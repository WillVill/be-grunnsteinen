import { Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../schemas/booking.schema';

class ResourceInfoDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  _id: string;

  @ApiProperty({ example: 'Guest Apartment A' })
  @Expose()
  name: string;

  @ApiPropertyOptional({ example: 'guest-apartment' })
  @Expose()
  type?: string;
}

class UserInfoDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  _id: string;

  @ApiProperty({ example: 'John Doe' })
  @Expose()
  name: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @Expose()
  email?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  @Expose()
  avatarUrl?: string;
}

export class BookingResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  _id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  organizationId: string;

  @ApiProperty({ type: ResourceInfoDto })
  @Expose()
  @Type(() => ResourceInfoDto)
  resourceId: ResourceInfoDto;

  @ApiProperty({ type: UserInfoDto })
  @Expose()
  @Type(() => UserInfoDto)
  userId: UserInfoDto;

  @ApiProperty({ example: '2024-06-15T14:00:00.000Z' })
  @Expose()
  @Type(() => Date)
  startDate: Date;

  @ApiProperty({ example: '2024-06-17T12:00:00.000Z' })
  @Expose()
  @Type(() => Date)
  endDate: Date;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  @Expose()
  status: BookingStatus;

  @ApiProperty({ example: 1000 })
  @Expose()
  totalPrice: number;

  @ApiProperty({ example: 'NOK' })
  @Expose()
  currency: string;

  @ApiPropertyOptional({ example: 'Please leave the apartment clean' })
  @Expose()
  notes?: string;

  @ApiPropertyOptional({ example: 'Approved by board' })
  @Expose()
  adminNotes?: string;

  @ApiPropertyOptional({ example: '2024-06-10T10:00:00.000Z' })
  @Expose()
  @Type(() => Date)
  cancelledAt?: Date;

  @ApiPropertyOptional({ type: UserInfoDto })
  @Expose()
  @Type(() => UserInfoDto)
  cancelledBy?: UserInfoDto;

  @ApiPropertyOptional({ example: 'Change of plans' })
  @Expose()
  cancellationReason?: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  @Expose()
  @Type(() => Date)
  updatedAt: Date;

  constructor(partial: Partial<BookingResponseDto>) {
    Object.assign(this, partial);
  }
}

