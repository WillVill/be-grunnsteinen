import {
  IsString,
  IsOptional,
  IsEnum,
  IsDate,
  IsNumber,
  IsMongoId,
  MinLength,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EventCategory, EventStatus } from '../schemas/event.schema';

export class UpdateEventDto {
  @ApiPropertyOptional({
    example: 'Updated Community BBQ',
    minLength: 3,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Title must be at least 3 characters long' })
  @MaxLength(100, { message: 'Title must not exceed 100 characters' })
  title?: string;

  @ApiPropertyOptional({
    example: 'Updated description',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Description must not exceed 2000 characters' })
  description?: string;

  @ApiPropertyOptional({ example: 'Updated Location' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: '2024-06-15T14:00:00.000Z' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startDate?: Date;

  @ApiPropertyOptional({ example: '2024-06-15T18:00:00.000Z' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  endDate?: Date;

  @ApiPropertyOptional({
    example: 50,
    description: 'Maximum participants (0 = unlimited)',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Max participants must be 0 or greater' })
  @Type(() => Number)
  maxParticipants?: number;

  @ApiPropertyOptional({
    example: EventCategory.SOCIAL,
    enum: EventCategory,
  })
  @IsOptional()
  @IsEnum(EventCategory)
  category?: EventCategory;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid group ID format' })
  groupId?: string;

  @ApiPropertyOptional({
    example: EventStatus.UPCOMING,
    enum: EventStatus,
  })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  isRecurring?: boolean;

  @ApiPropertyOptional({ example: 'weekly' })
  @IsOptional()
  @IsString()
  recurringPattern?: string;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

