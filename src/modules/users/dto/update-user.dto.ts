import {
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsDate,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

class EmailNotificationPreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  newPosts?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  comments?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  events?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  eventReminders?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  bookings?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  helpRequests?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  messages?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  boardAnnouncements?: boolean;
}

class PushNotificationPreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  newPosts?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  comments?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  events?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  eventReminders?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  bookings?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  helpRequests?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  messages?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  boardAnnouncements?: boolean;
}

class NotificationPreferencesDto {
  @ApiPropertyOptional({ type: EmailNotificationPreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmailNotificationPreferencesDto)
  email?: EmailNotificationPreferencesDto;

  @ApiPropertyOptional({ type: PushNotificationPreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PushNotificationPreferencesDto)
  push?: PushNotificationPreferencesDto;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '+47 123 45 678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '#3b82f6', description: 'Hex color for avatar fallback background' })
  @IsOptional()
  @IsString()
  avatarColor?: string;

  @ApiPropertyOptional({ example: '1990-01-15' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  dateOfBirth?: Date;

  @ApiPropertyOptional({ example: ['gardening', 'cooking', 'yoga'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isHelpfulNeighbor?: boolean;

  @ApiPropertyOptional({ example: ['plumbing', 'electrical', 'carpentry'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  helpfulSkills?: string[];

  @ApiPropertyOptional({ example: false, description: 'When true, user is hidden from neighbors list and profile is not viewable by others' })
  @IsOptional()
  @IsBoolean()
  isProfilePrivate?: boolean;

  @ApiPropertyOptional({ type: NotificationPreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPreferencesDto)
  notificationPreferences?: NotificationPreferencesDto;
}

