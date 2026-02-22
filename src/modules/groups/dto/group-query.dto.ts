import {
  IsOptional,
  IsString,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

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
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isMember?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by private status',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isPrivate?: boolean;
}

