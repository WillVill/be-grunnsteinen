import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StatsService } from './stats.service';
import { DailyStatsQueryDto, DailyStatsResponseDto } from './dto';

@ApiTags('Stats')
@ApiBearerAuth('JWT-auth')
@Controller('stats')
@UseGuards(RolesGuard)
@Roles('board', 'admin')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('daily')
  @ApiOperation({ summary: 'Daily stats for the current organization (Board/Admin only)' })
  @ApiResponse({ status: 200, type: DailyStatsResponseDto })
  async getDaily(
    @CurrentUser() user: CurrentUserData,
    @Query() query: DailyStatsQueryDto,
  ): Promise<DailyStatsResponseDto> {
    return this.statsService.getRange(
      user.organizationId,
      query.from,
      query.to,
      query.buildingId,
    );
  }
}
