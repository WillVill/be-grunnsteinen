import { IsString, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password' })
  @IsString({ message: 'Current password is required' })
  currentPassword: string;

  @ApiProperty({
    example: 'NewPassword123!',
    description:
      'Minimum 8 characters, at least one uppercase, one lowercase, one number, and one special character',
  })
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    {
      message:
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)',
    },
  )
  newPassword: string;
}

