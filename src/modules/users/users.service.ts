import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, QueryFilter } from 'mongoose';
import { User, UserDocument, UserRole, isAdminRole } from './schemas/user.schema';
import { UpdateUserDto, UserQueryDto, CreateAdminUserDto, UpdateAdminUserDto, UpdateRoleDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
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
    const user = await this.userModel.findById(id).select('+password');

    if (!user) {
      throw new NotFoundException('User not found');
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
      sortBy = 'name',
      sortOrder = 'asc',
      search,
      building,
      isHelpfulNeighbor,
      role,
      onlyRoles,
      excludeRoles,
    } = query;

    const skip = (page - 1) * limit;

    // Build filter query (exclude private profiles from neighbors list)
    const filter: QueryFilter<UserDocument> = {
      organizationId: new Types.ObjectId(organizationId),
      isActive: true,
      isProfilePrivate: { $ne: true },
    };

    // Search by name or email
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // Filter by building
    if (building) {
      filter.building = building;
    }

    // Filter by helpful neighbor status
    if (typeof isHelpfulNeighbor === 'boolean') {
      filter.isHelpfulNeighbor = isHelpfulNeighbor;
    }

    // Filter by role
    if (role) {
      filter.role = role;
    }

    // Only include specific roles (comma-separated)
    if (onlyRoles) {
      const roles = onlyRoles.split(',').map((r) => r.trim());
      filter.role = { $in: roles } as any;
    }

    // Exclude specific roles (comma-separated)
    if (excludeRoles) {
      const roles = excludeRoles.split(',').map((r) => r.trim());
      filter.role = { ...((filter.role as any) || {}), $nin: roles } as any;
    }

    // Execute query with pagination
    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
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
      throw new NotFoundException('User not found');
    }

    this.logger.log(`User updated: ${user.email}`);
    return user;
  }

  /**
   * Update user avatar URL
   */
  async updateAvatar(
    userId: string,
    avatarUrl: string,
  ): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: { avatarUrl } },
      { new: true },
    );

    if (!user) {
      throw new NotFoundException('User not found');
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
      throw new NotFoundException('User not found');
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
      throw new NotFoundException('User not found');
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
      throw new NotFoundException('User not found');
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
   * Create an admin user (admin or super_admin)
   */
  async createAdminUser(
    organizationId: string,
    dto: CreateAdminUserDto,
  ): Promise<UserDocument> {
    // Check if email is already taken
    const existingUser = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    const buildingObjectIds = (dto.buildingIds || []).map(
      (id) => new Types.ObjectId(id),
    );

    const user = new this.userModel({
      name: dto.name,
      email: dto.email.toLowerCase(),
      password: dto.password,
      phone: dto.phone,
      role: dto.role,
      organizationId: new Types.ObjectId(organizationId),
      buildingIds: buildingObjectIds,
      primaryBuildingId: buildingObjectIds.length > 0 ? buildingObjectIds[0] : undefined,
    });

    await user.save();
    this.logger.log(`Admin user created: ${user.email} (${user.role})`);
    return user;
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
      throw new NotFoundException('User not found');
    }

    if (!isAdminRole(user.role)) {
      throw new BadRequestException('This endpoint is for admin users only');
    }

    // Check email uniqueness if being changed
    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existingUser = await this.userModel.findOne({
        email: dto.email.toLowerCase(),
        _id: { $ne: user._id },
      });
      if (existingUser) {
        throw new ConflictException('A user with this email already exists');
      }
    }

    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.email !== undefined) updateData.email = dto.email.toLowerCase();
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.buildingIds !== undefined) {
      updateData.buildingIds = dto.buildingIds.map((id) => new Types.ObjectId(id));
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
      throw new NotFoundException('User not found');
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
      throw new NotFoundException('User not found');
    }

    // Only super_admin can set super_admin role
    if (dto.role === UserRole.SUPER_ADMIN && callerRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a super_admin can assign the super_admin role');
    }

    user.role = dto.role;
    await user.save();

    this.logger.log(`User role updated: ${user.email} -> ${dto.role}`);
    return user;
  }

  /**
   * Deactivate any user by admin
   */
  async deactivateUser(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const user = await this.userModel.findOneAndUpdate(
      {
        _id: userId,
        organizationId: new Types.ObjectId(organizationId),
      },
      { $set: { isActive: false } },
      { new: true },
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.logger.log(`User deactivated by admin: ${user.email}`);
  }
}

