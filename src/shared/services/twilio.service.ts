import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Twilio } from 'twilio';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const twilio = require('twilio');

/** E.164 regex: optional +, digits, 10-15 length */
const E164_REGEX = /^\+?[1-9]\d{1,14}$/;

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private readonly client: Twilio | null = null;
  private readonly phoneNumber: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const accountSid = this.configService.get<string>('twilio.accountSid');
    const authToken = this.configService.get<string>('twilio.authToken');
    this.phoneNumber = this.configService.get<string>('twilio.phoneNumber');

    if (accountSid && authToken) {
      this.client = twilio(accountSid, authToken);
      this.logger.log('Twilio client initialized');
    } else {
      this.logger.warn('Twilio not configured (missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN)');
    }
  }

  isConfigured(): boolean {
    return this.client !== null && !!this.phoneNumber;
  }

  /**
   * Send SMS via Twilio. `to` must be E.164 format.
   */
  async sendSms(to: string, body: string): Promise<void> {
    const normalized = this.normalizeE164(to);
    if (!normalized) {
      throw new Error(`Invalid phone number for SMS: ${to}. Must be E.164 format.`);
    }

    if (!this.client || !this.phoneNumber) {
      throw new Error('SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.');
    }

    try {
      await this.client.messages.create({
        body,
        from: this.phoneNumber,
        to: normalized,
      });
      this.logger.log(`SMS sent to ${normalized}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${normalized}`, error);
      throw error;
    }
  }

  /**
   * Normalize a phone string to E.164 (best effort). Returns null if not valid.
   */
  normalizeE164(phone: string | undefined): string | null {
    if (!phone || typeof phone !== 'string') return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return null;
    const withPlus = digits.startsWith('0') ? `+47${digits.slice(1)}` : `+${digits}`;
    return E164_REGEX.test(withPlus) ? withPlus : null;
  }
}
