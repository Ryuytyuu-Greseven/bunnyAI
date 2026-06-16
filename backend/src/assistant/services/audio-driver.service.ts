import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 } from '@google-cloud/speech';
import { DeepGram } from '../stt/deepgram/transcribe';

export interface AudioDriverCallbacks {
  onTranscript: (text: string) => void;
  onBargeIn: () => void;
}

export interface AudioSessionConfig {
  /** Google STT encoding. Defaults to LINEAR16 for app clients; set MULAW for Twilio. */
  encoding?: 'LINEAR16' | 'MULAW';
  /** Sample rate in Hz. Defaults to 16000 for LINEAR16; use 8000 for Twilio mulaw. */
  sampleRateHertz?: number;
}

interface AudioSession {
  stream: any | null;
  silenceTimer: NodeJS.Timeout | null;
  speechDetectedByGoogle: boolean;
  callbacks: AudioDriverCallbacks;
  encoding: 'LINEAR16' | 'MULAW';
  sampleRateHertz: number;
}

/**
 * AudioDriverService — owns the Google Cloud STT lifecycle per session.
 *
 * Why separate from AssistantService:
 *   AssistantService had silence detection wired to STT data events (interim
 *   transcripts), which means the 1-second timer only reset when Google sent
 *   a result — not when audio chunks actually arrived. If Google didn't send
 *   interim results quickly enough the timer fired with an empty transcript.
 *
 * This service instead:
 *   1. Resets the silence timer on every incoming audio CHUNK (not STT events).
 *   2. On silence (800 ms of no audio), calls stream.end() — this closes the
 *      write side of the gRPC duplex stream and forces Google to emit the
 *      final isFinal:true result for whatever audio it has buffered.
 *   3. Reopens a fresh stream immediately after, ready for the next utterance.
 *   4. Fires onBargeIn() the moment the first audio chunk arrives while the
 *      AI is generating, so TTS can be interrupted immediately.
 */
@Injectable()
export class AudioDriverService {
  private readonly logger = new Logger(AudioDriverService.name);
  private readonly speechClient: v2.SpeechClient;
  private readonly recognizerPath: string;
  private readonly sessions = new Map<string, AudioSession>();

  private STT_SERVICE = 'deepgram';

  constructor(private readonly configService: ConfigService, private readonly deepgramService: DeepGram) {
    const location =
      configService.get<string>('GOOGLE_CLOUD_LOCATION_IN') || 'global';

    this.speechClient = new v2.SpeechClient({
      apiEndpoint: `${location}-speech.googleapis.com`,
    });

    const projectId = configService.get<string>('GOOGLE_CLOUD_PROJECT') || '';
    const recognizerId =
      configService.get<string>('GOOGLE_CLOUD_STT_RECOGNIZER_ID') || '';
    this.recognizerPath = `projects/${projectId}/locations/${location}/recognizers/${recognizerId}`;

    this.logger.log(
      `[AudioDriver] Initialized. Recognizer: ${this.recognizerPath}`,
    );
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  async startSession(
    sessionId: string,
    callbacks: AudioDriverCallbacks,
    audioConfig?: AudioSessionConfig,
  ) {
    const session: AudioSession = {
      stream: null,
      silenceTimer: null,
      speechDetectedByGoogle: false,
      callbacks,
      encoding: audioConfig?.encoding ?? 'LINEAR16',
      sampleRateHertz: audioConfig?.sampleRateHertz ?? 16000,
    };
    this.sessions.set(sessionId, session);
    if (this.STT_SERVICE === 'deepgram') {
      await this.deepgramService.openConnection(sessionId, session)
    } else {
      this.openStream(sessionId, session);
    }
    this.logger.log(`[AudioDriver] Session started: ${sessionId}`);
  }

  /**
   * Feed a raw LINEAR16 audio buffer into the STT stream.
   * No barge-in or silence logic here — audio is just piped to Google.
   * All speech detection is driven by Google's transcript events.
   */
  feedAudio(sessionId: string, audio: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (this.STT_SERVICE === 'deepgram') {
      this.deepgramService.feedAudio(sessionId, audio, session)
    } else {
      if (session.stream && !session.stream.destroyed && session.stream.writable) {
        try {
          session.stream.write({ audio });
        } catch (err: any) {
          this.logger.error(
            `[AudioDriver] Write error, reopening stream: ${err.message}`,
          );
          this.openStream(sessionId, session);
        }
      }
    }
  }

  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (this.STT_SERVICE === 'deepgram') {
      this.deepgramService.closeConnection(sessionId);
    } else {
      this.clearSilenceTimer(session);
      this.destroyStream(session);
    }
    this.sessions.delete(sessionId);
    this.logger.log(`[AudioDriver] Session ended: ${sessionId}`);
  }

