import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';
import { PaginationQueryDto, PaginatedResponseDto } from '../../common/dto/pagination.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  /**
   * Create a notification for a user
   */
  async create(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    linkTo?: string,
    relatedId?: string,
    relatedType?: string,
  ): Promise<NotificationDocument> {
    const notification = await this.notificationModel.create({
      userId: new Types.ObjectId(userId),
      type,
      title,
      message,
      linkTo,
      relatedId: relatedId ? new Types.ObjectId(relatedId) : undefined,
      relatedType,
      isRead: false,
    });

    this.logger.log(`Notification created for user ${userId}: ${title}`);
    return notification;
  }

  /**
   * Create notifications for multiple users
   */
  async createBulk(
    userIds: string[],
    type: NotificationType,
    title: string,
    message: string,
    linkTo?: string,
    relatedId?: string,
    relatedType?: string,
  ): Promise<void> {
    const notifications = userIds.map((userId) => ({
      userId: new Types.ObjectId(userId),
      type,
      title,
      message,
      linkTo,
      relatedId: relatedId ? new Types.ObjectId(relatedId) : undefined,
      relatedType,
      isRead: false,
    }));

    await this.notificationModel.insertMany(notifications);

    this.logger.log(
      `Bulk notifications created for ${userIds.length} users: ${title}`,
    );
  }

  /**
   * Get paginated notifications for a user
   */
  async findByUser(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<NotificationDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      this.notificationModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.notificationModel.countDocuments({
        userId: new Types.ObjectId(userId),
      }),
    ]);

    return new PaginatedResponseDto(notifications, total, page, limit);
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<NotificationDocument> {
    const notification = await this.notificationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(notificationId),
        userId: new Types.ObjectId(userId),
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
      { new: true },
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    this.logger.log(`Notification marked as read: ${notificationId}`);
    return notification;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationModel.updateMany(
      {
        userId: new Types.ObjectId(userId),
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
    );

    this.logger.log(`All notifications marked as read for user ${userId}`);
  }

  /**
   * Get unread notification count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
    });
  }

  /**
   * Delete a notification
   */
  async delete(notificationId: string, userId: string): Promise<void> {
    const result = await this.notificationModel.deleteOne({
      _id: new Types.ObjectId(notificationId),
      userId: new Types.ObjectId(userId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException('Notification not found');
    }

    this.logger.log(`Notification deleted: ${notificationId}`);
  }

  /**
   * Delete all notifications for a user
   */
  async deleteAll(userId: string): Promise<void> {
    const result = await this.notificationModel.deleteMany({
      userId: new Types.ObjectId(userId),
    });

    this.logger.log(`Deleted ${result.deletedCount} notifications for user ${userId}`);
  }
}

