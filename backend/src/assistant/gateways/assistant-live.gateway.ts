import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';

interface SessionState {
  geminiSession: any | null;
  isConnecting: boolean;
  pendingMessages: any[];
}

@WebSocketGateway({ path: '/ws-old' })
export class AssistantLiveGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private sessions = new Map<WebSocket, SessionState>();

  constructor(private configService: ConfigService) {}

  handleConnection(client: WebSocket) {
    console.log('[Live Gateway] Client connected to Live WebSocket Gateway');

    // Initialize session state for this client
    this.sessions.set(client, {
      geminiSession: null,
      isConnecting: false,
      pendingMessages: [],
    });

    client.on('message', async (data: any) => {
      try {
        const messageStr = data.toString();
        const msg = JSON.parse(messageStr);

        const state = this.sessions.get(client);
        if (!state) return;

        // 1. Handle Setup configuration message
        if (msg.setup) {
          if (state.geminiSession || state.isConnecting) {
            console.log(
              '[Live Gateway] Setup already initialized or connecting.',
            );
            return;
          }

          state.isConnecting = true;

          const apiKey = this.configService.get<string>('GEMINI_API_KEY');
          if (!apiKey) {
            console.error(
              '[Live Gateway] GEMINI_API_KEY is not configured in backend environment.',
            );
            client.send(
              JSON.stringify({
                error: 'GEMINI_API_KEY is not configured on the server.',
              }),
            );
            client.close();
            state.isConnecting = false;
            return;
          }

          // Extract and prepare setup parameters
          const clientInstruction =
            msg.setup.systemInstruction?.parts?.[0]?.text ||
            'You are Aether, a brilliant, friendly, and helpful real-time AI assistant.';
          const voiceName =
            msg.setup.generationConfig?.speechConfig?.voiceConfig
              ?.prebuiltVoiceConfig?.voiceName || 'Aoede';
          // const modelName = msg.setup.model || 'gemini-3.1-flash-live-preview';
          const modelName =
            'projects/project-3857994f-2565-4c14-9a7/locations/us-central1/publishers/google/models/gemini-3.1-flash-live-preview';

          try {
            const genAi = new GoogleGenAI({
              apiKey: apiKey,
              vertexai: true,
              enterprise: true,
            });

            console.log(
              `[Live Gateway] Connecting to Gemini Live API via GoogleGenAI SDK (Model: ${modelName})...`,
            );

            const session = await genAi.live.connect({
              model: modelName,
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: voiceName,
                    },
                  },
                },
                systemInstruction: {
                  parts: [
                    {
                      text: clientInstruction,
                    },
                  ],
                },
              },
              callbacks: {
                onmessage: (geminiMsg: any) => {
                  // Forward all messages (serverContent etc.) directly to client
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(geminiMsg));
                  }
                },
                onerror: (err: any) => {
                  console.error(
                    '[Live Gateway] Gemini Live WebSocket error:',
                    err,
                  );
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(
                      JSON.stringify({
                        error: `Gemini Live error: ${err.message || err}`,
                      }),
                    );
                  }
                },
                onclose: (closeEvent: any) => {
                  console.log(
                    `[Live Gateway] Gemini Live WebSocket closed. Code: ${closeEvent.code}, Reason: ${closeEvent.reason}`,
                  );
                  if (client.readyState === WebSocket.OPEN) {
                    client.close();
                  }
                },
              },
            });

            console.log('[Live Gateway] Connected to Gemini Live API.');
            state.isConnecting = false;
            state.geminiSession = session;

            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ setupComplete: {} }));
            }

            // Process any messages queued during connection establishment
            while (state.pendingMessages.length > 0) {
              const pendingMsg = state.pendingMessages.shift();
              this.forwardToGemini(session, pendingMsg);
            }
          } catch (connErr) {
            console.error(
              '[Live Gateway] Failed to connect to Gemini Live API:',
              connErr,
            );
            client.send(
              JSON.stringify({
                error: `Failed to connect to Gemini Live API: ${connErr.message || connErr}`,
              }),
            );
            client.close();
            state.isConnecting = false;
          }
          return;
        }

        // 2. Handle Realtime Input or Client Content messages
        if (state.geminiSession) {
          this.forwardToGemini(state.geminiSession, msg);
        } else if (state.isConnecting) {
          state.pendingMessages.push(msg);
        }
      } catch (err) {
        console.error('[Live Gateway] Error handling client message:', err);
      }
    });

    client.on('error', (err: any) => {
      console.error('[Live Gateway] Client WebSocket error:', err);
      this.cleanupSession(client);
    });

    client.on('close', () => {
      console.log(
        '[Live Gateway] Client disconnected from Live WebSocket Gateway',
      );
      this.cleanupSession(client);
    });
  }

  handleDisconnect(client: WebSocket) {
    this.cleanupSession(client);
  }

  private cleanupSession(client: WebSocket) {
    const state = this.sessions.get(client);
    if (state) {
      if (state.geminiSession) {
        try {
          state.geminiSession.close();
        } catch (e) {
          // Already closed
        }
      }
      this.sessions.delete(client);
    }
  }

  private forwardToGemini(session: any, msg: any) {
    if (msg.realtimeInput) {
      if (msg.realtimeInput.audio) {
        const base64Data = msg.realtimeInput.audio.data;
        const mimeType =
          msg.realtimeInput.audio.mimeType || 'audio/pcm;rate=16000';
        session.sendRealtimeInput({
          audio: {
            mimeType: mimeType,
            data: base64Data,
          },
        });
      } else if (msg.realtimeInput.mediaChunks) {
        for (const chunk of msg.realtimeInput.mediaChunks) {
          session.sendRealtimeInput({
            audio: {
              mimeType: chunk.mimeType,
              data: chunk.data,
            },
          });
        }
      }
    } else if (msg.clientContent) {
      session.sendClientContent({
        turns: msg.clientContent.turns,
        turnComplete: msg.clientContent.turnComplete,
      });
    }
  }
}
