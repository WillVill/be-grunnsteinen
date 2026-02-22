import { IsOptional, IsString, IsBoolean } from "class-validator";
import { Transform } from "class-transformer";
import { PaginationQueryDto } from "../../../common/dto/pagination.dto";

export class BuildingQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  isActive?: boolean;
}
