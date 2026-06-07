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
      // Direct conversations are strictly 1-to-1. Support threads have a single
      // participant (the resident); the staff side is a role pool, not a stored
      // participant. Uses a function (not an arrow) to read `this.type`.
      validator: function (this: Conversation, participants: Types.ObjectId[]) {
        if (this.type === 'support') return participants.length === 1;
        return participants.length === 2;
      },
      message: 'Invalid number of participants for this conversation type',
    },
    index: true,
  })
  participants: Types.ObjectId[];

  // 'direct' = 1-to-1 neighbour chat. 'support' = resident ↔ Grunnsteinen/husvert,
  // where any eligible staff member can read and reply.
  @Prop({ type: String, enum: ['direct', 'support'], default: 'direct', index: true })
  type: 'direct' | 'support';

  @Prop({ type: String, enum: ['grunnsteinen', 'husvert'] })
  supportChannel?: 'grunnsteinen' | 'husvert';

  // Building the support thread belongs to (drives husvert staff eligibility).
  @Prop({ type: Types.ObjectId, ref: 'Building', index: true })
  buildingId?: Types.ObjectId;

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

// One support thread per resident per channel.
ConversationSchema.index(
  { organizationId: 1, participants: 1, supportChannel: 1 },
  {
    unique: true,
    partialFilterExpression: { type: 'support' },
  },
);

// Building support queue (staff inbox) lookups.
ConversationSchema.index({ buildingId: 1, type: 1, supportChannel: 1, lastMessageAt: -1 });

