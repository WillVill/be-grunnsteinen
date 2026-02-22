import { IsString, IsOptional, IsArray, IsIn, IsMongoId } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}
