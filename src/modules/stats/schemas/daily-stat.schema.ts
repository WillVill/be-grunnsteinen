import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type DailyStatDocument = DailyStat & Document;

@Schema(baseSchemaOptions)
export class DailyStat {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Building', default: null, index: true })
  buildingId: Types.ObjectId | null;

  @Prop({ type: Date, required: true, index: true })
  date: Date;

  @Prop({ default: 0 }) newUsers: number;
  @Prop({ default: 0 }) newPosts: number;
  @Prop({ default: 0 }) newEvents: number;
  @Prop({ default: 0 }) newBookings: number;
  @Prop({ default: 0 }) newHelpRequests: number;
  @Prop({ default: 0 }) newComments: number;
  @Prop({ default: 0 }) newMessages: number;
}

export const DailyStatSchema = SchemaFactory.createForClass(DailyStat);

DailyStatSchema.index(
  { organizationId: 1, buildingId: 1, date: 1 },
  { unique: true },
);
DailyStatSchema.index({ organizationId: 1, date: 1 });
