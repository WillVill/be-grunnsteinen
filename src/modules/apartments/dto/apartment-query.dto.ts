import { IsOptional, IsString, IsBoolean, IsMongoId } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination.dto";
import { ToBoolean } from "../../../common/decorators/to-boolean.decorator";

export class ApartmentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  isActive?: boolean;
}
