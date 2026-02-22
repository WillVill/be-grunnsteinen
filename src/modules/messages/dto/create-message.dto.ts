import {
  IsMongoId,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMessageDto {
  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Recipient user ID (for new conversation). Either recipientId or conversationId must be provided.',
  })
  @IsOptional()
  @ValidateIf((o) => !o.conversationId)
  @IsNotEmpty({ message: 'recipientId is required when conversationId is not provided' })
  @IsMongoId({ message: 'Invalid recipient ID format' })
  recipientId?: string;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Conversation ID (for existing conversation). Either recipientId or conversationId must be provided.',
  })
  @IsOptional()
  @ValidateIf((o) => !o.recipientId)
  @IsNotEmpty({ message: 'conversationId is required when recipientId is not provided' })
  @IsMongoId({ message: 'Invalid conversation ID format' })
  conversationId?: string;

  @ApiProperty({
    example: 'Hello! How are you doing?',
    minLength: 1,
    maxLength: 2000,
    description: 'Message content',
  })
  @IsString()
  @MinLength(1, { message: 'Message content cannot be empty' })
  @MaxLength(2000, { message: 'Message content must not exceed 2000 characters' })
  content: string;
}

