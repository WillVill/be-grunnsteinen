import { Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class AuthorResponse {
  @ApiProperty()
  @Expose()
  _id: string;

  @ApiProperty()
  @Expose()
  name: string;

  @ApiProperty()
  @Expose()
  avatarUrl?: string;
}

export class CommentResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  _id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  postId: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011', nullable: true, required: false })
  @Expose()
  parentCommentId?: string | null;

  @ApiProperty({ type: AuthorResponse })
  @Expose()
  @Type(() => AuthorResponse)
  author: AuthorResponse;

  @ApiProperty({ example: 'Great idea! I\'ll be there.' })
  @Expose()
  content: string;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  @Expose()
  @Type(() => Date)
  updatedAt: Date;

  constructor(partial: Partial<CommentResponseDto>) {
    Object.assign(this, partial);
  }
}

