import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type BookingDocument = Booking & Document;

export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

@Schema(baseSchemaOptions)
export class Booking {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Resource',
    required: true,
    index: true,
  })
  resourceId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Building',
    index: true,
  })
  buildingId?: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  startDate: Date;

  @Prop({ required: true, index: true })
  endDate: Date;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PENDING,
    index: true,
  })
  status: BookingStatus;

  @Prop({ required: true, min: 0 })
  totalPrice: number;

  @Prop({ default: 'NOK', trim: true })
  currency: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ trim: true })
  adminNotes?: string;

  @Prop()
  cancelledAt?: Date;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
  })
  cancelledBy?: Types.ObjectId;

  @Prop({ trim: true })
  cancellationReason?: string;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Compound index for availability checking
BookingSchema.index({ resourceId: 1, startDate: 1, endDate: 1, status: 1 });
BookingSchema.index({ organizationId: 1, buildingId: 1, startDate: 1 });

