import {
  IsString,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HelpRequestCategory } from '../schemas/help-request.schema';

export class CreateHelpRequestDto {
  @ApiProperty({
    example: 'Need help walking my dog this weekend',
    minLength: 5,
    maxLength: 100,
    description: 'Help request title',
  })
  @IsString()
  @MinLength(5, { message: 'Title must be at least 5 characters long' })
  @MaxLength(100, { message: 'Title must not exceed 100 characters' })
  title: string;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Building ID the help request belongs to (omit for concept-wide)',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Concept ID. Derived from buildingId when omitted.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid concept ID format' })
  conceptId?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'When true, the help request is visible across all buildings in the concept.',
  })
  @IsOptional()
  @IsBoolean()
  isConceptWide?: boolean;

  @ApiProperty({
    example: 'I need someone to walk my dog on Saturday and Sunday morning around 8 AM.',
    maxLength: 1000,
    description: 'Detailed description of the help needed',
  })
  @IsString()
  @MaxLength(1000, { message: 'Description must not exceed 1000 characters' })
  description: string;

  @ApiProperty({
    enum: HelpRequestCategory,
    example: HelpRequestCategory.PET_CARE,
    description: 'Category of help request',
  })
  @IsEnum(HelpRequestCategory, {
    message: 'Category must be one of: pet-care, plant-care, handyman, errands, other',
  })
  category: HelpRequestCategory;
}

