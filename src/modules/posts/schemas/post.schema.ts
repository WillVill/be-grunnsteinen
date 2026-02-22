import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type PostDocument = Post & Document;

export enum PostCategory {
  GENERAL = 'general',
  MAINTENANCE = 'maintenance',
  SOCIAL = 'social',
  QUESTION = 'question',
  ANNOUNCEMENT = 'announcement',
}

@Schema(baseSchemaOptions)
export class Post {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  authorId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Building',
    index: true,
  })
  buildingId?: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Group',
    index: true,
  })
  groupId?: Types.ObjectId;

  @Prop({ default: false })
  isOrganizationWide: boolean;

  @Prop({ trim: true })
  title?: string;

  @Prop({ required: true, trim: true })
  content: string;

  @Prop({
    type: String,
    enum: Object.values(PostCategory),
    required: true,
    index: true,
  })
  category: PostCategory;

  @Prop({ default: false, index: true })
  isPinned: boolean;

  @Prop({ default: false })
  isFromBoard: boolean;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'User' }],
    default: [],
  })
  likes: Types.ObjectId[];

  @Prop({ default: 0 })
  likesCount: number;

  @Prop({ default: 0 })
  commentsCount: number;
}

export const PostSchema = SchemaFactory.createForClass(Post);

// Compound indexes
PostSchema.index({ organizationId: 1, createdAt: -1 });
PostSchema.index({ organizationId: 1, isPinned: -1, createdAt: -1 });
PostSchema.index({ organizationId: 1, category: 1, createdAt: -1 });
PostSchema.index({ authorId: 1, createdAt: -1 });
PostSchema.index({ organizationId: 1, buildingId: 1, createdAt: -1 });
PostSchema.index({ organizationId: 1, groupId: 1, createdAt: -1 });
PostSchema.index({ buildingId: 1, isOrganizationWide: 1 });

// Text search index
PostSchema.index({ title: 'text', content: 'text' });

