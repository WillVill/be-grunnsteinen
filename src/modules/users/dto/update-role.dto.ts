import { IsEnum } from "class-validator";
import { UserRole } from "../schemas/user.schema";

export class UpdateRoleDto {
  @IsEnum(UserRole, {
    message: "Role must be one of: resident, board, admin, super_admin",
  })
  role: UserRole;
}
