import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document as MongooseDocument, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type DocumentFolderDocument = DocumentFolder & MongooseDocument;

@Schema(baseSchemaOptions)
export class DocumentFolder {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Concept',
    required: true,
    index: true,
  })
  conceptId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Building',
    index: true,
  })
  buildingId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ default: 0, min: 0 })
  documentCount: number;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  createdById: Types.ObjectId;
}

export const DocumentFolderSchema = SchemaFactory.createForClass(DocumentFolder);

DocumentFolderSchema.index({ organizationId: 1, conceptId: 1, buildingId: 1 });
DocumentFolderSchema.index(
  { organizationId: 1, conceptId: 1, name: 1 },
  { unique: true },
);
