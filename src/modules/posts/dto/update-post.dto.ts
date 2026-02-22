import {
  IsString,
  IsOptional,
  IsEnum,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PostCategory } from '../schemas/post.schema';

export class UpdatePostDto {
  @ApiPropertyOptional({
    example: 'Updated Community BBQ this Saturday',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Title must not exceed 200 characters' })
  title?: string;

  @ApiPropertyOptional({
    example: 'Updated content for the post',
    minLength: 1,
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Content cannot be empty' })
  @MaxLength(5000, { message: 'Content must not exceed 5000 characters' })
  content?: string;

  @ApiPropertyOptional({
    example: PostCategory.ANNOUNCEMENT,
    enum: PostCategory,
  })
  @IsOptional()
  @IsEnum(PostCategory, {
    message: 'Category must be one of: general, maintenance, social, question, announcement',
  })
  category?: PostCategory;
}

