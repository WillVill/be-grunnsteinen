import {
  IsEmail,
  IsOptional,
  IsEnum,
  IsArray,
  IsMongoId,
} from "class-validator";
import { UserRole } from "../schemas/user.schema";

export class CreateAdminUserDto {
  @IsEmail()
  email: string;

  @IsEnum(
    [
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN,
      UserRole.HOST,
      UserRole.CARETAKER,
    ],
    {
      message: "Role must be admin, super_admin, host or caretaker",
    },
  )
  role:
    | UserRole.ADMIN
    | UserRole.SUPER_ADMIN
    | UserRole.HOST
    | UserRole.CARETAKER;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  buildingIds?: string[];
}
