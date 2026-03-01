import { IsString, IsOptional, IsArray, IsIn, IsMongoId, ValidateNested, IsBase64, IsMimeType } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EmailAttachmentDto {
  @ApiProperty({ description: 'Base64-encoded file content' })
  @IsString()
  @IsBase64()
  content: string;

  @ApiProperty({ description: 'File name' })
  @IsString()
  filename: string;

  @ApiProperty({ description: 'MIME type, e.g. application/pdf' })
  @IsString()
  @IsMimeType()
  type: string;
}

export class SendBuildingMessageDto {
  @ApiProperty({ enum: ['email', 'sms', 'both'] })
  @IsString()
  @IsIn(['email', 'sms', 'both'])
  type: 'email' | 'sms' | 'both';

  @ApiPropertyOptional({ description: 'Subject for email (required when type is email or both)' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({ description: 'Message body (email body or SMS text)' })
  @IsString()
  body: string;

  @ApiPropertyOptional({
    description: 'Specific user IDs to send to; if omitted, all tenants in the building',
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  recipientIds?: string[];

  @ApiPropertyOptional({
    description: 'Specific tenant profile IDs (unregistered/invited) to send to',
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  tenantProfileIds?: string[];

  @ApiPropertyOptional({ description: 'File attachments for email (base64-encoded)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmailAttachmentDto)
  attachments?: EmailAttachmentDto[];
}
