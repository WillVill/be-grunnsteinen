import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, QueryFilter } from 'mongoose';
import { Group, GroupDocument } from './schemas/group.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateGroupDto, UpdateGroupDto, GroupQueryDto, AddMemberDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { Permission, canModerateInBuilding } from '../../common/permissions/permissions';
import {
  NotificationService,
  NotificationType,
} from '../../shared/services/notification.service';
import { S3Service } from '../../shared/services/s3.service';
import { ConceptsService } from '../concepts/concepts.service';
import { refId } from '../../common/schemas/ref-id';
import { canViewGroup, isGroupMember } from './group-access';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    @InjectModel(Group.name)
    private readonly groupModel: Model<GroupDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationService: NotificationService,
    private readonly s3Service: S3Service,
    private readonly conceptsService: ConceptsService,
  ) {}

  /**
   * Create a new group
   */
  async create(
    userId: string,
    orgId: string,
    dto: CreateGroupDto,
  ): Promise<GroupDocument> {
    if (!dto.buildingId && !dto.conceptId) {
      throw new BadRequestException(
        'Either a building or a concept must be provided.',
      );
    }

    let conceptObjectId: Types.ObjectId | null = null;
    if (dto.conceptId) {
      await this.conceptsService.assertConceptInOrg(dto.conceptId, orgId);
      conceptObjectId = new Types.ObjectId(dto.conceptId);
    } else if (dto.buildingId) {
      conceptObjectId = await this.conceptsService.findConceptIdForBuilding(
        dto.buildingId,
        orgId,
      );
    }

    const { galleryKey, ...rest } = dto;

    // Create group with creator as first member
    const group = await this.groupModel.create({
      ...rest,
      ...(rest.buildingId
        ? { buildingId: new Types.ObjectId(rest.buildingId) }
        : {}),
      ...(conceptObjectId ? { conceptId: conceptObjectId } : {}),
      organizationId: new Types.ObjectId(orgId),
      creatorId: new Types.ObjectId(userId),
      members: [new Types.ObjectId(userId)],
      memberCount: 1,
      isConceptWide: rest.isConceptWide ?? false,
      ...(galleryKey && {
        imageUrl: this.s3Service.buildGalleryImageUrl(galleryKey),
      }),
    });

    this.logger.log(`Group created: ${group.name} (${group._id}) by user ${userId}`);

    return this.groupModel
      .findById(group._id)
      .populate('creatorId', 'name avatarUrl avatarColor role')
      .populate('members', 'name avatarUrl avatarColor role')
      .exec() as Promise<GroupDocument>;
  }

  /**
   * Find all groups with pagination and filters
   */
  async findAll(
    orgId: string,
    userId: string,
    query: GroupQueryDto,
  ): Promise<PaginatedResponseDto<GroupDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'name',
      sortOrder = 'asc',
      search,
      isMember,
      isPrivate,
    } = query;

    const skip = (page - 1) * limit;

    // Build filter query
    const filter: QueryFilter<GroupDocument> = {
      organizationId: new Types.ObjectId(orgId),
      isActive: true,
    };

    // Filter by membership
    if (isMember === true) {
      filter.members = new Types.ObjectId(userId);
    }

    // Filter by privacy
    if (typeof isPrivate === 'boolean') {
      filter.isPrivate = isPrivate;
      // Listing private groups never reveals ones the caller isn't in.
      if (isPrivate && isMember !== true) {
        filter.members = new Types.ObjectId(userId);
      }
    } else if (isMember !== true) {
      // Default: show public groups and groups user is member of (only if not filtering by membership)
      // This ensures users can see groups they're part of even if private
      filter.$or = [
        { isPrivate: false },
        { members: new Types.ObjectId(userId) },
      ];
    }

    // Concept-scoped filter (see PostsService.findAll for the full rationale).
    let scopeConceptId: Types.ObjectId | null = null;
    if (query.conceptId) {
      scopeConceptId = new Types.ObjectId(query.conceptId);
    } else if (query.buildingId) {
      const derived = await this.conceptsService.findConceptIdForBuilding(
        query.buildingId,
        orgId,
      );
      scopeConceptId = derived ?? null;
      if (!derived) {
        this.logger.warn(
          `Building ${query.buildingId} has no conceptId; ` +
            `concept-wide groups will be omitted from this query`,
        );
      }
    }

    if (query.buildingId) {
      const buildingCondition = scopeConceptId
        ? {
            $or: [
              { buildingId: new Types.ObjectId(query.buildingId) },
              { isConceptWide: true },
            ],
          }
        : { buildingId: new Types.ObjectId(query.buildingId) };

      if (scopeConceptId) {
        filter.conceptId = scopeConceptId;
      }
      if ("$or" in buildingCondition) {
        if (filter.$or) {
          const existingOr = filter.$or;
          delete filter.$or;
          filter.$and = [{ $or: existingOr }, buildingCondition];
        } else {
          filter.$or = buildingCondition.$or;
        }
      } else {
        filter.buildingId = buildingCondition.buildingId;
      }
    } else if (scopeConceptId) {
      filter.conceptId = scopeConceptId;
    }

    // Text search
    if (search) {
      filter.$text = { $search: search };
    }

    const [groups, total] = await Promise.all([
      this.groupModel
        .find(filter)
        .populate('creatorId', 'name avatarUrl avatarColor role')
        .sort(
          search
            ? { score: { $meta: 'textScore' }, [sortBy]: sortOrder === 'desc' ? -1 : 1 }
            : { [sortBy]: sortOrder === 'desc' ? -1 : 1 },
        )
        .skip(skip)
        .limit(limit)
        .exec(),
      this.groupModel.countDocuments(filter),
    ]);

    return new PaginatedResponseDto(groups, total, page, limit);
  }

  /**
   * Find a group in the caller's organisation. A group in another organisation
   * reads as not found, so ids can't be probed across tenants.
   */
  async findById(groupId: string, orgId: string): Promise<GroupDocument> {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new NotFoundException('Group not found');
    }
    const group = await this.groupModel
      .findOne({ _id: groupId, organizationId: new Types.ObjectId(orgId) })
      .populate('creatorId', 'name avatarUrl avatarColor role')
      .populate('members', 'name avatarUrl avatarColor role')
      .exec();

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    return group;
  }

  /**
   * A private group is only visible to its members and to moderators of its
   * building. Members are checked without a user lookup.
   */
  async assertCanView(group: GroupDocument, userId: string): Promise<void> {
    if (!group.isPrivate || isGroupMember(group, userId)) return;
    const user = await this.userModel.findById(userId);
    if (!canViewGroup(group, userId, user)) {
      throw new ForbiddenException('This group is private');
    }
  }

  /**
   * Group detail for the caller: organisation-scoped and privacy-checked.
   */
  async findOneForUser(groupId: string, orgId: string, userId: string): Promise<GroupDocument> {
    const group = await this.findById(groupId, orgId);
    await this.assertCanView(group, userId);
    return group;
  }

  /**
   * A group in the caller's organisation that the caller may edit: its creator or
   * a moderator for its building. Returns the group so callers don't fetch it
   * twice; the controller runs it before an image reaches S3.
   */
  async assertCanEdit(
    groupId: string,
    orgId: string,
    userId: string,
    action = 'update',
  ): Promise<GroupDocument> {
    const group = await this.findById(groupId, orgId);
    if (refId(group.creatorId) === userId) return group;

    const user = await this.userModel.findById(userId);
    const scopeBuildingId = group.isConceptWide ? null : group.buildingId;
    if (!user || !canModerateInBuilding(user, scopeBuildingId, Permission.GROUP_MODERATE)) {
      throw new ForbiddenException(
        `Only the creator or a moderator for this building can ${action} this group`,
      );
    }
    return group;
  }

  /**
   * Update group
   */
  async update(
    groupId: string,
    userId: string,
    orgId: string,
    dto: UpdateGroupDto,
  ): Promise<GroupDocument> {
    await this.assertCanEdit(groupId, orgId, userId);

    const updatedGroup = await this.groupModel
      .findByIdAndUpdate(groupId, { $set: dto }, { new: true, runValidators: true })
      .populate('creatorId', 'name avatarUrl avatarColor role')
      .populate('members', 'name avatarUrl avatarColor role')
      .exec();

    this.logger.log(`Group updated: ${groupId}`);
    return updatedGroup!;
  }

  /**
   * Set the group image. Takes the group returned by `assertCanEdit`, so the
   * permission check has already run (before the upload).
   */
  async setImage(group: GroupDocument, imageUrl: string): Promise<GroupDocument> {
    const groupId = String(group._id);
    const updatedGroup = await this.groupModel
      .findByIdAndUpdate(groupId, { $set: { imageUrl } }, { new: true })
      .populate('creatorId', 'name avatarUrl avatarColor role')
      .populate('members', 'name avatarUrl avatarColor role')
      .exec();

    this.logger.log(`Group image updated: ${groupId}`);
    return updatedGroup!;
  }

  /**
   * Join group
   */
  async join(groupId: string, userId: string, orgId: string): Promise<GroupDocument> {
    const group = await this.findById(groupId, orgId);

    // Check if group is active
    if (!group.isActive) {
      throw new BadRequestException('Group is not active');
    }

    // Check if already a member
    const isMember = group.members.some(
      (m) => refId(m) === userId,
    );
    if (isMember) {
      throw new BadRequestException('Already a member of this group');
    }

    // Check if group is private
    if (group.isPrivate) {
      throw new BadRequestException('Cannot join a private group. Request an invitation.');
    }

    // Add user to members
    group.members.push(new Types.ObjectId(userId));
    group.memberCount = group.members.length;
    await group.save();

    this.logger.log(`User ${userId} joined group ${groupId}`);

    return this.groupModel
      .findById(groupId)
      .populate('creatorId', 'name avatarUrl avatarColor role')
      .populate('members', 'name avatarUrl avatarColor role')
      .exec() as Promise<GroupDocument>;
  }

  /**
   * Leave group
   */
  async leave(groupId: string, userId: string, orgId: string): Promise<GroupDocument> {
    const group = await this.findById(groupId, orgId);

    // Check if member
    const isMember = group.members.some(
      (m) => refId(m) === userId,
    );
    if (!isMember) {
      throw new BadRequestException('Not a member of this group');
    }

    // Creator cannot leave (must delete group instead)
    if (refId(group.creatorId) === userId) {
      throw new BadRequestException(
        'Creator cannot leave the group. Delete the group instead.',
      );
    }

    // Remove user from members
    group.members = group.members.filter(
      (m) => refId(m) !== userId,
    );
    group.memberCount = group.members.length;
    await group.save();

    this.logger.log(`User ${userId} left group ${groupId}`);

    return this.groupModel
      .findById(groupId)
      .populate('creatorId', 'name avatarUrl avatarColor role')
      .populate('members', 'name avatarUrl avatarColor role')
      .exec() as Promise<GroupDocument>;
  }

  /**
   * Add a member to the group (creator or board only). Sends GROUP_INVITATION to the added user.
   */
  async addMember(
    groupId: string,
    inviterUserId: string,
    orgId: string,
    dto: AddMemberDto,
  ): Promise<GroupDocument> {
    const group = await this.findById(groupId, orgId);

    const inviter = await this.userModel.findById(inviterUserId);
    const isCreator = refId(group.creatorId) === inviterUserId;
    const scopeBuildingId = group.isConceptWide ? null : group.buildingId;
    const canModerate =
      inviter && canModerateInBuilding(inviter, scopeBuildingId, Permission.GROUP_MODERATE);

    if (!isCreator && !canModerate) {
      throw new ForbiddenException(
        'Only the creator or a moderator for this building can add members to this group',
      );
    }

    const newMemberId = new Types.ObjectId(dto.userId);
    const isAlreadyMember = group.members.some((m) => refId(m) === dto.userId);
    if (isAlreadyMember) {
      throw new BadRequestException('User is already a member of this group');
    }

    const newMember = await this.userModel.findById(dto.userId);
    if (!newMember || refId(newMember.organizationId) !== orgId) {
      throw new NotFoundException('User to add not found');
    }

    group.members.push(newMemberId);
    group.memberCount = group.members.length;
    await group.save();

    this.logger.log(`User ${dto.userId} added to group ${groupId} by ${inviterUserId}`);

    await this.notificationService
      .createNotification(
        dto.userId,
        NotificationType.GROUP_INVITATION,
        'Added to group',
        `${inviter?.name ?? 'Someone'} added you to the group "${group.name}"`,
        `/groups/${groupId}`,
        true,
        {
          _id: newMember._id.toString(),
          email: newMember.email,
          firstName: newMember.name.split(' ')[0],
          lastName: newMember.name.split(' ').slice(1).join(' '),
        },
      )
      .catch((err) =>
        this.logger.warn(`Failed to send group invitation notification: ${err.message}`),
      );

    return this.groupModel
      .findById(groupId)
      .populate('creatorId', 'name avatarUrl avatarColor role')
      .populate('members', 'name avatarUrl avatarColor role')
      .exec() as Promise<GroupDocument>;
  }

  /**
   * Get group members (paginated)
   */
  async getMembers(
    groupId: string,
    orgId: string,
    userId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<PaginatedResponseDto<UserDocument>> {
    const group = await this.findById(groupId, orgId);
    await this.assertCanView(group, userId);

    const skip = (page - 1) * limit;

    const [members, total] = await Promise.all([
      this.userModel
        .find({ _id: { $in: group.members } })
        .select('name avatarUrl avatarColor')
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments({ _id: { $in: group.members } }),
    ]);

    return new PaginatedResponseDto(members, total, page, limit);
  }

  /**
   * Delete group
   */
  async delete(groupId: string, userId: string, orgId: string): Promise<void> {
    const group = await this.assertCanEdit(groupId, orgId, userId, 'delete');

    // Deactivate instead of deleting (soft delete)
    group.isActive = false;
    await group.save();

    this.logger.log(`Group deleted (deactivated): ${groupId} by user ${userId}`);
  }
}

