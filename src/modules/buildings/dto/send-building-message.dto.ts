import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsMongoId,
  IsNumber,
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

/**
 * Rule-based recipient segment. Resolved against the building's apartments:
 * an apartment matches when it satisfies every provided (non-empty) criterion,
 * and its tenants become recipients. Examples:
 *   { floors: [1] }            → first floor
 *   { entrances: ['A'] }       → entrance A (and not B)
 *   { tags: ['garasje'] }      → garage renters
 */
export class MessageSegmentDto {
  @ApiPropertyOptional({ type: [Number], description: 'Match apartments on these floors' })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  floors?: number[];

  @ApiPropertyOptional({ type: [String], description: 'Match apartments with these entrances' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  entrances?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Match apartments carrying any of these tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Match apartments of these types' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  apartmentTypes?: string[];
}

/**
 * Independent delivery channels. At least one must be enabled (validated in
 * the service). In-app reaches registered users only (their support thread);
 * email/SMS also reach unregistered tenant profiles.
 */
export class MessageChannelsDto {
  @ApiPropertyOptional({ description: 'Deliver as in-app support-thread message' })
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @ApiPropertyOptional({ description: 'Deliver as email' })
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional({ description: 'Deliver as SMS' })
  @IsOptional()
  @IsBoolean()
  sms?: boolean;
}

export class SendBuildingMessageDto {
  @ApiProperty({ type: MessageChannelsDto })
  @ValidateNested()
  @Type(() => MessageChannelsDto)
  channels: MessageChannelsDto;

  @ApiPropertyOptional({ description: 'Subject for email (required when the email channel is on)' })
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

  @ApiPropertyOptional({
    description: 'Rule-based segment; resolved against the building apartments to a recipient set',
    type: MessageSegmentDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageSegmentDto)
  segment?: MessageSegmentDto;

  @ApiPropertyOptional({ description: 'File attachments for email (base64-encoded)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => EmailAttachmentDto)
  @Validate(TotalAttachmentSizeConstraint)
  attachments?: EmailAttachmentDto[];
}
