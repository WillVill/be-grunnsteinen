import { IsString, MinLength, MaxLength, IsOptional, IsMongoId } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({
    example: 'Great idea! I\'ll be there.',
    minLength: 1,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(1, { message: 'Comment cannot be empty' })
  @MaxLength(1000, { message: 'Comment must not exceed 1000 characters' })
  content: string;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'ID of the parent comment when replying. Replies can only target top-level comments.',
  })
  @IsOptional()
  @IsMongoId()
  parentCommentId?: string;
}

