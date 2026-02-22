import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type HelpRequestDocument = HelpRequest & Document;

export enum HelpRequestCategory {
  PET_CARE = 'pet-care',
  PLANT_CARE = 'plant-care',
  HANDYMAN = 'handyman',
  TUTORING = 'tutoring',
  ERRANDS = 'errands',
  OTHER = 'other',
}

export enum HelpRequestStatus {
  OPEN = 'open',
  ACCEPTED = 'accepted',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Schema(baseSchemaOptions)
export class HelpRequest {
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
    index: true,
  })
  requesterId: Types.ObjectId;

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

  @Prop({
    type: String,
    enum: Object.values(HelpRequestCategory),
    required: true,
    index: true,
  })
  category: HelpRequestCategory;

  @Prop({
    type: String,
    enum: Object.values(HelpRequestStatus),
    default: HelpRequestStatus.OPEN,
    index: true,
  })
  status: HelpRequestStatus;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
  })
  helperId?: Types.ObjectId;

  @Prop()
  acceptedAt?: Date;

  @Prop()
  completedAt?: Date;
}

export const HelpRequestSchema = SchemaFactory.createForClass(HelpRequest);

// Compound indexes
HelpRequestSchema.index({ organizationId: 1, status: 1 });
HelpRequestSchema.index({ organizationId: 1, category: 1, status: 1 });
HelpRequestSchema.index({ requesterId: 1, status: 1 });
HelpRequestSchema.index({ organizationId: 1, buildingId: 1, status: 1 });
HelpRequestSchema.index({ buildingId: 1, isOrganizationWide: 1 });

// Text search index
HelpRequestSchema.index({ title: 'text', description: 'text' });

