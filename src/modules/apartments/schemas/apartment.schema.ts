import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { baseSchemaOptions } from "../../../common/schemas/base.schema";

export type ApartmentDocument = Apartment & Document;

export enum ApartmentType {
  ONE_ROOM = "1-room",
  TWO_ROOM = "2-room",
  THREE_ROOM = "3-room",
  FOUR_ROOM = "4-room",
  FIVE_PLUS_ROOM = "5+room",
  OTHER = "other",
}

@Schema(baseSchemaOptions)
export class Apartment {
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
    required: true,
    index: true,
  })
  buildingId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  unitNumber: string;

  @Prop()
  floor?: number;

  @Prop({ min: 0 })
  sizeSqm?: number;

  @Prop({ min: 0 })
  numberOfRooms?: number;

  @Prop({
    type: String,
    enum: Object.values(ApartmentType),
  })
  apartmentType?: ApartmentType;

  @Prop({ trim: true })
  description?: string;

  @Prop({
    type: Types.ObjectId,
    ref: "User",
    index: true,
  })
  tenantId?: Types.ObjectId;

  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const ApartmentSchema = SchemaFactory.createForClass(Apartment);

// Compound unique index: unit number must be unique within a building
ApartmentSchema.index(
  { buildingId: 1, unitNumber: 1 },
  { unique: true },
);

// Index for querying active apartments in a building
ApartmentSchema.index({ buildingId: 1, isActive: 1 });

// Index for querying apartments by organization
ApartmentSchema.index({ organizationId: 1, buildingId: 1 });
