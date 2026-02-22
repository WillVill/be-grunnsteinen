import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../common/schemas/base.schema';

export type NotificationDocument = Notification & Document;

@Schema(baseSchemaOptions)
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: [
      'booking_confirmed',
      'booking_cancelled',
      'booking_reminder',
      'event_created',
      'event_updated',
      'event_reminder',
      'event_cancelled',
      'message_received',
      'post_created',
      'post_comment',
      'document_shared',
      'group_invitation',
      'announcement',
      'system',
    ],
  })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop()
  linkTo?: string;

  @Prop({ default: false, index: true })
  isRead: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Compound index for efficient queries
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1 });

