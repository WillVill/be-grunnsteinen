import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { baseSchemaOptions } from "../../../common/schemas/base.schema";

export type BuildingDocument = Building & Document;

@Schema({ _id: false })
export class BuildingSettings {
  @Prop({ default: true })
  allowResidentPosts: boolean;

  @Prop({ default: true })
  allowResidentEvents: boolean;

  @Prop({ default: false })
  requireBookingApproval: boolean;
}

@Schema(baseSchemaOptions)
export class Building {
  @Prop({
    type: Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true, index: true })
  code?: string;

  @Prop({ trim: true })
  address?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  postalCode?: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({
    type: BuildingSettings,
    default: () => ({
      allowResidentPosts: true,
      allowResidentEvents: true,
      requireBookingApproval: false,
    }),
  })
  settings: BuildingSettings;

  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const BuildingSchema = SchemaFactory.createForClass(Building);

// Compound index for organization + code uniqueness
BuildingSchema.index({ organizationId: 1, code: 1 }, { unique: true, sparse: true });

// Index for querying active buildings in an organization
BuildingSchema.index({ organizationId: 1, isActive: 1 });
