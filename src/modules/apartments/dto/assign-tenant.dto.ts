import { IsMongoId } from "class-validator";

export class AssignTenantDto {
  @IsMongoId()
  userId: string;
}
