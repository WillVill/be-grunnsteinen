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
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateMessageDto, ConversationQueryDto, MessageQueryDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import {
  NotificationService,
  NotificationType,
} from '../../shared/services/notification.service';
import { EmailService, EmailUser } from '../../shared/services/email.service';

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

      // Verify user is participant
      const isParticipant = conversation.participants.some(
        (p) => p.toString() === userId,
      );
      if (!isParticipant) {
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

    // Create message
    const message = await this.messageModel.create({
      conversationId: conversation._id,
      senderId: new Types.ObjectId(userId),
      content: dto.content,
      isRead: false,
    });

    // Get recipient (other participant)
    const recipientId = conversation.participants.find(
      (p) => p.toString() !== userId,
    )?.toString();

    if (!recipientId) {
      throw new BadRequestException('Invalid conversation participants');
    }

    // Update conversation
    const preview = dto.content.length > 200
      ? dto.content.substring(0, 200) + '...'
      : dto.content;

    // Increment recipient's unread count
    const currentUnread = conversation.unreadCount.get(recipientId) || 0;
    conversation.unreadCount.set(recipientId, currentUnread + 1);
    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = preview;
    await conversation.save();

    this.logger.log(`Message sent: ${message._id} in conversation ${conversation._id}`);

    // Send notification to recipient
    const recipient = await this.userModel.findById(recipientId);
    const sender = await this.userModel.findById(userId);
    if (recipient && sender) {
      const emailUser: EmailUser = {
        _id: recipient._id.toString(),
        email: recipient.email,
        firstName: recipient.name.split(' ')[0],
        lastName: recipient.name.split(' ').slice(1).join(' ') || '',
      };

      await this.notificationService
        .createNotification(
          recipientId,
          NotificationType.MESSAGE_RECEIVED,
          `New message from ${sender.name}`,
          preview,
          `/messages/${conversation._id}`,
          true,
          emailUser,
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

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId,
    );
    if (!isParticipant) {
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

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId,
    );
    if (!isParticipant) {
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

      // Update unread count in conversation
      const currentUnread = conversation.unreadCount.get(userId) || 0;
      const newUnread = Math.max(0, currentUnread - unreadMessages.length);
      conversation.unreadCount.set(userId, newUnread);
      await conversation.save();
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

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId,
    );
    if (!isParticipant) {
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

    // Reset unread count for this user
    conversation.unreadCount.set(userId, 0);
    await conversation.save();

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

