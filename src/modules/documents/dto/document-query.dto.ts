import {
  IsOptional,
  IsEnum,
  IsString,
  IsMongoId,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { DocumentCategory } from '../schemas/document.schema';

export class DocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by document category',
    enum: DocumentCategory,
    example: DocumentCategory.RULES,
  })
  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @ApiPropertyOptional({
    description: 'Search documents by title or description',
    example: 'building rules',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by apartment ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid apartment ID format' })
  apartmentId?: string;
}

