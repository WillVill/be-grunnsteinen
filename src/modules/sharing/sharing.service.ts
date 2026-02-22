import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, QueryFilter } from 'mongoose';
import {
  HelpRequest,
  HelpRequestDocument,
  HelpRequestStatus,
  HelpRequestCategory,
} from './schemas/help-request.schema';
import {
  SharedItem,
  SharedItemDocument,
  SharedItemCategory,
} from './schemas/shared-item.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  CreateHelpRequestDto,
  CreateSharedItemDto,
  UpdateSharedItemDto,
} from './dto';
import { PaginationQueryDto, PaginatedResponseDto } from '../../common/dto/pagination.dto';
import {
  NotificationService,
  NotificationType,
} from '../../shared/services/notification.service';
import { EmailService, EmailUser } from '../../shared/services/email.service';

@Injectable()
export class SharingService {
  private readonly logger = new Logger(SharingService.name);

  constructor(
    @InjectModel(HelpRequest.name)
    private readonly helpRequestModel: Model<HelpRequestDocument>,
    @InjectModel(SharedItem.name)
    private readonly sharedItemModel: Model<SharedItemDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
  ) {}

  // ==================== Help Request Methods ====================

  /**
   * Create a new help request
   */
  async createHelpRequest(
    userId: string,
    orgId: string,
    dto: CreateHelpRequestDto,
  ): Promise<HelpRequestDocument> {
    const helpRequest = await this.helpRequestModel.create({
      ...dto,
      buildingId: new Types.ObjectId(dto.buildingId),
      organizationId: new Types.ObjectId(orgId),
      requesterId: new Types.ObjectId(userId),
      status: HelpRequestStatus.OPEN,
    });

    this.logger.log(`Help request created: ${helpRequest._id} by user ${userId}`);

    return this.helpRequestModel
      .findById(helpRequest._id)
      .populate('requesterId', 'name avatarUrl avatarColor role')
      .exec() as Promise<HelpRequestDocument>;
  }

