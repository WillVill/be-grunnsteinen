import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApartmentsService } from "./apartments.service";
import {
  CreateApartmentDto,
  UpdateApartmentDto,
  ApartmentQueryDto,
  AssignTenantDto,
} from "./dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  CurrentUserData,
} from "../../common/decorators/current-user.decorator";
import { UserRole } from "../users/schemas/user.schema";

@Controller("apartments")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApartmentsController {
  constructor(private readonly apartmentsService: ApartmentsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() createApartmentDto: CreateApartmentDto,
  ) {
    return this.apartmentsService.create(
      user.organizationId,
      createApartmentDto,
    );
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ApartmentQueryDto,
  ) {
    return this.apartmentsService.findAllByBuilding(
      user.organizationId,
      query,
    );
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  findOne(@CurrentUser() user: CurrentUserData, @Param("id") id: string) {
    return this.apartmentsService.findOne(user.organizationId, id);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN)
  update(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
    @Body() updateApartmentDto: UpdateApartmentDto,
  ) {
    return this.apartmentsService.update(
      user.organizationId,
      id,
      updateApartmentDto,
    );
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN)
  remove(@CurrentUser() user: CurrentUserData, @Param("id") id: string) {
    return this.apartmentsService.remove(user.organizationId, id);
  }

  @Post(":id/tenant")
  @Roles(UserRole.ADMIN)
  assignTenant(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
    @Body() assignTenantDto: AssignTenantDto,
  ) {
    return this.apartmentsService.assignTenant(
      user.organizationId,
      id,
      assignTenantDto,
    );
  }

  @Delete(":id/tenant")
  @Roles(UserRole.ADMIN)
  removeTenant(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
  ) {
    return this.apartmentsService.removeTenant(user.organizationId, id);
  }
}
