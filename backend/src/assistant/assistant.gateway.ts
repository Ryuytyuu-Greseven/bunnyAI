import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
// import * as googleTTS from 'google-tts-api';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

interface UserConfig {
  model: string;
  voice: string;
  systemInstruction: string;
}

interface SessionState {
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

@WebSocketGateway({ path: '/ws' })
export class AssistantGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  private sessions = new Map<any, SessionState>();

  private genAi: GoogleGenAI;


  constructor(private configService: ConfigService) { }

  handleConnection(client: any) {
    console.log('Client connected to WebSocket Gateway');

    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.genAi = new GoogleGenAI({
      vertexai: true, apiKey,
    });

    if (!apiKey || apiKey === 'YOUR_GEMINI_HERE') {
      console.error('Error: Gemini API Key is not configured on the server.');
      client.send(
        JSON.stringify({
          error: 'Gemini API Key is not configured on the server. Please add it to your server .env file.',
        }),
      );
      client.close();
      return;
    }

    // Initialize state for this connection
    this.sessions.set(client, {
      config: {
        model: 'models/gemini-3.1-flash-lite',
        voice: 'Aoede',
        systemInstruction: "You are Aether, a brilliant, friendly, and helpful real-time AI assistant.",
      },
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

    // Listen to messages from the browser client
    client.on('message', async (data: any) => {
      try {
        const messageStr = data.toString();
        const msg = JSON.parse(messageStr);

        // 1. Handle Setup configuration message
        if (msg.setup) {
          const session = this.sessions.get(client);
          if (session) {
            session.config.model = msg.setup.model || 'models/gemini-3.1-flash-lite';
            session.config.systemInstruction = msg.setup.systemInstruction?.parts?.[0]?.text || '';
            session.config.voice = msg.setup.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName || 'Aoede';
            console.log('Session setup updated:', session.config);
          }
          return;
        }

        // 2. Handle Realtime Input (Audio Chunks)
        if (msg.realtimeInput && msg.realtimeInput.audio) {
          const session = this.sessions.get(client);
          if (!session) return;

          const base64Audio = msg.realtimeInput.audio.data;
          const chunkBuffer = Buffer.from(base64Audio, 'base64');

          // Always accumulate audio chunks while not generating
          session.audioChunks.push(chunkBuffer);

          // Try to process periodic segments
          this.checkAndProcessSegments(client, session);
        }
      } catch (err) {
        console.error('Error handling client message:', err);
      }
    });

    client.on('error', (err: any) => {
      console.error('Client WebSocket error:', err);
    });
  }

  handleDisconnect(client: any) {
    console.log('Client disconnected from WebSocket Gateway');
    this.sessions.delete(client);
  }

  private async checkAndProcessSegments(client: any, session: SessionState) {

    const totalSize = session.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
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
      const wavBuffer = this.pcmToWav(segment, 16000);

      // Save segment audio to a WAV file in recordings directory
      const recordingsDir = path.join(process.cwd(), 'recordings');
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
      }
      const currentIdx = session.segmentIndex;
      session.segmentIndex = currentIdx + 1;
      // const filename = `segment_${Date.now()}_idx${currentIdx}.wav`;
      // const filePath = path.join(recordingsDir, filename);
      // await fs.promises.writeFile(filePath, wavBuffer);
      // console.log(`Saved segment audio to: ${filePath}`);

      // Transcribe using Speech-to-Text
      const transcript = await this.transcribeAudio(wavBuffer, session.config.model);
      const cleaned = transcript.trim();

      if (cleaned.length > 0) {
        console.log(`Segment transcription: "${cleaned}"`);
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
        console.log('Segment transcription is empty.');
        // User stopped talking (silence). Send accumulated text to LLM
        this.triggerLlmQuery(client, session);
      }
    } catch (err) {
      console.error('Error during segment processing:', err);
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
      console.log(`Queueing LLM response for: "${textToProcess}"`);
      if (!session.queryQueue) {
        session.queryQueue = [];
      }
      session.queryQueue.push(textToProcess);
      this.processQueryQueue(client, session);
    }
  }

  // --- Helpers for Audio and Gemini Processing ---

