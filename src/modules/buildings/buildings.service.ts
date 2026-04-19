import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Building, BuildingDocument } from "./schemas/building.schema";
import { User, UserDocument, UserRole } from "../users/schemas/user.schema";
import { CurrentUserData } from "../../common/decorators/current-user.decorator";
import {
  TenantProfile,
  TenantProfileDocument,
  TenantProfileStatus,
} from "../tenant-profiles/schemas/tenant-profile.schema";
import {
  CreateBuildingDto,
  UpdateBuildingDto,
  BuildingQueryDto,
  AssignUserToBuildingDto,
  SendBuildingMessageDto,
} from "./dto";
import { PaginatedResponseDto } from "../../common/dto/pagination.dto";
import { EmailService } from "../../shared/services/email.service";
import { TwilioService } from "../../shared/services/twilio.service";

export interface SendMessageResult {
  sentEmail: number;
  sentSms: number;
  skippedSms: number;
}

@Injectable()
export class BuildingsService {
  private readonly logger = new Logger(BuildingsService.name);

  constructor(
    @InjectModel(Building.name)
    private buildingModel: Model<BuildingDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(TenantProfile.name)
    private tenantProfileModel: Model<TenantProfileDocument>,
    private readonly emailService: EmailService,
    private readonly twilioService: TwilioService,
  ) {}

  async create(
    organizationId: string,
    createBuildingDto: CreateBuildingDto,
  ): Promise<Building> {
    // Check if building with same code exists in organization
    if (createBuildingDto.code) {
      const existingBuilding = await this.buildingModel.findOne({
        organizationId: new Types.ObjectId(organizationId),
        code: createBuildingDto.code,
      });

      if (existingBuilding) {
        throw new ConflictException(
          `Building with code "${createBuildingDto.code}" already exists`,
        );
      }
    }

    const building = new this.buildingModel({
      ...createBuildingDto,
      organizationId: new Types.ObjectId(organizationId),
    });

    return building.save();
  }

  private hasBuildingAccess(
    user: CurrentUserData,
    buildingId: string,
  ): boolean {
    if (user.role === UserRole.SUPER_ADMIN) return true;
    return (user.buildingIds || []).includes(buildingId);
  }

  private assertBuildingAccess(
    user: CurrentUserData,
    buildingId: string,
  ): void {
    if (!this.hasBuildingAccess(user, buildingId)) {
      throw new ForbiddenException(
        `You do not have access to building "${buildingId}"`,
      );
    }
  }

  async findAll(
    user: CurrentUserData,
    query: BuildingQueryDto,
  ): Promise<PaginatedResponseDto<Building>> {
    const { page = 1, limit = 20, search, isActive } = query;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(user.organizationId),
    };

    if (user.role !== UserRole.SUPER_ADMIN) {
      filter._id = {
        $in: (user.buildingIds || []).map((id) => new Types.ObjectId(id)),
      };
    }

