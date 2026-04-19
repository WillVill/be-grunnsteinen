import * as crypto from "crypto";
import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types, QueryFilter } from "mongoose";
import { ConfigService } from "@nestjs/config";
import {
  User,
  UserDocument,
  UserRole,
  isAdminRole,
} from "./schemas/user.schema";
import {
  UpdateUserDto,
  UserQueryDto,
  CreateAdminUserDto,
  UpdateAdminUserDto,
  UpdateRoleDto,
} from "./dto";
import { PaginatedResponseDto } from "../../common/dto/pagination.dto";
import {
  Organization,
  OrganizationDocument,
} from "../organizations/schemas/organization.schema";
import { EmailService } from "../../shared/services/email.service";

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() });
  }

  /**
   * Find user by ID with password included (for auth)
   */
  async findByIdWithPassword(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id).select("+password");

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  /**
   * Find paginated users by organization with filters
   */
  async findByOrganization(
    organizationId: string,
    query: UserQueryDto,
  ): Promise<PaginatedResponseDto<UserDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = "name",
      sortOrder = "asc",
      search,
      building,
      isHelpfulNeighbor,
      role,
      onlyRoles,
      excludeRoles,
    } = query;

    const skip = (page - 1) * limit;

    const adminOnlyQuery =
      query.onlyRoles &&
      query.onlyRoles
        .split(",")
        .map((r) => r.trim())
        .every((r) => r === UserRole.ADMIN || r === UserRole.SUPER_ADMIN);

    // Build filter query (exclude private profiles from neighbors list)
    const filter: QueryFilter<UserDocument> = {
      organizationId: new Types.ObjectId(organizationId),
      isProfilePrivate: { $ne: true },
    };
    if (!adminOnlyQuery) {
      filter.isActive = true;
    }

    // Search by name or email
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Filter by building
    if (building) {
      filter.building = building;
    }

    // Filter by helpful neighbor status
    if (typeof isHelpfulNeighbor === "boolean") {
      filter.isHelpfulNeighbor = isHelpfulNeighbor;
    }

    // Filter by role
    if (role) {
      filter.role = role;
    }

    // Only include specific roles (comma-separated)
    if (onlyRoles) {
      const roles = onlyRoles.split(",").map((r) => r.trim());
      filter.role = { $in: roles } as any;
    }

    // Exclude specific roles (comma-separated)
    if (excludeRoles) {
      const roles = excludeRoles.split(",").map((r) => r.trim());
      filter.role = { ...((filter.role as any) || {}), $nin: roles } as any;
    }

    // Execute query with pagination
    const query2 = this.userModel
      .find(filter)
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .skip(skip)
      .limit(limit);
    if (adminOnlyQuery) {
      query2.select("+setupTokenExpires");
    }

    const [users, total] = await Promise.all([
      query2.exec(),
      this.userModel.countDocuments(filter),
    ]);

    return new PaginatedResponseDto(users, total, page, limit);
  }

  /**
   * Update user fields
   */
  async update(
    userId: string,
    updateDto: UpdateUserDto,
  ): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: updateDto },
      { new: true, runValidators: true },
    );

    if (!user) {
      throw new NotFoundException("User not found");
    }

    this.logger.log(`User updated: ${user.email}`);
    return user;
  }

  /**
   * Update user avatar URL
   */
  async updateAvatar(userId: string, avatarUrl: string): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: { avatarUrl } },
      { new: true },
    );

    if (!user) {
      throw new NotFoundException("User not found");
    }

    this.logger.log(`Avatar updated for user: ${user.email}`);
    return user;
  }

  /**
   * Get all helpful neighbors in an organization
   */
  async getHelpfulNeighbors(organizationId: string): Promise<UserDocument[]> {
    return this.userModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        isHelpfulNeighbor: true,
        isActive: true,
        isProfilePrivate: { $ne: true },
      })
      .sort({ name: 1 })
      .exec();
  }

  /**
   * Deactivate user (soft disable)
   */
  async deactivate(userId: string): Promise<void> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: { isActive: false } },
      { new: true },
    );

    if (!user) {
      throw new NotFoundException("User not found");
    }

    this.logger.log(`User deactivated: ${user.email}`);
  }

  /**
   * Reactivate user
   */
  async reactivate(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: { isActive: true } },
      { new: true },
    );

    if (!user) {
      throw new NotFoundException("User not found");
    }

    this.logger.log(`User reactivated: ${user.email}`);
    return user;
  }

  /**
   * Hard delete user
   */
  async delete(userId: string): Promise<void> {
    const result = await this.userModel.deleteOne({ _id: userId });

    if (result.deletedCount === 0) {
      throw new NotFoundException("User not found");
    }

    this.logger.log(`User deleted: ${userId}`);
  }

  /**
   * Count users in an organization
   */
  async countByOrganization(organizationId: string): Promise<number> {
    return this.userModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      isActive: true,
    });
  }

  /**
   * Get users by IDs (for bulk operations)
   */
  async findByIds(ids: string[]): Promise<UserDocument[]> {
    return this.userModel.find({
      _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
    });
  }

  /**
   * Check if user belongs to organization
   */
  async belongsToOrganization(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    const user = await this.userModel.findOne({
      _id: userId,
      organizationId: new Types.ObjectId(organizationId),
    });

    return !!user;
  }

  /**
   * Invite an admin user by email. Creates a pending (inactive) user with a
   * setup token and sends them an email to complete their account setup.
   */
  async createAdminUser(
    organizationId: string,
    dto: CreateAdminUserDto,
    inviterUserId: string,
  ): Promise<UserDocument> {
    const emailLower = dto.email.toLowerCase();

    const existingUser = await this.userModel.findOne({ email: emailLower });
    if (existingUser) {
      throw new ConflictException("A user with this email already exists");
    }

    const buildingObjectIds = (dto.buildingIds || []).map(
      (id) => new Types.ObjectId(id),
    );

    // Generate setup token (plain for email, sha256 for DB)
    const plainToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(plainToken)
      .digest("hex");

    const emailLocalPart = emailLower.split("@")[0] || "Bruker";

    const user = new this.userModel({
      name: emailLocalPart,
      email: emailLower,
      role: dto.role,
      organizationId: new Types.ObjectId(organizationId),
      buildingIds: buildingObjectIds,
      primaryBuildingId:
        buildingObjectIds.length > 0 ? buildingObjectIds[0] : undefined,
      isActive: false,
      setupToken: hashedToken,
      setupTokenExpires: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    await user.save();
    this.logger.log(
      `Admin invitation created: ${user.email} (${user.role}) by ${inviterUserId}`,
    );

    // Fire-and-forget send (do not block on SendGrid)
    this.sendAdminSetupEmailSafe(user, plainToken, inviterUserId);

    return user;
  }

  /**
   * Resend the admin setup invitation: regenerate the token, reset the
   * expiry to 72h from now, and send a fresh email. Only works for users
   * that are still pending (isActive=false AND have a setupTokenExpires).
   */
  async resendAdminInvite(
    organizationId: string,
    targetUserId: string,
    inviterUserId: string,
  ): Promise<void> {
    const user = await this.userModel
      .findOne({
        _id: targetUserId,
        organizationId: new Types.ObjectId(organizationId),
      })
      .select("+setupToken +setupTokenExpires");

    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (user.isActive || !user.setupTokenExpires) {
      throw new BadRequestException(
        "This user is not pending a setup invitation",
      );
    }

    const plainToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(plainToken)
      .digest("hex");

    user.setupToken = hashedToken;
    user.setupTokenExpires = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await user.save();

    this.logger.log(
      `Admin invitation resent: ${user.email} by ${inviterUserId}`,
    );

    this.sendAdminSetupEmailSafe(user, plainToken, inviterUserId);
  }

  /**
   * Build the setup link and send the email. Never throws.
   */
  private async sendAdminSetupEmailSafe(
    user: UserDocument,
    plainToken: string,
    inviterUserId: string,
  ): Promise<void> {
    try {
      const [organization, inviter] = await Promise.all([
        this.organizationModel.findById(user.organizationId),
        this.userModel.findById(inviterUserId),
      ]);
      const frontendUrl =
        this.configService.get<string>("frontendUrl") || "";
      const setupLink = `${frontendUrl}/setup-account?token=${plainToken}`;
      const roleLabel =
        user.role === UserRole.SUPER_ADMIN ? "superadministrator" : "administrator";

      await this.emailService.sendAdminSetupEmail(
        user.email,
        organization?.name || "Heime",
        inviter?.name || "En administrator",
        roleLabel,
        setupLink,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send admin setup email to ${user.email}`,
        error as Error,
      );
    }
  }

  /**
   * Update an admin user's details
   */
  async updateAdminUser(
    organizationId: string,
    userId: string,
    dto: UpdateAdminUserDto,
  ): Promise<UserDocument> {
    const user = await this.userModel.findOne({
      _id: userId,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (!isAdminRole(user.role)) {
      throw new BadRequestException("This endpoint is for admin users only");
    }

    // Check email uniqueness if being changed
    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existingUser = await this.userModel.findOne({
        email: dto.email.toLowerCase(),
        _id: { $ne: user._id },
      });
      if (existingUser) {
        throw new ConflictException("A user with this email already exists");
      }
    }

    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.email !== undefined) updateData.email = dto.email.toLowerCase();
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.buildingIds !== undefined) {
      updateData.buildingIds = dto.buildingIds.map(
        (id) => new Types.ObjectId(id),
      );
      if (dto.buildingIds.length > 0) {
        updateData.primaryBuildingId = new Types.ObjectId(dto.buildingIds[0]);
      }
    }

    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true },
    );

    if (!updated) {
      throw new NotFoundException("User not found");
    }

    this.logger.log(`Admin user updated: ${updated.email}`);
    return updated;
  }

  /**
   * Update any user's role
   */
  async updateRole(
    organizationId: string,
    userId: string,
    dto: UpdateRoleDto,
    callerRole: string,
  ): Promise<UserDocument> {
    const user = await this.userModel.findOne({
      _id: userId,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Only super_admin can set super_admin role
    if (
      dto.role === UserRole.SUPER_ADMIN &&
      callerRole !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        "Only a super_admin can assign the super_admin role",
      );
    }

    user.role = dto.role;
    await user.save();

    this.logger.log(`User role updated: ${user.email} -> ${dto.role}`);
    return user;
  }

  /**
   * Deactivate (or hard-delete if pending) any user by admin
   */
  async deactivateUser(organizationId: string, userId: string): Promise<void> {
    const user = await this.userModel
      .findOne({
        _id: userId,
        organizationId: new Types.ObjectId(organizationId),
      })
      .select("+setupTokenExpires");

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const isPending = !user.isActive && !!user.setupTokenExpires;

    if (isPending) {
      await this.userModel.deleteOne({ _id: user._id });
      this.logger.log(`Pending admin invitation cancelled: ${user.email}`);
      return;
    }

    user.isActive = false;
    await user.save();
    this.logger.log(`User deactivated by admin: ${user.email}`);
  }
}
