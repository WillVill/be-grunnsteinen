import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsMongoId,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentCategory } from '../schemas/document.schema';

export class UploadDocumentDto {
  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description:
      'Building ID the document belongs to. Required unless isOrganizationWide is true.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'When true, the document is visible to residents of every building in the organization.',
  })
  @IsOptional()
  @IsBoolean()
  isOrganizationWide?: boolean;
  @ApiProperty({
    example: 'Building Rules and Regulations',
    minLength: 2,
    maxLength: 100,
    description: 'Document title',
  })
  @IsString()
  @MinLength(2, { message: 'Title must be at least 2 characters long' })
  @MaxLength(100, { message: 'Title must not exceed 100 characters' })
  title: string;

  @ApiPropertyOptional({
    example: 'Updated building rules effective January 2024',
    description: 'Document description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: DocumentCategory,
    example: DocumentCategory.RULES,
    description: 'Document category',
  })
  @IsEnum(DocumentCategory, {
    message: 'Category must be one of: rules, minutes, fdv, manuals, contracts, floor-plan, other',
  })
  category: DocumentCategory;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Apartment ID the document belongs to (optional)',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid apartment ID format' })
  apartmentId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the document is visible to all residents',
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

