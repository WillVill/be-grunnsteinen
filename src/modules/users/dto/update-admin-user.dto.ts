import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsArray,
  IsMongoId,
  MaxLength,
} from "class-validator";
import { UserRole } from "../schemas/user.schema";

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum([UserRole.ADMIN, UserRole.SUPER_ADMIN], {
    message: "Role must be admin or super_admin",
  })
  role?: UserRole.ADMIN | UserRole.SUPER_ADMIN;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  buildingIds?: string[];
}
