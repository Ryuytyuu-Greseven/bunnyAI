import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAiService } from '../interfaces/ai.interface';
import { UserConfig } from '../types/assistant.types';
import { GeminiService } from './gemini.service';
import { OpenAiService } from './openai.service';

@Injectable()
export class SharedAiService implements IAiService {
  private readonly logger = new Logger(SharedAiService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly geminiService: GeminiService,
    private readonly openAiService: OpenAiService,
  ) { }

  private getProviderService(providerName: string): IAiService {
    const provider = (providerName || '').toLowerCase().trim();
    switch (provider) {
      case 'openai':
        return this.openAiService;
      case 'gemini':
      default:
        return this.geminiService;
    }
  }

  public hasValidApiKey(): boolean {
    const defaultProvider =
      this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const service = this.getProviderService(defaultProvider);
    this.logger.log(
      `Checking API Key validity for active AI provider: ${defaultProvider}`,
    );
    return service.hasValidApiKey();
  }

  public async transcribeAudio(
    wavBuffer: Buffer,
    model: string,
  ): Promise<string> {
    const defaultProvider =
      this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const transcriptionProvider =
      this.configService.get<string>('TRANSCRIPTION_PROVIDER') ||
      defaultProvider;
    const service = this.getProviderService(transcriptionProvider);
    this.logger.log(
      `Routing transcribeAudio to transcription provider: ${transcriptionProvider}`,
    );
    return service.transcribeAudio(wavBuffer, model);
  }

  public createSttStream(
    onData: (data: string, isFinal: boolean) => void,
    onError: (err: any) => void,
  ): any {
    const defaultProvider =
      this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const transcriptionProvider =
      this.configService.get<string>('TRANSCRIPTION_PROVIDER') ||
      defaultProvider;
    const service = this.getProviderService(transcriptionProvider);
    this.logger.log(
      `Routing createSttStream to transcription provider: ${transcriptionProvider}`,
    );
    return service.createSttStream(onData, onError);
  }

  public async generateResponseStream(
    query: string,
    config: UserConfig,
  ): Promise<any> {
    const defaultProvider =
      this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const service = this.getProviderService(defaultProvider);
    this.logger.log(
      `Routing generateResponseStream to AI provider: ${defaultProvider}`,
    );
    return service.generateResponseStream(query, config);
  }

  public async textToSpeech(
    llmStream: any,
    voice: string,
    onAudioChunk: (base64Audio: string, text: string, client: any) => void,
    session: any,
    client: any
  ): Promise<void> {
    const defaultProvider =
      this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const ttsProvider =
      this.configService.get<string>('TTS_PROVIDER') || defaultProvider;
    const service = this.getProviderService(ttsProvider);
    this.logger.log(
      `Routing textToSpeech stream to TTS provider: ${ttsProvider}`,
    );
    return service.textToSpeech(llmStream, voice, onAudioChunk, session, client);
  }

  public getDefaultConfig(): UserConfig {
    const defaultProvider =
      this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const service = this.getProviderService(defaultProvider);
    return service.getDefaultConfig();
  }

  public parseSetupConfig(setupConfig: any): UserConfig {
    const defaultProvider =
      this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const service = this.getProviderService(defaultProvider);
    return service.parseSetupConfig(setupConfig);
  }

  public formatResponsePayload(
    base64Audio: string,
    mimeType: string,
    text: string,
  ): any {
    const defaultProvider =
      this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const service = this.getProviderService(defaultProvider);
    return service.formatResponsePayload(base64Audio, mimeType, text);
  }
}
