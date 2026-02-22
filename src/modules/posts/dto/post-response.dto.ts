import { Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostCategory } from '../schemas/post.schema';

class AuthorResponse {
  @ApiProperty()
  @Expose()
  _id: string;

  @ApiProperty()
  @Expose()
  name: string;

  @ApiPropertyOptional()
  @Expose()
  avatarUrl?: string;
}

export class PostResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  _id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  organizationId: string;

  @ApiProperty({ type: AuthorResponse })
  @Expose()
  @Type(() => AuthorResponse)
  author: AuthorResponse;

  @ApiPropertyOptional({ example: 'Community BBQ this Saturday' })
  @Expose()
  title?: string;

  @ApiProperty({ example: 'Join us for a community BBQ...' })
  @Expose()
  content: string;

  @ApiProperty({ enum: PostCategory, example: PostCategory.SOCIAL })
  @Expose()
  category: PostCategory;

  @ApiProperty({ example: false })
  @Expose()
  isPinned: boolean;

  @ApiProperty({ example: false })
  @Expose()
  isFromBoard: boolean;

  @ApiProperty({ example: 5 })
  @Expose()
  likesCount: number;

  @ApiProperty({ example: 3 })
  @Expose()
  commentsCount: number;

  @ApiProperty({ example: false })
  @Expose()
  isLiked: boolean;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  @Expose()
  @Type(() => Date)
  updatedAt: Date;

  constructor(partial: Partial<PostResponseDto>) {
    Object.assign(this, partial);
  }
}

