import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ThrottleUpload } from '../../common/decorators/throttle-upload.decorator';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ThrottleUpload()
  @ApiOperation({ summary: "Report a post, comment or message to the organisation's staff" })
  async create(
    @Body() dto: CreateReportDto,
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { report, isNew } = await this.reportsService.create(dto, user);
    res.status(isNew ? HttpStatus.CREATED : HttpStatus.OK);
    return { id: report.id, status: report.status };
  }
}
