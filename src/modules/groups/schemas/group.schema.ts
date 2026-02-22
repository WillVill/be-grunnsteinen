import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type GroupDocument = Group & Document;

@Schema(baseSchemaOptions)
export class Group {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop()
  imageUrl?: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  creatorId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Building',
    index: true,
  })
  buildingId?: Types.ObjectId;

  @Prop({ default: false })
  isOrganizationWide: boolean;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'User' }],
    default: [],
  })
  members: Types.ObjectId[];

  @Prop({ default: 0 })
  memberCount: number;

  @Prop({ default: false, index: true })
  isPrivate: boolean;

  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const GroupSchema = SchemaFactory.createForClass(Group);

// Compound indexes
GroupSchema.index({ organizationId: 1, isActive: 1 });
GroupSchema.index({ organizationId: 1, isPrivate: 1, isActive: 1 });
GroupSchema.index({ organizationId: 1, buildingId: 1, isActive: 1 });
GroupSchema.index({ buildingId: 1, isOrganizationWide: 1 });

// Text search index
GroupSchema.index({ name: 'text', description: 'text' });

