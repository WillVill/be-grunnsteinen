import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type EventDocument = Event & Document;

export enum EventCategory {
  SOCIAL = 'social',
  SPORTS = 'sports',
  CULTURAL = 'cultural',
  WORKSHOP = 'workshop',
  OTHER = 'other',
}

export enum EventStatus {
  UPCOMING = 'upcoming',
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Schema(baseSchemaOptions)
export class Event {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  organizerId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Group',
  })
  groupId?: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Building',
    index: true,
  })
  buildingId?: Types.ObjectId;

  @Prop({ default: false })
  isOrganizationWide: boolean;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ required: true, trim: true })
  location: string;

  @Prop()
  imageUrl?: string;

  @Prop({ required: true, index: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ default: 0 })
  maxParticipants: number;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'User' }],
    default: [],
  })
  participants: Types.ObjectId[];

  @Prop({ default: 0 })
  participantsCount: number;

  @Prop({
    type: String,
    enum: Object.values(EventCategory),
    required: true,
    index: true,
  })
  category: EventCategory;

  @Prop({ default: false })
  isRecurring: boolean;

  @Prop({ trim: true })
  recurringPattern?: string;

  @Prop({
    type: String,
    enum: Object.values(EventStatus),
    default: EventStatus.UPCOMING,
    index: true,
  })
  status: EventStatus;
}

export const EventSchema = SchemaFactory.createForClass(Event);

// Compound indexes
EventSchema.index({ organizationId: 1, startDate: 1 });
EventSchema.index({ organizationId: 1, status: 1, startDate: 1 });
EventSchema.index({ organizationId: 1, category: 1, startDate: 1 });
EventSchema.index({ organizerId: 1, startDate: -1 });
EventSchema.index({ groupId: 1, startDate: -1 });
EventSchema.index({ organizationId: 1, buildingId: 1, startDate: 1 });
EventSchema.index({ buildingId: 1, isOrganizationWide: 1 });

// Text search index
EventSchema.index({ title: 'text', description: 'text', location: 'text' });

