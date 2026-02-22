import { IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateAvatarDto {
  @ApiProperty({
    example: 'https://s3.amazonaws.com/bucket/avatars/user123.jpg',
    description: 'URL of the uploaded avatar image',
  })
  @IsString()
  @IsUrl({}, { message: 'Avatar URL must be a valid URL' })
  avatarUrl: string;
}

