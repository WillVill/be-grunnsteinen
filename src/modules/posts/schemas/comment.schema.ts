import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { baseSchemaOptions } from '../../../common/schemas/base.schema';

export type CommentDocument = Comment & Document;

@Schema(baseSchemaOptions)
export class Comment {
  @Prop({
    type: Types.ObjectId,
    ref: 'Post',
    required: true,
    index: true,
  })
  postId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  authorId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Comment',
    default: null,
    index: true,
  })
  parentCommentId?: Types.ObjectId | null;

  @Prop({ required: true, trim: true })
  content: string;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);

// Compound indexes
CommentSchema.index({ postId: 1, createdAt: 1 });
CommentSchema.index({ authorId: 1, createdAt: -1 });
CommentSchema.index({ postId: 1, parentCommentId: 1, createdAt: 1 });

