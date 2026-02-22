import { IsOptional, IsString, IsBoolean, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { UserRole } from '../schemas/user.schema';

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search by name or email',
    example: 'john',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by building',
    example: 'Building A',
  })
  @IsOptional()
  @IsString()
  building?: string;

  @ApiPropertyOptional({
    description: 'Filter by helpful neighbor status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isHelpfulNeighbor?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by user role',
    enum: UserRole,
    example: 'resident',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Only include these roles (comma-separated)',
    example: 'admin,super_admin',
  })
  @IsOptional()
  @IsString()
  onlyRoles?: string;

  @ApiPropertyOptional({
    description: 'Exclude these roles (comma-separated)',
    example: 'admin,super_admin',
  })
  @IsOptional()
  @IsString()
  excludeRoles?: string;
}

