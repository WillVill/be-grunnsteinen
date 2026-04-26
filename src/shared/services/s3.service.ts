import { BadRequestException, Injectable, Logger } from "@nestjs/common";
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
  private readonly cloudfrontDomain: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get<string>("aws.region");
    this.bucket = this.configService.get<string>("aws.s3Bucket");
    this.cloudfrontDomain = this.configService.get<string>(
      "aws.cloudfrontDomain",
    );

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.configService.get<string>("aws.accessKeyId"),
        secretAccessKey: this.configService.get<string>("aws.secretAccessKey"),
      },
    });
  }

  /**
   * Upload a file to S3. The folder must start with `public/` (served via
   * CloudFront) or `private/` (read via presigned URL); visibility is derived
   * from the prefix.
   */
  async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
    const fileExtension = file.originalname.split(".").pop();
    const key = `${folder}/${uuidv4()}.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await this.s3Client.send(command);

    const url = this.buildUrl(key);
    this.logger.log(`File uploaded: ${url}`);

    return url;
  }

  /**
   * Upload a buffer to S3. See `uploadFile` for key-prefix semantics.
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

    const url = this.buildUrl(key);
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
   * Generate a presigned URL for uploading. Key must start with `public/` or
   * `private/` — visibility of the returned `publicUrl` is derived from the
   * prefix.
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
    const publicUrl = this.buildUrl(key);

    return { uploadUrl, publicUrl };
  }

  /**
   * Generate a presigned URL for downloading. By default the response is
   * served inline so PDFs/images render in a browser tab; pass
   * `disposition: "attachment"` to force a download. `filename` controls the
   * name shown in the browser's save dialog.
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresIn: number = 3600,
    options: {
      disposition?: "inline" | "attachment";
      filename?: string;
      contentType?: string;
    } = {},
  ): Promise<string> {
    const { disposition = "inline", filename, contentType } = options;

    const dispositionHeader = filename
      ? `${disposition}; filename="${filename.replace(/"/g, "")}"`
      : disposition;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: dispositionHeader,
      ...(contentType ? { ResponseContentType: contentType } : {}),
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Build the stored URL for a key. Keys under `public/` resolve through
   * CloudFront; keys under `private/` return a raw S3 URL (callers use
   * presigned reads). The prefix is the single source of truth — any other
   * shape is rejected to prevent accidental public/private mix-ups.
   */
  private buildUrl(key: string): string {
    if (key.startsWith("public/")) {
      if (!this.cloudfrontDomain) {
        throw new Error(
          "public/* keys require AWS_CLOUDFRONT_DOMAIN to be set",
        );
      }
      const cfPath = key.slice("public/".length);
      return `https://${this.cloudfrontDomain}/${cfPath}`;
    }
    if (key.startsWith("private/")) {
      return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    }
    throw new BadRequestException(
      `S3 key must start with "public/" or "private/": ${key}`,
    );
  }

  /**
   * Extract the S3 key from a stored URL. CloudFront URLs have the `public/`
   * prefix stripped (origin path rewrite), so we add it back; direct S3 URLs
   * already carry the full key in their path.
   */
  private extractKeyFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.replace(/^\//, "");
      if (this.cloudfrontDomain && urlObj.host === this.cloudfrontDomain) {
        return `public/${path}`;
      }
      return path;
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

  /**
   * Build a CloudFront URL for a curated gallery image. Accepts the read
   * path (`gallery/<name>.<ext>`), not the S3 key — on disk these are
   * stored under `public/gallery/`, but CloudFront strips the `public/`
   * prefix via origin path. The regex is a whitelist that lets the frontend
   * pass paths directly without opening a path-injection surface.
   */
  buildGalleryImageUrl(galleryKey: string): string {
    if (!/^gallery\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i.test(galleryKey)) {
      throw new BadRequestException(`Invalid gallery key: ${galleryKey}`);
    }
    if (!this.cloudfrontDomain) {
      throw new BadRequestException(
        "Gallery images require AWS_CLOUDFRONT_DOMAIN to be set",
      );
    }
    return `https://${this.cloudfrontDomain}/${galleryKey}`;
  }
}
