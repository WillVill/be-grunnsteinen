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
  role?:
    | UserRole.ADMIN
    | UserRole.SUPER_ADMIN
    | UserRole.HOST
    | UserRole.CARETAKER;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  buildingIds?: string[];
}
