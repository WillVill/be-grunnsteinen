import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBookingDto {
  @ApiPropertyOptional({
    example: 'Please leave the apartment clean and tidy',
    description: 'User notes for the booking',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: 'Booking approved by board',
    description: 'Admin/board notes (board only)',
  })
  @IsOptional()
  @IsString()
  adminNotes?: string;
}

