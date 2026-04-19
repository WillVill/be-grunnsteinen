import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { baseSchemaOptions } from "../../../common/schemas/base.schema";

export type ResourceDocument = Resource & Document;

export enum ResourceType {
  GUEST_APARTMENT = "guest-apartment",
  COMMON_AREA = "common-area",
  PARKING = "parking",
  EQUIPMENT = "equipment",
}

@Schema(baseSchemaOptions)
export class Resource {
  @Prop({
    type: Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: "Building",
    index: true,
  })
  buildingId?: Types.ObjectId;

  @Prop({ default: false })
  isOrganizationWide: boolean;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    type: String,
    enum: Object.values(ResourceType),
    required: true,
    index: true,
  })
  type: ResourceType;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: [String], default: [] })
  imageUrls: string[];

  @Prop({ default: 0, min: 0 })
  pricePerDay: number;

  @Prop({ min: 0 })
  pricePerHour?: number;

  @Prop({ default: "NOK", trim: true })
  currency: string;

  @Prop({ trim: true })
  rules?: string;

  @Prop({ min: 0 })
  minBookingHours?: number;

  @Prop({ min: 0 })
  maxBookingDays?: number;

  @Prop({ default: false })
  requiresApproval: boolean;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({
    type: [Number],
    default: [],
    validate: {
      validator: (days: number[]) => {
        return days.every((day) => day >= 0 && day <= 6);
      },
      message: "Available days must be between 0 (Sunday) and 6 (Saturday)",
    },
  })
  availableDays: number[];

  @Prop({
    type: String,
    match: /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/,
    default: "00:00",
  })
  availableTimeStart: string;

  @Prop({
    type: String,
    match: /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/,
    default: "23:59",
  })
  availableTimeEnd: string;
}

export const ResourceSchema = SchemaFactory.createForClass(Resource);

// Compound indexes
ResourceSchema.index({ organizationId: 1, type: 1 });
ResourceSchema.index({ organizationId: 1, isActive: 1 });
ResourceSchema.index({ organizationId: 1, type: 1, isActive: 1 });
ResourceSchema.index({ organizationId: 1, buildingId: 1 });
ResourceSchema.index({ buildingId: 1, isOrganizationWide: 1 });

// Text search index
ResourceSchema.index({ name: "text", description: "text" });
