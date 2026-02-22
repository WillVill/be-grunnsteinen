import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document as MongooseDocument, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type DocumentDocument = Document & MongooseDocument;

export enum DocumentCategory {
  RULES = 'rules',
  MINUTES = 'minutes',
  FDV = 'fdv',
  MANUALS = 'manuals',
  CONTRACTS = 'contracts',
  FLOOR_PLAN = 'floor-plan',
  OTHER = 'other',
}

@Schema(baseSchemaOptions)
export class Document {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

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

  @Prop({ trim: true })
  description?: string;

  @Prop({
    type: String,
    enum: Object.values(DocumentCategory),
    required: true,
    index: true,
  })
  category: DocumentCategory;

  @Prop({ required: true })
  fileUrl: string;

  @Prop({ required: true })
  fileKey: string;

  @Prop({ required: true, trim: true })
  fileName: string;

  @Prop({ min: 0 })
  fileSize?: number;

  @Prop({ trim: true })
  mimeType?: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  uploadedById: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Apartment',
    index: true,
  })
  apartmentId?: Types.ObjectId;

  @Prop({ default: true, index: true })
  isPublic: boolean;
}

export const DocumentSchema = SchemaFactory.createForClass(Document);

// Compound indexes
DocumentSchema.index({ organizationId: 1, category: 1 });
DocumentSchema.index({ organizationId: 1, isPublic: 1 });
DocumentSchema.index({ organizationId: 1, category: 1, isPublic: 1 });
DocumentSchema.index({ uploadedById: 1, createdAt: -1 });
DocumentSchema.index({ organizationId: 1, buildingId: 1, category: 1 });
DocumentSchema.index({ buildingId: 1, isOrganizationWide: 1 });

// Apartment documents index
DocumentSchema.index({ apartmentId: 1, category: 1 });

// Text search index
DocumentSchema.index({ title: 'text', description: 'text' });

