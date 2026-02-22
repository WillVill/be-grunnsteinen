import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class NotificationPreferencesResponse {
  @ApiProperty()
  @Expose()
  email: {
    newPosts: boolean;
    comments: boolean;
    events: boolean;
    eventReminders: boolean;
    bookings: boolean;
    helpRequests: boolean;
    messages: boolean;
    boardAnnouncements: boolean;
  };

  @ApiProperty()
  @Expose()
  push: {
    newPosts: boolean;
    comments: boolean;
    events: boolean;
    eventReminders: boolean;
    bookings: boolean;
    helpRequests: boolean;
    messages: boolean;
    boardAnnouncements: boolean;
  };
}

export class UserResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  _id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  id: string;

  @ApiProperty({ example: 'john.doe@example.com' })
  @Expose()
  email: string;

  @ApiProperty({ example: 'John Doe' })
  @Expose()
  name: string;

  @ApiPropertyOptional({ example: '+47 123 45 678' })
  @Expose()
  phone?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  @Expose()
  avatarUrl?: string;

  @ApiPropertyOptional({ example: '#3b82f6' })
  @Expose()
  avatarColor?: string;

  @ApiPropertyOptional({ example: '1990-01-15' })
  @Expose()
  @Type(() => Date)
  dateOfBirth?: Date;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  organizationId: string;

  @ApiProperty({ example: '301' })
  @Expose()
  unitNumber: string;

  @ApiPropertyOptional({ example: 'Building A' })
  @Expose()
  building?: string;

  @ApiProperty({ example: 'resident', enum: ['resident', 'board', 'admin'] })
  @Expose()
  role: string;

  @ApiProperty({ example: ['gardening', 'cooking'] })
  @Expose()
  interests: string[];

  @ApiProperty({ example: false })
  @Expose()
  isHelpfulNeighbor: boolean;

  @ApiProperty({ example: ['plumbing', 'electrical'] })
  @Expose()
  helpfulSkills: string[];

  @ApiProperty({ example: false })
  @Expose()
  isProfilePrivate: boolean;

  @ApiProperty({ type: NotificationPreferencesResponse })
  @Expose()
  @Type(() => NotificationPreferencesResponse)
  notificationPreferences: NotificationPreferencesResponse;

  @ApiProperty({ example: true })
  @Expose()
  isActive: boolean;

  @ApiPropertyOptional({ example: '2024-01-15T10:30:00.000Z' })
  @Expose()
  @Type(() => Date)
  lastLoginAt?: Date;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  @Expose()
  @Type(() => Date)
  updatedAt: Date;

  // Excluded sensitive fields
  @Exclude()
  password: string;

  @Exclude()
  passwordResetToken: string;

  @Exclude()
  passwordResetExpires: Date;

  @Exclude()
  __v: number;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}

