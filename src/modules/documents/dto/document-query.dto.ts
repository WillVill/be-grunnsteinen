import { IsOptional, IsString, IsMongoId } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class DocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by folder ID. Pass the literal string "null" to return only documents without a folder ("Ikke sortert").',
  })
  @IsOptional()
  @IsString()
  folderId?: string;

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

  @ApiPropertyOptional({
    description: 'Filter by building ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;

  @ApiPropertyOptional({
    description: 'Filter by concept ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid concept ID format' })
  conceptId?: string;
}
