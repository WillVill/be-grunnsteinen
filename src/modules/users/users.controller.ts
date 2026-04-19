import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { UsersService } from "./users.service";
import {
  UpdateUserDto,
  UserQueryDto,
  CreateAdminUserDto,
  UpdateAdminUserDto,
  UpdateRoleDto,
} from "./dto";
import {
  CurrentUser,
  CurrentUserData,
} from "../../common/decorators/current-user.decorator";
import { S3Service } from "../../shared/services/s3.service";
import { ThrottleUpload } from "../../common/decorators/throttle-upload.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "./schemas/user.schema";

@ApiTags("Users")
@ApiBearerAuth("JWT-auth")
@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly s3Service: S3Service,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get paginated users in organization" })
  @ApiResponse({
    status: 200,
    description: "Paginated list of users",
  })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: UserQueryDto,
  ) {
    return this.usersService.findByOrganization(user.organizationId, query);
  }

  @Get("helpful-neighbors")
  @ApiOperation({ summary: "Get helpful neighbors in organization" })
  @ApiResponse({
    status: 200,
    description: "List of helpful neighbors",
  })
  async getHelpfulNeighbors(@CurrentUser() user: CurrentUserData) {
    return this.usersService.getHelpfulNeighbors(user.organizationId);
  }

  @Get("me")
  @ApiOperation({ summary: "Get current authenticated user profile" })
  @ApiResponse({
    status: 200,
    description: "Current user profile",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getMe(@CurrentUser("userId") userId: string) {
    return this.usersService.findById(userId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get user by ID" })
  @ApiResponse({
    status: 200,
    description: "User profile",
  })
  @ApiResponse({
    status: 403,
    description: "User not in same organization or profile is private",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  async findOne(
    @CurrentUser() currentUser: CurrentUserData,
    @Param("id") id: string,
  ) {
    const user = await this.usersService.findById(id);

    // Validate user belongs to same organization
    if (user.organizationId.toString() !== currentUser.organizationId) {
      throw new ForbiddenException(
        "Cannot access users from other organizations",
      );
    }

    // If profile is private, only the user themselves or an admin can view it
    if (
      user.isProfilePrivate &&
      currentUser.userId !== id &&
      currentUser.role !== "admin"
    ) {
      throw new ForbiddenException("Profile is private");
    }

    return user;
  }

  @Patch("me")
  @ApiOperation({ summary: "Update current user profile" })
  @ApiResponse({
    status: 200,
    description: "Updated user profile",
  })
  async updateMe(
    @CurrentUser("userId") userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(userId, updateUserDto);
  }

  @Post("me/avatar")
  @ThrottleUpload() // 10 requests per minute for file uploads
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({ summary: "Upload avatar image" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Avatar image file (jpg, png, webp)",
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Avatar uploaded successfully",
  })
  @ApiResponse({ status: 400, description: "Invalid file" })
  async uploadAvatar(
    @CurrentUser("userId") userId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    // Upload to S3
    const avatarUrl = await this.s3Service.uploadFile(
      file,
      `public/avatars/${userId}`,
    );

    // Update user with new avatar URL
    return this.usersService.updateAvatar(userId, avatarUrl);
  }

  @Delete("me")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Deactivate current user account" })
  @ApiResponse({
    status: 200,
    description: "Account deactivated",
    schema: {
      properties: {
        message: { type: "string", example: "Account deactivated" },
      },
    },
  })
  async deactivateMe(@CurrentUser("userId") userId: string) {
    await this.usersService.deactivate(userId);
    return { message: "Account deactivated" };
  }

  // ========================================
  // Admin User Management Endpoints
  // ========================================

  @Post("admin")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Create an admin user" })
  @ApiResponse({ status: 201, description: "Admin user created" })
  async createAdminUser(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateAdminUserDto,
  ) {
    // Only super_admin can create super_admin users
    if (
      dto.role === UserRole.SUPER_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        "Only a super_admin can create super_admin users",
      );
    }
    return this.usersService.createAdminUser(user.organizationId, dto, user.userId);
  }

  @Patch(":id/admin")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Update an admin user" })
  @ApiResponse({ status: 200, description: "Admin user updated" })
  async updateAdminUser(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    // Only super_admin can set super_admin role
    if (
      dto.role === UserRole.SUPER_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        "Only a super_admin can assign the super_admin role",
      );
    }
    return this.usersService.updateAdminUser(user.organizationId, id, dto);
  }

  @Patch(":id/role")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Update a user's role" })
  @ApiResponse({ status: 200, description: "User role updated" })
  async updateRole(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.usersService.updateRole(
      user.organizationId,
      id,
      dto,
      user.role,
    );
  }

  @Post(":id/resend-invite")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Resend the admin setup invitation email" })
  @ApiResponse({ status: 200, description: "Invitation re-sent" })
  @ApiResponse({ status: 400, description: "User is not pending setup" })
  @ApiResponse({ status: 404, description: "User not found" })
  async resendAdminInvite(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
  ) {
    await this.usersService.resendAdminInvite(user.organizationId, id, user.userId);
    return { message: "Invitation re-sent" };
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Deactivate a user (admin action)" })
  @ApiResponse({ status: 200, description: "User deactivated" })
  async deactivateUser(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
  ) {
    await this.usersService.deactivateUser(user.organizationId, id);
    return { message: "User deactivated" };
  }
}
