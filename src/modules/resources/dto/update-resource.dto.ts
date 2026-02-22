import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ResourceType } from '../schemas/resource.schema';

export class UpdateResourceDto {
  @ApiPropertyOptional({ example: 'Updated Guest Apartment A' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: ResourceType.GUEST_APARTMENT,
    enum: ResourceType,
  })
  @IsOptional()
  @IsEnum(ResourceType)
  type?: ResourceType;

  @ApiPropertyOptional({
    example: 'Updated description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 600,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Price per day must be 0 or greater' })
  @Type(() => Number)
  pricePerDay?: number;

  @ApiPropertyOptional({
    example: 60,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Price per hour must be 0 or greater' })
  @Type(() => Number)
  pricePerHour?: number;

  @ApiPropertyOptional({
    example: 'Updated rules',
  })
  @IsOptional()
  @IsString()
  rules?: string;

  @ApiPropertyOptional({
    example: 3,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Min booking hours must be 0 or greater' })
  @Type(() => Number)
  minBookingHours?: number;

  @ApiPropertyOptional({
    example: 10,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Max booking days must be 0 or greater' })
  @Type(() => Number)
  maxBookingDays?: number;

  @ApiPropertyOptional({
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional({
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: 'NOK',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    example: [0, 1, 2, 3, 4, 5, 6],
    description: 'Available days (0=Sunday, 6=Saturday). Empty array = all days',
  })
  @IsOptional()
  @IsNumber({}, { each: true })
  availableDays?: number[];

  @ApiPropertyOptional({
    example: '08:00',
    description: 'Available time start (HH:MM format)',
  })
  @IsOptional()
  @IsString()
  availableTimeStart?: string;

  @ApiPropertyOptional({
    example: '22:00',
    description: 'Available time end (HH:MM format)',
  })
  @IsOptional()
  @IsString()
  availableTimeEnd?: string;
}

