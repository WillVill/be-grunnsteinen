import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsMongoId,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SharedItemCategory } from '../schemas/shared-item.schema';

export class CreateSharedItemDto {
  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Building ID the shared item belongs to (omit for concept-wide)',
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
    description: 'When true, the shared item is borrowable across all buildings in the concept.',
  })
  @IsOptional()
  @IsBoolean()
  isConceptWide?: boolean;
  @ApiProperty({
    example: 'Power Drill',
    minLength: 2,
    maxLength: 50,
    description: 'Item name',
  })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(50, { message: 'Name must not exceed 50 characters' })
  name: string;

  @ApiPropertyOptional({
    example: 'Cordless power drill with multiple drill bits included',
    maxLength: 500,
    description: 'Item description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  description?: string;

  @ApiProperty({
    enum: SharedItemCategory,
    example: SharedItemCategory.TOOLS,
    description: 'Category of shared item',
  })
  @IsEnum(SharedItemCategory, {
    message: 'Category must be one of: tools, outdoor, games-social, kitchen, parking, other',
  })
  category: SharedItemCategory;
}

