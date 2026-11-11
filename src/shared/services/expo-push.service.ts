import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PushTicket } from './push-ticket.schema';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: { linkTo?: string };
}

export const EXPO_API_URL = 'https://exp.host/--/api/v2/push';
const EXPO_PUSH_URL = `${EXPO_API_URL}/send`;
const CHUNK_SIZE = 100;

/** JSON headers for Expo's push API, with the optional EXPO_ACCESS_TOKEN as a Bearer token. */
export function expoHeaders(configService: ConfigService): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const accessToken = configService.get<string>('expo.accessToken');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(PushTicket.name)
    private readonly ticketModel: Model<PushTicket>,
  ) {}

  /**
   * Sends push messages through Expo. Never rejects. Resolves to the tokens
   * Expo reported as DeviceNotRegistered so the caller can remove them.
   * Accepted tickets are stored so PushReceiptsService can check their receipts later.
   */
  async send(messages: PushMessage[]): Promise<string[]> {
    const invalidTokens: string[] = [];
    const accepted: Pick<PushTicket, 'ticketId' | 'token'>[] = [];
    try {
      if (!messages || messages.length === 0) return invalidTokens;

      const headers = expoHeaders(this.configService);

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
            if (ticket?.status === 'ok' && ticket.id && chunk[index]) {
              accepted.push({ ticketId: ticket.id, token: chunk[index].to });
              return;
            }
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
    if (accepted.length > 0) {
      try {
        await this.ticketModel.insertMany(accepted, { ordered: false });
      } catch (error) {
        this.logger.error(`Storing Expo push tickets failed: ${(error as Error)?.message}`);
      }
    }
    return invalidTokens;
  }
}
