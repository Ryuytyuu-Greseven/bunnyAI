import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { AssistantService } from '../services/assistant.service';

@WebSocketGateway({ path: '/ws' })
export class AssistantGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  constructor(private readonly assistantService: AssistantService) {}

  handleConnection(client: any) {
    this.assistantService.initializeSession(client);

    // Listen to messages from the browser client
    client.on('message', async (data: any) => {
      try {
        const messageStr = data.toString();
        const msg = JSON.parse(messageStr);

        // 1. Handle Setup configuration message
        if (msg.setup) {
          this.assistantService.updateSessionConfig(client, msg.setup);
          return;
        }

        // 2. Handle Realtime Input (Audio Chunks)
        if (msg.realtimeInput && msg.realtimeInput.audio) {
          this.assistantService.handleAudioChunk(
            client,
            msg.realtimeInput.audio.data,
          );
        }
      } catch (err) {
        console.error('Error handling client message in gateway:', err);
      }
    });

    client.on('error', (err: any) => {
      console.error('Client WebSocket error in gateway:', err);
    });
  }

  handleDisconnect(client: any) {
    this.assistantService.cleanupSession(client);
  }
}
