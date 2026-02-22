import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get<string>("aws.region");
    this.bucket = this.configService.get<string>("aws.s3Bucket");

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.configService.get<string>("aws.accessKeyId"),
        secretAccessKey: this.configService.get<string>("aws.secretAccessKey"),
      },
    });
  }

  /**
   * Upload a file to S3
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = "uploads",
  ): Promise<string> {
    const fileExtension = file.originalname.split(".").pop();
    const key = `${folder}/${uuidv4()}.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await this.s3Client.send(command);

    const url = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    this.logger.log(`File uploaded: ${url}`);

    return url;
  }

  /**
   * Upload a buffer to S3
   */
  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await this.s3Client.send(command);

    const url = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    this.logger.log(`Buffer uploaded: ${url}`);

    return url;
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.s3Client.send(command);
    this.logger.log(`File deleted: ${key}`);
  }

  /**
   * Delete file by URL
   */
  async deleteFileByUrl(url: string): Promise<void> {
    const key = this.extractKeyFromUrl(url);
    if (key) {
      await this.deleteFile(key);
    }
  }

  /**
   * Generate a presigned URL for uploading
   */
  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600,
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
    const publicUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;

    return { uploadUrl, publicUrl };
  }

  /**
   * Generate a presigned URL for downloading
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Extract S3 key from URL
   */
  private extractKeyFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      // Remove leading slash
      return urlObj.pathname.substring(1);
    } catch {
      return null;
    }
  }

  /**
   * Generate unique key for file
   */
  generateKey(folder: string, filename: string): string {
    const extension = filename.split(".").pop();
    return `${folder}/${uuidv4()}.${extension}`;
  }
}
