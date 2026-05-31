import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
// import * as googleTTS from 'google-tts-api';
import { GoogleGenAI } from '@google/genai';

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
    this.genAi = new GoogleGenAI({ apiKey });

    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
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
        model: 'models/gemini-2.0-flash-exp',
        voice: 'Aoede',
        systemInstruction: "You are Aether, a brilliant, friendly, and helpful real-time AI assistant.",
      },
      speechStarted: false,
      silenceStartTimestamp: 0,
      audioChunks: [],
      isGenerating: false,
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
            session.config.model = msg.setup.model || 'models/gemini-2.0-flash-exp';
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

          // Check for active speech signal in this chunk
          const hasSpeech = this.detectSpeech(chunkBuffer);

          if (hasSpeech) {
            // Barge-in (Interruption) Check:
            // If the user starts speaking while the assistant is generating/speaking,
            // we interrupt the assistant immediately.
            if (session.isGenerating) {
              console.log('Barge-in detected! Interrupting current generation...');
              // session.isGenerating = false;
              session.audioChunks = [];
              session.speechStarted = false;
              session.silenceStartTimestamp = 0;
              client.send(JSON.stringify({ serverContent: { interrupted: true } }));
              return;
            }

            if (!session.speechStarted) {
              console.log('Speech detected: user started speaking...', session);
              session.speechStarted = true;
            }
            session.silenceStartTimestamp = 0;
          } else {
            // No speech signal in this chunk
            if (session.speechStarted) {
              if (session.silenceStartTimestamp === 0) {
                session.silenceStartTimestamp = Date.now();
              } else if (Date.now() - session.silenceStartTimestamp > 1200) {
                // User stopped speaking (silence for > 1.2 seconds)
                console.log('Speech ended (silence timeout). Processing query...');
                session.speechStarted = false;
                session.silenceStartTimestamp = 0;

                // Process the query asynchronously
                this.processQuery(client, session);
              }
            }
          }

          // Accumulate audio chunks while speaking
          if (session.speechStarted) {
            session.audioChunks.push(chunkBuffer);

            // Safety limit: if recorded audio exceeds 15 seconds, trigger processing automatically
            const currentSize = session.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
            if (currentSize > 16000 * 2 * 15) {
              console.log('Safety limit reached (15 seconds of speech). Processing query...');
              session.speechStarted = false;
              session.silenceStartTimestamp = 0;
              this.processQuery(client, session);
            }
          }
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

  // --- Helpers for Audio and Gemini Processing ---

  private detectSpeech(buf: Buffer): boolean {
    const samplesCount = buf.length / 2;
    if (samplesCount === 0) return false;

    let sumSquares = 0;
    for (let i = 0; i < samplesCount; i++) {
      if (i * 2 + 1 >= buf.length) break;
      const sample = buf.readInt16LE(i * 2);
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / samplesCount);
    // An RMS value of > 400 represents human speech, whereas line noise/hum is typically < 150.
    return rms > 400;
  }

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
    if (!modelName) return 'gemini-3.1-flash-lite';
    if (modelName.includes('gemini-2.0')) {
      return 'gemini-2.0-flash';
    }
    if (modelName.includes('gemini-2.5')) {
      return 'gemini-2.5-flash';
    }
    if (modelName.includes('gemini-3.1')) {
      return 'gemini-3.1-flash-lite';
    }
    if (modelName.startsWith('models/')) {
      return modelName.substring(7);
    }
    return modelName;
  }

  private async transcribeAudio(wavBuffer: Buffer, model: string): Promise<string> {
    const base64Data = wavBuffer.toString('base64');
    const apiModel = this.mapModelName(model);
    console.log('Model we are using:', apiModel);

    const response = await this.genAi.models.generateContent({
      model: apiModel,
      contents: [
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: base64Data,
          },
        },
        'Transcribe the spoken audio exactly. Output ONLY the transcribed text, without any introductory, formatting, or explanatory text. If the audio is silent or contains no spoken words, respond with nothing.',
      ],
    });
    console.log('User Voice is transcribed:', response.text);

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

  private async processQuery(client: any, session: SessionState) {
    if (session.isGenerating) return;
    session.isGenerating = true;

    try {
      const audioBuffer = Buffer.concat(session.audioChunks);
      session.audioChunks = []; // Clear buffer for next turn

      if (audioBuffer.length === 0) {
        session.isGenerating = false;
        return;
      }

      console.log(`Processing user query: ${audioBuffer.length} bytes buffer`);
      const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
      if (!apiKey) {
        throw new Error('Gemini API Key is not configured on the server.');
      }

      // 1. PCM to WAV conversion
      const wavBuffer = this.pcmToWav(audioBuffer, 16000);

      // 2. Speech-to-Text
      const transcript = await this.transcribeAudio(wavBuffer, session.config.model);
      console.log(`Transcribed text: "${transcript}"`);

      if (!transcript.trim()) {
        console.log('Empty transcription. Skipping response.');
        session.isGenerating = false;
        return;
      }

      // Send user transcript back to client so they can display it in chat history
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            userContent: {
              text: transcript,
            },
          }),
        );
      }

      console.log('session is still active', session.isGenerating);
      // Check if connection was closed or interrupted
      if (!session.isGenerating) return;

      // 3. Invoke LLM agent in stream mode
      const responseStream = await this.generateResponseStream(
        transcript,
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
      session.isGenerating = false;
    }
  }
}
