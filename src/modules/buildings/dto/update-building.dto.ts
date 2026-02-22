import { PartialType } from "@nestjs/mapped-types";
import { IsBoolean, IsOptional } from "class-validator";
import { CreateBuildingDto } from "./create-building.dto";

export class UpdateBuildingDto extends PartialType(CreateBuildingDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
