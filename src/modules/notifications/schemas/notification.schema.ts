import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type NotificationDocument = Notification & Document;

export enum NotificationType {
  POST = 'post',
  COMMENT = 'comment',
  EVENT = 'event',
  BOOKING = 'booking',
  MESSAGE = 'message',
  HELP_REQUEST = 'help-request',
  SYSTEM = 'system',
}

@Schema(baseSchemaOptions)
export class Notification {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(NotificationType),
    required: true,
  })
  type: NotificationType;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  message: string;

  @Prop({ trim: true })
  linkTo?: string;

  @Prop({
    type: Types.ObjectId,
  })
  relatedId?: Types.ObjectId;

  @Prop({ trim: true })
  relatedType?: string;

  @Prop({ default: false, index: true })
  isRead: boolean;

  @Prop()
  readAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Compound indexes
NotificationSchema.index({ userId: 1, isRead: 1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

// TTL index - auto-delete notifications after 90 days
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

