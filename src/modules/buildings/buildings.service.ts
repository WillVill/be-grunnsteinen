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
  Apartment,
  ApartmentDocument,
} from "../apartments/schemas/apartment.schema";
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
import { ConceptsService } from "../concepts/concepts.service";
import { MessagesService } from "../messages/messages.service";

export interface SegmentOptionsResult {
  floors: number[];
  entrances: string[];
  tags: string[];
  apartmentTypes: string[];
}

export interface SendMessageResult {
  sentEmail: number;
  sentSms: number;
  skippedSms: number;
  /** In-app support-thread messages delivered (registered users only). */
  sentInApp: number;
  failedInApp: number;
}

export interface RecipientCountResult {
  /** Total distinct recipients (building users + included tenant profiles). */
  total: number;
  users: number;
  profiles: number;
  /** Whether SMS delivery is configured server-side (Twilio). */
  smsConfigured: boolean;
  /** Recipients that would actually receive an email for the chosen channel. */
  reachableEmail: number;
  /** Recipients that would actually receive an SMS (valid phone) for the chosen channel. */
  reachableSms: number;
  /** Recipients skipped because they have no email (only relevant for email/both). */
  skippedNoEmail: number;
  /** Recipients skipped because they have no valid phone (only relevant for sms/both). */
  skippedNoPhone: number;
  /** Registered users reachable in-app (when the in-app channel is on). */
  reachableInApp: number;
  /** Unregistered profiles that cannot be reached in-app (when the in-app channel is on). */
  skippedNoApp: number;
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
    @InjectModel(Apartment.name)
    private apartmentModel: Model<ApartmentDocument>,
    private readonly emailService: EmailService,
    private readonly twilioService: TwilioService,
    private readonly conceptsService: ConceptsService,
    private readonly messagesService: MessagesService,
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

    if (createBuildingDto.conceptId) {
      await this.conceptsService.assertConceptInOrg(
        createBuildingDto.conceptId,
        organizationId,
      );
    }

    const { conceptId, ...rest } = createBuildingDto;
    const building = new this.buildingModel({
      ...rest,
      organizationId: new Types.ObjectId(organizationId),
      ...(conceptId ? { conceptId: new Types.ObjectId(conceptId) } : {}),
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

    if (query.conceptId) {
      filter.conceptId = new Types.ObjectId(query.conceptId);
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

    if (updateBuildingDto.conceptId) {
      await this.conceptsService.assertConceptInOrg(
        updateBuildingDto.conceptId,
        user.organizationId,
      );
    }

    // Detect a concept move so we can cascade conceptId on all denormalized
    // content. Without this, moving a building to a new concept silently hides
    // its existing posts/events/etc. from residents because the filter uses
    // the (now stale) denormalized conceptId.
    const previousBuilding = await this.buildingModel.findOne({
      _id: new Types.ObjectId(buildingId),
      organizationId: new Types.ObjectId(user.organizationId),
    });
    if (!previousBuilding) {
      throw new NotFoundException(`Building with ID "${buildingId}" not found`);
    }

    const { conceptId, ...rest } = updateBuildingDto;
    const updatePayload: Record<string, unknown> = { ...rest };
    if (conceptId) {
      updatePayload.conceptId = new Types.ObjectId(conceptId);
    }

    const building = await this.buildingModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(buildingId),
        organizationId: new Types.ObjectId(user.organizationId),
      },
      { $set: updatePayload },
      { new: true },
    );

    if (!building) {
      throw new NotFoundException(`Building with ID "${buildingId}" not found`);
    }

    if (
      conceptId &&
      previousBuilding.conceptId?.toString() !== conceptId
    ) {
      await this.cascadeConceptMove(
        new Types.ObjectId(buildingId),
        new Types.ObjectId(user.organizationId),
        new Types.ObjectId(conceptId),
      );
    }

    return building;
  }

