import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Booking, BookingDocument, BookingStatus } from '../bookings/schemas/booking.schema';
import {
  HelpRequest,
  HelpRequestDocument,
  HelpRequestStatus,
} from '../sharing/schemas/help-request.schema';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Post, PostDocument } from '../posts/schemas/post.schema';
import { Comment, CommentDocument } from '../posts/schemas/comment.schema';
import {
  NotificationService,
  NotificationType as SharedNotificationType,
} from '../../shared/services/notification.service';
import { EventsService } from '../events/events.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(HelpRequest.name)
    private readonly helpRequestModel: Model<HelpRequestDocument>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Post.name)
    private readonly postModel: Model<PostDocument>,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
    private readonly notificationService: NotificationService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Event Reminders - Daily at 9 AM
   * Delegates to EventsService for one code path with email and EVENT_REMINDER type
   */
  @Cron('0 9 * * *') // Every day at 9:00 AM
  async handleEventReminders() {
    this.logger.log('Running event reminders task...');
    try {
      await this.eventsService.sendReminders();
      this.logger.log('Event reminders task completed');
    } catch (error) {
      this.logger.error('Error in event reminders task', error);
    }
  }

  /**
   * Booking Reminders - Daily at 8 AM
   * Find confirmed bookings starting in next 24 hours and send reminder notifications
   */
  @Cron('0 8 * * *') // Every day at 8:00 AM
  async handleBookingReminders() {
    this.logger.log('Running booking reminders task...');
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    try {
      const upcomingBookings = await this.bookingModel
        .find({
          status: BookingStatus.CONFIRMED,
          startDate: {
            $gte: now,
            $lte: tomorrow,
          },
        })
        .populate('resourceId', 'name')
        .exec();

      this.logger.log(
        `Found ${upcomingBookings.length} bookings starting in next 24 hours`,
      );

      for (const booking of upcomingBookings) {
        const user = await this.userModel.findById(booking.userId);
        if (!user) continue;

        const populatedResource = booking.resourceId as unknown as { name?: string } | null;
        const resourceName = populatedResource?.name ?? 'resource';

        await this.notificationService
          .createNotification(
            booking.userId,
            SharedNotificationType.BOOKING_REMINDER,
            'Booking reminder',
            `Your booking for "${resourceName}" starts tomorrow`,
            `/bookings/${booking._id}`,
            true,
            {
              _id: user._id.toString(),
              email: user.email,
              firstName: user.name.split(' ')[0],
              lastName: user.name.split(' ').slice(1).join(' '),
            },
          )
          .catch((error) => {
            this.logger.error(
              `Failed to create booking reminder for ${booking._id}`,
              error,
            );
          });
      }

      this.logger.log('Booking reminders task completed');
    } catch (error) {
      this.logger.error('Error in booking reminders task', error);
    }
  }

  /**
   * Booking Completion - Hourly
   * Find confirmed bookings where endDate < now and update status to 'completed'
   */
  @Cron('0 * * * *') // Every hour at minute 0
  async handleBookingCompletion() {
    this.logger.log('Running booking completion task...');
    const now = new Date();

    try {
      const result = await this.bookingModel.updateMany(
        {
          status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
          endDate: { $lt: now },
        },
        {
          $set: { status: BookingStatus.COMPLETED },
        },
      );

      this.logger.log(`Completed ${result.modifiedCount} expired bookings`);
    } catch (error) {
      this.logger.error('Error in booking completion task', error);
    }
  }

  /**
   * Expired Help Requests - Daily
   * Find open help requests older than 30 days and send reminder or auto-close
   */
  @Cron('0 0 * * *') // Every day at midnight
  async handleExpiredHelpRequests() {
    this.logger.log('Running expired help requests task...');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      const expiredRequests = await this.helpRequestModel.find({
        status: HelpRequestStatus.OPEN,
        createdAt: { $lt: thirtyDaysAgo },
      });

      this.logger.log(`Found ${expiredRequests.length} expired help requests`);

      for (const request of expiredRequests) {
        const requester = await this.userModel.findById(request.requesterId);
        if (!requester) continue;

        // Send reminder notification
        await this.notificationModel
          .create({
            userId: request.requesterId,
            type: NotificationType.HELP_REQUEST,
            title: 'Help Request Reminder',
            message: `Your help request "${request.title}" is still open after 30 days. Consider updating or closing it.`,
            linkTo: `/sharing/help-requests/${request._id}`,
            relatedId: request._id,
            relatedType: 'help-request',
            isRead: false,
          })
          .catch((error) => {
            this.logger.error(
              `Failed to create reminder for help request ${request._id}`,
              error,
            );
          });

        // Optionally auto-close after reminder (commented out - can be enabled)
        // request.status = HelpRequestStatus.CANCELLED;
        // await request.save();
      }

      this.logger.log('Expired help requests task completed');
    } catch (error) {
      this.logger.error('Error in expired help requests task', error);
    }
  }

  /**
   * Cleanup Old Notifications - Weekly (Sunday at 2 AM)
   * Delete read notifications older than 90 days
   */
  @Cron('0 2 * * 0') // Every Sunday at 2 AM
  async handleCleanupOldNotifications() {
    this.logger.log('Running cleanup old notifications task...');
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    try {
      const result = await this.notificationModel.deleteMany({
        isRead: true,
        createdAt: { $lt: ninetyDaysAgo },
      });

      this.logger.log(`Deleted ${result.deletedCount} old read notifications`);
    } catch (error) {
      this.logger.error('Error in cleanup old notifications task', error);
    }
  }

  /**
   * Usage Statistics - Daily (at 1 AM)
   * Calculate daily active users, booking statistics, and post engagement metrics
   */
  @Cron('0 1 * * *') // Daily at 1 AM
  async handleUsageStatistics() {
    this.logger.log('Running usage statistics task...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      // Daily active users (users who logged in yesterday)
      const dailyActiveUsers = await this.userModel.countDocuments({
        lastLoginAt: {
          $gte: yesterday,
          $lt: today,
        },
      });

      // Booking statistics
      const totalBookings = await this.bookingModel.countDocuments({
        createdAt: {
          $gte: yesterday,
          $lt: today,
        },
      });

      const confirmedBookings = await this.bookingModel.countDocuments({
        status: BookingStatus.CONFIRMED,
        createdAt: {
          $gte: yesterday,
          $lt: today,
        },
      });

      const completedBookings = await this.bookingModel.countDocuments({
        status: BookingStatus.COMPLETED,
        createdAt: {
          $gte: yesterday,
          $lt: today,
        },
      });

      // Post engagement metrics
      const totalPosts = await this.postModel.countDocuments({
        createdAt: {
          $gte: yesterday,
          $lt: today,
        },
      });

      const totalComments = await this.commentModel.countDocuments({
        createdAt: {
          $gte: yesterday,
          $lt: today,
        },
      });

      // Log statistics (can be stored in analytics collection if needed)
      this.logger.log('Daily Usage Statistics:');
      this.logger.log(`- Daily Active Users: ${dailyActiveUsers}`);
      this.logger.log(`- Total Bookings: ${totalBookings}`);
      this.logger.log(`- Confirmed Bookings: ${confirmedBookings}`);
      this.logger.log(`- Completed Bookings: ${completedBookings}`);
      this.logger.log(`- Total Posts: ${totalPosts}`);
      this.logger.log(`- Total Comments: ${totalComments}`);

      // TODO: Store in analytics collection if needed
      // await this.analyticsModel.create({
      //   date: yesterday,
      //   dailyActiveUsers,
      //   bookings: { total: totalBookings, confirmed: confirmedBookings, completed: completedBookings },
      //   posts: { total: totalPosts, comments: totalComments },
      // });

      this.logger.log('Usage statistics task completed');
    } catch (error) {
      this.logger.error('Error in usage statistics task', error);
    }
  }
}

