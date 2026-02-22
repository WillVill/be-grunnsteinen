import { IsOptional, IsString, IsBoolean, IsMongoId } from "class-validator";
import { Transform } from "class-transformer";
import { PaginationQueryDto } from "../../../common/dto/pagination.dto";

export class ApartmentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  isActive?: boolean;
}
