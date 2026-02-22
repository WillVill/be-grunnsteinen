import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, QueryFilter } from 'mongoose';
import { Booking, BookingDocument, BookingStatus } from './schemas/booking.schema';
import { Resource, ResourceDocument } from '../resources/schemas/resource.schema';
import { User, UserDocument, UserRole, isBoardOrAbove } from '../users/schemas/user.schema';
import {
  CreateBookingDto,
  UpdateBookingDto,
  CancelBookingDto,
  BookingQueryDto,
} from './dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import {
  NotificationService,
  NotificationType,
} from '../../shared/services/notification.service';
import { EmailService, EmailUser } from '../../shared/services/email.service';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Resource.name)
    private readonly resourceModel: Model<ResourceDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Create a new booking
   */
  async create(
    userId: string,
    orgId: string,
    dto: CreateBookingDto,
  ): Promise<BookingDocument> {
    // Fetch resource
    const resource = await this.resourceModel.findById(dto.resourceId);
    if (!resource) {
      throw new NotFoundException('Resource not found');
    }

    // Verify resource belongs to organization
    if (resource.organizationId.toString() !== orgId) {
      throw new ForbiddenException('Resource does not belong to your organization');
    }

    // Verify resource is active
    if (!resource.isActive) {
      throw new BadRequestException('Resource is not active');
    }

    // Validate availability
    const isAvailable = await this.checkAvailability(
      dto.resourceId,
      dto.startDate,
      dto.endDate,
    );
    if (!isAvailable) {
      throw new BadRequestException(
        'Resource is not available for the selected dates',
      );
    }

    // Calculate total price
    const totalPrice = this.calculatePrice(
      resource,
      dto.startDate,
      dto.endDate,
    );

    // Determine initial status based on requiresApproval
    const initialStatus = resource.requiresApproval
      ? BookingStatus.PENDING
      : BookingStatus.CONFIRMED;

    // Create booking – buildingId is derived from the resource
    const booking = await this.bookingModel.create({
      organizationId: new Types.ObjectId(orgId),
      resourceId: new Types.ObjectId(dto.resourceId),
      buildingId: resource.buildingId,
      userId: new Types.ObjectId(userId),
      startDate: dto.startDate,
      endDate: dto.endDate,
      status: initialStatus,
      totalPrice,
      currency: resource.currency,
      notes: dto.notes,
    });

    this.logger.log(`Booking created: ${booking._id} by user ${userId}`);

    // Populate booking for response
    const populatedBooking = await this.bookingModel
      .findById(booking._id)
      .populate('resourceId', 'name type')
      .populate('userId', 'name email')
      .exec();

    // Send confirmation email and notification
    const user = await this.userModel.findById(userId);
    if (user) {
      const emailUser: EmailUser = {
        _id: user._id.toString(),
        email: user.email,
        firstName: user.name.split(' ')[0],
        lastName: user.name.split(' ').slice(1).join(' ') || '',
      };

      if (initialStatus === BookingStatus.CONFIRMED) {
        // Send confirmation email
        await this.emailService
          .sendBookingConfirmation(emailUser, {
            _id: booking._id.toString(),
            resource: { name: resource.name },
            startTime: dto.startDate,
            endTime: dto.endDate,
          })
          .catch((error) => {
            this.logger.error('Failed to send booking confirmation email', error);
          });

        // Create notification
        await this.notificationService
          .createNotification(
            userId,
            NotificationType.BOOKING_CONFIRMED,
            'Booking confirmed',
            `Your booking for "${resource.name}" has been confirmed`,
            `/bookings/${booking._id}`,
            false,
            emailUser,
          )
          .catch((error) => {
            this.logger.error('Failed to create booking notification', error);
          });
      } else {
        // Send pending notification
        await this.notificationService
          .createNotification(
            userId,
            NotificationType.BOOKING_CONFIRMED,
            'Booking pending approval',
            `Your booking for "${resource.name}" is pending approval`,
            `/bookings/${booking._id}`,
            false,
            emailUser,
          )
          .catch((error) => {
            this.logger.error('Failed to create booking notification', error);
          });
      }
    }

    return populatedBooking!;
  }

  /**
   * Find all bookings with pagination and filters
   */
  async findAll(
    orgId: string,
    userId: string,
    query: BookingQueryDto,
    isBoard: boolean,
  ): Promise<PaginatedResponseDto<BookingDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'startDate',
      sortOrder = 'desc',
      resourceId,
      status,
      startDateFrom,
      startDateTo,
      userId: filterUserId,
    } = query;

    const skip = (page - 1) * limit;

    // Build filter query
    const filter: QueryFilter<BookingDocument> = {
      organizationId: new Types.ObjectId(orgId),
    };

    // Board can see all, users see only their own
    if (!isBoard) {
      filter.userId = new Types.ObjectId(userId);
    } else if (filterUserId) {
      filter.userId = new Types.ObjectId(filterUserId);
    }

    if (resourceId) {
      filter.resourceId = new Types.ObjectId(resourceId);
    }

    if (status) {
      filter.status = status;
    }

    // Building filter
    if (query.buildingId) {
      filter.buildingId = new Types.ObjectId(query.buildingId);
    }

    if (startDateFrom || startDateTo) {
      filter.startDate = {};
      if (startDateFrom) {
        filter.startDate.$gte = startDateFrom;
      }
      if (startDateTo) {
        filter.startDate.$lte = startDateTo;
      }
    }

    const [bookings, total] = await Promise.all([
      this.bookingModel
        .find(filter)
        .populate('resourceId', 'name type')
        .populate('userId', 'name email avatarUrl avatarColor')
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.bookingModel.countDocuments(filter),
    ]);

    return new PaginatedResponseDto(bookings, total, page, limit);
  }

  /**
   * Find booking by ID with access verification
   */
  async findById(
    bookingId: string,
    userId: string,
    isBoard: boolean,
  ): Promise<BookingDocument> {
    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('resourceId', 'name type description imageUrls')
      .populate('userId', 'name email avatarUrl avatarColor')
      .populate('cancelledBy', 'name email')
      .exec();

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Verify access rights
    const isOwner = booking.userId.toString() === userId;
    if (!isOwner && !isBoard) {
      throw new ForbiddenException('You do not have access to this booking');
    }

    return booking;
  }

  /**
   * Find current user's bookings
   */
  async findUserBookings(
    userId: string,
    query: BookingQueryDto,
  ): Promise<PaginatedResponseDto<BookingDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'startDate',
      sortOrder = 'desc',
      resourceId,
      status,
      startDateFrom,
      startDateTo,
    } = query;

    const skip = (page - 1) * limit;

    // Build filter query
    const filter: QueryFilter<BookingDocument> = {
      userId: new Types.ObjectId(userId),
    };

    if (resourceId) {
      filter.resourceId = new Types.ObjectId(resourceId);
    }

    if (status) {
      filter.status = status;
    }

    if (startDateFrom || startDateTo) {
      filter.startDate = {};
      if (startDateFrom) {
        filter.startDate.$gte = startDateFrom;
      }
      if (startDateTo) {
        filter.startDate.$lte = startDateTo;
      }
    }

    const [bookings, total] = await Promise.all([
      this.bookingModel
        .find(filter)
        .populate('resourceId', 'name type')
        .populate('userId', 'name email avatarUrl avatarColor')
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.bookingModel.countDocuments(filter),
    ]);

    return new PaginatedResponseDto(bookings, total, page, limit);
  }

  /**
   * Approve booking (board only)
   */
  async approve(
    bookingId: string,
    adminId: string,
  ): Promise<BookingDocument> {
    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException('Only pending bookings can be approved');
    }

    // Update status
    booking.status = BookingStatus.CONFIRMED;
    await booking.save();

    this.logger.log(`Booking approved: ${bookingId} by admin ${adminId}`);

    // Notify user
    const user = await this.userModel.findById(booking.userId);
    const resource = await this.resourceModel.findById(booking.resourceId);
    if (user && resource) {
      const emailUser: EmailUser = {
        _id: user._id.toString(),
        email: user.email,
        firstName: user.name.split(' ')[0],
        lastName: user.name.split(' ').slice(1).join(' ') || '',
      };

      // Send confirmation email
      await this.emailService
        .sendBookingConfirmation(emailUser, {
          _id: booking._id.toString(),
          resource: { name: resource.name },
          startTime: booking.startDate,
          endTime: booking.endDate,
        })
        .catch((error) => {
          this.logger.error('Failed to send approval email', error);
        });

      // Create notification
      await this.notificationService
        .createNotification(
          booking.userId.toString(),
          NotificationType.BOOKING_CONFIRMED,
          'Booking approved',
          `Your booking for "${resource.name}" has been approved`,
          `/bookings/${bookingId}`,
          true,
          emailUser,
        )
        .catch((error) => {
          this.logger.error('Failed to create approval notification', error);
        });
    }

    return this.bookingModel
      .findById(bookingId)
      .populate('resourceId', 'name type')
      .populate('userId', 'name email avatarUrl avatarColor')
      .exec() as Promise<BookingDocument>;
  }

  /**
   * Reject booking (board only)
   */
  async reject(
    bookingId: string,
    adminId: string,
    reason?: string,
  ): Promise<BookingDocument> {
    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException('Only pending bookings can be rejected');
    }

    // Update status
    booking.status = BookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    booking.cancelledBy = new Types.ObjectId(adminId);
    booking.cancellationReason = reason || 'Rejected by administrator';
    await booking.save();

    this.logger.log(`Booking rejected: ${bookingId} by admin ${adminId}`);

    // Notify user
    const user = await this.userModel.findById(booking.userId);
    const resource = await this.resourceModel.findById(booking.resourceId);
    if (user && resource) {
      const emailUser: EmailUser = {
        _id: user._id.toString(),
        email: user.email,
        firstName: user.name.split(' ')[0],
        lastName: user.name.split(' ').slice(1).join(' ') || '',
      };

      // Send cancellation email
      await this.emailService
        .sendBookingCancellation(emailUser, {
          _id: booking._id.toString(),
          resource: { name: resource.name },
          startTime: booking.startDate,
          endTime: booking.endDate,
        })
        .catch((error) => {
          this.logger.error('Failed to send rejection email', error);
        });

      // Create notification
      await this.notificationService
        .createNotification(
          booking.userId.toString(),
          NotificationType.BOOKING_CANCELLED,
          'Booking rejected',
          `Your booking for "${resource.name}" has been rejected${reason ? `: ${reason}` : ''}`,
          `/bookings/${bookingId}`,
          true,
          emailUser,
        )
        .catch((error) => {
          this.logger.error('Failed to create rejection notification', error);
        });
    }

    return this.bookingModel
      .findById(bookingId)
      .populate('resourceId', 'name type')
      .populate('userId', 'name email avatarUrl avatarColor')
      .exec() as Promise<BookingDocument>;
  }

  /**
   * Cancel booking
   */
  async cancel(
    bookingId: string,
    userId: string,
    reason?: string,
  ): Promise<BookingDocument> {
    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Check if user can cancel (owner or board)
    const user = await this.userModel.findById(userId);
    const isOwner = booking.userId.toString() === userId;
    const isBoard = user && isBoardOrAbove(user.role);

    if (!isOwner && !isBoard) {
      throw new ForbiddenException('You do not have permission to cancel this booking');
    }

    // Check if booking can be cancelled
    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('Booking is already cancelled');
    }

    if (booking.status === BookingStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed booking');
    }

    // Update status
    booking.status = BookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    booking.cancelledBy = new Types.ObjectId(userId);
    booking.cancellationReason = reason;
    await booking.save();

    this.logger.log(`Booking cancelled: ${bookingId} by user ${userId}`);

    // Notify relevant parties
    const resource = await this.resourceModel.findById(booking.resourceId);
    const bookingUser = await this.userModel.findById(booking.userId);
    
    if (bookingUser && resource) {
      const emailUser: EmailUser = {
        _id: bookingUser._id.toString(),
        email: bookingUser.email,
        firstName: bookingUser.name.split(' ')[0],
        lastName: bookingUser.name.split(' ').slice(1).join(' ') || '',
      };

      // Send cancellation email
      await this.emailService
        .sendBookingCancellation(emailUser, {
          _id: booking._id.toString(),
          resource: { name: resource.name },
          startTime: booking.startDate,
          endTime: booking.endDate,
        })
        .catch((error) => {
          this.logger.error('Failed to send cancellation email', error);
        });

      // Create notification
      await this.notificationService
        .createNotification(
          booking.userId.toString(),
          NotificationType.BOOKING_CANCELLED,
          'Booking cancelled',
          `Your booking for "${resource.name}" has been cancelled${reason ? `: ${reason}` : ''}`,
          `/bookings/${bookingId}`,
          true,
          emailUser,
        )
        .catch((error) => {
          this.logger.error('Failed to create cancellation notification', error);
        });
    }

    return this.bookingModel
      .findById(bookingId)
      .populate('resourceId', 'name type')
      .populate('userId', 'name email avatarUrl avatarColor')
      .populate('cancelledBy', 'name email')
      .exec() as Promise<BookingDocument>;
  }

  /**
   * Update booking
   */
  async update(
    bookingId: string,
    userId: string,
    isBoard: boolean,
    dto: UpdateBookingDto,
  ): Promise<BookingDocument> {
    const booking = await this.findById(bookingId, userId, isBoard);

    // Users can only update notes, board can update adminNotes
    const updateData: Partial<BookingDocument> = {};
    if (dto.notes !== undefined) {
      updateData.notes = dto.notes;
    }
    if (isBoard && dto.adminNotes !== undefined) {
      updateData.adminNotes = dto.adminNotes;
    }

    const updatedBooking = await this.bookingModel.findByIdAndUpdate(
      bookingId,
      { $set: updateData },
      { new: true },
    )
      .populate('resourceId', 'name type')
      .populate('userId', 'name email avatarUrl avatarColor')
      .exec();

    this.logger.log(`Booking updated: ${bookingId}`);
    return updatedBooking!;
  }

  /**
   * Check availability for a resource
   */
  async checkAvailability(
    resourceId: string,
    startDate: Date,
    endDate: Date,
    excludeBookingId?: string,
  ): Promise<boolean> {
    // Build query for overlapping confirmed bookings
    const overlapQuery: QueryFilter<BookingDocument> = {
      resourceId: new Types.ObjectId(resourceId),
      status: BookingStatus.CONFIRMED,
      $or: [
        // Booking starts before our end date and ends after our start date
        {
          startDate: { $lt: endDate },
          endDate: { $gt: startDate },
        },
      ],
    };

    if (excludeBookingId) {
      overlapQuery._id = { $ne: new Types.ObjectId(excludeBookingId) };
    }

    const overlappingBooking = await this.bookingModel.findOne(overlapQuery);
    return !overlappingBooking;
  }

  /**
   * Get bookings for a resource within a date range (for availability calendar)
   */
  async getResourceBookings(
    resourceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<BookingDocument[]> {
    return this.bookingModel
      .find({
        resourceId: new Types.ObjectId(resourceId),
        status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
        $or: [
          {
            startDate: { $lte: endDate },
            endDate: { $gte: startDate },
          },
        ],
      })
      .populate('userId', 'name')
      .sort({ startDate: 1 })
      .exec();
  }

  /**
   * Complete expired bookings (cron job)
   */
  async completeExpiredBookings(): Promise<void> {
    const now = new Date();

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
  }

  /**
   * Calculate total price for a booking
   */
  private calculatePrice(
    resource: ResourceDocument,
    startDate: Date,
    endDate: Date,
  ): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffMs = end.getTime() - start.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    // If resource has hourly pricing and booking is less than a day
    if (resource.pricePerHour && diffHours < 24) {
      return Math.ceil(diffHours) * resource.pricePerHour;
    }

    // Otherwise use daily pricing
    return diffDays * resource.pricePerDay;
  }
}

