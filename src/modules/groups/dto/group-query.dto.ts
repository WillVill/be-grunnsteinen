import {
  IsOptional,
  IsString,
  IsBoolean,
  IsMongoId,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';

export class GroupQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search groups by name or description',
    example: 'book club',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter to groups the current user is a member of',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  isMember?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by private status',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  isPrivate?: boolean;

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

