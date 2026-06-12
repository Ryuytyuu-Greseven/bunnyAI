import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Twilio from 'twilio';

export interface OutboundCallOptions {
  business?: string;
  voice?: string;
  systemInstruction?: string;
  from?: string;
}

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private readonly client: Twilio.Twilio | null = null;

  constructor(private readonly configService: ConfigService) {
    const accountSid = configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = configService.get<string>('TWILIO_AUTH_TOKEN');

    if (accountSid && authToken) {
      this.client = Twilio.default(accountSid, authToken);
      this.logger.log('Twilio REST client initialized.');
    } else {
      this.logger.warn(
        'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — outbound calls disabled.',
      );
    }
  }

  /**
   * Initiates an outbound call via Twilio REST API.
   * Twilio will hit the /twilio/voice webhook, which responds with TwiML
   * connecting the call to our Media Streams WebSocket.
   */
  async makeOutboundCall(to: string, options: OutboundCallOptions = {}): Promise<string> {
    if (!this.client) {
      throw new Error('Twilio client not configured. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
    }

    const webhookBase = this.configService.get<string>('TWILIO_WEBHOOK_URL');
    if (!webhookBase) {
      throw new Error('TWILIO_WEBHOOK_URL not set.');
    }

    const from =
      options.from ||
      this.configService.get<string>('TWILIO_PHONE_NUMBER') ||
      this.configService.get<string>('TWILIO_MOBILE_NUMBER');
    if (!from) {
      throw new Error('No from number — set TWILIO_PHONE_NUMBER or TWILIO_MOBILE_NUMBER.');
    }

    const params = new URLSearchParams({
      business: options.business ?? 'sales',
      voice: options.voice ?? 'Aoede',
      systemInstruction: options.systemInstruction ?? '',
    });

    const call = await this.client.calls.create({
      to,
      from,
      url: `${webhookBase}/twilio/voice?${params.toString()}`,
      statusCallback: `${webhookBase}/twilio/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'completed', 'answered'],
      record: false,
    });

    this.logger.log(`Outbound call created: ${call.sid} → ${to}`);
    return call.sid;
  }

  /**
   * Ends a call by its SID.
   */
  async endCall(callSid: string): Promise<void> {
    if (!this.client) throw new Error('Twilio client not configured.');
    await this.client.calls(callSid).update({ status: 'completed' });
    this.logger.log(`Call ended: ${callSid}`);
  }

  /**
   * Builds a TwiML response that instructs Twilio to connect the call to
   * our Media Streams WebSocket gateway.
   *
   * Custom parameters are forwarded in the 'start' WebSocket event, allowing
   * the TwilioGateway to configure the right agent (business, voice, etc.).
   */
  buildTwiml(wsUrl: string, params: Record<string, string> = {}): string {
    const paramElements = Object.entries(params)
      .map(([k, v]) => `      <Parameter name="${escapeXml(k)}" value="${escapeXml(v)}" />`)
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}">
${paramElements}
    </Stream>
  </Connect>
</Response>`;
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
