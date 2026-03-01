import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsMongoId,
  IsOptional,
  IsDateString,
  MinLength,
} from 'class-validator';

export class CreateTenantProfileDto {
  @ApiProperty({ description: 'Building ID the apartment belongs to' })
  @IsMongoId()
  buildingId: string;

  @ApiProperty({ description: 'Apartment ID to assign this tenant to' })
  @IsMongoId()
  apartmentId: string;

  @ApiProperty({ example: 'Ola' })
  @IsString()
  @MinLength(1)
  firstName: string;

  @ApiPropertyOptional({ example: 'Nordmann' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: 'ola@eksempel.no' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+47 123 45 678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Admin-only internal notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  moveInDate?: string;
}
