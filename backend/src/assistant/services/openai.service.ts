import { Injectable, Logger } from '@nestjs/common';
import { IAiService } from '../interfaces/ai.interface';
import { UserConfig } from '../types/assistant.types';

@Injectable()
export class OpenAiService implements IAiService {
  private readonly logger = new Logger(OpenAiService.name);

  public hasValidApiKey(): boolean {
    this.logger.log('Checking OpenAI API Key (stub)');
    return true;
  }

  public async transcribeAudio(
    wavBuffer: Buffer,
    model: string,
  ): Promise<string> {
    this.logger.log(
      `Transcribing audio with OpenAI Whisper (stub) - model: ${model}`,
    );
    return 'This is a stub transcription from OpenAI Whisper.';
  }

  public createSttStream(
    onData: (data: any) => void,
    onError: (err: any) => void,
  ): any {
    this.logger.log('createSttStream with OpenAI (stub)');
    const { PassThrough } = require('stream');
    return new PassThrough({ objectMode: true });
  }

  public async generateResponseStream(
    query: string,
    config: UserConfig,
  ): Promise<any> {
    this.logger.log(
      `Generating response stream with OpenAI (stub) - query: "${query}"`,
    );

    const mockChunks = [
      {
        text: `[en]: Hello! This is a mock response from OpenAI service. You queried: "${query}".`,
      },
    ];

    return (async function* () {
      for (const chunk of mockChunks) {
        yield chunk;
      }
    })();
  }

  public async textToSpeech(
    text: any,
    voice: string,
    onAudioChunk: (base64Audio: string, text: string, client: any) => void,
    session: any,
    client: any
  ): Promise<void> {
    this.logger.log(`textToSpeech streaming stub (OpenAI)`);
    let sentenceBuffer = '';
    for await (const chunk of text) {
      if (!session.isGenerating) break;
      const chunkText = chunk.text || '';
      sentenceBuffer += chunkText;

      let boundaryIndex = -1;
      for (let i = 0; i < sentenceBuffer.length; i++) {
        if (
          sentenceBuffer[i] === '.' ||
          sentenceBuffer[i] === '?' ||
          sentenceBuffer[i] === '!'
        ) {
          boundaryIndex = i;
          break;
        }
      }
      if (boundaryIndex !== -1) {
        const sentence = sentenceBuffer.substring(0, boundaryIndex + 1).trim();
        sentenceBuffer = sentenceBuffer.substring(boundaryIndex + 1);
        if (sentence) {
          onAudioChunk('', sentence + ' ', client);
          const dummyBase64 =
            'UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA';
          onAudioChunk(dummyBase64, '', client);
        }
      }
    }
    if (session.isGenerating && sentenceBuffer.trim()) {
      onAudioChunk('', sentenceBuffer.trim() + ' ', client);
      const dummyBase64 =
        'UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA';
      onAudioChunk(dummyBase64, '', client);
    }
  }

  public getDefaultConfig(): UserConfig {
    return {
      model: 'gpt-4o',
      voice: 'alloy',
      systemInstruction:
        'You are Madhuri, a brilliant, friendly, and helpful real-time AI assistant.',
      business: 'Customer Success',
    };
  }

  public parseSetupConfig(setupConfig: any): UserConfig {
    return {
      model: setupConfig.model || 'gpt-4o',
      systemInstruction: setupConfig.systemInstruction || '',
      voice: setupConfig.voice || 'alloy',
      business: setupConfig.business || 'Customer Success',
    };
  }

  public formatResponsePayload(
    base64Audio: string,
    mimeType: string,
    text: string,
  ): any {
    return {
      serverContent: {
        modelTurn: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Audio,
              },
            },
            {
              text,
            },
          ],
        },
      },
    };
  }
}
