import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EmailService, EmailUser } from './email.service';
import {
  renderButton,
  renderEmailLayout,
  renderH1,
} from '../email-templates/base-layout';
import { PaginationQueryDto, PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { NotificationDocument } from './notification.schema';
import { UserDocument } from '../../modules/users/schemas/user.schema';

// Notification types enum
export enum NotificationType {
  BOOKING_CONFIRMED = 'booking_confirmed',
  BOOKING_CANCELLED = 'booking_cancelled',
  BOOKING_REMINDER = 'booking_reminder',
  EVENT_CREATED = 'event_created',
  EVENT_UPDATED = 'event_updated',
  EVENT_REMINDER = 'event_reminder',
  EVENT_CANCELLED = 'event_cancelled',
  MESSAGE_RECEIVED = 'message_received',
  POST_CREATED = 'post_created',
  POST_COMMENT = 'post_comment',
  DOCUMENT_SHARED = 'document_shared',
  GROUP_INVITATION = 'group_invitation',
  ANNOUNCEMENT = 'announcement',
  SYSTEM = 'system',
}

// Notification document type is exported from notification.schema.ts

// Preference keys used in User.notificationPreferences.email (8 independent toggles)
export type NotificationPreferenceKey =
  | 'newPosts'
  | 'comments'
  | 'events'
  | 'eventReminders'
  | 'bookings'
  | 'helpRequests'
  | 'messages'
  | 'boardAnnouncements';

// Map each notification type to the user preference key (Varslingsinnstillinger)
const NOTIFICATION_TYPE_TO_PREFERENCE: Record<
  NotificationType,
  NotificationPreferenceKey
> = {
  [NotificationType.BOOKING_CONFIRMED]: 'bookings',
  [NotificationType.BOOKING_CANCELLED]: 'bookings',
  [NotificationType.BOOKING_REMINDER]: 'bookings',
  [NotificationType.EVENT_CREATED]: 'events',
  [NotificationType.EVENT_UPDATED]: 'events',
  [NotificationType.EVENT_REMINDER]: 'eventReminders',
  [NotificationType.EVENT_CANCELLED]: 'events',
  [NotificationType.MESSAGE_RECEIVED]: 'messages',
  [NotificationType.POST_CREATED]: 'newPosts',
  [NotificationType.POST_COMMENT]: 'comments',
  [NotificationType.DOCUMENT_SHARED]: 'boardAnnouncements',
  [NotificationType.GROUP_INVITATION]: 'boardAnnouncements',
  [NotificationType.ANNOUNCEMENT]: 'boardAnnouncements',
  [NotificationType.SYSTEM]: 'boardAnnouncements',
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  private readonly frontendUrl: string;

  constructor(
    @InjectModel('Notification')
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel('User')
    private readonly userModel: Model<UserDocument>,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {
    this.frontendUrl = this.configService.get<string>('frontendUrl');
  }

  /**
   * Create a single notification for a user.
   * In-app notification is always created. Email is sent only if requested and user's
   * Varslingsinnstillinger (notification preferences) allow it for this notification category.
   */
  async createNotification(
    userId: string | Types.ObjectId,
    type: NotificationType,
    title: string,
    message: string,
    linkTo?: string,
    sendEmail: boolean = false,
    emailUser?: EmailUser,
  ): Promise<NotificationDocument> {
    const notification = await this.notificationModel.create({
      userId: new Types.ObjectId(userId),
      type,
      title,
      message,
      linkTo,
      isRead: false,
    });

    this.logger.log(`Notification created for user ${userId}: ${title}`);

    if (sendEmail && emailUser) {
      const preferenceKey = NOTIFICATION_TYPE_TO_PREFERENCE[type];
      const allowEmail = await this.userAllowsEmailForPreference(userId, preferenceKey);
      if (allowEmail) {
        await this.sendEmailNotification(emailUser, type, title, message, linkTo);
      }
    }

    return notification;
  }

  /**
   * Create notifications for multiple users.
   * In-app notifications are always created. Emails are sent only to users whose
   * Varslingsinnstillinger (notification preferences) allow it for this category.
   */
  async createBulkNotifications(
    userIds: (string | Types.ObjectId)[],
    type: NotificationType,
    title: string,
    message: string,
    linkTo?: string,
    sendEmail: boolean = false,
    emailUsers?: EmailUser[],
  ): Promise<NotificationDocument[]> {
    const notifications = userIds.map((userId) => ({
      userId: new Types.ObjectId(userId),
      type,
      title,
      message,
      linkTo,
      isRead: false,
    }));

    const created = await this.notificationModel.insertMany(notifications);

    this.logger.log(
      `Bulk notifications created for ${userIds.length} users: ${title}`,
    );

    if (sendEmail && emailUsers?.length) {
      const preferenceKey = NOTIFICATION_TYPE_TO_PREFERENCE[type];
      const userIdsStr = userIds.map((id) => id.toString());
      const allowEmailByUserId = await this.usersAllowEmailForPreference(
        userIdsStr,
        preferenceKey,
      );
      await Promise.all(
        emailUsers.map((user) => {
          if (!allowEmailByUserId.get(user._id)) return Promise.resolve();
          return this.sendEmailNotification(
            user,
            type,
            title,
            message,
            linkTo,
          ).catch((error) => {
            this.logger.error(
              `Failed to send email notification to ${user.email}`,
              error,
            );
          });
        }),
      );
    }

    return created as NotificationDocument[];
  }

  /**
   * Get paginated notifications for a user
   */
  async getUserNotifications(
    userId: string | Types.ObjectId,
    pagination: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<NotificationDocument>> {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
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
   * Get unread notification count for a user
   */
  async getUnreadCount(userId: string | Types.ObjectId): Promise<number> {
    return this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
    });
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(
    notificationId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<NotificationDocument> {
    const notification = await this.notificationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(notificationId),
        userId: new Types.ObjectId(userId),
      },
      { isRead: true },
      { new: true },
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return notification;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string | Types.ObjectId): Promise<void> {
    await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { isRead: true },
    );

    this.logger.log(`All notifications marked as read for user ${userId}`);
  }

  /**
   * Delete a notification
   */
  async deleteNotification(
    notificationId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<void> {
    const result = await this.notificationModel.deleteOne({
      _id: new Types.ObjectId(notificationId),
      userId: new Types.ObjectId(userId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException('Notification not found');
    }
  }

  /**
   * Delete all notifications for a user
   */
  async deleteAllNotifications(userId: string | Types.ObjectId): Promise<void> {
    await this.notificationModel.deleteMany({
      userId: new Types.ObjectId(userId),
    });

    this.logger.log(`All notifications deleted for user ${userId}`);
  }

  /**
   * Check if a user allows email for the given preference key (Varslingsinnstillinger).
   * Defaults to true if preferences are missing.
   */
  private async userAllowsEmailForPreference(
    userId: string | Types.ObjectId,
    key: NotificationPreferenceKey,
  ): Promise<boolean> {
    const user = await this.userModel
      .findById(userId)
      .select('notificationPreferences')
      .lean()
      .exec();
    const email = user?.notificationPreferences?.email;
    if (!email) return true;
    const value = email[key];
    return value !== false;
  }

  /**
   * For bulk: check which user IDs allow email for the given preference key.
   * Returns a Map<userId, boolean>. Defaults to true if preferences are missing.
   */
  private async usersAllowEmailForPreference(
    userIds: string[],
    key: NotificationPreferenceKey,
  ): Promise<Map<string, boolean>> {
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('_id notificationPreferences')
      .lean()
      .exec();
    const map = new Map<string, boolean>();
    for (const id of userIds) {
      map.set(id, true);
    }
    for (const user of users) {
      const id = user._id.toString();
      const email = user.notificationPreferences?.email;
      if (!email) continue;
      map.set(id, email[key] !== false);
    }
    return map;
  }

  /**
   * Send email notification based on type
   */
  private async sendEmailNotification(
    user: EmailUser,
    type: NotificationType,
    title: string,
    message: string,
    linkTo?: string,
  ): Promise<void> {
    const subject = this.getEmailSubject(type, title);
    const html = this.buildEmailHtml(user, title, message, linkTo);

    await this.emailService.sendEmail(user.email, subject, html);
  }

  /**
   * Get email subject based on notification type
   */
  private getEmailSubject(type: NotificationType, title: string): string {
    const prefixes: Record<NotificationType, string> = {
      [NotificationType.BOOKING_CONFIRMED]: '✅ Booking bekreftet',
      [NotificationType.BOOKING_CANCELLED]: '❌ Booking avlyst',
      [NotificationType.BOOKING_REMINDER]: '⏰ Påminnelse om booking',
      [NotificationType.EVENT_CREATED]: '📅 Nytt arrangement',
      [NotificationType.EVENT_UPDATED]: '📅 Arrangement oppdatert',
      [NotificationType.EVENT_REMINDER]: '⏰ Påminnelse om arrangement',
      [NotificationType.EVENT_CANCELLED]: '❌ Arrangement avlyst',
      [NotificationType.MESSAGE_RECEIVED]: '💬 Ny melding',
      [NotificationType.POST_CREATED]: '📝 Nytt innlegg',
      [NotificationType.POST_COMMENT]: '💬 Ny kommentar',
      [NotificationType.DOCUMENT_SHARED]: '📄 Dokument delt',
      [NotificationType.GROUP_INVITATION]: '👥 Gruppeinvitasjon',
      [NotificationType.ANNOUNCEMENT]: '📢 Kunngjøring',
      [NotificationType.SYSTEM]: 'ℹ️ Systemvarsling',
    };

    return `${prefixes[type] || ''}: ${title}`;
  }

  /**
   * Build email HTML content
   */
  private buildEmailHtml(
    user: EmailUser,
    title: string,
    message: string,
    linkTo?: string,
  ): string {
    const content = `
      ${renderH1(title)}
      <p>Hei ${user.firstName},</p>
      <p>${message}</p>
      ${linkTo ? renderButton('Se detaljer', linkTo) : ''}
    `;

    return renderEmailLayout(content, {
      frontendUrl: this.frontendUrl,
      userId: user._id,
      preheader: message,
    });
  }
}

