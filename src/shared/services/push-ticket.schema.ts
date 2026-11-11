import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Expo keeps push receipts for 24 hours, so a ticket is useless after that. */
export const PUSH_TICKET_TTL_SECONDS = 24 * 60 * 60;

/**
 * An Expo push ticket waiting for its receipt. Expo usually reports an uninstalled app
 * (DeviceNotRegistered) only in the receipt, minutes after the send, not in the ticket.
 */
@Schema({ collection: 'pushtickets', timestamps: { createdAt: true, updatedAt: false } })
export class PushTicket {
  @Prop({ required: true, unique: true })
  ticketId: string;

  @Prop({ required: true })
  token: string;

  createdAt?: Date;
}

export type PushTicketDocument = HydratedDocument<PushTicket>;

export const PushTicketSchema = SchemaFactory.createForClass(PushTicket);
PushTicketSchema.index({ createdAt: 1 }, { expireAfterSeconds: PUSH_TICKET_TTL_SECONDS });
