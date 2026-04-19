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

  @IsEnum([UserRole.ADMIN, UserRole.SUPER_ADMIN], {
    message: "Role must be admin or super_admin",
  })
  role: UserRole.ADMIN | UserRole.SUPER_ADMIN;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  buildingIds?: string[];
}
