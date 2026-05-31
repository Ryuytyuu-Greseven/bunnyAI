import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';

@WebSocketGateway({ path: '/ws' })
export class AssistantGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  private activeConnections = new Map<any, WebSocket>();

  constructor(private configService: ConfigService) { }

  handleConnection(client: any) {
    console.log('Client connected to WebSocket Gateway', client);

    const apiKey = this.configService.get<string>('GEMINI_API_KEY');

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

    // Connect to the Gemini Multimodal Live API WebSocket
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    console.log('Connecting to Gemini Multimodal Live API...');

    const geminiSocket = new WebSocket(geminiUrl);
    this.activeConnections.set(client, geminiSocket);

    const clientMessageQueue: string[] = [];
    let isGeminiConnected = false;

    geminiSocket.on('open', () => {
      console.log('Connected to Gemini Live API', clientMessageQueue);
      isGeminiConnected = true;

      // Flush any client messages that arrived during the handshake
      while (clientMessageQueue.length > 0) {
        const msg = clientMessageQueue.shift();
        if (msg) {
          console.log('message:', msg);
          geminiSocket.send(msg);
        }
      }
    });

    geminiSocket.on('message', (data: WebSocket.Data) => {
      // Forward Gemini's responses back to the browser client
      if (client.readyState === WebSocket.OPEN) {
        client.send(data.toString());
      }
    });

    geminiSocket.on('close', (code: number, reason: Buffer) => {
      console.log(`Gemini connection closed: ${code} - ${reason.toString()}`);
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    });

    geminiSocket.on('error', (err: Error) => {
      console.error('Gemini connection error:', err);
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ error: 'Gemini API connection error.' }));
        client.close();
      }
    });

    // Listen to messages from the browser client
    client.on('message', (data: any) => {
      const messageStr = data.toString();
      // console.log('In Open', messageStr);

      if (isGeminiConnected && geminiSocket.readyState === WebSocket.OPEN) {
        geminiSocket.send(messageStr);
      } else {
        // Buffer client messages if Gemini is still connecting
        clientMessageQueue.push(messageStr);
      }
    });

    client.on('error', (err: any) => {
      console.error('Client WebSocket error:', err);
    });
  }

  handleDisconnect(client: any) {
    console.log('Client disconnected from WebSocket Gateway');
    const geminiSocket = this.activeConnections.get(client);
    if (geminiSocket) {
      if (
        geminiSocket.readyState === WebSocket.OPEN ||
        geminiSocket.readyState === WebSocket.CONNECTING
      ) {
        geminiSocket.close();
      }
      this.activeConnections.delete(client);
    }
  }
}
