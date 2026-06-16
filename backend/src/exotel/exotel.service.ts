import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface ExotelOutboundCallOptions {
  business?: string;
  voice?: string;
  systemInstruction?: string;
  /** Override the Exophone callerid for this call. */
  callerid?: string;
  /** Max call duration in seconds (Exotel max: 14400). */
  timelimit?: number;
}

@Injectable()
export class ExotelService {
  private readonly logger = new Logger(ExotelService.name);
  private readonly apiKey: string | null;
  private readonly apiToken: string | null;
  private readonly accountSid: string | null;
  private readonly apiBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = configService.get<string>('EXOTEL_API_KEY') ?? null;
    this.apiToken = configService.get<string>('EXOTEL_API_TOKEN') ?? null;
    this.accountSid = configService.get<string>('EXOTEL_ACCOUNT_SID') ?? null;
    // Default to Singapore region; set EXOTEL_API_BASE_URL for other regions (e.g. Singapore: https://api.exotel.com)
    this.apiBaseUrl =
      configService.get<string>('EXOTEL_API_BASE_URL') ??
      'api.exotel.com';

    if (this.apiKey && this.apiToken && this.accountSid) {
      this.logger.log('Exotel client initialized.');
    } else {
      this.logger.warn(
        'EXOTEL_API_KEY / EXOTEL_API_TOKEN / EXOTEL_ACCOUNT_SID not set — outbound calls disabled.',
      );
    }
  }

  /**
   * Initiates an outbound call via the Exotel REST API with bidirectional streaming.
   *
   * Exotel dials `to` using the configured Exophone as the caller ID. Once the
   * call is answered, Exotel opens a WebSocket to `streamurl` and begins the
   * bidirectional audio stream.
   *
   * The streamurl points to our existing WebSocket gateway. Custom params
   * (business, voice, systemInstruction) are appended as query parameters and
   * delivered back in the `start` WebSocket event as `custom_parameters`.
   *
   * Returns the Exotel call SID.
   */
  async makeOutboundCall(
    to: string,
    options: ExotelOutboundCallOptions = {},
  ): Promise<string> {
    if (!this.apiKey || !this.apiToken || !this.accountSid) {
      throw new Error(
        'Exotel credentials not configured. Check EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_ACCOUNT_SID.',
      );
    }

    const wsBase = this.configService.get<string>('EXOTEL_WS_URL');
    if (!wsBase) throw new Error('EXOTEL_WS_URL not set.');

    const callerid =
      options.callerid ?? this.configService.get<string>('EXOTEL_EXOPHONE');
    if (!callerid) {
      throw new Error('No Exophone set — configure EXOTEL_EXOPHONE.');
    }

    const params = new URLSearchParams({
      business: options.business ?? 'sales',
      voice: options.voice ?? 'Aoede',
      systemInstruction: options.systemInstruction ?? '',
    });

    // Points to the existing WebSocket gateway path
    const streamurl = `${wsBase}/twilio?${params.toString()}`;

    const webhookBase = this.configService.get<string>('EXOTEL_WEBHOOK_URL');

    const body = new URLSearchParams({
      from: to,
      callerid,
      streamurl,
      streamtype: 'bidirectional',
      ...(webhookBase
        ? {
          statuscallback: `${webhookBase}/twilio/status`,
          'statuscallbackevents[]': 'terminal',
        }
        : {}),
      ...(options.timelimit
        ? { timelimit: String(options.timelimit) }
        : {}),
    });

    const url = `https://${this.apiKey}:${this.apiToken}@${this.apiBaseUrl}/v1/accounts/${this.accountSid}/calls/connect`;

    this.logger.log(url);
    try {
      const { data } = await axios.post(url, body.toString(), {
        auth: { username: this.apiKey, password: this.apiToken },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      const callSid: string = data?.Call?.Sid ?? data?.call?.sid ?? '';
      this.logger.log(`Outbound call created: ${callSid} → ${to}`);
      return callSid;
    } catch (error) {
      this.logger.log(error.message);
      throw error;
    }
  }

  /**
   * Ends an active call by its SID via the Exotel REST API.
   */
  async endCall(callSid: string): Promise<void> {
    if (!this.apiKey || !this.apiToken || !this.accountSid) {
      throw new Error('Exotel credentials not configured.');
    }

    const url = `https://${this.apiKey}:${this.apiToken}@${this.apiBaseUrl}/v1/accounts/${this.accountSid}/calls/${callSid}`;

    await axios.post(url, new URLSearchParams({ Status: 'completed' }).toString(), {
      auth: { username: this.apiKey, password: this.apiToken },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.logger.log(`Call ended: ${callSid}`);
  }
}
