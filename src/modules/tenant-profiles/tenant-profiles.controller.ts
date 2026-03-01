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
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TenantProfilesService } from './tenant-profiles.service';
import { CreateTenantProfileDto, UpdateTenantProfileDto } from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../users/schemas/user.schema';

@ApiTags('tenant-profiles')
@ApiBearerAuth('JWT-auth')
@Controller('tenant-profiles')
export class TenantProfilesController {
  constructor(private readonly tenantProfilesService: TenantProfilesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  @ApiOperation({ summary: 'Create an unregistered tenant profile for an apartment' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateTenantProfileDto,
  ) {
    return this.tenantProfilesService.create(user.organizationId, user.userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  @ApiOperation({ summary: 'List tenant profiles by apartmentId or buildingId' })
  @ApiQuery({ name: 'apartmentId', required: false })
  @ApiQuery({ name: 'buildingId', required: false })
  find(
    @CurrentUser() user: CurrentUserData,
    @Query('apartmentId') apartmentId?: string,
    @Query('buildingId') buildingId?: string,
  ) {
    if (buildingId) {
      return this.tenantProfilesService.findByBuilding(user.organizationId, buildingId);
    }
    if (apartmentId) {
      return this.tenantProfilesService.findByApartment(user.organizationId, apartmentId);
    }
    throw new BadRequestException('Either apartmentId or buildingId query param is required');
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  @ApiOperation({ summary: 'Update tenant profile info and notes' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateTenantProfileDto,
  ) {
    return this.tenantProfilesService.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  @ApiOperation({ summary: 'Delete a tenant profile (expires linked invitation if any)' })
  delete(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.tenantProfilesService.delete(user.organizationId, id);
  }

  @Post(':id/invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  @ApiOperation({ summary: 'Send registration invitation to the tenant via email' })
  sendInvite(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.tenantProfilesService.sendInvite(user.organizationId, user.userId, id);
  }
}
