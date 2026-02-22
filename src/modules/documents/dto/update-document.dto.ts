import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentCategory } from '../schemas/document.schema';

export class UpdateDocumentDto {
  @ApiPropertyOptional({
    example: 'Building Rules and Regulations',
    minLength: 2,
    maxLength: 100,
    description: 'Document title',
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Title must be at least 2 characters long' })
  @MaxLength(100, { message: 'Title must not exceed 100 characters' })
  title?: string;

  @ApiPropertyOptional({
    example: 'Updated building rules effective January 2024',
    description: 'Document description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: DocumentCategory,
    example: DocumentCategory.RULES,
    description: 'Document category',
  })
  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the document is visible to all residents',
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

