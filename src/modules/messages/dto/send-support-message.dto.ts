import { IsString, IsIn, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Resident message to a support channel (Grunnsteinen or husvert/Leva).
 * The thread is created on first message and reused thereafter.
 */
export class SendSupportMessageDto {
  @ApiProperty({ enum: ['grunnsteinen', 'husvert'] })
  @IsString()
  @IsIn(['grunnsteinen', 'husvert'])
  channel: 'grunnsteinen' | 'husvert';

  @ApiProperty({ description: 'Message content', minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1, { message: 'Message content cannot be empty' })
  @MaxLength(2000, { message: 'Message content must not exceed 2000 characters' })
  content: string;
}
