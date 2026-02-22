import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type ConversationDocument = Conversation & Document;

@Schema(baseSchemaOptions)
export class Conversation {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'User' }],
    required: true,
    validate: {
      validator: (participants: Types.ObjectId[]) => participants.length === 2,
      message: 'Conversation must have exactly 2 participants',
    },
    index: true,
  })
  participants: Types.ObjectId[];

  @Prop({ index: true })
  lastMessageAt?: Date;

  @Prop({ trim: true, maxlength: 200 })
  lastMessagePreview?: string;

  @Prop({
    type: Map,
    of: Number,
    default: new Map<string, number>(),
  })
  unreadCount: Map<string, number>;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Compound indexes
ConversationSchema.index({ organizationId: 1, lastMessageAt: -1 });
ConversationSchema.index({ participants: 1, lastMessageAt: -1 });

// Unique index to prevent duplicate conversations between same two users
ConversationSchema.index(
  { organizationId: 1, participants: 1 },
  {
    unique: true,
    partialFilterExpression: { participants: { $size: 2 } },
  },
);

