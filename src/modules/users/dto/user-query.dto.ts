import { IsOptional, IsString, IsBoolean, IsEnum, IsMongoId } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { UserRole } from '../schemas/user.schema';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';

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
  @ToBoolean()
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

export class HelpfulNeighborsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by building ID' })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;
}