  /**
   * Find all help requests with pagination and filters
   */
  async findAllHelpRequests(
    orgId: string,
    query: PaginationQueryDto & { category?: HelpRequestCategory; status?: HelpRequestStatus },
  ): Promise<PaginatedResponseDto<HelpRequestDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      category,
      status,
    } = query;

    const skip = (page - 1) * limit;

    const filter: QueryFilter<HelpRequestDocument> = {
      organizationId: new Types.ObjectId(orgId),
    };

    if (category) {
      filter.category = category;
    }

    if (status) {
      filter.status = status;
    } else {
      // Default to open requests only
      filter.status = HelpRequestStatus.OPEN;
    }

    // Building filter: show items for the selected building or org-wide items
    if (query.buildingId) {
      filter.$or = [
        { buildingId: new Types.ObjectId(query.buildingId) },
        { isOrganizationWide: true },
      ];
    }

    const [helpRequests, total] = await Promise.all([
      this.helpRequestModel
        .find(filter)
        .populate('requesterId', 'name avatarUrl avatarColor role')
        .populate('helperId', 'name avatarUrl avatarColor role')
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.helpRequestModel.countDocuments(filter),
    ]);

    return new PaginatedResponseDto(helpRequests, total, page, limit);
  }

  /**
   * Find help request by ID
   */
  async findHelpRequestById(id: string): Promise<HelpRequestDocument> {
    const helpRequest = await this.helpRequestModel
      .findById(id)
      .populate('requesterId', 'name avatarUrl avatarColor email')
      .populate('helperId', 'name avatarUrl avatarColor email')
      .exec();

    if (!helpRequest) {
      throw new NotFoundException('Help request not found');
    }

    return helpRequest;
  }

  /**
   * Accept a help request
   */
  async acceptHelpRequest(
    requestId: string,
    helperId: string,
  ): Promise<HelpRequestDocument> {
    const helpRequest = await this.findHelpRequestById(requestId);

    if (helpRequest.status !== HelpRequestStatus.OPEN) {
      throw new BadRequestException('Help request is not open');
    }

    if (helpRequest.requesterId.toString() === helperId) {
      throw new BadRequestException('Cannot accept your own help request');
    }

    // Update status
    helpRequest.status = HelpRequestStatus.ACCEPTED;
    helpRequest.helperId = new Types.ObjectId(helperId);
    helpRequest.acceptedAt = new Date();
    await helpRequest.save();

    this.logger.log(`Help request accepted: ${requestId} by helper ${helperId}`);

    // Notify requester
    const requester = await this.userModel.findById(helpRequest.requesterId);
    const helper = await this.userModel.findById(helperId);
    if (requester && helper) {
      const emailUser: EmailUser = {
        _id: requester._id.toString(),
        email: requester.email,
        firstName: requester.name.split(' ')[0],
        lastName: requester.name.split(' ').slice(1).join(' ') || '',
      };

      await this.notificationService
        .createNotification(
          helpRequest.requesterId.toString(),
          NotificationType.MESSAGE_RECEIVED,
          'Help request accepted',
          `${helper.name} has accepted your help request: "${helpRequest.title}"`,
          `/sharing/help-requests/${requestId}`,
          true,
          emailUser,
        )
        .catch((error) => {
          this.logger.error('Failed to create acceptance notification', error);
        });
    }

    return this.helpRequestModel
      .findById(requestId)
      .populate('requesterId', 'name avatarUrl avatarColor role')
      .populate('helperId', 'name avatarUrl avatarColor role')
      .exec() as Promise<HelpRequestDocument>;
  }

  /**
   * Complete a help request
   */
  async completeHelpRequest(
    requestId: string,
    userId: string,
  ): Promise<HelpRequestDocument> {
    const helpRequest = await this.findHelpRequestById(requestId);

    if (helpRequest.status !== HelpRequestStatus.ACCEPTED) {
      throw new BadRequestException('Help request must be accepted before completion');
    }

    // Verify user is requester or helper
    const isRequester = helpRequest.requesterId.toString() === userId;
    const isHelper = helpRequest.helperId?.toString() === userId;

    if (!isRequester && !isHelper) {
      throw new ForbiddenException(
        'Only the requester or helper can complete this help request',
      );
    }

    // Update status
    helpRequest.status = HelpRequestStatus.COMPLETED;
    helpRequest.completedAt = new Date();
    await helpRequest.save();

    this.logger.log(`Help request completed: ${requestId} by user ${userId}`);

    // Notify the other party
    const otherUserId = isRequester
      ? helpRequest.helperId?.toString()
      : helpRequest.requesterId.toString();
    const otherUser = await this.userModel.findById(otherUserId);
    const currentUser = await this.userModel.findById(userId);
    if (otherUser && currentUser) {
      const emailUser: EmailUser = {
        _id: otherUser._id.toString(),
        email: otherUser.email,
        firstName: otherUser.name.split(' ')[0],
        lastName: otherUser.name.split(' ').slice(1).join(' ') || '',
      };

      await this.notificationService
        .createNotification(
          otherUserId!,
          NotificationType.MESSAGE_RECEIVED,
          'Help request completed',
          `${currentUser.name} has marked the help request "${helpRequest.title}" as completed`,
          `/sharing/help-requests/${requestId}`,
          false,
          emailUser,
        )
        .catch((error) => {
          this.logger.error('Failed to create completion notification', error);
        });
    }

    return this.helpRequestModel
      .findById(requestId)
      .populate('requesterId', 'name avatarUrl avatarColor role')
      .populate('helperId', 'name avatarUrl avatarColor role')
      .exec() as Promise<HelpRequestDocument>;
  }

  /**
   * Cancel a help request
   */
  async cancelHelpRequest(
    requestId: string,
    userId: string,
  ): Promise<HelpRequestDocument> {
    const helpRequest = await this.findHelpRequestById(requestId);

    if (helpRequest.status === HelpRequestStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed help request');
    }

    if (helpRequest.status === HelpRequestStatus.CANCELLED) {
      throw new BadRequestException('Help request is already cancelled');
    }

    // Verify user is requester
    if (helpRequest.requesterId.toString() !== userId) {
      throw new ForbiddenException('Only the requester can cancel this help request');
    }

    // Update status
    helpRequest.status = HelpRequestStatus.CANCELLED;
    await helpRequest.save();

    this.logger.log(`Help request cancelled: ${requestId} by user ${userId}`);

    // Notify helper if one was assigned
    if (helpRequest.helperId) {
      const helper = await this.userModel.findById(helpRequest.helperId);
      if (helper) {
        const emailUser: EmailUser = {
          _id: helper._id.toString(),
          email: helper.email,
          firstName: helper.name.split(' ')[0],
          lastName: helper.name.split(' ').slice(1).join(' ') || '',
        };

        await this.notificationService
          .createNotification(
            helpRequest.helperId.toString(),
            NotificationType.MESSAGE_RECEIVED,
            'Help request cancelled',
            `The help request "${helpRequest.title}" has been cancelled`,
            `/sharing/help-requests`,
            false,
            emailUser,
          )
          .catch((error) => {
            this.logger.error('Failed to create cancellation notification', error);
          });
      }
    }

    return this.helpRequestModel
      .findById(requestId)
      .populate('requesterId', 'name avatarUrl avatarColor role')
      .populate('helperId', 'name avatarUrl avatarColor role')
      .exec() as Promise<HelpRequestDocument>;
  }

  // ==================== Shared Item Methods ====================

  /**
   * Create a new shared item
   */
  async createSharedItem(
    userId: string,
    orgId: string,
    dto: CreateSharedItemDto,
  ): Promise<SharedItemDocument> {
    if (!userId || !orgId) {
      throw new BadRequestException('userId and organizationId are required');
    }
    const doc = {
      name: dto.name,
      description: dto.description,
      category: dto.category,
      buildingId: new Types.ObjectId(dto.buildingId),
      organizationId: new Types.ObjectId(orgId),
      ownerId: new Types.ObjectId(userId),
      isAvailable: true,
    };
    const sharedItem = await this.sharedItemModel.create(doc);

    this.logger.log(
      `Shared item created: ${sharedItem.name} (${sharedItem._id}) by user ${userId} in org ${orgId}`,
    );

    const populated = await this.sharedItemModel
      .findById(sharedItem._id)
      .populate('ownerId', 'name avatarUrl avatarColor role')
      .exec();
    if (!populated) {
      this.logger.warn(`Shared item ${sharedItem._id} not found after create`);
      return sharedItem as SharedItemDocument;
    }
    return populated as SharedItemDocument;
  }

  /**
   * Find all shared items with pagination and filters
   */
  async findAllSharedItems(
    orgId: string,
    query: PaginationQueryDto & {
      category?: SharedItemCategory;
      isAvailable?: boolean;
      ownerId?: string;
    },
  ): Promise<PaginatedResponseDto<SharedItemDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'name',
      sortOrder = 'asc',
      category,
      isAvailable,
      ownerId,
    } = query;

    const skip = (page - 1) * limit;

    const filter: QueryFilter<SharedItemDocument> = {
      organizationId: new Types.ObjectId(orgId),
    };

    if (category) {
      filter.category = category;
    }

    if (typeof isAvailable === 'boolean') {
      filter.isAvailable = isAvailable;
    } else {
      // Default to available items only
      filter.isAvailable = true;
    }

    if (ownerId) {
      filter.ownerId = new Types.ObjectId(ownerId);
    }

    // Building filter: show items for the selected building or org-wide items
    if (query.buildingId) {
      filter.$or = [
        { buildingId: new Types.ObjectId(query.buildingId) },
        { isOrganizationWide: true },
      ];
    }

    const [sharedItems, total] = await Promise.all([
      this.sharedItemModel
        .find(filter)
        .populate('ownerId', 'name avatarUrl avatarColor role')
        .populate('borrowedBy', 'name avatarUrl avatarColor role')
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.sharedItemModel.countDocuments(filter),
    ]);

    return new PaginatedResponseDto(sharedItems, total, page, limit);
  }

  /**
   * Find shared item by ID
   */
  async findSharedItemById(id: string): Promise<SharedItemDocument> {
    const sharedItem = await this.sharedItemModel
      .findById(id)
      .populate('ownerId', 'name avatarUrl avatarColor email')
      .populate('borrowedBy', 'name avatarUrl avatarColor email')
      .exec();

    if (!sharedItem) {
      throw new NotFoundException('Shared item not found');
    }

    return sharedItem;
  }

  /**
   * Update shared item
   */
  async updateSharedItem(
    itemId: string,
    userId: string,
    dto: UpdateSharedItemDto,
  ): Promise<SharedItemDocument> {
    const sharedItem = await this.findSharedItemById(itemId);

    // Verify user is owner
    if (sharedItem.ownerId.toString() !== userId) {
      throw new ForbiddenException('Only the owner can update this item');
    }

    const updatedItem = await this.sharedItemModel
      .findByIdAndUpdate(itemId, { $set: dto }, { new: true, runValidators: true })
      .populate('ownerId', 'name avatarUrl avatarColor role')
      .populate('borrowedBy', 'name avatarUrl avatarColor role')
      .exec();

    this.logger.log(`Shared item updated: ${itemId}`);
    return updatedItem!;
  }

  /**
   * Toggle item availability
   */
  async toggleAvailability(
    itemId: string,
    userId: string,
  ): Promise<SharedItemDocument> {
    const sharedItem = await this.findSharedItemById(itemId);

    // Verify user is owner
    if (sharedItem.ownerId.toString() !== userId) {
      throw new ForbiddenException('Only the owner can toggle availability');
    }

    // Toggle availability
    sharedItem.isAvailable = !sharedItem.isAvailable;

    // If marking as unavailable and item is borrowed, clear borrower info
    if (!sharedItem.isAvailable && sharedItem.borrowedBy) {
      sharedItem.borrowedBy = undefined;
      sharedItem.borrowedAt = undefined;
    }

    await sharedItem.save();

    this.logger.log(`Shared item availability toggled: ${itemId} to ${sharedItem.isAvailable}`);

    return this.sharedItemModel
      .findById(itemId)
      .populate('ownerId', 'name avatarUrl avatarColor role')
      .populate('borrowedBy', 'name avatarUrl avatarColor role')
      .exec() as Promise<SharedItemDocument>;
  }

  /**
   * Request to borrow an item (sends notification to owner)
   */
  async requestToBorrow(itemId: string, userId: string): Promise<void> {
    const sharedItem = await this.findSharedItemById(itemId);

    if (!sharedItem.isAvailable) {
      throw new BadRequestException('Item is not available for borrowing');
    }

    if (sharedItem.ownerId.toString() === userId) {
      throw new BadRequestException('Cannot request to borrow your own item');
    }

    // Send notification to owner
    const owner = await this.userModel.findById(sharedItem.ownerId);
    const requester = await this.userModel.findById(userId);
    if (owner && requester) {
      const emailUser: EmailUser = {
        _id: owner._id.toString(),
        email: owner.email,
        firstName: owner.name.split(' ')[0],
        lastName: owner.name.split(' ').slice(1).join(' ') || '',
      };

      await this.notificationService
        .createNotification(
          sharedItem.ownerId.toString(),
          NotificationType.MESSAGE_RECEIVED,
          'Borrow request',
          `${requester.name} wants to borrow your "${sharedItem.name}"`,
          `/sharing/items/${itemId}`,
          true,
          emailUser,
        )
        .catch((error) => {
          this.logger.error('Failed to create borrow request notification', error);
        });
    }

    this.logger.log(`Borrow request sent: ${itemId} by user ${userId}`);
  }

  /**
   * Delete shared item
   */
  async deleteSharedItem(itemId: string, userId: string): Promise<void> {
    const sharedItem = await this.findSharedItemById(itemId);

    // Verify user is owner
    if (sharedItem.ownerId.toString() !== userId) {
      throw new ForbiddenException('Only the owner can delete this item');
    }

    // Check if item is currently borrowed
    if (sharedItem.borrowedBy) {
      throw new BadRequestException('Cannot delete an item that is currently borrowed');
    }

    await this.sharedItemModel.deleteOne({ _id: itemId });

    this.logger.log(`Shared item deleted: ${itemId} by user ${userId}`);
  }
}

