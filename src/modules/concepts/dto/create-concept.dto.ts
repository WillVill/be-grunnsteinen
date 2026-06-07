import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

export class BrandColorsDto {
  @ApiProperty({ example: "#E1654F", description: "Primary brand color" })
  @IsString()
  @Matches(HEX_REGEX, { message: "primary must be a hex string like #E1654F" })
  primary: string;

  @ApiPropertyOptional({ example: "#9DC3D1" })
  @IsOptional()
  @IsString()
  @Matches(HEX_REGEX, { message: "secondary must be a hex string like #9DC3D1" })
  secondary?: string;

  @ApiPropertyOptional({ example: "#AD7C59" })
  @IsOptional()
  @IsString()
  @Matches(HEX_REGEX, { message: "tertiary must be a hex string like #AD7C59" })
  tertiary?: string;

  @ApiPropertyOptional({ example: "#373A36" })
  @IsOptional()
  @IsString()
  @Matches(HEX_REGEX, { message: "quaternary must be a hex string like #373A36" })
  quaternary?: string;
}

export class CreateConceptDto {
  @ApiProperty({ example: "Solsiden", minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    example: "solsiden",
    description: "Unique code for the concept within the organization",
    maxLength: 30,
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @ApiPropertyOptional({
    example: "#0E9471",
    description: "Brand color as hex string (e.g. #0E9471)",
  })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: "brandColor must be a hex string like #0E9471",
  })
  brandColor?: string;

  @ApiPropertyOptional({ type: BrandColorsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandColorsDto)
  brandColors?: BrandColorsDto;

  @ApiPropertyOptional({ example: "Concept description", maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
