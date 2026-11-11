import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: { linkTo?: string };
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Sends push messages through Expo. Never rejects. Resolves to the tokens
   * Expo reported as DeviceNotRegistered so the caller can remove them.
   */
  async send(messages: PushMessage[]): Promise<string[]> {
    const invalidTokens: string[] = [];
    try {
      if (!messages || messages.length === 0) return invalidTokens;

      const accessToken = this.configService.get<string>('expo.accessToken');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
        const chunk = messages.slice(i, i + CHUNK_SIZE);
        try {
          const response = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(chunk.map((m) => ({ ...m, sound: 'default' }))),
          });
          if (!response.ok) {
            this.logger.error(`Expo push request failed with status ${response.status}`);
            continue;
          }
          const json = await response.json();
          const tickets: any[] = Array.isArray(json?.data) ? json.data : [];
          tickets.forEach((ticket, index) => {
            if (ticket?.status !== 'error') return;
            if (ticket.details?.error === 'DeviceNotRegistered' && chunk[index]) {
              invalidTokens.push(chunk[index].to);
            } else {
              this.logger.error(`Expo push ticket error: ${ticket.message ?? ticket.details?.error}`);
            }
          });
        } catch (error) {
          this.logger.error(`Expo push chunk failed: ${(error as Error)?.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Expo push failed: ${(error as Error)?.message}`);
    }
    return invalidTokens;
  }
}