  /**
   * Rewrites the denormalized conceptId on every doc that references this
   * building, across the 12 content collections + apartments + invitations +
   * tenant-profiles. Without this, moving a building between concepts hides
   * its existing content because filters check the (stale) denormalized
   * conceptId. Runs inline; for orgs with very high write volume this should
   * probably be moved to a background job.
   */
  private async cascadeConceptMove(
    buildingObjectId: Types.ObjectId,
    organizationId: Types.ObjectId,
    newConceptId: Types.ObjectId,
  ): Promise<void> {
    const db = this.buildingModel.db.db;
    const collections = [
      "posts",
      "events",
      "bookings",
      "resources",
      "groups",
      "apartments",
      "documents",
      "shareditems",
      "helprequests",
      "invitations",
      "tenantprofiles",
      "dailystats",
    ];

    let totalUpdated = 0;
    for (const name of collections) {
      const res = await db.collection(name).updateMany(
        { organizationId, buildingId: buildingObjectId },
        { $set: { conceptId: newConceptId } },
      );
      totalUpdated += res.modifiedCount;
    }

    this.logger.log(
      `Cascaded conceptId change for building ${buildingObjectId.toString()} ` +
        `→ concept ${newConceptId.toString()}: ${totalUpdated} doc(s) updated`,
    );
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

    // Only residents are "beboere" — board members and admins/super-admins are
    // excluded so they don't appear in (or receive) building communications.
    return this.userModel
      .find({
        organizationId: new Types.ObjectId(user.organizationId),
        buildingIds: new Types.ObjectId(buildingId),
        role: UserRole.RESIDENT,
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
    totalResidents: number;
    registeredResidents: number;
    unregisteredResidents: number;
  }> {
    // Verify building exists, belongs to organization, and user has access
    await this.findOne(user, buildingId);

    const buildingObjectId = new Types.ObjectId(buildingId);

    const [totalUsers, activeUsers, roleStats, totalResidents, registeredResidents] =
      await Promise.all([
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
        this.tenantProfileModel.countDocuments({ buildingId: buildingObjectId }),
        this.tenantProfileModel.countDocuments({
          buildingId: buildingObjectId,
          status: TenantProfileStatus.REGISTERED,
        }),
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
      totalResidents,
      registeredResidents,
      unregisteredResidents: Math.max(0, totalResidents - registeredResidents),
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
   * Send in-app, email and/or SMS to building tenants (admin/board/host).
   * In-app messages land in each registered user's support thread; unregistered
   * tenant profiles are reachable by email/SMS only.
   */
  async sendMessageToTenants(
    currentUser: CurrentUserData,
    buildingId: string,
    dto: SendBuildingMessageDto,
  ): Promise<SendMessageResult> {
    if (!dto.channels?.inApp && !dto.channels?.email && !dto.channels?.sms) {
      throw new BadRequestException("At least one channel must be selected");
    }

    const building = await this.findOne(currentUser, buildingId);
    const { users, profiles } = await this.resolveMessageRecipients(
      currentUser,
      buildingId,
      dto,
    );

    const result: SendMessageResult = {
      sentEmail: 0,
      sentSms: 0,
      skippedSms: 0,
      sentInApp: 0,
      failedInApp: 0,
    };
    const subject =
      dto.subject ||
      (dto.channels.email ? `Message from ${building.name}` : undefined);

    if (dto.channels.inApp && users.length > 0) {
      // Boards/admins speak for Grunnsteinen; hosts for the husvert channel —
      // mirrors which inbox each role sees the replies in.
      const supportChannel =
        currentUser.role === UserRole.HOST ? "husvert" : "grunnsteinen";
      const { sent, failed } = await this.messagesService.broadcastSupportMessage(
        currentUser.userId,
        currentUser.organizationId,
        users.map((u) => (u as UserDocument)._id.toString()),
        supportChannel,
        dto.body,
        {
          suppressEmailNotification: !!dto.channels.email,
          preferredBuildingId: buildingId,
        },
      );
      result.sentInApp = sent;
      result.failedInApp = failed;
    }

    for (const user of users) {
      if (dto.channels.email) {
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

      if (dto.channels.sms) {
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
      if (dto.channels.email) {
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

      if (dto.channels.sms) {
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
      `Building message: inApp=${result.sentInApp} email=${result.sentEmail} sms=${result.sentSms} skippedSms=${result.skippedSms}`,
    );
    return result;
  }

  /**
   * Resolve the exact set of users + tenant profiles a message would target.
   * Shared by sendMessageToTenants and countMessageRecipients so the previewed
   * count can never diverge from the actual send set.
   */
  private async resolveMessageRecipients(
    currentUser: CurrentUserData,
    buildingId: string,
    dto: SendBuildingMessageDto,
  ): Promise<{ users: User[]; profiles: TenantProfileDocument[] }> {
    let users = await this.getBuildingUsers(currentUser, buildingId);

    // Rule-based segment: resolve the building's matching apartments to the set
    // of tenants (registered users) and apartments (for unregistered profiles).
    // SAFETY: the presence of a `segment` object signals explicit targeting. We
    // never fall back to "send to all" when a segment is supplied — a segment
    // with no usable criteria resolves to ZERO recipients, never everyone.
    const segmentProvided = !!dto.segment;
    let segmentTenantIds: Set<string> | null = null;
    let segmentApartmentIds: string[] | null = null;
    const segmentHasCriteria =
      segmentProvided &&
      ((dto.segment.floors?.length ?? 0) > 0 ||
        (dto.segment.entrances?.length ?? 0) > 0 ||
        (dto.segment.tags?.length ?? 0) > 0 ||
        (dto.segment.apartmentTypes?.length ?? 0) > 0);
    if (segmentProvided) {
      // Empty/criteria-less segment → no apartments match → no recipients.
      segmentApartmentIds = [];
      segmentTenantIds = new Set<string>();
      if (segmentHasCriteria) {
        const aptFilter: Record<string, unknown> = {
          organizationId: new Types.ObjectId(currentUser.organizationId),
          buildingId: new Types.ObjectId(buildingId),
          isActive: true,
        };
        if (dto.segment.floors?.length)
          aptFilter.floor = { $in: dto.segment.floors };
        if (dto.segment.entrances?.length)
          aptFilter.entrance = { $in: dto.segment.entrances };
        if (dto.segment.tags?.length) aptFilter.tags = { $in: dto.segment.tags };
        if (dto.segment.apartmentTypes?.length)
          aptFilter.apartmentType = { $in: dto.segment.apartmentTypes };

        const apartments = await this.apartmentModel
          .find(aptFilter)
          .select("_id tenantIds")
          .lean()
          .exec();
        segmentApartmentIds = apartments.map((a) => a._id.toString());
        segmentTenantIds = new Set(
          apartments.flatMap((a) =>
            (a.tenantIds || []).map((id) => id.toString()),
          ),
        );
      }
    }

    if (dto.recipientIds && dto.recipientIds.length > 0) {
      const idSet = new Set(dto.recipientIds);
      users = users.filter((u) => {
        const id = (u as UserDocument)._id?.toString();
        return id ? idSet.has(id) : false;
      });
    } else if (segmentTenantIds) {
      users = users.filter((u) => {
        const id = (u as UserDocument)._id?.toString();
        return id ? segmentTenantIds.has(id) : false;
      });
    }

    let profiles: TenantProfileDocument[] = [];
    const sendAll =
      !dto.recipientIds?.length && !dto.tenantProfileIds?.length && !segmentProvided;
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
    } else if (segmentApartmentIds) {
      profiles = await this.tenantProfileModel
        .find({
          organizationId: new Types.ObjectId(currentUser.organizationId),
          buildingId: new Types.ObjectId(buildingId),
          status: { $ne: TenantProfileStatus.REGISTERED },
          apartmentId: {
            $in: segmentApartmentIds.map((id) => new Types.ObjectId(id)),
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

    return { users, profiles };
  }

  /**
   * Distinct segment-filter values present in the building's apartments, so
   * the composer can offer real options instead of free-text criteria.
   */
  async getSegmentOptions(
    currentUser: CurrentUserData,
    buildingId: string,
  ): Promise<SegmentOptionsResult> {
    await this.findOne(currentUser, buildingId);

    const apartments = await this.apartmentModel
      .find({
        organizationId: new Types.ObjectId(currentUser.organizationId),
        buildingId: new Types.ObjectId(buildingId),
        isActive: true,
      })
      .select("floor entrance tags apartmentType")
      .lean()
      .exec();

    const floors = new Set<number>();
    const entrances = new Set<string>();
    const tags = new Set<string>();
    const apartmentTypes = new Set<string>();
    for (const apt of apartments) {
      if (typeof apt.floor === "number") floors.add(apt.floor);
      if (apt.entrance) entrances.add(apt.entrance);
      for (const tag of apt.tags || []) tags.add(tag);
      if (apt.apartmentType) apartmentTypes.add(apt.apartmentType);
    }

    return {
      floors: [...floors].sort((a, b) => a - b),
      entrances: [...entrances].sort(),
      tags: [...tags].sort(),
      apartmentTypes: [...apartmentTypes].sort(),
    };
  }

  /**
   * Dry-run: count the recipients a send would actually reach, broken down by
   * channel. Lets the admin UI show an accurate confirmation before dispatch.
   */
  async countMessageRecipients(
    currentUser: CurrentUserData,
    buildingId: string,
    dto: SendBuildingMessageDto,
  ): Promise<RecipientCountResult> {
    const { users, profiles } = await this.resolveMessageRecipients(
      currentUser,
      buildingId,
      dto,
    );

    const wantsInApp = !!dto.channels?.inApp;
    const wantsEmail = !!dto.channels?.email;
    const wantsSms = !!dto.channels?.sms;
    // SMS only actually goes out when Twilio is configured; mirror the send path
    // so the dry-run count never promises SMS reach that won't be delivered.
    const smsConfigured = this.twilioService.isConfigured();

    const recipients: { email?: string; phone?: string }[] = [
      ...users.map((u) => ({ email: u.email, phone: u.phone })),
      ...profiles.map((p) => ({ email: p.email, phone: p.phone })),
    ];

    let reachableEmail = 0;
    let reachableSms = 0;
    let skippedNoEmail = 0;
    let skippedNoPhone = 0;

    for (const r of recipients) {
      if (wantsEmail) {
        if (r.email) reachableEmail++;
        else skippedNoEmail++;
      }
      if (wantsSms) {
        if (smsConfigured && this.twilioService.normalizeE164(r.phone)) reachableSms++;
        else skippedNoPhone++;
      }
    }

    return {
      total: recipients.length,
      users: users.length,
      profiles: profiles.length,
      smsConfigured,
      reachableEmail,
      reachableSms,
      skippedNoEmail,
      skippedNoPhone,
      // In-app reaches registered users only; unregistered profiles are
      // counted as skipped so the UI can surface them.
      reachableInApp: wantsInApp ? users.length : 0,
      skippedNoApp: wantsInApp ? profiles.length : 0,
    };
  }
}
