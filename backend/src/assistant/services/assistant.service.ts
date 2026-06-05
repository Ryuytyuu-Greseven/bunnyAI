import WebSocket from 'ws';
import { Injectable, Logger } from '@nestjs/common';
import { SharedAiService } from './shared-ai.service';
import { SessionState } from '../types/assistant.types';
import { pcmToWav } from '../helpers/audio.helper';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private sessions = new Map<any, SessionState>();

  constructor(private readonly sharedAiService: SharedAiService) { }

  public initializeSession(client: any): void {
    this.logger.log('Client connected to WebSocket Gateway');

    if (!this.sharedAiService.hasValidApiKey()) {
      this.logger.error('Error: API Key is not configured on the server.');
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            error: 'Service down',
          }),
        );
      }
      client.close();
      return;
    }

    // Initialize state for this connection
    const session: SessionState = {
      config: this.sharedAiService.getDefaultConfig(),
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

    // Initialize real-time Speech-to-Text stream
    try {
      this.logger.log('Sessions strtreaming started');
      session.sttStream = this.sharedAiService.createSttStream(
        (data: any) => this.handleSttData(client, data),
        (err: any) => this.handleSttError(client, err),
      );
      this.logger.log(`Stream Check 2: ${session.sttStream.destroyed}`);
    } catch (err) {
      this.logger.error('Failed to create STT stream for connection:', err);
    }
  }

  public cleanupSession(client: any): void {
    this.logger.log('Client disconnected from WebSocket Gateway');
    const session = this.sessions.get(client);
    if (session) {
      if (session.silenceTimeout) {
        clearTimeout(session.silenceTimeout);
        session.silenceTimeout = null;
      }
      if (session.sttStream) {
        try {
          session.sttStream.end();
        } catch (e) {
          this.logger.error('Error ending STT stream during cleanup:', e);
        }
      }
      this.sessions.delete(client);
    }
  }

  public updateSessionConfig(client: any, setupConfig: any): void {
    const session = this.sessions.get(client);
    if (session) {
      session.config = this.sharedAiService.parseSetupConfig(setupConfig);
      this.logger.log(
        `Session setup updated: ${JSON.stringify(session.config)}`,
      );
    }
  }

  public handleAudioChunk(client: any, base64Audio: string): void {
    const session = this.sessions.get(client);
    if (!session) return;

    const chunkBuffer = Buffer.from(base64Audio, 'base64');
    if (session.sttStream) {
      try {
        session.sttStream.write({
          audio: chunkBuffer,
        });
      } catch (err) {
        this.logger.error('Error writing to STT stream:', err);
      }
    } else {
      this.logger.error('STT stream is not initialized');
    }
  }

  private handleSttData(client: any, transcript: any): void {
    const session = this.sessions.get(client);
    if (!session || !transcript) return;

    const cleaned = transcript.trim();
    if (!cleaned) return;

    // Reset silence timeout
    this.resetSilenceTimeout(client, session);

    if (cleaned) {
      this.logger.log(`[STT Stream] Final segment: "${cleaned}"`);
      session.accumulatedTranscript = session.accumulatedTranscript
        ? session.accumulatedTranscript + ' ' + cleaned
        : cleaned;

      // Send to client
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            userContent: {
              text: cleaned,
            },
          }),
        );
      }
    }
  }

  private handleSttError(client: any, err: any): void {
    this.logger.error(`[STT Stream] Error: ${err.message || err}`, err);
  }

  private resetSilenceTimeout(client: any, session: SessionState): void {
    if (session.silenceTimeout) {
      clearTimeout(session.silenceTimeout);
      session.silenceTimeout = null;
    }

    session.silenceTimeout = setTimeout(() => {
      this.handleSilenceTimeout(client, session);
    }, 1000);
  }

  private handleSilenceTimeout(client: any, session: SessionState): void {
    session.silenceTimeout = null;
    if (session.accumulatedTranscript.trim().length > 0) {
      this.logger.log(
        `[Silence Timeout] Silence detected. Triggering LLM query.`,
      );
      this.triggerLlmQuery(client, session);
    }
  }

  private triggerLlmQuery(client: any, session: SessionState) {
    if (session.accumulatedTranscript.trim().length > 0) {
      const textToProcess = session.accumulatedTranscript;
      session.accumulatedTranscript = '';
      this.logger.log(`Queueing LLM response for: "${textToProcess}"`);
      if (!session.queryQueue) {
        session.queryQueue = [];
      }
      session.queryQueue.push(textToProcess);
      this.processQueryQueue(client, session);
    }
  }

  private async processQueryQueue(client: any, session: SessionState) {
    if (!session.queryQueue || session.queryQueue.length === 0) return;

    const queryText = session.queryQueue.shift()!;
    session.isGenerating = true;

    try {
      this.logger.log(`Processing user query with LLM: "${queryText}"`);

      // Check if connection was closed or interrupted
      if (!session.isGenerating) return;

      // Invoke LLM agent in stream mode
      const responseStream = await this.sharedAiService.generateResponseStream(
        queryText,
        session.config,
      );
      // Call streaming text to speech
      await this.sharedAiService.textToSpeech(
        responseStream,
        session.config.voice,
        (base64Audio: string, text: string) => {
          if (!session.isGenerating) return;

          const parts: any[] = [];
          if (base64Audio) {
            parts.push({
              inlineData: {
                mimeType: 'audio/l16', // LINEAR16 raw PCM
                data: base64Audio,
              },
            });
          }
          if (text) {
            parts.push({
              text,
            });
          }

          const responsePayload = {
            serverContent: {
              modelTurn: {
                parts,
              },
            },
          };

          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(responsePayload));
          }
        },
        session,
      );
    } catch (err) {
      this.logger.error('Error during query processing:', err);
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            error: `Processing error: ${err.message || err}`,
          }),
        );
      }
    } finally {
      this.processQueryQueue(client, session);
    }
  }
}
