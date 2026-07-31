import { UserConfig } from '../types/assistant.types';

export interface IAiService {
  hasValidApiKey(): boolean;
  transcribeAudio(wavBuffer: Buffer, model: string): Promise<string>;
  // generateResponseStream(query: string, config: UserConfig): Promise<any>;
  textToSpeech(
    llmStream: any,
    voice: string,
    onAudioChunk: (base64Audio: string, text: string, client: any) => void,
    session: any,
    client: any
  ): Promise<void>;
  getDefaultConfig(): UserConfig;
  parseSetupConfig(setupConfig: any): UserConfig;
  formatResponsePayload(
    base64Audio: string,
    mimeType: string,
    text: string,
  ): any;
  createSttStream(
    onData: (data: string, isFinal: boolean) => void,
    onError: (err: any) => void,
  ): any;
}
