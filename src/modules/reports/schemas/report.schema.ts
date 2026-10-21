import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export enum ReportTargetType {
  POST = 'post',
  COMMENT = 'comment',
  MESSAGE = 'message',
}

export enum ReportReason {
  SPAM = 'spam',
  HARASSMENT = 'harassment',
  INAPPROPRIATE = 'inappropriate',
  OTHER = 'other',
}

export enum ReportStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

@Schema(baseSchemaOptions)
export class Report {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  reporterId: Types.ObjectId;

  @Prop({ type: String, enum: ReportTargetType, required: true })
  targetType: ReportTargetType;

  @Prop({ type: Types.ObjectId, required: true })
  targetId: Types.ObjectId;

  /** Author/owner of the reported content at report time. */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  targetOwnerId?: Types.ObjectId;

  /** Snapshot so staff can judge the report after the content is gone or when they can't open it (1:1 messages). */
  @Prop({ type: String, maxlength: 280 })
  excerpt?: string;

  /** Web app path to the content, when there is one. */
  @Prop({ type: String })
  webPath?: string;

  @Prop({ type: String, enum: ReportReason, required: true })
  reason: ReportReason;

  @Prop({ type: String, maxlength: 500 })
  details?: string;

  @Prop({ type: String, enum: ReportStatus, default: ReportStatus.OPEN, index: true })
  status: ReportStatus;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index({ reporterId: 1, targetType: 1, targetId: 1, status: 1 });
// One open report per reporter and target; closes the double-tap race.
ReportSchema.index(
  { organizationId: 1, reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
);
