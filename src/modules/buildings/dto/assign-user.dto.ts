import { IsMongoId, IsOptional, IsBoolean } from "class-validator";

export class AssignUserToBuildingDto {
  @IsMongoId()
  userId: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
