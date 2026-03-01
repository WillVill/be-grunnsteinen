import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type InvitationDocument = Invitation & Document;

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
}

@Schema(baseSchemaOptions)
export class Invitation {
  @Prop({ required: true, lowercase: true, trim: true, index: true })
  email: string;

  @Prop({ type: Types.ObjectId, ref: 'Building', required: true, index: true })
  buildingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId: Types.ObjectId;

  @Prop({ trim: true })
  unitNumber?: string;

  @Prop({ type: Types.ObjectId, ref: 'Apartment' })
  apartmentId?: Types.ObjectId;

  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ required: true, unique: true, index: true })
  token: string;

  @Prop({ required: true, index: true })
  expiresAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(InvitationStatus),
    default: InvitationStatus.PENDING,
    index: true,
  })
  status: InvitationStatus;
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);

InvitationSchema.index({ token: 1 }, { unique: true });
