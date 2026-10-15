import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { NotificationService, NotificationType } from './notification.service';
import { EmailService } from './email.service';

const liveId = new Types.ObjectId().toString();
const deletedId = new Types.ObjectId().toString();

/** A Mongoose query stand-in: chainable, resolved by exec() or by awaiting it. */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['select', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
};

describe('NotificationService skips deleted accounts', () => {
  let service: NotificationService;
  let create: jest.Mock;
  let insertMany: jest.Mock;
  let exists: jest.Mock;
  let sendEmail: jest.Mock;

  beforeEach(async () => {
    create = jest.fn(async (doc: unknown) => doc);
    insertMany = jest.fn(async (docs: unknown[]) => docs);
    exists = jest.fn(async (filter: { _id: string }) => (filter._id === deletedId ? { _id: deletedId } : null));
    sendEmail = jest.fn().mockResolvedValue(undefined);
    const find = jest.fn((filter: any) =>
      query(
        filter.isDeleted
          ? [{ _id: new Types.ObjectId(deletedId) }]
          : [{ _id: new Types.ObjectId(liveId) }, { _id: new Types.ObjectId(deletedId) }],
      ),
    );
    const findById = jest.fn(() => query({}));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: getModelToken('Notification'), useValue: { create, insertMany } },
        { provide: getModelToken('User'), useValue: { exists, find, findById } },
        { provide: EmailService, useValue: { sendEmail } },
        { provide: ConfigService, useValue: { get: () => 'https://example.com' } },
      ],
    }).compile();

    service = module.get(NotificationService);
  });

  const emailUser = (id: string) => ({ _id: id, email: `${id}@example.com`, firstName: 'A', lastName: 'B' });

  it('creates nothing and sends no email for a deleted user', async () => {
    const result = await service.createNotification(
      deletedId, NotificationType.SYSTEM, 'T', 'M', '/x', true, emailUser(deletedId),
    );
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still notifies a live user', async () => {
    await service.createNotification(liveId, NotificationType.SYSTEM, 'T', 'M', '/x', true, emailUser(liveId));
    expect(create).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(`${liveId}@example.com`, expect.any(String), expect.any(String));
  });

  it('drops deleted users from bulk notifications and their emails', async () => {
    await service.createBulkNotifications(
      [liveId, deletedId], NotificationType.EVENT_CANCELLED, 'T', 'M', '/x', true,
      [emailUser(liveId), emailUser(deletedId)],
    );
    const docs = insertMany.mock.calls[0][0];
    expect(docs.map((d: any) => String(d.userId))).toEqual([liveId]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(`${liveId}@example.com`, expect.any(String), expect.any(String));
  });

  it('creates nothing when every bulk recipient is deleted', async () => {
    await expect(
      service.createBulkNotifications([deletedId], NotificationType.EVENT_CANCELLED, 'T', 'M'),
    ).resolves.toEqual([]);
    expect(insertMany).not.toHaveBeenCalled();
  });
});
