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
    const defaultProvider = this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const service = this.getProviderService(defaultProvider);
    this.logger.log(`Checking API Key validity for active AI provider: ${defaultProvider}`);
    return service.hasValidApiKey();
  }

  public async transcribeAudio(wavBuffer: Buffer, model: string): Promise<string> {
    const defaultProvider = this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const transcriptionProvider = this.configService.get<string>('TRANSCRIPTION_PROVIDER') || defaultProvider;
    const service = this.getProviderService(transcriptionProvider);
    this.logger.log(`Routing transcribeAudio to transcription provider: ${transcriptionProvider}`);
    return service.transcribeAudio(wavBuffer, model);
  }

  public async generateResponseStream(query: string, config: UserConfig): Promise<any> {
    const defaultProvider = this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const service = this.getProviderService(defaultProvider);
    this.logger.log(`Routing generateResponseStream to AI provider: ${defaultProvider}`);
    return service.generateResponseStream(query, config);
  }

  public async textToSpeech(text: string, voice: string): Promise<{ base64: string; mimeType: string }> {
    const defaultProvider = this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const ttsProvider = this.configService.get<string>('TTS_PROVIDER') || defaultProvider;
    const service = this.getProviderService(ttsProvider);
    this.logger.log(`Routing textToSpeech to TTS provider: ${ttsProvider}`);
    return service.textToSpeech(text, voice);
  }

  public getDefaultConfig(): UserConfig {
    const defaultProvider = this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const service = this.getProviderService(defaultProvider);
    return service.getDefaultConfig();
  }

  public parseSetupConfig(setupConfig: any): UserConfig {
    const defaultProvider = this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const service = this.getProviderService(defaultProvider);
    return service.parseSetupConfig(setupConfig);
  }

  public formatResponsePayload(base64Audio: string, mimeType: string, text: string): any {
    const defaultProvider = this.configService.get<string>('AI_PROVIDER') || 'gemini';
    const service = this.getProviderService(defaultProvider);
    return service.formatResponsePayload(base64Audio, mimeType, text);
  }
}
