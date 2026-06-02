export interface UserConfig {
  model: string;
  voice: string;
  systemInstruction: string;
}

export interface SessionState {
  config: UserConfig;
  speechStarted: boolean;
  silenceStartTimestamp: number;
  audioChunks: Buffer[];
  isGenerating: boolean;
  accumulatedTranscript: string;
  lastSegmentHadSpeech: boolean;
  isTranscribing: boolean;
  segmentIndex: number;
  queryQueue: string[];
}
