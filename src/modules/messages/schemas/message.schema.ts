import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type MessageDocument = Message & Document;

@Schema(baseSchemaOptions)
export class Message {
  @Prop({
    type: Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  })
  conversationId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  senderId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  content: string;

  @Prop({ default: false })
  isRead: boolean;

  @Prop()
  readAt?: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Compound indexes
MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1, createdAt: -1 });
MessageSchema.index({ conversationId: 1, isRead: 1, createdAt: -1 });

