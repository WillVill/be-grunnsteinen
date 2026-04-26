import {
  IsEmail,
  IsString,
  MinLength,
  Matches,
  IsOptional,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { message: "Vennligst oppgi en gyldig e-postadresse" })
  email: string;

  @ApiProperty({
    example: "Passord123",
    description:
      "Minimum 8 tegn, minst én stor bokstav, én liten bokstav og ett tall",
  })
  @IsString()
  @MinLength(8, { message: "Passordet må være minst 8 tegn langt" })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      "Passordet må inneholde minst én stor bokstav, én liten bokstav og ett tall",
  })
  password: string;

  @ApiProperty({ example: "Ola Nordmann", minLength: 2 })
  @IsString()
  @MinLength(2, { message: "Navn må være minst 2 tegn langt" })
  name: string;

  @ApiPropertyOptional({ example: "+47 123 45 678" })
  @IsOptional()
  @IsString()
  phone?: string;

  @ValidateIf((o) => !o.inviteToken)
  @ApiProperty({
    example: "ORG-ABC123",
    description:
      "Organization invite code to join (not required when using inviteToken)",
  })
  @IsString({
    message: "Organisasjonskode er påkrevd når du ikke bruker en invitasjonslenke",
  })
  organizationCode?: string;

  @ApiProperty({ example: "301", description: "Unit/apartment number" })
  @IsString({ message: "Leilighetsnummer er påkrevd" })
  unitNumber: string;

  @ApiPropertyOptional({ example: "Building A" })
  @IsOptional()
  @IsString()
  building?: string;

  @ApiPropertyOptional({
    description:
      "Token from building invite link; when set, organization and building come from invite",
  })
  @IsOptional()
  @IsString()
  inviteToken?: string;
}
