import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type SharedItemDocument = SharedItem & Document;

export enum SharedItemCategory {
  TOOLS = 'tools',
  OUTDOOR = 'outdoor',
  TOYS = 'toys',
  KITCHEN = 'kitchen',
  ELECTRONICS = 'electronics',
  OTHER = 'other',
}

@Schema(baseSchemaOptions)
export class SharedItem {
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
  ownerId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Building',
    index: true,
  })
  buildingId?: Types.ObjectId;

  @Prop({ default: false })
  isOrganizationWide: boolean;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({
    type: String,
    enum: Object.values(SharedItemCategory),
    required: true,
    index: true,
  })
  category: SharedItemCategory;

  @Prop()
  imageUrl?: string;

  @Prop({ default: true, index: true })
  isAvailable: boolean;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
  })
  borrowedBy?: Types.ObjectId;

  @Prop()
  borrowedAt?: Date;
}

export const SharedItemSchema = SchemaFactory.createForClass(SharedItem);

// Compound indexes
SharedItemSchema.index({ organizationId: 1, isAvailable: 1 });
SharedItemSchema.index({ organizationId: 1, category: 1, isAvailable: 1 });
SharedItemSchema.index({ ownerId: 1, isAvailable: 1 });
SharedItemSchema.index({ organizationId: 1, buildingId: 1, isAvailable: 1 });
SharedItemSchema.index({ buildingId: 1, isOrganizationWide: 1 });

// Text search index
SharedItemSchema.index({ name: 'text', description: 'text' });

