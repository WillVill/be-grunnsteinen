import {
  IsOptional,
  IsEnum,
  IsDate,
  IsMongoId,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { BookingStatus } from '../schemas/booking.schema';

export class BookingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by resource ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid resource ID format' })
  resourceId?: string;

  @ApiPropertyOptional({
    description: 'Filter by booking status',
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    description: 'Filter bookings starting from this date',
    example: '2024-06-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startDateFrom?: Date;

  @ApiPropertyOptional({
    description: 'Filter bookings starting until this date',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startDateTo?: Date;

  @ApiPropertyOptional({
    description: 'Filter by user ID (board only)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid user ID format' })
  userId?: string;
}

