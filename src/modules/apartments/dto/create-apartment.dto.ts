import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsMongoId,
  IsArray,
  MaxLength,
  MinLength,
  Min,
} from "class-validator";
import { ApartmentType } from "../schemas/apartment.schema";

export class CreateApartmentDto {
  @IsMongoId()
  buildingId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unitNumber: string;

  @IsOptional()
  @IsNumber()
  floor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  entrance?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  sizeSqm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  numberOfRooms?: number;

  @IsOptional()
  @IsEnum(ApartmentType)
  apartmentType?: ApartmentType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
