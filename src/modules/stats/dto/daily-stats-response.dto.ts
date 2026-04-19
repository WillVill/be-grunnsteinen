import { ApiProperty } from '@nestjs/swagger';

export class DailyStatRowDto {
  @ApiProperty({ example: '2026-04-18' }) date: string;
  @ApiProperty() newUsers: number;
  @ApiProperty() newPosts: number;
  @ApiProperty() newEvents: number;
  @ApiProperty() newBookings: number;
  @ApiProperty() newHelpRequests: number;
  @ApiProperty() newComments: number;
  @ApiProperty() newMessages: number;
  @ApiProperty({ required: false }) isLive?: true;
}

export class DailyStatsTotalsDto {
  @ApiProperty() newUsers: number;
  @ApiProperty() newPosts: number;
  @ApiProperty() newEvents: number;
  @ApiProperty() newBookings: number;
  @ApiProperty() newHelpRequests: number;
  @ApiProperty() newComments: number;
  @ApiProperty() newMessages: number;
}

export class DailyStatsResponseDto {
  @ApiProperty({ type: [DailyStatRowDto] }) days: DailyStatRowDto[];
  @ApiProperty({ type: DailyStatsTotalsDto }) totals: DailyStatsTotalsDto;
}
