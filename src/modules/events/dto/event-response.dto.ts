import { Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventCategory, EventStatus } from '../schemas/event.schema';

class OrganizerResponse {
  @ApiProperty()
  @Expose()
  _id: string;

  @ApiProperty()
  @Expose()
  name: string;

  @ApiPropertyOptional()
  @Expose()
  avatarUrl?: string;
}

export class EventResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  _id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  organizationId: string;

  @ApiProperty({ type: OrganizerResponse })
  @Expose()
  @Type(() => OrganizerResponse)
  organizer: OrganizerResponse;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  groupId?: string;

  @ApiProperty({ example: 'Community BBQ' })
  @Expose()
  title: string;

  @ApiProperty({ example: 'Join us for a fun community BBQ...' })
  @Expose()
  description: string;

  @ApiProperty({ example: 'Community Courtyard' })
  @Expose()
  location: string;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @Expose()
  imageUrl?: string;

  @ApiProperty({ example: '2024-06-15T14:00:00.000Z' })
  @Expose()
  @Type(() => Date)
  startDate: Date;

  @ApiProperty({ example: '2024-06-15T18:00:00.000Z' })
  @Expose()
  @Type(() => Date)
  endDate: Date;

  @ApiProperty({ example: 50 })
  @Expose()
  maxParticipants: number;

  @ApiProperty({ example: 25 })
  @Expose()
  participantsCount: number;

  @ApiProperty({ enum: EventCategory, example: EventCategory.SOCIAL })
  @Expose()
  category: EventCategory;

  @ApiProperty({ example: false })
  @Expose()
  isRecurring: boolean;

  @ApiPropertyOptional({ example: 'weekly' })
  @Expose()
  recurringPattern?: string;

  @ApiProperty({ enum: EventStatus, example: EventStatus.UPCOMING })
  @Expose()
  status: EventStatus;

  @ApiProperty({ example: false })
  @Expose()
  isParticipating: boolean;

  @ApiProperty({ example: false })
  @Expose()
  isFull: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  @Expose()
  @Type(() => Date)
  updatedAt: Date;

  constructor(partial: Partial<EventResponseDto>) {
    Object.assign(this, partial);
  }
}

