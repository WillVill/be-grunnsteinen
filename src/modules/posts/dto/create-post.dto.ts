import {
  IsBoolean,
  IsString,
  IsOptional,
  IsEnum,
  IsMongoId,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostCategory } from '../schemas/post.schema';

export class CreatePostDto {
  @ApiPropertyOptional({
    example: 'Community BBQ this Saturday',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Title must not exceed 200 characters' })
  title?: string;

  @ApiProperty({
    example: 'Join us for a community BBQ this Saturday at 2 PM in the courtyard!',
    minLength: 1,
    maxLength: 5000,
  })
  @IsString()
  @MinLength(1, { message: 'Content cannot be empty' })
  @MaxLength(5000, { message: 'Content must not exceed 5000 characters' })
  content: string;

  @ApiProperty({
    example: PostCategory.SOCIAL,
    enum: PostCategory,
    description: 'Post category',
  })
  @IsEnum(PostCategory, {
    message: 'Category must be one of: general, maintenance, social, question, announcement',
  })
  category: PostCategory;

  @ApiPropertyOptional({
    description:
      'Building ID the post belongs to. Required unless isOrganizationWide is true.',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'When true, the post is visible in every building in the organization.',
  })
  @IsOptional()
  @IsBoolean()
  isOrganizationWide?: boolean;

  @ApiPropertyOptional({
    description: 'Group ID when posting in a group',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid group ID format' })
  groupId?: string;
}

