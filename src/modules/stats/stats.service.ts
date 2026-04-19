import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DailyStat, DailyStatDocument } from './schemas/daily-stat.schema';

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    @InjectModel(DailyStat.name)
    private readonly dailyStatModel: Model<DailyStatDocument>,
  ) {}
}
