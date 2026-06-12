import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { v2 } from '@google-cloud/speech';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { UserConfig } from '../types/assistant.types';
import { IAiService } from '../interfaces/ai.interface';

@Injectable()
export class GeminiService implements IAiService {
  private readonly logger = new Logger(GeminiService.name);
  private genAi: GoogleGenAI;
  private readonly apiKey: string | undefined;
  private readonly speechClient: v2.SpeechClient;
  private readonly ttsClient: TextToSpeechClient;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.genAi = new GoogleGenAI({
      vertexai: true,
      apiKey: this.apiKey,
    });
    const location =
      this.configService.get<string>('GOOGLE_CLOUD_LOCATION_IN') || 'global';
    this.speechClient = new v2.SpeechClient({
      apiEndpoint: `${location}-speech.googleapis.com`,
    });

    this.speechClient
      .initialize()
      .then(() => {
        this.logger.log('Initiated');
      })
      .catch((error) => {
        this.logger.error(
          'Exception with initialising the speechClient',
          error,
        );
      });

    this.ttsClient = new TextToSpeechClient();
  }

  public hasValidApiKey(): boolean {
    return !!this.apiKey && this.apiKey !== 'YOUR_GEMINI_HERE';
  }

  private mapModelName(modelName: string): string {
    return 'gemini-3.1-flash-lite';
  }

  public async transcribeAudio(
    wavBuffer: Buffer,
    model: string,
  ): Promise<string> {
    const startTime = Date.now();
    const projectId = this.configService.get<string>('GOOGLE_CLOUD_PROJECT');
    const location = this.configService.get<string>('GOOGLE_CLOUD_LOCATION_IN');
    const recognizerId = this.configService.get<string>(
      'GOOGLE_CLOUD_STT_RECOGNIZER_ID',
    );

    const recognizerPath = `projects/${projectId}/locations/${location}/recognizers/${recognizerId}`;

    try {
      const speechClient = this.speechClient;
      const base64Data = wavBuffer.toString('base64');
      const request = {
        recognizer: recognizerPath,
        config: {
          languageCodes: ['en-US'],
          model: 'chirp_3',
        },
        interimResults: true,
        content: base64Data,
      };

      const [response] = await speechClient.recognize(request);

      if (!response.results || response.results.length === 0) {
        this.logger.log('[Cloud STT V2] No results returned.');
        return '';
      }

      const transcription = response.results
        .map((result) => result.alternatives?.[0]?.transcript || '')
        .join(' ')
        .trim();

      const duration = Date.now() - startTime;
      this.logger.log(
        `[Cloud STT V2] Transcribed: "${transcription}" in ${duration}ms`,
      );
      return transcription;
    } catch (err) {
      this.logger.error(
        `[Cloud STT V2] Failed to transcribe using Cloud Speech V2. Falling back to GeminiTranscribe. Error: ${err.message || err}`,
      );
      throw err;
    }
  }

  public createSttStream(
    onData: (data: string, isFinal: boolean) => void,
    onError: (err: any) => void,
  ): any {
    const projectId = this.configService.get<string>('GOOGLE_CLOUD_PROJECT');
    const location =
      this.configService.get<string>('GOOGLE_CLOUD_LOCATION_IN') || 'global';
    const recognizerId = this.configService.get<string>(
      'GOOGLE_CLOUD_STT_RECOGNIZER_ID',
    );
    const recognizerPath = `projects/${projectId}/locations/${location}/recognizers/${recognizerId}`;

    this.logger.log(
      `Starting real-time streaming recognize connection using recognizer: ${recognizerPath}`,
    );
    const stream = this.speechClient._streamingRecognize();

    stream.on('finish', () => {
      console.log('Google gRPC stream finish by Google Cloud.');
    });

    stream.addListener('data', (response) => {
      // this.logger.log('Response from stream session', response);
      const result = response.results[0];
      if (result && result.alternatives[0]) {
        const transcript = result.alternatives[0].transcript;
        const isFinal = result.isFinal;

        // This is where you see the "Magic":
        // Interim results (isFinal: false) show up in ~200ms
        process.stdout.write(
          `\rCurrent thought: ${transcript} ${isFinal ? '\n' : ''}`,
        );

        onData(transcript, isFinal);
      }
    });

    stream.on('error', onError);

    stream.on('end', () => {
      console.log('Google gRPC stream closed by Google Cloud.');
    });

    // Write initial configuration message
    stream.write({
      recognizer: recognizerPath,
      interimResults: true,
      streamingConfig: {
        config: {
          explicitDecodingConfig: {
            // LINEAR16 is uncompressed, raw PCM audio (Standard mic data)
            encoding: 'LINEAR16',
            sampleRateHertz: 16000, // 16kHz is highly recommended for Chirp
            audioChannelCount: 1, // Mono (1 channel) is standard for voice
          },
          // autoDecodingConfig: {},
          languageCodes: ['en-US'],
          model: 'chirp_3',
          features: {
            enableWordTimeOffsets: false,
          },
        },
        streamingFeatures: {
          interimResults: true,
        },
      },
    });

    this.logger.log('Stream status', stream.writable);
    return stream;
  }

  public async geminiTranscribe(
    wavBuffer: Buffer,
    model: string,
  ): Promise<string> {
    const startTime = Date.now();
    const base64Data = wavBuffer.toString('base64');
    const apiModel = this.mapModelName(model);

    const response = await this.genAi.models.generateContent({
      model: apiModel,
      contents: [
        {
          text:
            'You are an audio transcriber. Listen carefully. If the audio contains only background noise, ' +
            'static, breath, hums, or silence, the transcript property MUST be an empty string.' +
            'Do not hallucinate the words, just transcribe what you hear. Always make sure no over thinking or hallusinating. You shall transcribe the words as it is and never change words to other words.' +
            "Never output timestamps or strings like '00:00' under any circumstances.",
        },
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: base64Data,
          },
        },
      ],
    });
    const duration = Date.now() - startTime;
    if (response.text) {
      this.logger.log(
        `User Voice is transcribed (Gemini): ${response.text} in ${duration}ms`,
      );
    }

    return response.text?.trim() || '';
  }

  public async generateResponseStream(
    query: string,
    config: UserConfig,
  ): Promise<any> {
    const clientData = `
CLIENT: Oracle HCM Support Assistant (Lyre AI)
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
    this.logger.log(
      `Model we selected for the response generation stream: ${apiModel}`,
    );

    const responseStream = await this.genAi.models.generateContentStream({
      model: apiModel,
      contents: query,
      config: {
        systemInstruction: finalSystemInstruction,
      },
    });

    return responseStream;
  }

  public async geminiTextToSpeech(
    text: string,
    voice: string,
  ): Promise<{ base64: string; mimeType: string }> {
    this.logger.log(
      `Now starting text to speech using Gemini model for: "${text}"`,
    );
    const response = await this.genAi.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: text,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
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
    this.logger.log('Text to speach generation done');
    return { base64, mimeType };
  }

  // chirp_3 voice
  public async textToSpeech(
    llmStream: any,
    voice: string,
    onAudioChunk: (base64Audio: string, text: string, client: any) => void,
    session: any,
    client: any
  ): Promise<void> {
    this.logger.log(
      `Starting real-time LLM-to-Speech stream using Google Cloud TTS... ${voice}`,
    );

    // 1. Initialize the bidirectional gRPC stream
    let ttsStream: any;
    // 4. Consume incoming LLM stream
    let sentenceBuffer = '';
    let languageExtracted = false;

    try {
      for await (const chunk of llmStream) {

        // Text to stream logic
        if (!ttsStream) {
          this.logger.log('Gemini STream in TTS started');
          ttsStream = this.ttsClient.streamingSynthesize();

          // 2. Setup the output listener
          ttsStream.on('data', (response: any) => {
            if (response.audioContent && session.isGenerating) {
              const base64Audio = Buffer.from(
                response.audioContent as Uint8Array,
              ).toString('base64');
              // console.log('Got some data');
              onAudioChunk(base64Audio, '', client);
            }
          });

          ttsStream.on('error', (err: any) => {
            this.logger.error('TTS Streaming Error:', err);
            // ttsStream = this.speechClient.streamingRecognize();
          });

          ttsStream.on('end', () => {
            this.logger.log('TTS Stream fully closed.');
          });

          // 3. Send initial configuration chunk
          ttsStream.write({
            streamingConfig: {
              voice: {
                languageCode: 'en-US',
                name: `en-US-Chirp3-HD-${voice}`,
              },
              audioConfig: {
                audioEncoding: 'LINEAR16', // Raw PCM audio
                sampleRateHertz: 24000,
              },
            },
          });
        }

        if (!session.isGenerating) break;


        const chunkText = chunk.text || '';
        sentenceBuffer += chunkText;

        if (!languageExtracted) {
          if (sentenceBuffer.includes(']:')) {
            const prefixIndex = sentenceBuffer.indexOf(']:');
            sentenceBuffer = sentenceBuffer.substring(prefixIndex + 2);
            languageExtracted = true;
          } else if (sentenceBuffer.length > 20) {
            languageExtracted = true;
          }
        }

        // Sentence detection
        let boundaryIndex = -1;
        for (let i = 0; i < sentenceBuffer.length; i++) {
          if (
            sentenceBuffer[i] === '.' ||
            sentenceBuffer[i] === '?' ||
            sentenceBuffer[i] === '!' ||
            sentenceBuffer[i] === '\n'
          ) {
            boundaryIndex = i;
            break;
          }
        }

        if (boundaryIndex !== -1) {
          const sentence = sentenceBuffer
            .substring(0, boundaryIndex + 1)
            .trim();
          sentenceBuffer = sentenceBuffer.substring(boundaryIndex + 1);

          if (sentence) {
            this.logger.log(
              `Sending buffered sentence to Chirp 3: "${sentence}"`,
            );
            onAudioChunk('', sentence + ' ', client);
            if (!ttsStream.destroyed) {
              ttsStream.write({
                input: { text: sentence },
              });
            }
          }
        }
      }

      if (session.isGenerating && sentenceBuffer.trim().length > 0) {
        const sentence = sentenceBuffer.trim();
        this.logger.log(`Sending remaining sentence to Chirp 3: "${sentence}"`);
        onAudioChunk('', sentence + ' ', client);
        ttsStream.write({ input: { text: sentence } });
      }

    } catch (err) {
      this.logger.error('Error in LLM stream to TTS generation loop:', err);
    } finally {
      if (ttsStream && !ttsStream.destroyed) {
        ttsStream.end();
      }
    }
  }

  public getDefaultConfig(): UserConfig {
    return {
      model: 'models/gemini-3.1-flash-lite',
      voice: 'Aoede',
      systemInstruction:
        'You are Madhuri, a brilliant, friendly, and helpful real-time AI assistant.',
      business: 'Customer Success',
    };
  }

  public parseSetupConfig(setupConfig: any): UserConfig {
    return {
      model: setupConfig.model || 'models/gemini-3.1-flash-lite',
      systemInstruction: setupConfig.systemInstruction?.parts?.[0]?.text || '',
      voice:
        setupConfig.generationConfig?.speechConfig?.voiceConfig
          ?.prebuiltVoiceConfig?.voiceName || 'Aoede',
      business: setupConfig.business || 'Customer Success',
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
