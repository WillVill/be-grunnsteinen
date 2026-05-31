import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

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

  @ApiPropertyOptional({ example: "Concept description", maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
