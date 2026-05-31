import {
  IsString,
  IsOptional,
  IsArray,
  IsIn,
  IsMongoId,
  ValidateNested,
  IsBase64,
  IsMimeType,
  ArrayMaxSize,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// SendGrid caps total message size (content + attachments) at ~30MB.
// Keep a safety margin since base64 inflates payload ~33%.
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

/** Decoded byte length of a base64 string (without allocating the buffer). */
function base64ByteLength(content: string): number {
  if (!content) return 0;
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
  return Math.floor((content.length * 3) / 4) - padding;
}

@ValidatorConstraint({ name: 'totalAttachmentSize', async: false })
class TotalAttachmentSizeConstraint implements ValidatorConstraintInterface {
  validate(attachments: EmailAttachmentDto[] | undefined): boolean {
    if (!attachments || attachments.length === 0) return true;
    const total = attachments.reduce(
      (sum, a) => sum + base64ByteLength(a?.content ?? ''),
      0,
    );
    return total <= MAX_TOTAL_ATTACHMENT_BYTES;
  }

  defaultMessage(): string {
    return `Total attachment size must not exceed ${
      MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024)
    }MB`;
  }
}

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
  @ArrayMaxSize(MAX_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => EmailAttachmentDto)
  @Validate(TotalAttachmentSizeConstraint)
  attachments?: EmailAttachmentDto[];
}
