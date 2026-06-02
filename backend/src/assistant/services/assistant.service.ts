import WebSocket from 'ws';
import { Injectable, Logger } from '@nestjs/common';
import { SharedAiService } from './shared-ai.service';
import { SessionState } from '../types/assistant.types';
import { pcmToWav } from '../helpers/audio.helper';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private sessions = new Map<any, SessionState>();

  constructor(private readonly sharedAiService: SharedAiService) {}

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
    this.sessions.set(client, {
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
    });
  }

  public cleanupSession(client: any): void {
    this.logger.log('Client disconnected from WebSocket Gateway');
    this.sessions.delete(client);
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

    // Always accumulate audio chunks while not generating
    session.audioChunks.push(chunkBuffer);

    // Try to process periodic segments
    this.checkAndProcessSegments(client, session);
  }

  // processing for every 5seconds
  private async checkAndProcessSegments(client: any, session: SessionState) {
    const totalSize = session.audioChunks.reduce(
      (acc, chunk) => acc + chunk.length,
      0,
    );
    if (totalSize < 160000) {
      return;
    }

    session.isTranscribing = true;

    try {
      const concatenated = Buffer.concat(session.audioChunks);
      const segment = concatenated.subarray(0, 160000);
      const remainder = concatenated.subarray(160000);

      session.audioChunks = remainder.length > 0 ? [remainder] : [];

      // Convert segment to WAV format
      const wavBuffer = pcmToWav(segment, 16000);

      const currentIdx = session.segmentIndex;
      session.segmentIndex = currentIdx + 1;

      // Transcribe using Speech-to-Text
      const transcript = await this.sharedAiService.transcribeAudio(
        wavBuffer,
        session.config.model,
      );
      const cleaned = transcript.trim();

      if (cleaned.length > 0) {
        this.logger.log(`Segment transcription: "${cleaned}"`);
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
      } else {
        this.logger.log('Segment transcription is empty.');
        // User stopped talking (silence). Send accumulated text to LLM
        this.triggerLlmQuery(client, session);
      }
    } catch (err) {
      this.logger.error('Error during segment processing:', err);
    } finally {
      session.isTranscribing = false;
      // Recursively call to check if more segments can be processed
      await this.checkAndProcessSegments(client, session);
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

  private async speakAndSend(
    client: any,
    session: SessionState,
    sentence: string,
    lang: string,
  ) {
    try {
      this.logger.log(`TTS synthesis for sentence: "${sentence}" in [${lang}]`);
      const { base64: base64Audio, mimeType } =
        await this.sharedAiService.textToSpeech(sentence, session.config.voice);

      if (!session.isGenerating) return;

      const responsePayload = this.sharedAiService.formatResponsePayload(
        base64Audio,
        mimeType,
        sentence + ' ',
      );

      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(responsePayload));
      }
    } catch (err) {
      this.logger.error('Error in speakAndSend:', err);
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

      // Check if connection was closed or interrupted
      if (!session.isGenerating) return;

      let buffer = '';
      let detectedLang = 'en';
      let languageExtracted = false;

      // Iterate over LLM response stream, synthesizing and sending sentence-by-sentence
      for await (const chunk of responseStream) {
        if (!session.isGenerating) break;

        const chunkText = chunk.text || '';
        buffer += chunkText;

        // Extract language prefix if present
        if (!languageExtracted) {
          if (buffer.includes(']:')) {
            const prefixIndex = buffer.indexOf(']:');
            const prefix = buffer.substring(0, prefixIndex + 2); // e.g. "[en]:"
            const match = prefix.match(/^\[([a-z]{2})\]:/);
            if (match) {
              detectedLang = match[1];
            }
            buffer = buffer.substring(prefixIndex + 2); // strip the prefix from the buffer
            languageExtracted = true;
          } else if (buffer.length > 20) {
            // Fallback if no prefix found after 20 characters
            languageExtracted = true;
          }
        }

        // Check for sentence boundaries in buffer
        let boundaryIndex = -1;
        for (let i = 0; i < buffer.length; i++) {
          if (
            buffer[i] === '.' ||
            buffer[i] === '?' ||
            buffer[i] === '!' ||
            buffer[i] === '\n'
          ) {
            boundaryIndex = i;
            break;
          }
        }

        if (boundaryIndex !== -1) {
          const sentence = buffer.substring(0, boundaryIndex + 1).trim();
          buffer = buffer.substring(boundaryIndex + 1);

          if (sentence) {
            await this.speakAndSend(client, session, sentence, detectedLang);
          }
        }
      }

      // Send remaining text in buffer
      if (session.isGenerating && buffer.trim()) {
        await this.speakAndSend(client, session, buffer.trim(), detectedLang);
      }
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
