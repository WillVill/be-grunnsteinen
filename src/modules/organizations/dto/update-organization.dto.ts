import {
  IsString,
  IsOptional,
  IsBoolean,
  ValidateNested,
  MinLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

class UpdateOrganizationSettingsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  allowResidentPosts?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  allowResidentEvents?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  requireBookingApproval?: boolean;

  @ApiPropertyOptional({ example: 'Maximum 2 hours per booking' })
  @IsOptional()
  @IsString()
  defaultBookingRules?: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional({ example: 'Sunset Apartments' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  name?: string;

  @ApiPropertyOptional({
    example: 'SUNSET2024',
    description: 'Unique code for users to join (uppercase letters and numbers only)',
  })
  @IsOptional()
  @IsString()
  @MinLength(4, { message: 'Code must be at least 4 characters long' })
  @Matches(/^[A-Z0-9]+$/, {
    message: 'Code must contain only uppercase letters and numbers',
  })
  code?: string;

  @ApiPropertyOptional({ example: '123 Main Street' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Oslo' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: '0123' })
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional({ example: 'A friendly community apartment building' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ type: UpdateOrganizationSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateOrganizationSettingsDto)
  settings?: UpdateOrganizationSettingsDto;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

