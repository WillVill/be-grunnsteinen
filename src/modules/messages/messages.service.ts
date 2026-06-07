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
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';
import {
  User,
  UserDocument,
  UserRole,
  isAdminRole,
} from '../users/schemas/user.schema';
import { CreateMessageDto, ConversationQueryDto, MessageQueryDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import {
  NotificationService,
  NotificationType,
} from '../../shared/services/notification.service';
import { EmailService, EmailUser } from '../../shared/services/email.service';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Get or create a conversation between two users
   */
  async getOrCreateConversation(
    userId: string,
    recipientId: string,
    orgId: string,
  ): Promise<ConversationDocument> {
    if (userId === recipientId) {
      throw new BadRequestException('Cannot create conversation with yourself');
    }

    // Verify recipient exists and is in same organization
    const recipient = await this.userModel.findById(recipientId);
    if (!recipient) {
      throw new NotFoundException('Recipient not found');
    }

    if (recipient.organizationId.toString() !== orgId) {
      throw new ForbiddenException('Recipient is not in your organization');
    }

    // Sort participant IDs to ensure consistent ordering
    const participantIds = [userId, recipientId]
      .map((id) => new Types.ObjectId(id))
      .sort((a, b) => a.toString().localeCompare(b.toString()));

    // Try to find existing conversation
    let conversation = await this.conversationModel.findOne({
      organizationId: new Types.ObjectId(orgId),
      participants: { $all: participantIds, $size: 2 },
    });

    // Create new conversation if not found
    if (!conversation) {
      conversation = await this.conversationModel.create({
        organizationId: new Types.ObjectId(orgId),
        participants: participantIds,
        unreadCount: new Map<string, number>(),
      });

      this.logger.log(
        `Conversation created: ${conversation._id} between ${userId} and ${recipientId}`,
      );
    }

    return conversation;
  }

  private toEmailUser(user: UserDocument): EmailUser {
    return {
      _id: user._id.toString(),
      email: user.email,
      firstName: (user.name || '').split(' ')[0],
      lastName: (user.name || '').split(' ').slice(1).join(' ') || '',
    };
  }

  /**
   * Can this user read/reply to the conversation? Participants always can.
   * For support threads, eligible staff can too (admins anywhere; board for the
   * Grunnsteinen channel; host/caretaker for the husvert channel in their building).
   */
  private async canAccessConversation(
    conversation: ConversationDocument,
    userId: string,
  ): Promise<boolean> {
    const isParticipant = conversation.participants.some(
      (p: any) => (p?._id ?? p).toString() === userId,
    );
    if (isParticipant) return true;
    if (conversation.type !== 'support') return false;

    const user = await this.userModel
      .findById(userId)
      .select('role buildingIds primaryBuildingId')
      .lean()
      .exec();
    if (!user) return false;
    if (isAdminRole(user.role)) return true;
    if (conversation.supportChannel === 'grunnsteinen') {
      return user.role === UserRole.BOARD;
    }
    if (conversation.supportChannel === 'husvert') {
      const inBuilding =
        !!conversation.buildingId &&
        [
          ...(user.buildingIds || []).map((b) => b.toString()),
          user.primaryBuildingId?.toString(),
        ].includes(conversation.buildingId.toString());
      return (
        (user.role === UserRole.HOST || user.role === UserRole.CARETAKER) &&
        inBuilding
      );
    }
    return false;
  }

  /**
   * Staff who should be notified of a new resident message on a support thread.
   * Grunnsteinen → admins + board (org-wide). Husvert → host/caretaker in building.
   */
  private async getSupportStaff(
    conversation: ConversationDocument,
  ): Promise<UserDocument[]> {
    const orgId = conversation.organizationId;
    if (conversation.supportChannel === 'grunnsteinen') {
      return this.userModel
        .find({
          organizationId: orgId,
          role: { $in: [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.BOARD] },
          isActive: true,
        })
        .exec();
    }
    // husvert
    const buildingFilter = conversation.buildingId
      ? {
          $or: [
            { buildingIds: conversation.buildingId },
            { primaryBuildingId: conversation.buildingId },
          ],
        }
      : {};
    return this.userModel
      .find({
        organizationId: orgId,
        role: { $in: [UserRole.HOST, UserRole.CARETAKER] },
        isActive: true,
        ...buildingFilter,
      })
      .exec();
  }

  /**
   * Get (or lazily create) a resident's support thread for a channel.
   */
  async getOrCreateSupportConversation(
    userId: string,
    orgId: string,
    channel: 'grunnsteinen' | 'husvert',
  ): Promise<ConversationDocument> {
    const existing = await this.conversationModel.findOne({
      organizationId: new Types.ObjectId(orgId),
      type: 'support',
      supportChannel: channel,
      participants: new Types.ObjectId(userId),
    });
    if (existing) return existing;

    const resident = await this.userModel
      .findById(userId)
      .select('primaryBuildingId buildingIds')
      .lean()
      .exec();
    const buildingId =
      resident?.primaryBuildingId ?? resident?.buildingIds?.[0];

    // Husvert support is building-scoped (staff eligibility + the building queue
    // both key off buildingId). Without a building the thread would be invisible
    // to staff and over-notify, so require one.
    if (channel === 'husvert' && !buildingId) {
      throw new BadRequestException(
        'Du må være tilknyttet en bygning for å kontakte husvert',
      );
    }

    try {
      return await this.conversationModel.create({
        organizationId: new Types.ObjectId(orgId),
        participants: [new Types.ObjectId(userId)],
        type: 'support',
        supportChannel: channel,
        buildingId,
        unreadCount: new Map<string, number>(),
      });
    } catch (err: any) {
      // Concurrent first message: the partial unique index rejected the second
      // create. Re-fetch the thread the other request created.
      if (err?.code === 11000) {
        const conv = await this.conversationModel.findOne({
          organizationId: new Types.ObjectId(orgId),
          type: 'support',
          supportChannel: channel,
          participants: new Types.ObjectId(userId),
        });
        if (conv) return conv;
      }
      throw err;
    }
  }

  /**
   * Resident sends a message to Grunnsteinen / husvert (creates the thread if needed).
   */
  async sendSupportMessage(
    userId: string,
    orgId: string,
    channel: 'grunnsteinen' | 'husvert',
    content: string,
  ): Promise<MessageDocument> {
    const conversation = await this.getOrCreateSupportConversation(
      userId,
      orgId,
      channel,
    );
    return this.appendMessage(conversation, userId, content);
  }

  /**
   * Send a message
   */
  async sendMessage(
    userId: string,
    orgId: string,
    dto: CreateMessageDto,
  ): Promise<MessageDocument> {
    let conversation: ConversationDocument;

    // Get or create conversation
    if (dto.conversationId) {
      conversation = await this.conversationModel.findById(dto.conversationId);
      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      // Participants always allowed; eligible staff allowed on support threads
      const allowed = await this.canAccessConversation(conversation, userId);
      if (!allowed) {
        throw new ForbiddenException('You are not a participant in this conversation');
      }

      // Verify conversation belongs to organization
      if (conversation.organizationId.toString() !== orgId) {
        throw new ForbiddenException('Conversation does not belong to your organization');
      }
    } else if (dto.recipientId) {
      conversation = await this.getOrCreateConversation(
        userId,
        dto.recipientId,
        orgId,
      );
    } else {
      throw new BadRequestException('Either recipientId or conversationId must be provided');
    }

    return this.appendMessage(conversation, userId, dto.content);
  }

  /**
   * Create a message in a conversation, update unread/preview, and notify.
   * Handles both direct (1-to-1) and support (resident ↔ staff pool) threads.
   */
  private async appendMessage(
    conversation: ConversationDocument,
    userId: string,
    content: string,
  ): Promise<MessageDocument> {
    const message = await this.messageModel.create({
      conversationId: conversation._id,
      senderId: new Types.ObjectId(userId),
      content,
      isRead: false,
    });

    const preview =
      content.length > 200 ? content.substring(0, 200) + '...' : content;
    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = preview;

    const sender = await this.userModel.findById(userId);

    if (conversation.type === 'support') {
      const residentId = conversation.participants[0]?.toString();
      if (!residentId) {
        throw new BadRequestException('Invalid support conversation');
      }
      const channelLabel =
        conversation.supportChannel === 'grunnsteinen'
          ? 'Grunnsteinen'
          : 'Leva (husvert)';

      if (userId === residentId) {
        // Resident → staff pool. Staff-side unread is tracked via message read
        // flags in the support queue, so no unreadCount map change here.
        await conversation.save();
        const staff = await this.getSupportStaff(conversation);
        if (staff.length) {
          const link = conversation.buildingId
            ? `/admin/buildings/${conversation.buildingId.toString()}?tab=henvendelser`
            : '/admin';
          await this.notificationService
            .createBulkNotifications(
              staff.map((s) => s._id.toString()),
              NotificationType.MESSAGE_RECEIVED,
              `Ny henvendelse (${channelLabel})`,
              `${sender?.name || 'Beboer'}: ${preview}`,
              link,
              true,
              staff.map((s) => this.toEmailUser(s)),
            )
            .catch((error) =>
              this.logger.error('Failed to notify support staff', error),
            );
        }
      } else {
        // Staff → resident. Bump the resident's unread and notify them.
        const current = conversation.unreadCount.get(residentId) || 0;
        conversation.unreadCount.set(residentId, current + 1);
        await conversation.save();
        const resident = await this.userModel.findById(residentId);
        if (resident) {
          await this.notificationService
            .createNotification(
              residentId,
              NotificationType.MESSAGE_RECEIVED,
              `Svar fra ${channelLabel}`,
              preview,
              `/messages/${conversation._id}`,
              true,
              this.toEmailUser(resident),
            )
            .catch((error) =>
              this.logger.error('Failed to notify resident', error),
            );
        }
      }

      this.logger.log(
        `Support message sent: ${message._id} in conversation ${conversation._id}`,
      );
      return this.messageModel
        .findById(message._id)
        .populate('senderId', 'name avatarUrl avatarColor role')
        .exec() as Promise<MessageDocument>;
    }

    // Direct 1-to-1 conversation
    const recipientId = conversation.participants
      .find((p) => p.toString() !== userId)
      ?.toString();
    if (!recipientId) {
      throw new BadRequestException('Invalid conversation participants');
    }
    const currentUnread = conversation.unreadCount.get(recipientId) || 0;
    conversation.unreadCount.set(recipientId, currentUnread + 1);
    await conversation.save();

    this.logger.log(`Message sent: ${message._id} in conversation ${conversation._id}`);

    const recipient = await this.userModel.findById(recipientId);
    if (recipient && sender) {
      await this.notificationService
        .createNotification(
          recipientId,
          NotificationType.MESSAGE_RECEIVED,
          `New message from ${sender.name}`,
          preview,
          `/messages/${conversation._id}`,
          true,
          this.toEmailUser(recipient),
        )
        .catch((error) => {
          this.logger.error('Failed to create message notification', error);
        });
    }

    return this.messageModel
      .findById(message._id)
      .populate('senderId', 'name avatarUrl avatarColor role')
      .exec() as Promise<MessageDocument>;
  }

  /**
   * Get user's conversations
   */
  async getConversations(
    userId: string,
    orgId: string,
    query: ConversationQueryDto,
  ): Promise<PaginatedResponseDto<ConversationDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'lastMessageAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const filter: QueryFilter<ConversationDocument> = {
      organizationId: new Types.ObjectId(orgId),
      participants: new Types.ObjectId(userId),
    };

    const [conversations, total] = await Promise.all([
      this.conversationModel
        .find(filter)
        .populate('participants', 'name avatarUrl avatarColor email')
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.conversationModel.countDocuments(filter),
    ]);

    return new PaginatedResponseDto(conversations, total, page, limit);
  }

  /**
   * Get conversation by ID with recent messages
   */
  async getConversationById(
    conversationId: string,
    userId: string,
    recentMessagesLimit: number = 10,
  ): Promise<ConversationDocument & { recentMessages: MessageDocument[] }> {
    const conversation = await this.conversationModel
      .findById(conversationId)
      .populate('participants', 'name avatarUrl avatarColor email')
      .exec();

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const canAccess = await this.canAccessConversation(conversation, userId);
    if (!canAccess) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // Get recent messages
    const recentMessages = await this.messageModel
      .find({
        conversationId: new Types.ObjectId(conversationId),
      })
      .populate('senderId', 'name avatarUrl avatarColor role')
      .sort({ createdAt: -1 })
      .limit(recentMessagesLimit)
      .exec();

    return {
      ...conversation.toObject(),
      recentMessages: recentMessages.reverse(), // Reverse to show oldest first
    } as unknown as ConversationDocument & { recentMessages: MessageDocument[] };
  }

  /**
   * Get messages in a conversation
   */
  async getMessages(
    conversationId: string,
    userId: string,
    query: MessageQueryDto,
  ): Promise<PaginatedResponseDto<MessageDocument>> {
    // Verify conversation exists and user is participant
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const canAccess = await this.canAccessConversation(conversation, userId);
    if (!canAccess) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    const {
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const filter: QueryFilter<MessageDocument> = {
      conversationId: new Types.ObjectId(conversationId),
    };

    const [messages, total] = await Promise.all([
      this.messageModel
        .find(filter)
        .populate('senderId', 'name avatarUrl avatarColor role')
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.messageModel.countDocuments(filter),
    ]);

    // Mark messages as read for this user (except their own messages)
    const unreadMessages = messages.filter(
      (m) => !m.isRead && m.senderId.toString() !== userId,
    );

    if (unreadMessages.length > 0) {
      await this.messageModel.updateMany(
        {
          _id: { $in: unreadMessages.map((m) => m._id) },
        },
        {
          $set: {
            isRead: true,
            readAt: new Date(),
          },
        },
      );

      // Update unread count in conversation, but only for actual participants
      // (support-thread staff are not in the map — skip to avoid polluting it).
      const isParticipant = conversation.participants.some(
        (p) => p.toString() === userId,
      );
      if (isParticipant) {
        const currentUnread = conversation.unreadCount.get(userId) || 0;
        const newUnread = Math.max(0, currentUnread - unreadMessages.length);
        conversation.unreadCount.set(userId, newUnread);
        await conversation.save();
      }
    }

    return new PaginatedResponseDto(messages, total, page, limit);
  }

  /**
   * Mark all messages in conversation as read
   */
  async markAsRead(conversationId: string, userId: string): Promise<void> {
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const canAccess = await this.canAccessConversation(conversation, userId);
    if (!canAccess) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // Mark all unread messages as read
    const result = await this.messageModel.updateMany(
      {
        conversationId: new Types.ObjectId(conversationId),
        senderId: { $ne: new Types.ObjectId(userId) },
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
    );

    // Reset unread count for this user (participants only; support staff aren't
    // tracked in the map — their queue unread derives from message read flags).
    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId,
    );
    if (isParticipant) {
      conversation.unreadCount.set(userId, 0);
      await conversation.save();
    }

    this.logger.log(
      `Marked ${result.modifiedCount} messages as read in conversation ${conversationId}`,
    );
  }

  /**
   * Get total unread count across all conversations using aggregation.
   * unreadCount is stored as a Map<userId, number> (object in MongoDB).
   */
  async getUnreadCount(userId: string): Promise<number> {
    const unreadField = `unreadCount.${userId}`;

    const result = await this.conversationModel.aggregate([
      { $match: { participants: new Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: [`$${unreadField}`, 0] } },
        },
      },
    ]);

    return result.length > 0 ? result[0].total : 0;
  }

  /**
   * Staff support queue for a building: support threads, optionally filtered by
   * channel, each with the resident participant and a staff-side unread count
   * (resident messages not yet read).
   */
  async getBuildingSupportConversations(
    currentUser: CurrentUserData,
    buildingId: string,
    channel?: 'grunnsteinen' | 'husvert',
  ): Promise<Array<ConversationDocument & { unread: number }>> {
    // Building access: admins and board span the org; host/caretaker are limited
    // to the buildings they are assigned to (prevents cross-building IDOR).
    const orgWide =
      isAdminRole(currentUser.role) || currentUser.role === UserRole.BOARD;
    if (!orgWide) {
      const assigned = [
        ...(currentUser.buildingIds || []).map((b) => b.toString()),
        currentUser.primaryBuildingId?.toString(),
      ].filter(Boolean);
      if (!assigned.includes(buildingId)) {
        throw new ForbiddenException(
          'You do not have access to this building',
        );
      }
    }

    const filter: QueryFilter<ConversationDocument> = {
      organizationId: new Types.ObjectId(currentUser.organizationId),
      buildingId: new Types.ObjectId(buildingId),
      type: 'support',
    };
    if (channel) filter.supportChannel = channel;

    const conversations = await this.conversationModel
      .find(filter)
      .populate('participants', 'name avatarUrl avatarColor email')
      .sort({ lastMessageAt: -1 })
      .exec();

    return Promise.all(
      conversations.map(async (conv) => {
        const residentId = conv.participants[0]
          ? ((conv.participants[0] as any)._id ?? conv.participants[0])
          : null;
        const unread = residentId
          ? await this.messageModel.countDocuments({
              conversationId: conv._id,
              senderId: residentId,
              isRead: false,
            })
          : 0;
        return Object.assign(conv.toObject(), { unread }) as ConversationDocument & {
          unread: number;
        };
      }),
    );
  }

  /**
   * Delete conversation
   * Since conversations require exactly 2 participants, deleting removes the entire conversation
   */
  async deleteConversation(conversationId: string, userId: string): Promise<void> {
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // Delete conversation and all messages
    // Since conversations require exactly 2 participants, we delete the entire conversation
    await this.conversationModel.deleteOne({ _id: conversationId });
    await this.messageModel.deleteMany({
      conversationId: new Types.ObjectId(conversationId),
    });

    this.logger.log(`Conversation deleted: ${conversationId} by user ${userId}`);
  }
}

