import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class RecordingTesterService implements OnApplicationBootstrap {
  private genAi: GoogleGenAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.genAi = new GoogleGenAI({
      vertexai: true,
      apiKey,
    });
  }

  async onApplicationBootstrap() {
    console.log(
      '[RecordingTesterService] Application bootstrap: starting recordings transcription test...',
    );
    // // Run asynchronously to not block the server startup/listening process
    // this.testRecordings().catch((err) => {
    //   console.error(
    //     '[RecordingTesterService] Transcription test encountered an error:',
    //     err,
    //   );
    // });
  }

  async testRecordings() {
    const recordingsDir = path.join(process.cwd(), 'recordings');
    if (!fs.existsSync(recordingsDir)) {
      console.log(
        `[RecordingTesterService] Recordings directory does not exist at: ${recordingsDir}`,
      );
      return;
    }

    try {
      const files = fs.readdirSync(recordingsDir);
      const wavFiles = files.filter((file) => file.endsWith('.wav'));
      if (wavFiles.length === 0) {
        console.log(
          '[RecordingTesterService] No WAV recordings found in recordings/ folder.',
        );
        return;
      }

      console.log(
        `[RecordingTesterService] Found ${wavFiles.length} WAV file(s) in recordings/. Transcribing...`,
      );

      const results: Record<string, string> = {};

      for (const file of wavFiles) {
        const filePath = path.join(recordingsDir, file);
        try {
          const fileBuffer = fs.readFileSync(filePath);
          const base64Data = fileBuffer.toString('base64');

          const timerSt = new Date();
          // Use gemini-3.1-flash-lite as the model
          const response = await this.genAi.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: [
              {
                text:
                  'You are an audio transcriber. Listen carefully. If the audio contains only background noise, ' +
                  'static, breath, hums, or silence, the transcript property MUST be an empty string. ' +
                  'Do not hallucinate the words, just transcribe what you hear. Always make sure no over thinking or hallusinating. You shall transcribe the words as it is and never change words to other words. ' +
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

          const transcription = response.text?.trim() || '';
          results[file] = transcription;
          console.log(
            `[RecordingTesterService] Transcribed [${file}]: "${transcription}" : duration in milliseconds: ${new Date().getTime() - timerSt.getTime()}`,
          );
        } catch (fileErr) {
          console.error(
            `[RecordingTesterService] Failed to transcribe ${file}:`,
            fileErr,
          );
          results[file] = `ERROR: ${fileErr.message || fileErr}`;
        }
      }

      const timestamp = new Date().toISOString();
      const outputFilename = `transcription_results_${Date.now()}.json`;
      const outputPath = path.join(recordingsDir, outputFilename);

      const finalOutput = {
        timestamp,
        results,
      };

      fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2));
      console.log(
        `[RecordingTesterService] Transcription test completed! Results saved to: ${outputPath}`,
      );
    } catch (err) {
      console.error(
        '[RecordingTesterService] Error during testRecordings execution:',
        err,
      );
    }
  }
}
