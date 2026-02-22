import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelBookingDto {
  @ApiPropertyOptional({
    example: 'Change of plans',
    description: 'Reason for cancellation',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

