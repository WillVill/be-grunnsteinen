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
import { User, UserDocument, UserRole, isBoardOrAbove } from '../users/schemas/user.schema';
import { CreateGroupDto, UpdateGroupDto, GroupQueryDto, AddMemberDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import {
  NotificationService,
  NotificationType,
} from '../../shared/services/notification.service';
import { S3Service } from '../../shared/services/s3.service';

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
  ) {}

  /**
   * Create a new group
   */
  async create(
    userId: string,
    orgId: string,
    dto: CreateGroupDto,
  ): Promise<GroupDocument> {
    const { galleryKey, ...rest } = dto;

    // Create group with creator as first member
    const group = await this.groupModel.create({
      ...rest,
      buildingId: new Types.ObjectId(rest.buildingId),
      organizationId: new Types.ObjectId(orgId),
      creatorId: new Types.ObjectId(userId),
      members: [new Types.ObjectId(userId)],
      memberCount: 1,
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
    } else if (isMember !== true) {
      // Default: show public groups and groups user is member of (only if not filtering by membership)
      // This ensures users can see groups they're part of even if private
      filter.$or = [
        { isPrivate: false },
        { members: new Types.ObjectId(userId) },
      ];
    }

    // Building filter: show groups for the selected building or org-wide groups
    if (query.buildingId) {
      const buildingCondition = {
        $or: [
          { buildingId: new Types.ObjectId(query.buildingId) },
          { isOrganizationWide: true },
        ],
      };
      if (filter.$or) {
        const existingOr = filter.$or;
        delete filter.$or;
        filter.$and = [{ $or: existingOr }, buildingCondition];
      } else {
        filter.$or = buildingCondition.$or;
      }
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
   * Find group by ID
   */
  async findById(groupId: string): Promise<GroupDocument> {
    const group = await this.groupModel
      .findById(groupId)
      .populate('creatorId', 'name avatarUrl avatarColor role')
      .populate('members', 'name avatarUrl avatarColor email')
      .exec();

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    return group;
  }

  /**
   * Update group
   */
  async update(
    groupId: string,
    userId: string,
    dto: UpdateGroupDto,
  ): Promise<GroupDocument> {
    const group = await this.findById(groupId);

    // Verify user is creator or board member
    const user = await this.userModel.findById(userId);
    const isCreator = group.creatorId.toString() === userId;
    const isBoard = user && isBoardOrAbove(user.role);

    if (!isCreator && !isBoard) {
      throw new ForbiddenException(
        'Only the creator or board members can update this group',
      );
    }

    const updatedGroup = await this.groupModel
      .findByIdAndUpdate(groupId, { $set: dto }, { new: true, runValidators: true })
      .populate('creatorId', 'name avatarUrl avatarColor role')
      .populate('members', 'name avatarUrl avatarColor role')
      .exec();

    this.logger.log(`Group updated: ${groupId}`);
    return updatedGroup!;
  }

  /**
   * Upload group image
   */
  async uploadImage(
    groupId: string,
    userId: string,
    imageUrl: string,
  ): Promise<GroupDocument> {
    const group = await this.findById(groupId);

    // Verify user is creator or board member
    const user = await this.userModel.findById(userId);
    const isCreator = group.creatorId.toString() === userId;
    const isBoard = user && isBoardOrAbove(user.role);

    if (!isCreator && !isBoard) {
      throw new ForbiddenException(
        'Only the creator or board members can update group image',
      );
    }

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
  async join(groupId: string, userId: string): Promise<GroupDocument> {
    const group = await this.findById(groupId);

    // Check if group is active
    if (!group.isActive) {
      throw new BadRequestException('Group is not active');
    }

    // Check if already a member
    const isMember = group.members.some(
      (m) => m.toString() === userId,
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
  async leave(groupId: string, userId: string): Promise<GroupDocument> {
    const group = await this.findById(groupId);

    // Check if member
    const isMember = group.members.some(
      (m) => m.toString() === userId,
    );
    if (!isMember) {
      throw new BadRequestException('Not a member of this group');
    }

    // Creator cannot leave (must delete group instead)
    if (group.creatorId.toString() === userId) {
      throw new BadRequestException(
        'Creator cannot leave the group. Delete the group instead.',
      );
    }

    // Remove user from members
    group.members = group.members.filter(
      (m) => m.toString() !== userId,
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
    dto: AddMemberDto,
  ): Promise<GroupDocument> {
    const group = await this.findById(groupId);

    const inviter = await this.userModel.findById(inviterUserId);
    const isCreator = group.creatorId.toString() === inviterUserId;
    const isBoard = inviter && isBoardOrAbove(inviter.role);

    if (!isCreator && !isBoard) {
      throw new ForbiddenException(
        'Only the creator or board members can add members to this group',
      );
    }

    const newMemberId = new Types.ObjectId(dto.userId);
    const isAlreadyMember = group.members.some((m) => m.toString() === dto.userId);
    if (isAlreadyMember) {
      throw new BadRequestException('User is already a member of this group');
    }

    const newMember = await this.userModel.findById(dto.userId);
    if (!newMember) {
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
    page: number = 1,
    limit: number = 50,
  ): Promise<PaginatedResponseDto<UserDocument>> {
    const group = await this.findById(groupId);

    const skip = (page - 1) * limit;

    const [members, total] = await Promise.all([
      this.userModel
        .find({ _id: { $in: group.members } })
        .select('name email avatarUrl avatarColor')
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
  async delete(groupId: string, userId: string): Promise<void> {
    const group = await this.findById(groupId);

    // Verify user is creator or board member
    const user = await this.userModel.findById(userId);
    const isCreator = group.creatorId.toString() === userId;
    const isBoard = user && isBoardOrAbove(user.role);

    if (!isCreator && !isBoard) {
      throw new ForbiddenException(
        'Only the creator or board members can delete this group',
      );
    }

    // Deactivate instead of deleting (soft delete)
    group.isActive = false;
    await group.save();

    this.logger.log(`Group deleted (deactivated): ${groupId} by user ${userId}`);
  }
}