  // ─── Private stream lifecycle ─────────────────────────────────────────────

  private openStream(sessionId: string, session: AudioSession): void {
    this.destroyStream(session);

    this.logger.log(`[AudioDriver] Opening STT stream for: ${sessionId}`);

    const stream = this.speechClient._streamingRecognize();

    stream.on('data', (response: any) => {
      const result = response?.results?.[0];
      if (!result?.alternatives?.[0]) return;

      const transcript: string = result.alternatives[0].transcript ?? '';
      const isFinal: boolean = result.isFinal ?? false;

      process.stdout.write(
        `\r[STT] ${isFinal ? 'FINAL   ' : 'interim '}: "${transcript}"\n`,
      );

      if (!transcript.trim()) return;

      if (!isFinal) {
        // Google returned an interim transcript → real speech is happening.
        // Fire barge-in ONCE per utterance (not on background noise, not on audio chunks).
        if (!session.speechDetectedByGoogle) {
          session.speechDetectedByGoogle = true;
          session.callbacks.onBargeIn();
        }
        // Reset the post-speech silence timer so we give Google time to finalize
        this.resetSilenceTimer(sessionId, session);
      } else {
        // isFinal:true — Google is confident the utterance is complete
        this.clearSilenceTimer(session);
        session.speechDetectedByGoogle = false; // ready for next utterance
        session.callbacks.onTranscript(transcript.trim());
      }
    });

    stream.on('error', (err: any) => {
      this.logger.error(
        `[AudioDriver] STT stream error: ${err.message || err}`,
      );
      // Brief delay then reopen so we don't spin-loop on persistent errors
      setTimeout(() => {
        if (this.sessions.has(sessionId)) {
          session.speechDetectedByGoogle = false;
          this.openStream(sessionId, session);
        }
      }, 500);
    });

    stream.on('end', () => {
      this.logger.log(
        `[AudioDriver] STT stream closed — reopening for next utterance.`,
      );
      session.speechDetectedByGoogle = false;
      if (this.sessions.has(sessionId)) {
        this.openStream(sessionId, session);
      }
    });

    // First write: send the streaming config (no audio yet)
    stream.write({
      recognizer: this.recognizerPath,
      streamingConfig: {
        config: {
          explicitDecodingConfig: {
            encoding: session.encoding,
            sampleRateHertz: session.sampleRateHertz,
            audioChannelCount: 1,
          },
          languageCodes: ['en-US'],
          model: 'chirp_3',
        },
        streamingFeatures: {
          interimResults: true,
        },
      },
    });

    session.stream = stream;
  }

  /**
   * Started only when Google returns an INTERIM transcript (real speech detected).
   * If Google doesn't send isFinal within 1.5 s of the last interim result,
   * we end the stream to nudge it into finalization. Google's own VAD handles
   * clean cases; this timer is a safety net for slow or noisy finalization.
   */
  private resetSilenceTimer(sessionId: string, session: AudioSession): void {
    this.clearSilenceTimer(session);
    session.silenceTimer = setTimeout(() => {
      session.silenceTimer = null;
      this.logger.log(
        `[AudioDriver] No isFinal after speech — nudging stream.end() to force finalization.`,
      );
      if (session.stream && !session.stream.destroyed) {
        session.stream.end();
      }
    }, 1500);
  }

  private clearSilenceTimer(session: AudioSession): void {
    if (session.silenceTimer) {
      clearTimeout(session.silenceTimer);
      session.silenceTimer = null;
    }
  }

  private destroyStream(session: AudioSession): void {
    if (session.stream) {
      try {
        if (!session.stream.destroyed) {
          session.stream.destroy();
        }
      } catch {
        // ignore destroy errors
      }
      session.stream = null;
    }
  }
}
