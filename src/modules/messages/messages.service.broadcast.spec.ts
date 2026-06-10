import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { MessagesService } from './messages.service';
import { Conversation } from './schemas/conversation.schema';
import { Message } from './schemas/message.schema';
import { User } from '../users/schemas/user.schema';
import { NotificationService } from '../../shared/services/notification.service';
import { EmailService } from '../../shared/services/email.service';

const orgId = '507f1f77bcf86cd799439011';
const staffId = '507f1f77bcf86cd799439012';
const buildingId = '507f1f77bcf86cd799439013';
const residentA = '507f1f77bcf86cd799439021';
const residentB = '507f1f77bcf86cd799439022';
const residentC = '507f1f77bcf86cd799439023';

describe('MessagesService.broadcastSupportMessage', () => {
  let service: MessagesService;
  let conversationFindOne: jest.Mock;
  let conversationCreate: jest.Mock;
  let messageCreate: jest.Mock;
  let createNotification: jest.Mock;
  let userFindById: jest.Mock;

  const buildModule = async () => {
    conversationFindOne = jest.fn().mockResolvedValue(null);
    conversationCreate = jest.fn().mockImplementation(async (doc: any) => ({
      _id: new Types.ObjectId(),
      ...doc,
      unreadCount: new Map<string, number>(),
      save: jest.fn().mockResolvedValue(undefined),
    }));
    messageCreate = jest
      .fn()
      .mockImplementation(async (doc: any) => ({ _id: new Types.ObjectId(), ...doc }));
    createNotification = jest.fn().mockResolvedValue(undefined);

    // findById is awaited directly (sender/resident lookups) and also chained
    // with .select().lean().exec() (building lookup) — return an object that
    // supports both.
    userFindById = jest.fn().mockImplementation((id: any) => ({
      _id: new Types.ObjectId(id.toString()),
      name: 'Test Bruker',
      email: 'user@example.com',
      select: () => ({
        lean: () => ({
          exec: async () => ({
            primaryBuildingId: new Types.ObjectId(buildingId),
            buildingIds: [new Types.ObjectId(buildingId)],
          }),
        }),
      }),
    }));

    const conversationModel: any = { findOne: conversationFindOne, create: conversationCreate };
    const messageModel: any = {
      create: messageCreate,
      findById: jest.fn().mockReturnValue({
        populate: () => ({ exec: async () => ({ _id: new Types.ObjectId() }) }),
      }),
    };
    const userModel: any = { findById: userFindById };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getModelToken(Conversation.name), useValue: conversationModel },
        { provide: getModelToken(Message.name), useValue: messageModel },
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: NotificationService,
          useValue: { createNotification, createBulkNotifications: jest.fn() },
        },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  };

  it('sends one support message per resident and reports the sent count', async () => {
    await buildModule();

    const result = await (service as any).broadcastSupportMessage(
      staffId,
      orgId,
      [residentA, residentB],
      'grunnsteinen',
      'Hei alle sammen',
    );

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(messageCreate).toHaveBeenCalledTimes(2);
    expect(conversationCreate).toHaveBeenCalledTimes(2);
    for (const call of conversationCreate.mock.calls) {
      expect(call[0].type).toBe('support');
      expect(call[0].supportChannel).toBe('grunnsteinen');
    }
  });

  it('scopes lazily created threads to the preferred building', async () => {
    await buildModule();
    const preferredBuilding = '507f1f77bcf86cd799439099';

    await (service as any).broadcastSupportMessage(
      staffId,
      orgId,
      [residentA],
      'husvert',
      'Hei',
      { preferredBuildingId: preferredBuilding },
    );

    expect(conversationCreate).toHaveBeenCalledTimes(1);
    expect(conversationCreate.mock.calls[0][0].buildingId.toString()).toBe(
      preferredBuilding,
    );
  });

  it('continues the batch when one resident fails', async () => {
    await buildModule();
    conversationCreate
      .mockImplementationOnce(async (doc: any) => ({
        _id: new Types.ObjectId(),
        ...doc,
        unreadCount: new Map<string, number>(),
        save: jest.fn().mockResolvedValue(undefined),
      }))
      .mockImplementationOnce(async () => {
        throw new Error('boom');
      })
      .mockImplementationOnce(async (doc: any) => ({
        _id: new Types.ObjectId(),
        ...doc,
        unreadCount: new Map<string, number>(),
        save: jest.fn().mockResolvedValue(undefined),
      }));

    const result = await (service as any).broadcastSupportMessage(
      staffId,
      orgId,
      [residentA, residentB, residentC],
      'grunnsteinen',
      'Hei',
    );

    expect(result).toEqual({ sent: 2, failed: 1 });
    expect(messageCreate).toHaveBeenCalledTimes(2);
  });

  it('suppresses the notification email when the broadcast also goes by email', async () => {
    await buildModule();

    await (service as any).broadcastSupportMessage(
      staffId,
      orgId,
      [residentA],
      'grunnsteinen',
      'Hei',
      { suppressEmailNotification: true },
    );

    expect(createNotification).toHaveBeenCalledTimes(1);
    // createNotification(userId, type, title, message, linkTo, sendEmail, emailUser)
    expect(createNotification.mock.calls[0][5]).toBe(false);
  });

  it('keeps the notification email when the broadcast is in-app only', async () => {
    await buildModule();

    await (service as any).broadcastSupportMessage(
      staffId,
      orgId,
      [residentA],
      'grunnsteinen',
      'Hei',
    );

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][5]).toBe(true);
  });
});
