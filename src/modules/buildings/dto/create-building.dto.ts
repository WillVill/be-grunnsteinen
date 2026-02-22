import {
  IsString,
  IsOptional,
  IsBoolean,
  ValidateNested,
  MaxLength,
  MinLength,
} from "class-validator";
import { Type } from "class-transformer";

export class BuildingSettingsDto {
  @IsOptional()
  @IsBoolean()
  allowResidentPosts?: boolean;

  @IsOptional()
  @IsBoolean()
  allowResidentEvents?: boolean;

  @IsOptional()
  @IsBoolean()
  requireBookingApproval?: boolean;
}

export class CreateBuildingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BuildingSettingsDto)
  settings?: BuildingSettingsDto;
}
