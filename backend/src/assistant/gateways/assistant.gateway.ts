import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { AssistantService } from '../services/assistant.service';
import { AudioDriverService } from '../services/audio-driver.service';

@WebSocketGateway({ path: '/ws', cors: true })
export class AssistantGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly assistantService: AssistantService,
    private readonly audioDriverService: AudioDriverService,
  ) { }

  async handleConnection(client: any) {
    // 1. Create session state (config, queue, etc.)
    this.assistantService.initializeSession(client);

    const sessionId = this.assistantService.getSessionId(client);

    // 2. Route incoming WebSocket messages.
    //    Registered synchronously BEFORE awaiting startSession so the setup
    //    frame (sent by the client immediately on open) can never be dropped
    //    while the STT connection is still opening.
    client.on('message', async (data: any) => {
      try {
        const msg = JSON.parse(data.toString());

        // Setup config message — configures agent type and triggers greeting
        if (msg.setup) {
          this.assistantService.initiateAgentState(client, msg.setup);
          return;
        }

        // Realtime audio chunks — feed directly into the audio driver
        if (msg.realtimeInput?.audio) {
          const audioBuffer = Buffer.from(msg.realtimeInput.audio.data, 'base64');
          if (sessionId) {
            this.audioDriverService.feedAudio(sessionId, audioBuffer);
          }
        }
      } catch (err) {
        console.error('Error handling client message:', err);
      }
    });

    client.on('error', (err: any) => {
      console.error('Client WebSocket error:', err);
    });

    // 3. Start the audio driver — keyed by sessionId so it's independent of the WS socket object.
    //    Awaited after listeners are attached; any audio frames that arrive before
    //    the STT stream is ready are simply dropped by feedAudio (harmless).
    if (sessionId) {
      await this.audioDriverService.startSession(sessionId, {
        onTranscript: (text) => this.assistantService.onTranscriptReady(client, text),
        onBargeIn: () => this.assistantService.handleBargeIn(client),
      });
    }
  }

  handleDisconnect(client: any): void {
    const sessionId = this.assistantService.getSessionId(client);
    if (sessionId) {
      this.audioDriverService.endSession(sessionId);
    }
    this.assistantService.cleanupSession(client);
  }
}
