import { DeepgramClient } from '@deepgram/sdk';
import { Logger } from '@nestjs/common';
import { V1Socket } from 'node_modules/@deepgram/sdk/dist/cjs/api/resources/listen/resources/v1/client/Socket';

interface DeepgramActiveSession {
  callbacks: {
    onTranscript: (text: string) => void;
    onBargeIn: () => void;
  };
  speechDetectedByDeepgram?: boolean;
}

export class DeepGram {
  connections = new Map<string, V1Socket>();
  // Per-session buffer of finalized (is_final) segments, flushed on speech_final.
  utterances = new Map<string, string>();
  logger = new Logger(DeepGram.name);

  async openConnection(
    sessionId: string,
    activeSession: DeepgramActiveSession,
  ) {
    console.log('New Connection');
    const client = new DeepgramClient();
    const connection = await client.listen.v1.connect({
      model: 'nova-3',
      language: 'en',
      punctuate: 'true',
      interim_results: 'true',
      encoding: 'linear16',
      sample_rate: 16000,
      Authorization: process.env.DEEPGRAM_API_KEY || '',
    });

    connection.on('open', () => console.log('Connection opened', sessionId));

    connection.on('message', (data) => {
      // console.log('This is user audio', data);
      if (data.type === 'Results') {
        const transcript: string =
          data.channel?.alternatives?.[0]?.transcript ?? '';
        const isFinal: boolean = data.is_final ?? false;
        const speechFinal: boolean = data.speech_final ?? false;

        // Fire barge-in once per utterance, as soon as any speech is detected —
        // don't wait for Deepgram to finalize the transcript before interrupting TTS.
        if (transcript.trim() && !activeSession.speechDetectedByDeepgram) {
          activeSession.speechDetectedByDeepgram = true;
          activeSession.callbacks.onBargeIn();
        }

        // Accumulate only finalized segments; interim results are ignored.
        if (isFinal && transcript.trim()) {
          const prev = this.utterances.get(sessionId) ?? '';
          this.utterances.set(sessionId, `${prev} ${transcript.trim()}`.trim());
        }

        // Deepgram signals end-of-speech via speech_final — flush the full utterance once.
        if (speechFinal) {
          activeSession.speechDetectedByDeepgram = false;
          const full = (this.utterances.get(sessionId) ?? '').trim();
          this.utterances.delete(sessionId);
          if (full) {
            activeSession.callbacks.onTranscript(full);
            console.log(full);
          }
        }
      }
    });

    connection.connect();
    await connection.waitForOpen();
    this.connections.set(sessionId, connection);
  }

  async feedAudio(
    sessionId: string,
    audioData: Buffer<ArrayBuffer>,
    activeSession: any,
  ) {
    // console.log('This is Deepgram key:', process.env.DEEPGRAM_API_KEY);
    const activeConnection = this.connections.get(sessionId);

    if (!activeConnection) {
    } else {
      // this.logger.log('In Receiver', audioData);
      activeConnection.socket.send(audioData);
    }
  }

  async closeConnection(sessionId: string) {
    const activeConnection = this.connections.get(sessionId);
    if (activeConnection) {
      this.logger.log('Closing connection for: ' + sessionId);
      activeConnection.close();
      this.connections.delete(sessionId);
      this.utterances.delete(sessionId);
    }
  }
}
