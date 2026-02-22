import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  MongooseHealthIndicator,
  HealthCheckResult,
} from '@nestjs/terminus';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { S3HealthIndicator } from './s3-health.indicator';

@ApiTags('Health')
@Controller('health')
@SkipThrottle() // Skip rate limiting for health checks
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
    private readonly s3Health: S3HealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({
    summary: 'Health check',
    description: 'Check the health status of the application, including database and S3 connectivity.',
  })
  @ApiResponse({
    status: 200,
    description: 'Health check results',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          example: 'ok',
          description: 'Overall health status',
        },
        info: {
          type: 'object',
          description: 'Health check details',
        },
        error: {
          type: 'object',
          description: 'Health check errors if any',
        },
        details: {
          type: 'object',
          description: 'Detailed health check results',
        },
        timestamp: {
          type: 'string',
          example: '2024-01-15T10:30:00.000Z',
          description: 'Current timestamp',
        },
        version: {
          type: 'string',
          example: '0.0.1',
          description: 'Application version',
        },
      },
    },
  })
  @ApiResponse({ status: 503, description: 'Service Unavailable - Health check failed' })
  async check(): Promise<HealthCheckResult & { timestamp: string; version: string }> {
    const healthCheck = await this.health.check([
      // MongoDB health check
      () => this.mongoose.pingCheck('mongodb'),
      
      // S3 health check
      () => this.s3Health.isHealthy('s3'),
    ]);

    return {
      ...healthCheck,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.1',
    };
  }
}

