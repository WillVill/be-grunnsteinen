import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsArray,
  IsMongoId,
  MinLength,
  MaxLength,
} from "class-validator";
import { UserRole } from "../schemas/user.schema";

export class CreateAdminUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEnum([UserRole.ADMIN, UserRole.SUPER_ADMIN], {
    message: "Role must be admin or super_admin",
  })
  role: UserRole.ADMIN | UserRole.SUPER_ADMIN;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  buildingIds?: string[];
}
