import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { EXPO_API_URL, expoHeaders } from './expo-push.service';
import { PushTicket } from './push-ticket.schema';
import { User, UserDocument } from '../../modules/users/schemas/user.schema';

/** Expo recommends waiting about 15 minutes before asking for a receipt. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;
/** Expo accepts at most 1000 ids per getReceipts request. */
const MAX_IDS_PER_REQUEST = 1000;

/**
 * Reads Expo push receipts for stored tickets and removes the tokens of devices that no
 * longer have the app (DeviceNotRegistered). Tickets without a receipt yet are kept for the
 * next run; the TTL index drops them after 24 hours.
 */
@Injectable()
export class PushReceiptsService {
  private readonly logger = new Logger(PushReceiptsService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(PushTicket.name)
    private readonly ticketModel: Model<PushTicket>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  @Cron('*/15 * * * *') // Every 15 minutes
  async checkReceipts(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - RECEIPT_DELAY_MS);
      const due = await this.ticketModel
        .find({ createdAt: { $lte: cutoff } })
        .sort({ createdAt: 1 })
        .limit(MAX_IDS_PER_REQUEST)
        .lean()
        .exec();
      if (!due?.length) return;

      const response = await fetch(`${EXPO_API_URL}/getReceipts`, {
        method: 'POST',
        headers: expoHeaders(this.configService),
        body: JSON.stringify({ ids: due.map((t) => t.ticketId) }),
      });
      if (!response.ok) {
        this.logger.error(`Expo receipts request failed with status ${response.status}`);
        return;
      }
      const json = await response.json();
      const receipts: Record<string, any> = json?.data ?? {};

      const answered: string[] = [];
      const dead: string[] = [];
      for (const ticket of due) {
        const receipt = receipts[ticket.ticketId];
        if (!receipt) continue;
        answered.push(ticket.ticketId);
        if (receipt.status !== 'error') continue;
        if (receipt.details?.error === 'DeviceNotRegistered') {
          dead.push(ticket.token);
        } else {
          this.logger.error(`Expo push receipt error: ${receipt.message ?? receipt.details?.error}`);
        }
      }

      if (dead.length > 0) {
        await this.userModel.updateMany(
          { pushTokens: { $in: dead } },
          { $pull: { pushTokens: { $in: dead } } },
        );
        this.logger.log(`Removed ${dead.length} push token(s) of uninstalled apps`);
      }
      if (answered.length > 0) {
        await this.ticketModel.deleteMany({ ticketId: { $in: answered } });
      }
    } catch (error) {
      this.logger.error(`Checking Expo push receipts failed: ${(error as Error)?.message}`);
    }
  }
}