  private pcmToWav(pcmBuffer: Buffer, sampleRate: number = 16000): Buffer {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);
    return Buffer.concat([header, pcmBuffer]);
  }

  private mapModelName(modelName: string): string {
    return 'gemini-3.1-flash-lite';
  }

  private async transcribeAudio(wavBuffer: Buffer, model: string): Promise<string> {
    const base64Data = wavBuffer.toString('base64');
    const apiModel = this.mapModelName(model);

    const response = await this.genAi.models.generateContent({
      model: apiModel,
      contents: [
        {
          text:
            "You are an audio transcriber. Listen carefully. If the audio contains only background noise, " +
            "static, breath, hums, or silence, the transcript property MUST be an empty string." +
            "Do not hallucinate the words, just transcribe what you hear. Always make sure no over thinking or hallusinating. You shall transcribe the words as it is and never change words to other words." +
            "Never output timestamps or strings like '00:00' under any circumstances."
        },
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: base64Data,
          },
        }
      ],
    });
    if (response.text) {
      console.log('User Voice is transcribed: ', response.text);
    }

    return response.text?.trim() || '';
  }

  private async generateResponseStream(
    query: string,
    config: UserConfig,
  ): Promise<any> {
    const clientData = `
CLIENT: Oracle HCM Support Assistant (Aether)
SCOPE: Help employees and HR administrators with Oracle HCM SaaS product inquiries.
FAQ/KNOWLEDGE BASE:
1. How to apply for leave?
   - Navigate to 'Me' -> 'Time and Absence' -> 'Add Absence'. Select absence type, dates, and click Submit.
2. How to view my payslip?
   - Navigate to 'Me' -> 'Pay' -> 'My Payslips'. You can view or download payslips for any pay period.
3. How to update personal info (address, phone)?
   - Go to 'Me' -> 'Personal Information' -> 'Personal Details'. Click Edit on the section you want to update, enter the new details, and submit.
4. Support Escalation:
   - If an issue is unsolvable (e.g., payroll discrepancies, system errors), route the call to a live agent.
`;

    const finalSystemInstruction = `${config.systemInstruction}

Here is the CLIENT-SPECIFIC DATA you must use to answer the user's queries:
${clientData}

CRITICAL RULES:
1. You must respond in the same language as the user's query. If the user speaks in English, Telugu, or Hindi, respond in that language.
2. You must prefix your response with the language code in square brackets, followed by a colon.
   - For English: [en]: <your response>
   - For Telugu: [te]: <your response>
   - For Hindi: [hi]: <your response>
3. Keep your response concise (1-3 sentences maximum).
4. If you cannot solve the user's query based on the client data, explain politely that you will connect them to a live agent.`;

    const apiModel = this.mapModelName(config.model);
    console.log('Model we selected for the response generation stream:', apiModel);

    const responseStream = await this.genAi.models.generateContentStream({
      model: apiModel,
      contents: query,
      config: {
        systemInstruction: finalSystemInstruction,
      },
    });

    return responseStream;
  }

  private async textToSpeech(text: string, session: SessionState): Promise<{ base64: string; mimeType: string }> {
    console.log(`Now starting text to speech using Gemini model for: "${text}"`);
    const response = await this.genAi.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: text,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: session.config.voice }
          }
        }
      }
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    let base64 = '';
    let mimeType = 'audio/mp3';
    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        base64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || 'audio/mp3';
        break;
      }
    }

    if (!base64) {
      throw new Error('No audio data generated by Gemini TTS.');
    }
    console.log('Text to speach generation done');
    return { base64, mimeType };
  }

  private async speakAndSend(client: any, session: SessionState, sentence: string, lang: string) {
    try {
      console.log(`TTS synthesis for sentence: "${sentence}" in [${lang}]`);
      const { base64: base64Audio, mimeType } = await this.textToSpeech(sentence, session);

      if (!session.isGenerating) return;

      const responsePayload = {
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
                text: sentence + ' ',
              },
            ],
          },
        },
      };

      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(responsePayload));
      }
    } catch (err) {
      console.error('Error in speakAndSend:', err);
    }
  }

  private async processQueryQueue(client: any, session: SessionState) {
    if (!session.queryQueue || session.queryQueue.length === 0) return;

    const queryText = session.queryQueue.shift()!;
    session.isGenerating = true;

    try {
      console.log(`Processing user query with LLM: "${queryText}"`);

      // Check if connection was closed or interrupted
      if (!session.isGenerating) return;

      // 3. Invoke LLM agent in stream mode
      const responseStream = await this.generateResponseStream(
        queryText,
        session.config,
      );

      // Check if connection was closed or interrupted
      if (!session.isGenerating) return;

      let buffer = '';
      let detectedLang = 'en';
      let languageExtracted = false;

      // 4. Iterate over LLM response stream, synthesizing and sending sentence-by-sentence
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
          if (buffer[i] === '.' || buffer[i] === '?' || buffer[i] === '!' || buffer[i] === '\n') {
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

      // 5. Send remaining text in buffer
      if (session.isGenerating && buffer.trim()) {
        await this.speakAndSend(client, session, buffer.trim(), detectedLang);
      }

    } catch (err) {
      console.error('Error during query processing:', err);
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
