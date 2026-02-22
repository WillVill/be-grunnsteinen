import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}

