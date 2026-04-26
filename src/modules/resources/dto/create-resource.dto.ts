import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsMongoId,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResourceType } from '../schemas/resource.schema';

export class CreateResourceDto {
  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description:
      'Building ID the resource belongs to. Required unless isOrganizationWide is true.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'When true, the resource is bookable by residents of every building in the organization.',
  })
  @IsOptional()
  @IsBoolean()
  isOrganizationWide?: boolean;
  @ApiProperty({ example: 'Guest Apartment A' })
  @IsString()
  name: string;

  @ApiProperty({
    example: ResourceType.GUEST_APARTMENT,
    enum: ResourceType,
    description: 'Resource type',
  })
  @IsEnum(ResourceType, {
    message: 'Type must be one of: guest-apartment, common-area, parking, equipment',
  })
  type: ResourceType;

  @ApiPropertyOptional({
    example: 'A cozy one-bedroom apartment perfect for visiting guests',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 500,
    description: 'Price per day in the specified currency',
    minimum: 0,
  })
  @IsNumber()
  @Min(0, { message: 'Price per day must be 0 or greater' })
  @Type(() => Number)
  pricePerDay: number;

  @ApiPropertyOptional({
    example: 50,
    description: 'Price per hour (for hourly bookings)',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Price per hour must be 0 or greater' })
  @Type(() => Number)
  pricePerHour?: number;

  @ApiPropertyOptional({
    example: 'No smoking. Maximum 2 guests. Check-in after 2 PM.',
  })
  @IsOptional()
  @IsString()
  rules?: string;

  @ApiPropertyOptional({
    example: 2,
    description: 'Minimum booking duration in hours',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Min booking hours must be 0 or greater' })
  @Type(() => Number)
  minBookingHours?: number;

  @ApiPropertyOptional({
    example: 7,
    description: 'Maximum booking duration in days',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Max booking days must be 0 or greater' })
  @Type(() => Number)
  maxBookingDays?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether bookings require approval',
  })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional({
    example: 'gallery/gjestehybel.jpg',
    description:
      'Reference to a curated gallery image (CloudFront read path). The backend resolves this to a full CloudFront URL and appends it to imageUrls. Mutually exclusive with uploading a file to POST /resources/:id/image.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^gallery\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i, {
    message: 'galleryKey must look like "gallery/<name>.<ext>"',
  })
  galleryKey?: string;
}

