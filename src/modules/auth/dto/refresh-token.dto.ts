import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token to exchange for new access token' })
  @IsString({ message: 'Refresh token is required' })
  refreshToken: string;
}

