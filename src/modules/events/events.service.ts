import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types, QueryFilter } from "mongoose";
import { Event, EventDocument, EventStatus } from "./schemas/event.schema";
import { User, UserDocument } from "../users/schemas/user.schema";
import { Group, GroupDocument } from "../groups/schemas/group.schema";
import { CreateEventDto, UpdateEventDto, EventQueryDto } from "./dto";
import { PaginatedResponseDto } from "../../common/dto/pagination.dto";
import {
  NotificationService,
  NotificationType,
} from "../../shared/services/notification.service";
import { EmailService } from "../../shared/services/email.service";
import { S3Service } from "../../shared/services/s3.service";

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectModel(Event.name)
    private readonly eventModel: Model<EventDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Group.name)
    private readonly groupModel: Model<GroupDocument>,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Create a new event
   */
  async create(
    userId: string,
    organizationId: string,
    createDto: CreateEventDto,
  ): Promise<EventDocument> {
    // Validate endDate is after startDate
    if (createDto.endDate < createDto.startDate) {
      throw new BadRequestException("End date must be after start date");
    }

    // Create event
    const event = await this.eventModel.create({
      ...createDto,
      buildingId: new Types.ObjectId(createDto.buildingId),
      organizerId: new Types.ObjectId(userId),
      organizationId: new Types.ObjectId(organizationId),
      participants: [new Types.ObjectId(userId)],
      participantsCount: 1,
    });

    this.logger.log(`Event created: ${event._id} by user ${userId}`);

    // Notify building/group/organization members about new event (EVENT_CREATED)
    const recipientIds: string[] = [];
    const organizerIdStr = userId.toString();
    if (event.groupId) {
      const group = await this.groupModel.findById(event.groupId).exec();
      if (group?.members?.length) {
        recipientIds.push(
          ...group.members
            .filter((id) => id.toString() !== organizerIdStr)
            .map((id) => id.toString()),
        );
      }
    }
    if (recipientIds.length === 0 && event.buildingId) {
      const usersInBuilding = await this.userModel
        .find({
          organizationId: new Types.ObjectId(organizationId),
          $or: [
            { buildingIds: event.buildingId },
            { primaryBuildingId: event.buildingId },
          ],
          _id: { $ne: new Types.ObjectId(userId) },
        })
        .select("_id")
        .lean()
        .exec();
      recipientIds.push(...usersInBuilding.map((u) => u._id.toString()));
    }
    if (recipientIds.length === 0 && event.isOrganizationWide) {
      const orgUsers = await this.userModel
        .find({
          organizationId: new Types.ObjectId(organizationId),
          _id: { $ne: new Types.ObjectId(userId) },
        })
        .select("_id")
        .lean()
        .exec();
      recipientIds.push(...orgUsers.map((u) => u._id.toString()));
    }
    const uniqueRecipientIds = [...new Set(recipientIds)];
    if (uniqueRecipientIds.length > 0) {
      const startDateStr = new Date(event.startDate).toLocaleDateString("nb-NO", {
        dateStyle: "short",
        timeStyle: "short",
      });
      await this.notificationService
        .createBulkNotifications(
          uniqueRecipientIds,
          NotificationType.EVENT_CREATED,
          "New event",
          `"${event.title}" - ${event.location}, ${startDateStr}`,
          `/events/${event._id}`,
          true,
        )
        .catch((err) =>
          this.logger.warn(`Failed to send new event notifications: ${err.message}`),
        );
    }

    return this.eventModel
      .findById(event._id)
      .populate("organizerId", "name avatarUrl avatarColor role")
      .populate("participants", "name avatarUrl avatarColor role")
      .exec();
  }

  /**
   * Find all events with pagination and filters
   */
  async findAll(
    organizationId: string,
    userId: string,
    query: EventQueryDto,
  ): Promise<PaginatedResponseDto<EventDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = "startDate",
      sortOrder = "asc",
      category,
      status,
      startDateFrom,
      startDateTo,
      organizerId,
      participating,
    } = query;

    const skip = (page - 1) * limit;

    // Build filter query
    const filter: QueryFilter<EventDocument> = {
      organizationId: new Types.ObjectId(organizationId),
    };

    if (category) {
      filter.category = category;
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

    if (organizerId) {
      filter.organizerId = new Types.ObjectId(organizerId);
    }

    if (participating === true) {
      filter.participants = new Types.ObjectId(userId);
    }

    // Building filter: show items for the selected building or org-wide items
    if (query.buildingId) {
      filter.$or = [
        { buildingId: new Types.ObjectId(query.buildingId) },
        { isOrganizationWide: true },
      ];
    }

    const [events, total] = await Promise.all([
      this.eventModel
        .find(filter)
        .populate("organizerId", "name avatarUrl avatarColor role")
        .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.eventModel.countDocuments(filter),
    ]);

    return new PaginatedResponseDto(events, total, page, limit);
  }

  /**
   * Find event by ID with populated organizer and participants
   */
  async findById(eventId: string): Promise<EventDocument> {
    const event = await this.eventModel
      .findById(eventId)
      .populate("organizerId", "name avatarUrl avatarColor role")
      .populate("participants", "name avatarUrl avatarColor email role")
      .exec();

    if (!event) {
      throw new NotFoundException("Event not found");
    }

    return event;
  }

  /**
   * Update event
   */
  async update(
    eventId: string,
    userId: string,
    updateDto: UpdateEventDto,
  ): Promise<EventDocument> {
    const event = await this.findById(eventId);

    // Verify user is organizer or board member
    const user = await this.userModel.findById(userId);
    const isOrganizer = event.organizerId.toString() === userId;
    const isBoard = user && ["board", "admin"].includes(user.role);

    if (!isOrganizer && !isBoard) {
      throw new ForbiddenException(
        "Only the organizer or board members can update this event",
      );
    }

    // Check if date changed
    const dateChanged =
      (updateDto.startDate &&
        updateDto.startDate.getTime() !== event.startDate.getTime()) ||
      (updateDto.endDate &&
        updateDto.endDate.getTime() !== event.endDate.getTime());

    // Validate endDate if both dates are provided
    if (updateDto.startDate && updateDto.endDate) {
      if (updateDto.endDate < updateDto.startDate) {
        throw new BadRequestException("End date must be after start date");
      }
    }

    const updatedEvent = await this.eventModel
      .findByIdAndUpdate(eventId, { $set: updateDto }, { new: true })
      .populate("organizerId", "name avatarUrl avatarColor role")
      .populate("participants", "name avatarUrl avatarColor role")
      .exec();

    // Notify participants if date changed
    if (dateChanged && event.participants.length > 0) {
      const participantIds = event.participants.map((p) => p.toString());
      const participants = await this.userModel.find({
        _id: { $in: participantIds },
      });

      await this.notificationService
        .createBulkNotifications(
          participantIds,
          NotificationType.EVENT_UPDATED,
          "Event date changed",
          `The event "${event.title}" has been updated`,
          `/events/${eventId}`,
          true,
          participants.map((p) => ({
            _id: p._id.toString(),
            email: p.email,
            firstName: p.name.split(" ")[0],
            lastName: p.name.split(" ").slice(1).join(" "),
          })),
        )
        .catch((error) => {
          this.logger.error("Failed to send update notifications", error);
        });
    }

    this.logger.log(`Event updated: ${eventId}`);
    return updatedEvent;
  }

  /**
   * Delete event
   */
  async delete(eventId: string, userId: string): Promise<void> {
    const event = await this.findById(eventId);

    // Verify user is organizer or board member
    const user = await this.userModel.findById(userId);
    const isOrganizer = event.organizerId.toString() === userId;
    const isBoard = user && ["board", "admin"].includes(user.role);

    if (!isOrganizer && !isBoard) {
      throw new ForbiddenException(
        "Only the organizer or board members can delete this event",
      );
    }

    // Notify participants
    if (event.participants.length > 0) {
      const participantIds = event.participants.map((p) => p._id.toString());
      const participants = await this.userModel.find({
        _id: { $in: participantIds },
      });

      await this.notificationService
        .createBulkNotifications(
          participantIds,
          NotificationType.EVENT_CANCELLED,
          "Event cancelled",
          `The event "${event.title}" has been cancelled`,
          `/events`,
          true,
          participants.map((p) => ({
            _id: p._id.toString(),
            email: p.email,
            firstName: p.name.split(" ")[0],
            lastName: p.name.split(" ").slice(1).join(" "),
          })),
        )
        .catch((error) => {
          this.logger.error("Failed to send cancellation notifications", error);
        });
    }

    // Delete event
    await this.eventModel.deleteOne({ _id: eventId });

    this.logger.log(`Event deleted: ${eventId}`);
  }

  /**
   * Cancel event
   */
  async cancel(eventId: string, userId: string): Promise<EventDocument> {
    const event = await this.findById(eventId);

    // Verify user is organizer or board member
    const user = await this.userModel.findById(userId);
    const isOrganizer = event.organizerId.toString() === userId;
    const isBoard = user && ["board", "admin"].includes(user.role);

    if (!isOrganizer && !isBoard) {
      throw new ForbiddenException(
        "Only the organizer or board members can cancel this event",
      );
    }

    // Update status
    event.status = EventStatus.CANCELLED;
    await event.save();

    // Notify participants
    if (event.participants.length > 0) {
      const participantIds = event.participants.map((p) => p.toString());
      const participants = await this.userModel.find({
        _id: { $in: participantIds },
      });

      await this.notificationService
        .createBulkNotifications(
          participantIds,
          NotificationType.EVENT_CANCELLED,
          "Event cancelled",
          `The event "${event.title}" has been cancelled`,
          `/events/${eventId}`,
          true,
          participants.map((p) => ({
            _id: p._id.toString(),
            email: p.email,
            firstName: p.name.split(" ")[0],
            lastName: p.name.split(" ").slice(1).join(" "),
          })),
        )
        .catch((error) => {
          this.logger.error("Failed to send cancellation notifications", error);
        });
    }

    this.logger.log(`Event cancelled: ${eventId}`);

    return this.eventModel
      .findById(eventId)
      .populate("organizerId", "name avatarUrl avatarColor role")
      .populate("participants", "name avatarUrl avatarColor role")
      .exec();
  }

  /**
   * Join event
   */
  async join(eventId: string, userId: string): Promise<EventDocument> {
    const event = await this.findById(eventId);

    // Check if event is cancelled
    if (event.status === EventStatus.CANCELLED) {
      throw new BadRequestException("Cannot join a cancelled event");
    }

    // Check if already participating
    const isParticipating = event.participants.some(
      (p) => p.toString() === userId,
    );
    if (isParticipating) {
      throw new BadRequestException("Already participating in this event");
    }

    // Check max participants
    if (
      event.maxParticipants > 0 &&
      event.participantsCount >= event.maxParticipants
    ) {
      throw new BadRequestException("Event is full");
    }

    // Add user to participants
    event.participants.push(new Types.ObjectId(userId));
    event.participantsCount = event.participants.length;
    await event.save();

    // Send confirmation notification
    const user = await this.userModel.findById(userId);
    if (user) {
      await this.notificationService
        .createNotification(
          userId,
          NotificationType.EVENT_CREATED,
          "Event registration confirmed",
          `You've successfully registered for "${event.title}"`,
          `/events/${eventId}`,
          true,
          {
            _id: user._id.toString(),
            email: user.email,
            firstName: user.name.split(" ")[0],
            lastName: user.name.split(" ").slice(1).join(" "),
          },
        )
        .catch((error) => {
          this.logger.error("Failed to send join confirmation", error);
        });
    }

    this.logger.log(`User ${userId} joined event ${eventId}`);

    return this.eventModel
      .findById(eventId)
      .populate("organizerId", "name avatarUrl avatarColor role")
      .populate("participants", "name avatarUrl avatarColor role")
      .exec();
  }

  /**
   * Leave event
   */
  async leave(eventId: string, userId: string): Promise<EventDocument> {
    const event = await this.findById(eventId);

    // Check if participating
    const isParticipating = event.participants.some(
      (p) => p._id.toString() === userId,
    );
    if (!isParticipating) {
      throw new BadRequestException("Not participating in this event");
    }

    // Remove user from participants
    event.participants = event.participants.filter(
      (p) => p._id.toString() !== userId,
    );
    event.participantsCount = event.participants.length;
    await event.save();

    this.logger.log(`User ${userId} left event ${eventId}`);

    return this.eventModel
      .findById(eventId)
      .populate("organizerId", "name avatarUrl avatarColor role")
      .populate("participants", "name avatarUrl avatarColor role")
      .exec();
  }

  /**
   * Get participants for an event
   */
  async getParticipants(eventId: string): Promise<UserDocument[]> {
    const event = await this.findById(eventId);

    return this.userModel
      .find({
        _id: { $in: event.participants },
      })
      .select("name email avatarUrl avatarColor")
      .exec();
  }

  /**
   * Get upcoming events
   */
  async getUpcoming(
    organizationId: string,
    limit: number = 5,
  ): Promise<EventDocument[]> {
    const now = new Date();

    return this.eventModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        status: EventStatus.UPCOMING,
        startDate: { $gte: now },
      })
      .populate("organizerId", "name avatarUrl avatarColor role")
      .sort({ startDate: 1 })
      .limit(limit)
      .exec();
  }

  /**
   * Send reminders for events starting in 24 hours
   */
  async sendReminders(): Promise<void> {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcomingEvents = await this.eventModel
      .find({
        status: EventStatus.UPCOMING,
        startDate: {
          $gte: now,
          $lte: tomorrow,
        },
      })
      .populate("participants", "name email")
      .exec();

    this.logger.log(`Sending reminders for ${upcomingEvents.length} events`);

    for (const event of upcomingEvents) {
      if (event.participants.length === 0) continue;

      const participantIds = event.participants.map((p) => p.toString());
      const participants = await this.userModel.find({
        _id: { $in: participantIds },
      });

      // Send notifications
      await this.notificationService
        .createBulkNotifications(
          participantIds,
          NotificationType.EVENT_REMINDER,
          "Event reminder",
          `Reminder: "${event.title}" starts tomorrow`,
          `/events/${event._id}`,
          true,
          participants.map((p) => ({
            _id: p._id.toString(),
            email: p.email,
            firstName: p.name.split(" ")[0],
            lastName: p.name.split(" ").slice(1).join(" "),
          })),
        )
        .catch((error) => {
          this.logger.error(
            `Failed to send reminders for event ${event._id}`,
            error,
          );
        });

      // Send email reminders
      for (const participant of participants) {
        await this.emailService
          .sendEventReminder(
            {
              _id: participant._id.toString(),
              email: participant.email,
              firstName: participant.name.split(" ")[0],
              lastName: participant.name.split(" ").slice(1).join(" "),
            },
            {
              _id: event._id.toString(),
              title: event.title,
              startDate: event.startDate,
              location: event.location,
            },
          )
          .catch((error) => {
            this.logger.error(
              `Failed to send email reminder to ${participant.email}`,
              error,
            );
          });
      }
    }
  }
}
