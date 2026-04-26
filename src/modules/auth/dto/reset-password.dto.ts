import { IsString, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Password reset token from email' })
  @IsString({ message: 'Token er påkrevd' })
  token: string;

  @ApiProperty({
    example: 'NyttPassord123',
    description:
      'Minimum 8 tegn, minst én stor bokstav, én liten bokstav og ett tall',
  })
  @IsString()
  @MinLength(8, { message: 'Passordet må være minst 8 tegn langt' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Passordet må inneholde minst én stor bokstav, én liten bokstav og ett tall',
  })
  password: string;
}

