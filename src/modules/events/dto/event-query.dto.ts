import {
  IsOptional,
  IsEnum,
  IsDate,
  IsBoolean,
  IsMongoId,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { EventCategory, EventStatus } from '../schemas/event.schema';

export class EventQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by event category',
    enum: EventCategory,
    example: EventCategory.SOCIAL,
  })
  @IsOptional()
  @IsEnum(EventCategory)
  category?: EventCategory;

  @ApiPropertyOptional({
    description: 'Filter by event status',
    enum: EventStatus,
    example: EventStatus.UPCOMING,
  })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiPropertyOptional({
    description: 'Filter events starting from this date',
    example: '2024-06-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startDateFrom?: Date;

  @ApiPropertyOptional({
    description: 'Filter events starting until this date',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startDateTo?: Date;

  @ApiPropertyOptional({
    description: 'Filter by organizer ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid organizer ID format' })
  organizerId?: string;

  @ApiPropertyOptional({
    description: 'Filter to events the current user is participating in',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  participating?: boolean;
}

