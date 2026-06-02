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
    text: string,
    voice: string,
  ): Promise<{ base64: string; mimeType: string }> {
    this.logger.log(
      `Synthesizing TTS with OpenAI TTS (stub) - text: "${text}", voice: "${voice}"`,
    );
    // Return a dummy base64 audio chunk
    const dummyBase64 =
      'UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA';
    return {
      base64: dummyBase64,
      mimeType: 'audio/mp3',
    };
  }

  public getDefaultConfig(): UserConfig {
    return {
      model: 'gpt-4o',
      voice: 'alloy',
      systemInstruction:
        'You are Madhuri, a brilliant, friendly, and helpful real-time AI assistant.',
    };
  }

  public parseSetupConfig(setupConfig: any): UserConfig {
    return {
      model: setupConfig.model || 'gpt-4o',
      systemInstruction: setupConfig.systemInstruction || '',
      voice: setupConfig.voice || 'alloy',
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
