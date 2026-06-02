import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { VertexAI } from '@google-cloud/vertexai';

interface SessionState {
  geminiWs: WebSocket | null;
  isConnecting: boolean;
  pendingMessages: any[];
}

@WebSocketGateway({ path: '/ws-old' })
export class AssistantLiveGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  private sessions = new Map<WebSocket, SessionState>();

  constructor(private configService: ConfigService) { }

  handleConnection(client: WebSocket) {
    console.log('[Live Gateway] Client connected to Live WebSocket Gateway (Vertex AI)');

    // Initialize session state for this client
    this.sessions.set(client, {
      geminiWs: null,
      isConnecting: false,
      pendingMessages: [],
    });

    const dummyTool = {
      functionDeclarations: [
        {
          name: 'dummy_tool',
          description: 'A dummy tool that takes an input string and returns a success response. Useful for testing tool calling capability.',
          parameters: {
            type: 'OBJECT',
            properties: {
              input: {
                type: 'STRING',
                description: 'A dummy input parameter.',
              },
            },
            required: ['input'],
          },
        },
      ],
    };

    client.on('message', async (data: any) => {
      try {
        const messageStr = data.toString();
        const msg = JSON.parse(messageStr);

        const state = this.sessions.get(client);
        if (!state) return;

        // 1. Handle Setup configuration message
        if (msg.setup) {
          if (state.geminiWs || state.isConnecting) {
            console.log('[Live Gateway] Setup already initialized or connecting.');
            return;
          }

          state.isConnecting = true;

          const project =
            this.configService.get<string>('GOOGLE_CLOUD_PROJECT') ||
            'project-3857994f-2565-4c14-9a7';
          const location =
            this.configService.get<string>('GOOGLE_CLOUD_LOCATION') ||
            'us-central1';

          console.log(`[Live Gateway] Initializing VertexAI (Project: ${project}, Location: ${location})`);

          try {
            const vertexAi = new VertexAI({ project, location });
            const googleAuth = (vertexAi as any).googleAuth;
            const authClient = await googleAuth.getClient();
            const tokenResponse = await authClient.getAccessToken();
            const accessToken = tokenResponse.token;

            if (!accessToken) {
              throw new Error('Failed to generate OAuth access token from Vertex AI SDK.');
            }

            // Using the regional WebSocket endpoint for Vertex AI Multimodal Live
            const wsUrl = `wss://${location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
            console.log(`[Live Gateway] Connecting to Vertex AI WebSocket: ${wsUrl}`);

            const geminiWs = new WebSocket(wsUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });

            geminiWs.on('open', () => {
              console.log('[Live Gateway] Connected to Vertex AI Live API.');
              state.isConnecting = false;
              state.geminiWs = geminiWs;

              // Send the initial setup message to Vertex AI
              const clientInstruction =
                msg.setup.systemInstruction?.parts?.[0]?.text ||
                'You are Aether, a brilliant, friendly, and helpful real-time AI assistant.';
              const voiceName =
                msg.setup.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName ||
                'Aoede';

              const finalSystemInstruction = `${clientInstruction}

You are in a live audio-to-audio conversation. Talk in a friendly and conversational tone.
You have access to a dummy tool named 'dummy_tool' which you can call when appropriate or when testing tool functionality.`;

              // Vertex AI supported live models: gemini-2.0-flash-exp or gemini-live-2.5-flash-native-audio
              const modelName = 'gemini-2.0-flash-exp';
              const modelResourcePath = `projects/${project}/locations/${location}/publishers/google/models/${modelName}`;

              const setupPayload = {
                setup: {
                  model: modelResourcePath,
                  generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                      voiceConfig: {
                        prebuiltVoiceConfig: {
                          voiceName: voiceName,
                        },
                      },
                    },
                  },
                  systemInstruction: {
                    parts: [
                      {
                        text: finalSystemInstruction,
                      },
                    ],
                  },
                  tools: [
                    dummyTool,
                  ],
                },
              };

              console.log('[Live Gateway] Sending setup payload to Vertex AI:', JSON.stringify(setupPayload));
              geminiWs.send(JSON.stringify(setupPayload));

              // Process any messages queued during connection establishment
              while (state.pendingMessages.length > 0) {
                const pendingMsg = state.pendingMessages.shift();
                this.forwardToGemini(geminiWs, pendingMsg);
              }
            });

            geminiWs.on('message', (geminiData: any) => {
              this.handleGeminiMessage(client, geminiWs, geminiData);
            });

            geminiWs.on('error', (err: any) => {
              console.error('[Live Gateway] Vertex AI Live WebSocket error:', err);
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ error: `Vertex AI Live error: ${err.message || err}` }));
              }
            });

            geminiWs.on('close', (code, reason) => {
              console.log(`[Live Gateway] Vertex AI Live WebSocket closed. Code: ${code}, Reason: ${reason}`);
              if (client.readyState === WebSocket.OPEN) {
                client.close();
              }
            });

          } catch (connErr) {
            console.error('[Live Gateway] Failed to connect to Vertex AI Live API:', connErr);
            client.send(JSON.stringify({ error: `Failed to connect to Vertex AI Live API: ${connErr.message || connErr}` }));
            client.close();
          }
          return;
        }

        // 2. Handle Realtime Input or Client Content messages
        if (state.geminiWs) {
          this.forwardToGemini(state.geminiWs, msg);
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
      console.log('[Live Gateway] Client disconnected from Live WebSocket Gateway');
      this.cleanupSession(client);
    });
  }

  handleDisconnect(client: WebSocket) {
    this.cleanupSession(client);
  }

  private cleanupSession(client: WebSocket) {
    const state = this.sessions.get(client);
    if (state) {
      if (state.geminiWs) {
        try {
          state.geminiWs.close();
        } catch (e) {
          // Already closed
        }
      }
      this.sessions.delete(client);
    }
  }

  private forwardToGemini(geminiWs: WebSocket, msg: any) {
    if (geminiWs.readyState !== WebSocket.OPEN) return;

    if (msg.realtimeInput) {
      if (msg.realtimeInput.audio) {
        const base64Data = msg.realtimeInput.audio.data;
        const mimeType = msg.realtimeInput.audio.mimeType || 'audio/pcm;rate=16000';
        geminiWs.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: mimeType,
                data: base64Data,
              },
            ],
          },
        }));
      } else if (msg.realtimeInput.mediaChunks) {
        geminiWs.send(JSON.stringify(msg));
      }
    } else if (msg.clientContent) {
      geminiWs.send(JSON.stringify({ clientContent: msg.clientContent }));
    } else if (msg.toolResponse) {
      geminiWs.send(JSON.stringify({ toolResponse: msg.toolResponse }));
    }
  }

  private handleGeminiMessage(client: WebSocket, geminiWs: WebSocket, geminiData: any) {
    try {
      const messageStr = geminiData.toString();
      const geminiMsg = JSON.parse(messageStr);

      // Handle setupComplete by forwarding it back to the client
      if (geminiMsg.setupComplete) {
        console.log('[Live Gateway] Setup complete received from Vertex AI.');
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ setupComplete: {} }));
        }
        return;
      }

      // Intercept toolCall to execute the dummy tool locally
      if (geminiMsg.toolCall) {
        console.log('[Live Gateway] Received toolCall from Gemini (Vertex AI):', messageStr);
        const functionCalls = geminiMsg.toolCall.functionCalls || [];
        const functionResponses: any[] = [];

        for (const call of functionCalls) {
          if (call.name === 'dummy_tool') {
            const inputVal = call.args?.input || '';
            console.log(`[Live Gateway] Executing dummy_tool with args:`, call.args);

            functionResponses.push({
              name: call.name,
              id: call.id,
              response: {
                output: `Successfully executed dummy_tool via Vertex AI. Input received: "${inputVal}"`,
              },
            });

            // Send a text message to the frontend chat UI indicating execution
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  serverContent: {
                    modelTurn: {
                      parts: [
                        {
                          text: `\n[System Tool Log: dummy_tool executed with input: "${inputVal}"]\n`,
                        },
                      ],
                    },
                  },
                }),
              );
            }
          } else {
            functionResponses.push({
              name: call.name,
              id: call.id,
              response: {
                error: `Tool "${call.name}" is not supported.`,
              },
            });
          }
        }

        if (functionResponses.length > 0 && geminiWs.readyState === WebSocket.OPEN) {
          const toolResponsePayload = {
            toolResponse: {
              functionResponses,
            },
          };
          console.log('[Live Gateway] Sending toolResponse back to Vertex AI:', JSON.stringify(toolResponsePayload));
          geminiWs.send(JSON.stringify(toolResponsePayload));
        }
        return;
      }

      // Forward all other messages (serverContent etc.) to client
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    } catch (err) {
      console.error('[Live Gateway] Error handling Gemini message:', err);
    }
  }
}
