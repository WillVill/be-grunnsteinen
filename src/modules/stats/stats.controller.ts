import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StatsService } from './stats.service';

@ApiTags('Stats')
@ApiBearerAuth('JWT-auth')
@Controller('stats')
@UseGuards(RolesGuard)
@Roles('board', 'admin')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}
}
