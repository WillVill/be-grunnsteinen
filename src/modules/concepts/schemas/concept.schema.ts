import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { baseSchemaOptions } from "../../../common/schemas/base.schema";

export type ConceptDocument = Concept & Document;

@Schema(baseSchemaOptions)
export class Concept {
  @Prop({
    type: Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  // No standalone index on `code` — the compound {organizationId, code} unique
  // index below covers org-scoped lookups, which is the only way code is used.
  @Prop({ trim: true })
  code?: string;

  @Prop({ trim: true })
  logoUrl?: string;

  @Prop({ trim: true })
  brandColor?: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const ConceptSchema = SchemaFactory.createForClass(Concept);

// Compound index for organization + code uniqueness (sparse — code is optional)
ConceptSchema.index({ organizationId: 1, code: 1 }, { unique: true, sparse: true });

// Index for listing active concepts in an organization
ConceptSchema.index({ organizationId: 1, isActive: 1 });
