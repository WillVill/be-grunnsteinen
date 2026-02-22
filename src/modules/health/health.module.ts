import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthController } from './health.controller';
import { S3HealthIndicator } from './s3-health.indicator';
import { AppConfigModule } from '../../config/config.module';

@Module({
  imports: [
    TerminusModule,
    MongooseModule,
    AppConfigModule,
  ],
  controllers: [HealthController],
  providers: [S3HealthIndicator],
})
export class HealthModule {}

