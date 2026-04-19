import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class DailyStatsQueryDto {
  @ApiProperty({ example: '2026-04-01', description: 'Start date (YYYY-MM-DD, Oslo), inclusive' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from: string;

  @ApiProperty({ example: '2026-04-19', description: 'End date (YYYY-MM-DD, Oslo), inclusive' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to: string;

  @ApiPropertyOptional({ description: 'Building ID; omit for org-wide totals' })
  @IsOptional()
  @IsString()
  buildingId?: string;
}
