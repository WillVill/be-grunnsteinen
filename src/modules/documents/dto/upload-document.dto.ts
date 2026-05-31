import {
  IsString,
  IsOptional,
  IsBoolean,
  IsMongoId,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadDocumentDto {
  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description:
      'Building ID the document belongs to. Required unless isConceptWide is true and conceptId is provided.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Concept ID the document belongs to. Derived from buildingId when omitted.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid concept ID format' })
  conceptId?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'When true, the document is visible to residents of every building in the concept.',
  })
  @IsOptional()
  @IsBoolean()
  isConceptWide?: boolean;

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

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description:
      'Folder ID the document belongs to. Optional — documents without a folder appear in the "Ikke sortert" section. Apartment-specific documents typically have no folder.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid folder ID format' })
  folderId?: string;

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
