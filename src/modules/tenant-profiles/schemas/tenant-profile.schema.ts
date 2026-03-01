import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export enum TenantProfileStatus {
  UNREGISTERED = 'unregistered',
  INVITED = 'invited',
  REGISTERED = 'registered',
}

@Schema(baseSchemaOptions)
export class TenantProfile {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Building', required: true, index: true })
  buildingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Apartment', required: true, index: true })
  apartmentId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ trim: true })
  lastName?: string;

  @Prop({ lowercase: true, trim: true })
  email?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop()
  moveInDate?: Date;

  @Prop({
    type: String,
    enum: Object.values(TenantProfileStatus),
    default: TenantProfileStatus.UNREGISTERED,
    index: true,
  })
  status: TenantProfileStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Invitation' })
  invitationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  addedBy: Types.ObjectId;
}

export type TenantProfileDocument = HydratedDocument<TenantProfile>;
export const TenantProfileSchema = SchemaFactory.createForClass(TenantProfile);

TenantProfileSchema.index({ organizationId: 1, apartmentId: 1 });
TenantProfileSchema.index({ invitationId: 1 }, { sparse: true });
TenantProfileSchema.index({ userId: 1 }, { sparse: true });
// Prevent duplicate email per apartment (sparse so nulls are excluded)
TenantProfileSchema.index({ apartmentId: 1, email: 1 }, { unique: true, sparse: true });
