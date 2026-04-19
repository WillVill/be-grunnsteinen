import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class CompleteSetupDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
