import WebSocket from 'ws';
import { Injectable, Logger } from '@nestjs/common';
import { SharedAiService } from './shared-ai.service';
import { SessionState } from '../types/assistant.types';
import { AgentService } from '../agents/agent.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { randomUUID } from 'crypto';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private sessions = new Map<any, SessionState>();

  constructor(
    private readonly sharedAiService: SharedAiService,
    private readonly agentService: AgentService,
    private readonly firebaseService: FirebaseService,
  ) {}

  // ─── Session lifecycle ────────────────────────────────────────────────────

  public initializeSession(client: any): void {
    this.logger.log('Client connected — initializing session');

    if (!this.sharedAiService.hasValidApiKey()) {
      this.logger.error('API key is not configured.');
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ error: 'Service down' }));
      }
      client.close();
      return;
    }

    const session: SessionState = {
      config: this.sharedAiService.getDefaultConfig(),
      sessionId: randomUUID(),
      speechStarted: false,
      silenceStartTimestamp: 0,
      audioChunks: [],
      isGenerating: false,
      accumulatedTranscript: '',
      lastSegmentHadSpeech: false,
      isTranscribing: false,
      segmentIndex: 0,
      queryQueue: [],
    };

    this.sessions.set(client, session);
  }

  public cleanupSession(client: any): void {
    this.logger.log('Client disconnected — cleaning up session');
    const session = this.sessions.get(client);
    if (session) {
      try {
        const { creditCardCheckpointer } = require('../agents/graphs/creditcards/graph/creditcard.graph');
        const { salesCheckpointer } = require('../agents/graphs/sales/graph/sales.graph');
        const { customerSupportCheckpointer } = require('../agents/graphs/customer-support/graph/customer-support.graph');
        const { lovebytCheckpointer } = require('../agents/graphs/lovebyt/graph/lovebyt.graph');
        creditCardCheckpointer.storage = {};
        salesCheckpointer.storage = {};
        customerSupportCheckpointer.storage = {};
        lovebytCheckpointer.storage = {};
      } catch (e) {
        this.logger.error('Error clearing LangGraph checkpointer:', e);
      }
      this.sessions.delete(client);
    }
  }

  /** Returns the sessionId for this client — used by AudioDriverService keying. */
  public getSessionId(client: any): string | undefined {
    return this.sessions.get(client)?.sessionId;
  }

  // ─── Setup message ────────────────────────────────────────────────────────

  public initiateAgentState(client: any, setupConfig: any): void {
    const session = this.sessions.get(client);
    if (!session) return;

    session.config = this.sharedAiService.parseSetupConfig(setupConfig);
    this.logger.log(
      `Agent configured: business="${session.config.business}", voice="${session.config.voice}"`,
    );

    // Trigger initial greeting
    session.queryQueue.push('SYSTEM_START_CONVERSATION');
    this.processQueryQueue(client, session);
  }

  // ─── AudioDriver callbacks ────────────────────────────────────────────────

  /**
   * Called by AudioDriverService when the first audio chunk of a new
   * utterance arrives. Interrupts any in-progress TTS immediately.
   */
  public handleBargeIn(client: any): void {
    const session = this.sessions.get(client);
    if (!session || !session.isGenerating) return;

    this.logger.log('[Barge-in] User started speaking — interrupting AI.');
    session.isGenerating = false;

    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ serverContent: { interrupted: true } }));
    }
  }

  /**
   * Called by AudioDriverService once Google STT returns a finalized
   * transcript for the user's utterance. Queues it for the LLM pipeline.
   */
  public onTranscriptReady(client: any, text: string): void {
    const session = this.sessions.get(client);
    if (!session || !text.trim()) return;

    this.logger.log(`[Transcript] "${text}"`);

    // Echo to frontend so it can display the user's words
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ userContent: { text } }));
    }

    // Persist the user's message
    void this.firebaseService.saveMessage(
      session.sessionId,
      'user',
      text,
      session.config.business ?? 'unknown',
    );

    session.queryQueue.push(text);
    this.processQueryQueue(client, session);
  }

  // ─── LLM + TTS pipeline ──────────────────────────────────────────────────

  private async processQueryQueue(client: any, session: SessionState): Promise<void> {
    if (!session.queryQueue || session.queryQueue.length === 0) return;

    const queryText = session.queryQueue.shift()!;
    session.isGenerating = true;

    try {
      this.logger.log(`[LLM] Processing: "${queryText}"`);

      // Wrap the agent stream so we can accumulate the full AI text for storage
      const rawStream = this.agentService.runAgent(
        queryText,
        session.config,
        session.sessionId,
      );
      const { stream: responseStream, getText } = this.captureTextStream(rawStream);

      await this.sharedAiService.textToSpeech(
        responseStream,
        session.config.voice,
        this.onAudioChunk,
        session,
        client,
      );

      // Persist the assistant's full reply after TTS completes
      const aiText = getText();
      if (aiText && queryText !== 'SYSTEM_START_CONVERSATION') {
        void this.firebaseService.saveMessage(
          session.sessionId,
          'assistant',
          aiText,
          session.config.business ?? 'unknown',
        );
      }
    } catch (err: any) {
      this.logger.error('Error in LLM/TTS pipeline:', err);
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ error: `Processing error: ${err.message || err}` }));
      }
    } finally {
      this.processQueryQueue(client, session);
    }
  }

  /**
   * Wraps an async generator so callers can still iterate it normally while
   * we silently accumulate the text yielded by each chunk.
   * getText() returns the concatenated result after the stream is exhausted.
   */
  private captureTextStream(source: AsyncGenerator<{ text: string }>): {
    stream: AsyncGenerator<{ text: string }>;
    getText: () => string;
  } {
    let accumulated = '';
    const stream = (async function* () {
      for await (const chunk of source) {
        const t = typeof chunk?.text === 'string' ? chunk.text : (chunk as any)?.content ?? '';
        if (t) accumulated += t;
        yield chunk;
      }
    })();
    return { stream, getText: () => accumulated };
  }

  // Streams synthesized audio and text chunks back to the WebSocket client
  onAudioChunk(base64Audio: string, text: string, client: any): void {
    const parts: any[] = [];
    if (base64Audio) {
      parts.push({ inlineData: { mimeType: 'audio/l16', data: base64Audio } });
    }
    if (text) {
      parts.push({ text });
    }

    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ serverContent: { modelTurn: { parts } } }));
    }
  }
}
