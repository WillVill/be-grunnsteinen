import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '../users/schemas/user.schema';

@ApiTags('Invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create building invitation (admin/board)' })
  @ApiResponse({ status: 201, description: 'Invitation created and email sent' })
  @ApiResponse({ status: 404, description: 'Building not found' })
  @ApiResponse({ status: 409, description: 'User already in organization or pending invite exists' })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.create(user.organizationId, user.userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List pending invitations for a building' })
  @ApiResponse({ status: 200, description: 'List of pending invitations' })
  async findByBuilding(
    @CurrentUser() user: CurrentUserData,
    @Query('buildingId') buildingId: string,
  ) {
    if (!buildingId) {
      return [];
    }
    return this.invitationsService.findByBuilding(user.organizationId, buildingId);
  }

  @Get('validate/:token')
  @Public()
  @ApiOperation({ summary: 'Validate invite token (public)' })
  @ApiResponse({ status: 200, description: 'Invitation valid; returns org, building, email' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async validate(@Param('token') token: string) {
    return this.invitationsService.validate(token);
  }
}
