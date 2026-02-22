import { Injectable } from "@nestjs/common";
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from "@nestjs/terminus";
import { ConfigService } from "@nestjs/config";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";

@Injectable()
export class S3HealthIndicator extends HealthIndicator {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const region = this.configService.get<string>("aws.region");
      const bucket = this.configService.get<string>("aws.s3Bucket");
      const accessKeyId = this.configService.get<string>("aws.accessKeyId");
      const secretAccessKey = this.configService.get<string>(
        "aws.secretAccessKey",
      );

      if (!region || !bucket || !accessKeyId || !secretAccessKey) {
        throw new Error("S3 configuration is incomplete");
      }

      const s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });

      await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));

      return this.getStatus(key, true, {
        bucket,
        region,
      });
    } catch (error) {
      throw new HealthCheckError(
        "S3 health check failed",
        this.getStatus(key, false, { message: error.message }),
      );
    }
  }
}
