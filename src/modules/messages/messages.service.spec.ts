import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MessagesService } from './messages.service';
import { Conversation } from './schemas/conversation.schema';
import { Message } from './schemas/message.schema';
import { User, UserRole } from '../users/schemas/user.schema';
import { NotificationService } from '../../shared/services/notification.service';
import { EmailService } from '../../shared/services/email.service';

// S3Service (reached through the notification imports) pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const otherOrgId = new Types.ObjectId().toString();
const adminId = new Types.ObjectId().toString();
const residentId = new Types.ObjectId().toString();
const conversationId = new Types.ObjectId().toString();

/** A Mongoose query stand-in: chainable, resolved by exec() or by awaiting it. */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
};

describe('MessagesService organisation scoping', () => {
  let service: MessagesService;
  let conversationFindOne: jest.Mock;
  let messageFind: jest.Mock;
  let messageUpdateMany: jest.Mock;
  let userFindById: jest.Mock;
  let conversation: any;

  beforeEach(async () => {
    conversation = {
      _id: new Types.ObjectId(conversationId),
      organizationId: new Types.ObjectId(orgId),
      type: 'support',
      supportChannel: 'grunnsteinen',
      participants: [new Types.ObjectId(residentId)],
      unreadCount: new Map<string, number>(),
      save: jest.fn(),
      toObject() {
        return { ...this };
      },
    };
    // The conversation only exists in `orgId`: findOne honours the organisation like Mongo would.
    conversationFindOne = jest.fn((filter: { organizationId?: Types.ObjectId }) =>
      query(filter.organizationId?.equals(orgId) ? conversation : null),
    );
    messageFind = jest.fn(() => query([]));
    messageUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    userFindById = jest.fn(() => query({ role: UserRole.ADMIN, buildingIds: [] }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getModelToken(Conversation.name), useValue: { findOne: conversationFindOne } },
        {
          provide: getModelToken(Message.name),
          useValue: { find: messageFind, updateMany: messageUpdateMany, countDocuments: jest.fn().mockResolvedValue(0) },
        },
        { provide: getModelToken(User.name), useValue: { findById: userFindById } },
        { provide: NotificationService, useValue: {} },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();

    service = module.get(MessagesService);
  });

  describe('an admin of another organisation', () => {
    it('gets 404 on GET conversation', async () => {
      await expect(service.getConversationById(conversationId, adminId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(conversationFindOne.mock.calls[0][0]).toEqual({ _id: conversationId, organizationId: new Types.ObjectId(otherOrgId) });
    });

    it('gets 404 on GET messages, and nothing is marked read', async () => {
      await expect(service.getMessages(conversationId, adminId, otherOrgId, {} as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(messageFind).not.toHaveBeenCalled();
      expect(messageUpdateMany).not.toHaveBeenCalled();
    });

    it('gets 404 on mark-as-read', async () => {
      await expect(service.markAsRead(conversationId, adminId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(messageUpdateMany).not.toHaveBeenCalled();
    });

    it('is refused by the access check even if a foreign conversation slips through the lookup', async () => {
      conversationFindOne.mockReturnValue(query({ ...conversation, organizationId: new Types.ObjectId(otherOrgId) }));
      await expect(service.markAsRead(conversationId, adminId, orgId)).rejects.toBeInstanceOf(ForbiddenException);
      expect(messageUpdateMany).not.toHaveBeenCalled();
    });

    it('cannot post into the thread', async () => {
      await expect(
        service.sendMessage(adminId, otherOrgId, { conversationId, content: 'hei' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('an admin in the same organisation can still read a support thread', async () => {
    await expect(service.getMessages(conversationId, adminId, orgId, {} as any)).resolves.toBeDefined();
    await expect(service.markAsRead(conversationId, adminId, orgId)).resolves.toBeUndefined();
  });
});

describe('MessagesService and deleted accounts', () => {
  const senderId = new Types.ObjectId().toString();
  const deletedId = new Types.ObjectId().toString();
  let service: MessagesService;
  let conversationFindOne: jest.Mock;
  let messageCreate: jest.Mock;
  let userFindById: jest.Mock;

  beforeEach(async () => {
    const direct = {
      _id: new Types.ObjectId(conversationId),
      organizationId: new Types.ObjectId(orgId),
      type: 'direct',
      participants: [new Types.ObjectId(senderId), new Types.ObjectId(deletedId)],
      unreadCount: new Map<string, number>(),
      save: jest.fn(),
    };
    conversationFindOne = jest.fn(() => query(direct));
    messageCreate = jest.fn();
    userFindById = jest.fn((id: unknown) =>
      query(
        String(id) === deletedId
          ? { _id: new Types.ObjectId(deletedId), organizationId: new Types.ObjectId(orgId), isDeleted: true }
          : { _id: new Types.ObjectId(senderId), organizationId: new Types.ObjectId(orgId), role: UserRole.RESIDENT },
      ),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getModelToken(Conversation.name), useValue: { findOne: conversationFindOne } },
        { provide: getModelToken(Message.name), useValue: { create: messageCreate } },
        { provide: getModelToken(User.name), useValue: { findById: userFindById } },
        { provide: NotificationService, useValue: { createNotification: jest.fn() } },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();

    service = module.get(MessagesService);
  });

  it('refuses to start a conversation with a deleted user (404)', async () => {
    await expect(service.getOrCreateConversation(senderId, deletedId, orgId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(conversationFindOne).not.toHaveBeenCalled();
  });

  it('refuses a new message to a deleted user by recipientId (404)', async () => {
    await expect(
      service.sendMessage(senderId, orgId, { recipientId: deletedId, content: 'hei' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it('refuses a new message into an existing 1:1 thread whose partner was deleted (404)', async () => {
    await expect(
      service.sendMessage(senderId, orgId, { conversationId, content: 'hei' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(messageCreate).not.toHaveBeenCalled();
  });
});
