import { PartialType } from "@nestjs/mapped-types";
import { IsOptional, IsBoolean } from "class-validator";
import { CreateApartmentDto } from "./create-apartment.dto";

export class UpdateApartmentDto extends PartialType(CreateApartmentDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
