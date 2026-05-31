import {
  IsString,
  IsOptional,
  IsBoolean,
  IsMongoId,
  MinLength,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
    example: '507f1f77bcf86cd799439011',
    description:
      'Folder ID. Pass null to remove the document from its folder (move to "Ikke sortert").',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsMongoId({ message: 'Invalid folder ID format' })
  folderId?: string | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the document is visible to all residents',
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
