import {
  IsBoolean,
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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventCategory } from '../schemas/event.schema';

export class CreateEventDto {
  @ApiProperty({
    example: 'Community BBQ',
    minLength: 3,
    maxLength: 100,
  })
  @IsString()
  @MinLength(3, { message: 'Title must be at least 3 characters long' })
  @MaxLength(100, { message: 'Title must not exceed 100 characters' })
  title: string;

  @ApiProperty({
    example: 'Join us for a fun community BBQ in the courtyard. Bring your favorite dish!',
    maxLength: 2000,
  })
  @IsString()
  @MaxLength(2000, { message: 'Description must not exceed 2000 characters' })
  description: string;

  @ApiProperty({ example: 'Community Courtyard' })
  @IsString()
  location: string;

  @ApiProperty({ example: '2024-06-15T14:00:00.000Z' })
  @IsDate()
  @Type(() => Date)
  startDate: Date;

  @ApiProperty({ example: '2024-06-15T18:00:00.000Z' })
  @IsDate()
  @Type(() => Date)
  endDate: Date;

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

  @ApiProperty({
    example: EventCategory.SOCIAL,
    enum: EventCategory,
    description: 'Event category',
  })
  @IsEnum(EventCategory, {
    message: 'Category must be one of: social, sports, cultural, workshop, other',
  })
  category: EventCategory;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description:
      'Building ID the event belongs to. Required unless isOrganizationWide is true.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'When true, the event is visible to residents of every building in the organization.',
  })
  @IsOptional()
  @IsBoolean()
  isOrganizationWide?: boolean;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Group ID if this is a group event',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid group ID format' })
  groupId?: string;
}

