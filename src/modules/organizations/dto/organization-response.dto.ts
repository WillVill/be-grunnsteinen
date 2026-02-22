import { Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class OrganizationSettingsResponse {
  @ApiProperty()
  @Expose()
  allowResidentPosts: boolean;

  @ApiProperty()
  @Expose()
  allowResidentEvents: boolean;

  @ApiProperty()
  @Expose()
  requireBookingApproval: boolean;

  @ApiProperty()
  @Expose()
  defaultBookingRules: string;
}

export class OrganizationResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  _id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  id: string;

  @ApiProperty({ example: 'Sunset Apartments' })
  @Expose()
  name: string;

  @ApiProperty({ example: 'SUNSET2024' })
  @Expose()
  code: string;

  @ApiPropertyOptional({ example: '123 Main Street' })
  @Expose()
  address?: string;

  @ApiPropertyOptional({ example: 'Oslo' })
  @Expose()
  city?: string;

  @ApiPropertyOptional({ example: '0123' })
  @Expose()
  postalCode?: string;

  @ApiPropertyOptional({ example: 'A friendly community apartment building' })
  @Expose()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @Expose()
  logoUrl?: string;

  @ApiProperty({ type: OrganizationSettingsResponse })
  @Expose()
  @Type(() => OrganizationSettingsResponse)
  settings: OrganizationSettingsResponse;

  @ApiProperty({ example: true })
  @Expose()
  isActive: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  @Expose()
  @Type(() => Date)
  updatedAt: Date;

  constructor(partial: Partial<OrganizationResponseDto>) {
    Object.assign(this, partial);
  }
}

