import {
  IsEmail,
  IsString,
  MinLength,
  Matches,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @ApiProperty({
    example: 'Password123!',
    description:
      'Minimum 8 characters, at least one uppercase, one lowercase, one number, and one special character',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    {
      message:
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)',
    },
  )
  password: string;

  @ApiProperty({ example: 'John Doe', minLength: 2 })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  name: string;

  @ApiPropertyOptional({ example: '+47 123 45 678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ValidateIf((o) => !o.inviteToken)
  @ApiProperty({
    example: 'ORG-ABC123',
    description: 'Organization invite code to join (not required when using inviteToken)',
  })
  @IsString({ message: 'Organization code is required when not using an invite link' })
  organizationCode?: string;

  @ApiProperty({ example: '301', description: 'Unit/apartment number' })
  @IsString({ message: 'Unit number is required' })
  unitNumber: string;

  @ApiPropertyOptional({ example: 'Building A' })
  @IsOptional()
  @IsString()
  building?: string;

  @ApiPropertyOptional({
    description: 'Token from building invite link; when set, organization and building come from invite',
  })
  @IsOptional()
  @IsString()
  inviteToken?: string;
}

