import { Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResourceType } from '../schemas/resource.schema';

export class ResourceResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  _id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  organizationId: string;

  @ApiProperty({ example: 'Guest Apartment A' })
  @Expose()
  name: string;

  @ApiProperty({ enum: ResourceType, example: ResourceType.GUEST_APARTMENT })
  @Expose()
  type: ResourceType;

  @ApiPropertyOptional({ example: 'A cozy one-bedroom apartment...' })
  @Expose()
  description?: string;

  @ApiProperty({ example: ['https://example.com/image1.jpg'] })
  @Expose()
  imageUrls: string[];

  @ApiProperty({ example: 500 })
  @Expose()
  pricePerDay: number;

  @ApiPropertyOptional({ example: 50 })
  @Expose()
  pricePerHour?: number;

  @ApiProperty({ example: 'NOK' })
  @Expose()
  currency: string;

  @ApiPropertyOptional({ example: 'No smoking. Maximum 2 guests.' })
  @Expose()
  rules?: string;

  @ApiPropertyOptional({ example: 2 })
  @Expose()
  minBookingHours?: number;

  @ApiPropertyOptional({ example: 7 })
  @Expose()
  maxBookingDays?: number;

  @ApiProperty({ example: false })
  @Expose()
  requiresApproval: boolean;

  @ApiProperty({ example: true })
  @Expose()
  isActive: boolean;

  @ApiProperty({ example: [0, 1, 2, 3, 4, 5, 6] })
  @Expose()
  availableDays: number[];

  @ApiProperty({ example: '08:00' })
  @Expose()
  availableTimeStart: string;

  @ApiProperty({ example: '22:00' })
  @Expose()
  availableTimeEnd: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  @Expose()
  @Type(() => Date)
  updatedAt: Date;

  constructor(partial: Partial<ResourceResponseDto>) {
    Object.assign(this, partial);
  }
}

