import {
  IsString,
  IsOptional,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Sunset Apartments', minLength: 2 })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  name: string;

  @ApiProperty({
    example: 'SUNSET2024',
    description: 'Unique code for users to join (uppercase letters and numbers only)',
    minLength: 4,
  })
  @IsString()
  @MinLength(4, { message: 'Code must be at least 4 characters long' })
  @Matches(/^[A-Z0-9]+$/, {
    message: 'Code must contain only uppercase letters and numbers',
  })
  code: string;

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
}

