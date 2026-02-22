import { IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ResourceType } from '../schemas/resource.schema';

export class ResourceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by resource type',
    enum: ResourceType,
    example: ResourceType.GUEST_APARTMENT,
  })
  @IsOptional()
  @IsEnum(ResourceType)
  type?: ResourceType;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isActive?: boolean;
}

