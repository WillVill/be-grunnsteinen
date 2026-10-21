import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportReason, ReportTargetType } from '../schemas/report.schema';

export class CreateReportDto {
  @ApiProperty({ enum: ReportTargetType })
  @IsEnum(ReportTargetType, { message: 'Ugyldig type' })
  targetType: ReportTargetType;

  @ApiProperty()
  @IsMongoId({ message: 'Ugyldig id' })
  targetId: string;

  @ApiProperty({ enum: ReportReason })
  @IsEnum(ReportReason, { message: 'Ugyldig årsak' })
  reason: ReportReason;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Maks 500 tegn' })
  details?: string;
}
