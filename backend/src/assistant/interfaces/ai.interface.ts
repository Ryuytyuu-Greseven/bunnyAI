import { UserConfig } from '../types/assistant.types';

export interface IAiService {
  hasValidApiKey(): boolean;
  transcribeAudio(wavBuffer: Buffer, model: string): Promise<string>;
  generateResponseStream(query: string, config: UserConfig): Promise<any>;
  textToSpeech(
    text: string,
    voice: string,
  ): Promise<{ base64: string; mimeType: string }>;
  getDefaultConfig(): UserConfig;
  parseSetupConfig(setupConfig: any): UserConfig;
  formatResponsePayload(
    base64Audio: string,
    mimeType: string,
    text: string,
  ): any;
}
