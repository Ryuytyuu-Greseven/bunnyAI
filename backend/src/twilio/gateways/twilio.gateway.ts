import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { AssistantService } from '../../assistant/services/assistant.service';
import { AudioDriverService } from '../../assistant/services/audio-driver.service';
import { convertTtsForTwilio } from '../utils/audio.util';

/**
 * Adapts a Twilio Media Streams WebSocket into the shape that AssistantService
 * and AudioDriverService expect from a generic "client".
 *
 * AssistantService calls:
 *   client.readyState  — to guard sends
 *   client.send(json)  — to deliver audio chunks, text, barge-in events
 *
 * This adapter intercepts those sends, translates the protocol, and forwards
 * to the real Twilio WebSocket:
 *   inlineData audio → Twilio "media" event  (after mulaw conversion)
 *   interrupted: true → Twilio "clear" event (clears Twilio's audio buffer)
 *   text / other       → silently dropped    (Twilio is voice-only)
 */
class TwilioClientAdapter {
  public streamSid = '';

  constructor(private readonly socket: any) { }

  get readyState(): number {
    return this.socket.readyState;
  }

  send(data: string): void {
    if (this.socket.readyState !== 1 /* WebSocket.OPEN */) return;

    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    // ── TTS audio chunk ────────────────────────────────────────────────────
    const parts: any[] = msg.serverContent?.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const linear16 = Buffer.from(part.inlineData.data, 'base64');
        const mulaw = convertTtsForTwilio(linear16);
        this.socket.send(
          JSON.stringify({
            event: 'media',
            streamSid: this.streamSid,
            media: { payload: mulaw.toString('base64') },
          }),
        );
      }
    }

    // ── Barge-in: clear Twilio's audio buffer ─────────────────────────────
    if (msg.serverContent?.interrupted) {
      this.socket.send(
        JSON.stringify({ event: 'clear', streamSid: this.streamSid }),
      );
    }
  }
}

/**
 * TwilioGateway — WebSocket endpoint at /twilio.
 *
 * Twilio Media Streams opens one WebSocket per active call and sends:
 *   "connected"  — stream is ready
 *   "start"      — stream metadata (streamSid, callSid, customParameters)
 *   "media"      — audio chunk (base64 mulaw 8 kHz)
 *   "stop"       — call ended
 *
 * Configure your Twilio number's Voice webhook to POST to /twilio/voice.
 * The controller responds with TwiML that points Stream url="wss://…/twilio".
 *
 * For local dev, expose your server with ngrok:
 *   ngrok http 3000
 *   → set TWILIO_WEBHOOK_URL=https://<id>.ngrok.io
 *   → set TWILIO_WS_URL=wss://<id>.ngrok.io
 */
@WebSocketGateway({ path: '/twilio' })
export class TwilioGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TwilioGateway.name);
  private readonly adapters = new Map<any, TwilioClientAdapter>();

  constructor(
    private readonly assistantService: AssistantService,
    private readonly audioDriverService: AudioDriverService,
  ) { }

  handleConnection(socket: any): void {
    this.logger.log('[TwilioGateway] WebSocket connection opened');
    const adapter = new TwilioClientAdapter(socket);
    this.adapters.set(socket, adapter);

    socket.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleTwilioEvent(socket, adapter, msg);
      } catch {
        // ignore malformed frames
      }
    });

    socket.on('error', (err: any) => {
      this.logger.error('[TwilioGateway] Socket error:', err?.message);
    });
  }

  handleDisconnect(socket: any): void {
    const adapter = this.adapters.get(socket);
    if (!adapter) return;

    if (adapter.streamSid) {
      this.audioDriverService.endSession(adapter.streamSid);
    }
    this.assistantService.cleanupSession(adapter);
    this.adapters.delete(socket);
    this.logger.log(`[TwilioGateway] Disconnected: ${adapter.streamSid || 'unknown'}`);
  }

  // ── Twilio event handler ───────────────────────────────────────────────────

  private handleTwilioEvent(
    socket: any,
    adapter: TwilioClientAdapter,
    msg: any,
  ): void {
    switch (msg.event) {
      case 'connected':
        // No action needed — Twilio confirms WebSocket is open
        this.logger.log('[TwilioGateway] Stream connected');
        break;

      case 'start':
        this.onStreamStart(adapter, msg.start);
        break;

      case 'media':
        if (msg.media?.payload && adapter.streamSid) {
          const audio = Buffer.from(msg.media.payload, 'base64');
          this.audioDriverService.feedAudio(adapter.streamSid, audio);
        }
        break;

      case 'stop':
        this.logger.log(`[TwilioGateway] Stream stopped: ${adapter.streamSid}`);
        if (adapter.streamSid) {
          this.audioDriverService.endSession(adapter.streamSid);
        }
        this.assistantService.cleanupSession(adapter);
        this.adapters.delete(socket);
        break;
    }
  }

  private onStreamStart(adapter: TwilioClientAdapter, startPayload: any): void {
    adapter.streamSid = startPayload.streamSid;
    const params: Record<string, string> = startPayload.customParameters ?? {};

    const business = params.business ?? 'sales';
    const voice = params.voice ?? 'Aoede';
    const systemInstruction = params.systemInstruction ?? '';

    this.logger.log(
      `[TwilioGateway] Stream start — streamSid=${adapter.streamSid} callSid=${startPayload.callSid} business=${business}`,
    );

    // ── 1. Create AssistantService session (uses adapter as "client" key) ──
    this.assistantService.initializeSession(adapter);

    // ── 2. Start Google STT with Twilio's audio format (mulaw 8 kHz) ──────
    this.audioDriverService.startSession(
      adapter.streamSid,
      {
        onTranscript: (text) => this.assistantService.onTranscriptReady(adapter, text),
        onBargeIn: () => this.assistantService.handleBargeIn(adapter),
      },
      { encoding: 'MULAW', sampleRateHertz: 8000 },
    );

    // ── 3. Configure agent type and trigger opening greeting ──────────────
    this.assistantService.initiateAgentState(adapter, {
      model: 'models/gemini-3.1-flash-lite',
      voice,
      business,
      systemInstruction: { parts: [{ text: systemInstruction }] },
    });
  }
}
