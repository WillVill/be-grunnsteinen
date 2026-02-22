import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";
import { baseSchemaOptions } from "../../../common/schemas/base.schema";

export type OrganizationDocument = Organization & Document;

@Schema({ _id: false })
export class OrganizationSettings {
  @Prop({ default: true })
  allowResidentPosts: boolean;

  @Prop({ default: true })
  allowResidentEvents: boolean;

  @Prop({ default: false })
  requireBookingApproval: boolean;

  @Prop({ type: String, default: "" })
  defaultBookingRules: string;
}

@Schema(baseSchemaOptions)
export class Organization {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, trim: true, index: true })
  code: string;

  @Prop({ trim: true })
  address?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  postalCode?: string;

  @Prop({ trim: true })
  description?: string;

  @Prop()
  logoUrl?: string;

  @Prop({
    type: OrganizationSettings,
    default: () => ({
      allowResidentPosts: true,
      allowResidentEvents: true,
      requireBookingApproval: false,
      defaultBookingRules: "",
    }),
  })
  settings: OrganizationSettings;

  @Prop({ default: true })
  isActive: boolean;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);

// Unique index on code (already defined in @Prop, but explicit for clarity)
OrganizationSchema.index({ code: 1 }, { unique: true });
