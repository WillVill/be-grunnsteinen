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

  // Subfolders inherit conceptId/buildingId from their parent, so a folder's
  // scope is always that of its root folder. Absent on top-level folders.
  @Prop({
    type: Types.ObjectId,
    ref: 'DocumentFolder',
    index: true,
  })
  parentId?: Types.ObjectId;

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
// Names are unique among siblings: the same name may exist in different
// buildings and under different parents. Missing buildingId/parentId index as
// null, so concept-wide and top-level folders are still deduplicated.
// Replaces the old { organizationId, conceptId, name } index — drop it with
// scripts/migrate-folder-hierarchy.ts.
DocumentFolderSchema.index(
  { organizationId: 1, conceptId: 1, buildingId: 1, parentId: 1, name: 1 },
  { unique: true },
);