    if (typeof isActive === "boolean") {
      filter.isActive = isActive;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
        { address: { $regex: search, $options: "i" } },
      ];
    }

    const [buildings, total] = await Promise.all([
      this.buildingModel
        .find(filter)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.buildingModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponseDto(buildings, total, page, limit);
  }

  async findOne(
    user: CurrentUserData,
    buildingId: string,
  ): Promise<Building> {
    const building = await this.buildingModel.findOne({
      _id: new Types.ObjectId(buildingId),
      organizationId: new Types.ObjectId(user.organizationId),
    });

    if (!building) {
      throw new NotFoundException(`Building with ID "${buildingId}" not found`);
    }

    this.assertBuildingAccess(user, buildingId);

    return building;
  }

  async update(
    user: CurrentUserData,
    buildingId: string,
    updateBuildingDto: UpdateBuildingDto,
  ): Promise<Building> {
    this.assertBuildingAccess(user, buildingId);

    // Check code uniqueness if updating code
    if (updateBuildingDto.code) {
      const existingBuilding = await this.buildingModel.findOne({
        organizationId: new Types.ObjectId(user.organizationId),
        code: updateBuildingDto.code,
        _id: { $ne: new Types.ObjectId(buildingId) },
      });

      if (existingBuilding) {
        throw new ConflictException(
          `Building with code "${updateBuildingDto.code}" already exists`,
        );
      }
    }

    const building = await this.buildingModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(buildingId),
        organizationId: new Types.ObjectId(user.organizationId),
      },
      { $set: updateBuildingDto },
      { new: true },
    );

    if (!building) {
      throw new NotFoundException(`Building with ID "${buildingId}" not found`);
    }

    return building;
  }

  async remove(user: CurrentUserData, buildingId: string): Promise<Building> {
    this.assertBuildingAccess(user, buildingId);

    // Check if building has users
    const usersInBuilding = await this.userModel.countDocuments({
      buildingIds: new Types.ObjectId(buildingId),
    });

    if (usersInBuilding > 0) {
      throw new BadRequestException(
        `Cannot delete building with ${usersInBuilding} assigned user(s). Remove users first.`,
      );
    }

    const building = await this.buildingModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(buildingId),
        organizationId: new Types.ObjectId(user.organizationId),
      },
      { $set: { isActive: false } },
      { new: true },
    );

    if (!building) {
      throw new NotFoundException(`Building with ID "${buildingId}" not found`);
    }

    return building;
  }

  async getBuildingUsers(
    user: CurrentUserData,
    buildingId: string,
  ): Promise<User[]> {
    // Verify building exists, belongs to organization, and user has access
    await this.findOne(user, buildingId);

    return this.userModel
      .find({
        organizationId: new Types.ObjectId(user.organizationId),
        buildingIds: new Types.ObjectId(buildingId),
        isActive: true,
      })
      .select("-password -passwordResetToken -passwordResetExpires")
      .sort({ name: 1 })
      .exec();
  }

  async assignUserToBuilding(
    currentUser: CurrentUserData,
    buildingId: string,
    assignDto: AssignUserToBuildingDto,
  ): Promise<User> {
    // Verify building exists, belongs to organization, and user has access
    await this.findOne(currentUser, buildingId);

    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(assignDto.userId),
      organizationId: new Types.ObjectId(currentUser.organizationId),
    });

    if (!user) {
      throw new NotFoundException(
        `User with ID "${assignDto.userId}" not found`,
      );
    }

    const buildingObjectId = new Types.ObjectId(buildingId);
    const updateOps: Record<string, unknown> = {};

    // Add building to user's buildingIds if not already present
    if (!user.buildingIds?.some((id) => id.equals(buildingObjectId))) {
      updateOps.$addToSet = { buildingIds: buildingObjectId };
    }

    // Set as primary if requested or if it's the user's first building
    if (assignDto.isPrimary || !user.primaryBuildingId) {
      updateOps.$set = { primaryBuildingId: buildingObjectId };
    }

    if (Object.keys(updateOps).length === 0) {
      return user; // User already assigned to this building
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(assignDto.userId, updateOps, { new: true })
      .select("-password -passwordResetToken -passwordResetExpires");

    return updatedUser!;
  }

  async removeUserFromBuilding(
    currentUser: CurrentUserData,
    buildingId: string,
    userId: string,
  ): Promise<User> {
    // Verify building exists, belongs to organization, and user has access
    await this.findOne(currentUser, buildingId);

    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      organizationId: new Types.ObjectId(currentUser.organizationId),
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    const buildingObjectId = new Types.ObjectId(buildingId);
    const updateOps: Record<string, unknown> = {
      $pull: { buildingIds: buildingObjectId },
    };

    // If this was their primary building, clear it
    if (user.primaryBuildingId?.equals(buildingObjectId)) {
      // Find the next building to set as primary (if any remaining)
      const remainingBuildings = user.buildingIds?.filter(
        (id) => !id.equals(buildingObjectId),
      );
      if (remainingBuildings && remainingBuildings.length > 0) {
        updateOps.$set = { primaryBuildingId: remainingBuildings[0] };
      } else {
        updateOps.$unset = { primaryBuildingId: "" };
      }
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(userId, updateOps, { new: true })
      .select("-password -passwordResetToken -passwordResetExpires");

    return updatedUser!;
  }

  async getBuildingStats(
    user: CurrentUserData,
    buildingId: string,
  ): Promise<{
    totalUsers: number;
    activeUsers: number;
    usersByRole: Record<string, number>;
  }> {
    // Verify building exists, belongs to organization, and user has access
    await this.findOne(user, buildingId);

    const buildingObjectId = new Types.ObjectId(buildingId);

    const [totalUsers, activeUsers, roleStats] = await Promise.all([
      this.userModel.countDocuments({
        buildingIds: buildingObjectId,
      }),
      this.userModel.countDocuments({
        buildingIds: buildingObjectId,
        isActive: true,
      }),
      this.userModel.aggregate([
        { $match: { buildingIds: buildingObjectId } },
        { $group: { _id: "$role", count: { $sum: 1 } } },
      ]),
    ]);

    const usersByRole = roleStats.reduce(
      (acc, { _id, count }) => {
        acc[_id] = count;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalUsers,
      activeUsers,
      usersByRole,
    };
  }

  /**
   * Get buildings by IDs (for token generation)
   */
  async findByIds(buildingIds: Types.ObjectId[]): Promise<Building[]> {
    return this.buildingModel
      .find({
        _id: { $in: buildingIds },
        isActive: true,
      })
      .exec();
  }

  /**
   * Send email and/or SMS to building tenants (admin/board).
   */
  async sendMessageToTenants(
    currentUser: CurrentUserData,
    buildingId: string,
    dto: SendBuildingMessageDto,
  ): Promise<SendMessageResult> {
    const building = await this.findOne(currentUser, buildingId);
    let users = await this.getBuildingUsers(currentUser, buildingId);

    if (dto.recipientIds && dto.recipientIds.length > 0) {
      const idSet = new Set(dto.recipientIds);
      users = users.filter((u) => {
        const id = (u as UserDocument)._id?.toString();
        return id ? idSet.has(id) : false;
      });
    }

    // Resolve tenant profiles to include
    let profiles: TenantProfileDocument[] = [];
    const sendAll = !dto.recipientIds?.length && !dto.tenantProfileIds?.length;
    if (dto.tenantProfileIds && dto.tenantProfileIds.length > 0) {
      profiles = await this.tenantProfileModel
        .find({
          organizationId: new Types.ObjectId(currentUser.organizationId),
          buildingId: new Types.ObjectId(buildingId),
          status: { $ne: TenantProfileStatus.REGISTERED },
          _id: {
            $in: dto.tenantProfileIds.map((id) => new Types.ObjectId(id)),
          },
        })
        .exec();
    } else if (sendAll) {
      profiles = await this.tenantProfileModel
        .find({
          organizationId: new Types.ObjectId(currentUser.organizationId),
          buildingId: new Types.ObjectId(buildingId),
          status: { $ne: TenantProfileStatus.REGISTERED },
        })
        .exec();
    }

    const result: SendMessageResult = {
      sentEmail: 0,
      sentSms: 0,
      skippedSms: 0,
    };
    const subject =
      dto.subject ||
      (dto.type !== "sms" ? `Message from ${building.name}` : undefined);

    for (const user of users) {
      if (dto.type === "email" || dto.type === "both") {
        try {
          await this.emailService.sendEmail(
            user.email,
            subject!,
            dto.body.replace(/\n/g, "<br/>"),
            undefined,
            dto.attachments,
          );
          result.sentEmail++;
        } catch (err) {
          this.logger.warn(`Failed to send email to ${user.email}`, err);
        }
      }

      if (dto.type === "sms" || dto.type === "both") {
        const to = this.twilioService.normalizeE164(user.phone);
        if (!to) {
          result.skippedSms++;
          continue;
        }
        if (!this.twilioService.isConfigured()) {
          this.logger.warn("SMS not configured; skipping SMS send");
          break;
        }
        try {
          await this.twilioService.sendSms(to, dto.body);
          result.sentSms++;
        } catch (err) {
          this.logger.warn(`Failed to send SMS to ${user.phone}`, err);
        }
      }
    }

    for (const profile of profiles) {
      if (dto.type === "email" || dto.type === "both") {
        if (!profile.email) continue;
        try {
          await this.emailService.sendEmail(
            profile.email,
            subject!,
            dto.body.replace(/\n/g, "<br/>"),
            undefined,
            dto.attachments,
          );
          result.sentEmail++;
        } catch (err) {
          this.logger.warn(
            `Failed to send email to profile ${profile.email}`,
            err,
          );
        }
      }

      if (dto.type === "sms" || dto.type === "both") {
        const to = this.twilioService.normalizeE164(profile.phone);
        if (!to) {
          result.skippedSms++;
          continue;
        }
        if (!this.twilioService.isConfigured()) {
          this.logger.warn("SMS not configured; skipping SMS send");
          break;
        }
        try {
          await this.twilioService.sendSms(to, dto.body);
          result.sentSms++;
        } catch (err) {
          this.logger.warn(
            `Failed to send SMS to profile ${profile.phone}`,
            err,
          );
        }
      }
    }

    this.logger.log(
      `Building message: email=${result.sentEmail} sms=${result.sentSms} skippedSms=${result.skippedSms}`,
    );
    return result;
  }
}
