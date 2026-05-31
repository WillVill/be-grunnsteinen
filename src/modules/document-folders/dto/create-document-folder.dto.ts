import {
  IsString,
  IsOptional,
  IsMongoId,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDocumentFolderDto {
  @ApiProperty({
    example: 'Ordensregler',
    minLength: 2,
    maxLength: 60,
    description: 'Folder name',
  })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(60, { message: 'Name must not exceed 60 characters' })
  name: string;

  @ApiPropertyOptional({
    example: 'Husordensregler og retningslinjer for sameiet',
    maxLength: 300,
    description: 'Optional folder description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Description must not exceed 300 characters' })
  description?: string;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description:
      'Concept ID. Derived from buildingId when omitted. Required if buildingId is not provided.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid concept ID format' })
  conceptId?: string;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description:
      'When set, the folder is scoped to a specific building. Omit to make the folder visible to the whole concept.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;
}
