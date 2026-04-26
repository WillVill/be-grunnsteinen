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
import { BuildingsService } from "./buildings.service";
import {
  CreateBuildingDto,
  UpdateBuildingDto,
  BuildingQueryDto,
  AssignUserToBuildingDto,
  SendBuildingMessageDto,
} from "./dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  CurrentUserData,
} from "../../common/decorators/current-user.decorator";
import { UserRole } from "../users/schemas/user.schema";

@Controller("buildings")
@UseGuards(JwtAuthGuard, RolesGuard)
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() createBuildingDto: CreateBuildingDto,
  ) {
    return this.buildingsService.create(user.organizationId, createBuildingDto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.BOARD, UserRole.RESIDENT)
  findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: BuildingQueryDto,
  ) {
    return this.buildingsService.findAll(user, query);
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  findOne(@CurrentUser() user: CurrentUserData, @Param("id") id: string) {
    return this.buildingsService.findOne(user, id);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN)
  update(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
    @Body() updateBuildingDto: UpdateBuildingDto,
  ) {
    return this.buildingsService.update(user, id, updateBuildingDto);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN)
  remove(@CurrentUser() user: CurrentUserData, @Param("id") id: string) {
    return this.buildingsService.remove(user, id);
  }

  @Get(":id/users")
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  getBuildingUsers(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
  ) {
    return this.buildingsService.getBuildingUsers(user, id);
  }

  @Post(":id/users")
  @Roles(UserRole.ADMIN)
  assignUser(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
    @Body() assignDto: AssignUserToBuildingDto,
  ) {
    return this.buildingsService.assignUserToBuilding(user, id, assignDto);
  }

  @Delete(":id/users/:userId")
  @Roles(UserRole.ADMIN)
  removeUser(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    return this.buildingsService.removeUserFromBuilding(user, id, userId);
  }

  @Get(":id/stats")
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  getStats(@CurrentUser() user: CurrentUserData, @Param("id") id: string) {
    return this.buildingsService.getBuildingStats(user, id);
  }

  @Post(":id/send-message")
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  sendMessage(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
    @Body() dto: SendBuildingMessageDto,
  ) {
    return this.buildingsService.sendMessageToTenants(user, id, dto);
  }
}
