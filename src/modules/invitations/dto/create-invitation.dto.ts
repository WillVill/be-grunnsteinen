import { IsEmail, IsString, IsOptional, IsMongoId } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInvitationDto {
  @ApiProperty({ example: 'resident@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Building ID to invite the user to' })
  @IsMongoId()
  buildingId: string;

  @ApiPropertyOptional({ example: '301' })
  @IsOptional()
  @IsString()
  unitNumber?: string;
}
