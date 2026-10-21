import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  AccountDeletionService,
  DELETED_MESSAGE_CONTENT,
  LAST_ADMIN_MESSAGE,
} from './account-deletion.service';
import { User, UserRole } from './schemas/user.schema';
import { Post } from '../posts/schemas/post.schema';
import { Comment } from '../posts/schemas/comment.schema';
import { Event, EventStatus } from '../events/schemas/event.schema';
import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';
import { Group } from '../groups/schemas/group.schema';
import { SharedItem } from '../sharing/schemas/shared-item.schema';
import { HelpRequest, HelpRequestStatus } from '../sharing/schemas/help-request.schema';
import { Conversation } from '../messages/schemas/conversation.schema';
import { Message } from '../messages/schemas/message.schema';
import { Invitation } from '../invitations/schemas/invitation.schema';
import { TenantProfile, TenantProfileStatus } from '../tenant-profiles/schemas/tenant-profile.schema';
import { Apartment } from '../apartments/schemas/apartment.schema';
import { EventsService } from '../events/events.service';
import { BookingsService } from '../bookings/bookings.service';
import { NotificationService } from '../../shared/services/notification.service';
import { S3Service } from '../../shared/services/s3.service';

// S3Service pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const userId = new Types.ObjectId().toString();
const orgOid = new Types.ObjectId(orgId);
const userOid = new Types.ObjectId(userId);

const ownPostId = new Types.ObjectId();
const otherPostId = new Types.ObjectId();
const foreignPostId = new Types.ObjectId();
const topComment = { _id: new Types.ObjectId(), postId: otherPostId, parentCommentId: null };
const reply = { _id: new Types.ObjectId(), postId: otherPostId, parentCommentId: new Types.ObjectId() };
const foreignComment = { _id: new Types.ObjectId(), postId: foreignPostId, parentCommentId: null };
const eventId = new Types.ObjectId();
const bookingId = new Types.ObjectId();
const itemId = new Types.ObjectId();
const helpRequestId = new Types.ObjectId();
const requesterId = new Types.ObjectId();
const supportConvId = new Types.ObjectId();
const directConvId = new Types.ObjectId();

/** A Mongoose query stand-in: chainable, resolved by exec() or by awaiting it. */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
};

/** Every model call, in order, as `Model.method`. */
let calls: string[];

function mockModel(name: string) {
  const record = <T>(method: string, result: () => T) =>
    jest.fn((..._args: any[]) => {
      calls.push(`${name}.${method}`);
      return result();
    });
  return {
    find: record('find', () => query([])),
    findOne: record('findOne', () => query(null)),
    distinct: record('distinct', () => Promise.resolve([])),
    updateOne: record('updateOne', () => Promise.resolve({ modifiedCount: 0 })),
    updateMany: record('updateMany', () => Promise.resolve({ modifiedCount: 0 })),
    deleteMany: record('deleteMany', () => Promise.resolve({ deletedCount: 0 })),
    countDocuments: record('countDocuments', () => Promise.resolve(0)),
    exists: record('exists', () => Promise.resolve({ _id: new Types.ObjectId() })),
  };
}

type MockModel = ReturnType<typeof mockModel>;

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;
  let models: Record<string, MockModel>;
  let eventsCancel: jest.Mock;
  let bookingsCancel: jest.Mock;
  let createNotification: jest.Mock;
  let deleteAllNotifications: jest.Mock;
  let deletePrefix: jest.Mock;
  let deleteFile: jest.Mock;

  const activeUser = (overrides: Record<string, unknown> = {}) => ({
    _id: userOid,
    organizationId: orgOid,
    email: 'kari@example.com',
    name: 'Kari Nordmann',
    role: UserRole.RESIDENT,
    isActive: true,
    isDeleted: false,
    avatarUrl: `https://cdn.test/avatars/${userId}/current.png`,
    ...overrides,
  });

  /** Seeds one record per Decisions-table row. */
  function seedData() {
    models.Post.distinct.mockImplementation((_field: string, filter: any) => {
      calls.push('Post.distinct');
      return Promise.resolve(filter.authorId ? [ownPostId] : [otherPostId]);
    });
    models.Comment.find.mockImplementation(() => {
      calls.push('Comment.find');
      return query([topComment, reply, foreignComment]);
    });
    models.Comment.countDocuments.mockImplementation(() => {
      calls.push('Comment.countDocuments');
      return Promise.resolve(4);
    });
    models.Event.find.mockImplementation(() => {
      calls.push('Event.find');
      return query([{ _id: eventId }]);
    });
    models.Booking.find.mockImplementation(() => {
      calls.push('Booking.find');
      return query([{ _id: bookingId }]);
    });
    models.SharedItem.find.mockImplementation(() => {
      calls.push('SharedItem.find');
      return query([{ _id: itemId, imageUrl: `https://cdn.test/sharing/items/${itemId}/images/drill.jpg` }]);
    });
    models.HelpRequest.find.mockImplementation(() => {
      calls.push('HelpRequest.find');
      return query([{ _id: helpRequestId, requesterId, title: 'Gå tur med hunden' }]);
    });
    models.HelpRequest.updateOne.mockImplementation(() => {
      calls.push('HelpRequest.updateOne');
      return Promise.resolve({ modifiedCount: 1 });
    });
    models.Conversation.distinct.mockImplementation((_field: string, filter: any) => {
      calls.push('Conversation.distinct');
      return Promise.resolve(filter.type === 'support' ? [supportConvId] : [directConvId]);
    });
    models.Message.findOne.mockImplementation(() => {
      calls.push('Message.findOne');
      return query({ senderId: userOid });
    });
  }

  beforeEach(async () => {
    calls = [];
    models = {};
    for (const name of [
      User.name, Post.name, Comment.name, Event.name, Booking.name, Group.name, SharedItem.name,
      HelpRequest.name, Conversation.name, Message.name, Invitation.name, TenantProfile.name, Apartment.name,
    ]) {
      models[name] = mockModel(name);
    }
    models.User.findOne.mockImplementation((filter: any) => {
      calls.push('User.findOne');
      if (filter._id === userId) return query(activeUser());
      return query({ _id: requesterId, email: 'ola@example.com', name: 'Ola Hansen', isDeleted: false });
    });
    models.User.countDocuments.mockImplementation(() => {
      calls.push('User.countDocuments');
      return Promise.resolve(1);
    });

    eventsCancel = jest.fn().mockResolvedValue(undefined);
    bookingsCancel = jest.fn().mockResolvedValue(undefined);
    createNotification = jest.fn().mockResolvedValue(undefined);
    deleteAllNotifications = jest.fn().mockResolvedValue(undefined);
    deletePrefix = jest.fn().mockResolvedValue(1);
    deleteFile = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        ...Object.entries(models).map(([name, useValue]) => ({ provide: getModelToken(name), useValue })),
        { provide: EventsService, useValue: { cancel: eventsCancel } },
        { provide: BookingsService, useValue: { cancel: bookingsCancel } },
        { provide: NotificationService, useValue: { createNotification, deleteAllNotifications } },
        {
          provide: S3Service,
          // CloudFront URLs map back to `public/<path>`, as in the real service.
          useValue: {
            deletePrefix,
            deleteFile,
            keyFromUrl: (url: string) => url.replace('https://cdn.test/', 'public/'),
          },
        },
      ],
    }).compile();

    service = module.get(AccountDeletionService);
  });

  describe('lookup and guards', () => {
    it('loads the user scoped to the organisation', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.User.findOne.mock.calls[0][0]).toEqual({ _id: userId, organizationId: orgOid });
    });

    it('404s for a user outside the organisation, writing nothing', async () => {
      models.User.findOne.mockImplementation(() => query(null));
      await expect(service.deleteAccount(userId, orgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(models.User.updateOne).not.toHaveBeenCalled();
    });

    it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])('409s for the last active %s and writes nothing', async (role) => {
      models.User.findOne.mockImplementation(() => query(activeUser({ role })));
      models.User.countDocuments.mockResolvedValue(0);

      await expect(service.deleteAccount(userId, orgId)).rejects.toThrow(
        new ConflictException(LAST_ADMIN_MESSAGE),
      );
      expect(models.User.countDocuments).toHaveBeenCalledWith({
        organizationId: orgOid,
        _id: { $ne: userOid },
        role: { $in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        isActive: true,
        isDeleted: { $ne: true },
      });
      const writes = calls.filter((c) => /\.(update|delete)/.test(c));
      expect(writes).toEqual([]);
      expect(eventsCancel).not.toHaveBeenCalled();
      expect(deletePrefix).not.toHaveBeenCalled();
      expect(deleteFile).not.toHaveBeenCalled();
      expect(deleteAllNotifications).not.toHaveBeenCalled();
    });

    it('lets an admin go when another active admin remains', async () => {
      models.User.findOne.mockImplementation(() => query(activeUser({ role: UserRole.ADMIN })));
      await expect(service.deleteAccount(userId, orgId)).resolves.toMatchObject({ tombstoned: true });
    });

    it('does not run the admin check for a resident', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.User.countDocuments).not.toHaveBeenCalled();
    });
  });

  describe('tombstone', () => {
    it('anonymises the user document and keeps id, org, createdAt and role', async () => {
      await service.deleteAccount(userId, orgId);

      const [filter, update] = models.User.updateOne.mock.calls[0];
      expect(filter).toEqual({ _id: userOid, organizationId: orgOid });
      const { password, deletedAt, ...set } = update.$set;
      expect(set).toEqual({
        name: 'Slettet bruker',
        email: `deleted+${userId}@deleted.invalid`,
        isActive: false,
        isDeleted: true,
        buildingIds: [],
        interests: [],
        helpfulSkills: [],
        isHelpfulNeighbor: false,
        emergencyContacts: [],
        pets: { hasPets: false, types: [] },
      });
      expect(password).toMatch(/^\$2[aby]\$10\$/);
      expect(deletedAt).toBeInstanceOf(Date);
      expect(Object.keys(update.$unset).sort()).toEqual(
        [
          'phone', 'avatarUrl', 'avatarColor', 'dateOfBirth', 'unitNumber', 'building', 'primaryBuildingId',
          'lastLoginAt', 'passwordResetToken', 'passwordResetExpires', 'setupToken', 'setupTokenExpires', 'blockedUserIds',
        ].sort(),
      );
      for (const kept of ['_id', 'organizationId', 'createdAt', 'role']) {
        expect(update.$set).not.toHaveProperty(kept);
        expect(update.$unset).not.toHaveProperty(kept);
      }
    });

    it('writes the tombstone before any cascade step', async () => {
      seedData();
      await service.deleteAccount(userId, orgId);

      expect(calls[0]).toBe('User.findOne');
      // Invitations match on the real address, so they go just before the tombstone.
      expect(calls[1]).toBe('Invitation.deleteMany');
      expect(calls[2]).toBe('User.updateOne');
      const tombstoneOrder = models.User.updateOne.mock.invocationCallOrder[0];
      for (const mock of [eventsCancel, bookingsCancel, deletePrefix, deleteFile, deleteAllNotifications, createNotification]) {
        expect(mock.mock.invocationCallOrder[0]).toBeGreaterThan(tombstoneOrder);
      }
    });
  });

  describe('cascade', () => {
    beforeEach(() => seedData());

    it('deletes invitations sent to the original address, scoped to the org', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.Invitation.deleteMany).toHaveBeenCalledWith({
        organizationId: orgOid,
        email: 'kari@example.com',
      });
    });

    it('unlinks the tenant profile and the apartment, keeping the profile', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.TenantProfile.updateMany).toHaveBeenCalledWith(
        { organizationId: orgOid, userId: userOid },
        { $set: { status: TenantProfileStatus.UNREGISTERED }, $unset: { userId: '', invitationId: '' } },
      );
      expect(models.TenantProfile.deleteMany).not.toHaveBeenCalled();
      expect(models.Apartment.updateMany).toHaveBeenCalledWith(
        { organizationId: orgOid, tenantIds: userOid },
        { $pull: { tenantIds: userOid } },
      );
    });

    it('deletes their posts with every comment on them', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.Post.distinct).toHaveBeenCalledWith('_id', { organizationId: orgOid, authorId: userOid });
      expect(models.Comment.deleteMany).toHaveBeenCalledWith({ postId: { $in: [ownPostId] } });
      expect(models.Post.deleteMany).toHaveBeenCalledWith({ _id: { $in: [ownPostId] }, organizationId: orgOid });
    });

    it('deletes their comments on posts in the org only, with replies, and recounts', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.Comment.find).toHaveBeenCalledWith({ authorId: userOid });
      expect(models.Post.distinct).toHaveBeenCalledWith('_id', {
        _id: { $in: [String(otherPostId), String(foreignPostId)] },
        organizationId: orgOid,
      });
      expect(models.Comment.deleteMany).toHaveBeenCalledWith({
        parentCommentId: { $in: [topComment._id] },
        postId: { $in: [otherPostId] },
      });
      expect(models.Comment.deleteMany).toHaveBeenCalledWith({
        _id: { $in: [topComment._id, reply._id] },
        authorId: userOid,
      });
      expect(models.Post.updateOne).toHaveBeenCalledWith(
        { _id: otherPostId, organizationId: orgOid },
        { $set: { commentsCount: 4 } },
      );
      expect(models.Post.updateOne).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['Post', 'likes', 'likesCount'],
      ['Event', 'participants', 'participantsCount'],
      ['Group', 'members', 'memberCount'],
    ])('pulls them from %s.%s and resyncs %s', async (model, field, countField) => {
      await service.deleteAccount(userId, orgId);
      expect(models[model].updateMany).toHaveBeenCalledWith(
        { organizationId: orgOid, [field]: userOid },
        [
          { $set: { [field]: { $filter: { input: `$${field}`, cond: { $ne: ['$$this', userOid] } } } } },
          { $set: { [countField]: { $size: `$${field}` } } },
        ],
        { updatePipeline: true },
      );
    });

    it('cancels future events they organise through EventsService, after pulling participation', async () => {
      await service.deleteAccount(userId, orgId);
      const [filter] = models.Event.find.mock.calls[0];
      expect(filter).toMatchObject({
        organizationId: orgOid,
        organizerId: userOid,
        status: { $in: [EventStatus.UPCOMING, EventStatus.ONGOING] },
      });
      expect(filter.startDate.$gt).toBeInstanceOf(Date);
      expect(eventsCancel).toHaveBeenCalledWith(String(eventId), userId, orgId);
      expect(models.Event.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        eventsCancel.mock.invocationCallOrder[0],
      );
    });

    it('cancels future pending/confirmed bookings through BookingsService and clears notes', async () => {
      await service.deleteAccount(userId, orgId);
      const [filter] = models.Booking.find.mock.calls[0];
      expect(filter).toMatchObject({
        organizationId: orgOid,
        userId: userOid,
        status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      });
      // endDate, not startDate: a running booking is cancelled too, freeing the slot.
      expect(filter.endDate.$gt).toBeInstanceOf(Date);
      expect(filter.startDate).toBeUndefined();
      expect(bookingsCancel).toHaveBeenCalledWith(String(bookingId), userId, orgId, 'Konto slettet');
      expect(models.Booking.updateMany).toHaveBeenCalledWith(
        { organizationId: orgOid, userId: userOid, notes: { $exists: true } },
        { $unset: { notes: '' } },
      );
    });

    it('deactivates groups where they are creator and only member', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.Group.updateMany).toHaveBeenCalledWith(
        {
          organizationId: orgOid,
          creatorId: userOid,
          isActive: true,
          members: { $not: { $elemMatch: { $ne: userOid } } },
        },
        { $set: { isActive: false } },
      );
      expect(models.Group.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes their shared items after removing the images, and releases borrowed items', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.SharedItem.find).toHaveBeenCalledWith({ organizationId: orgOid, ownerId: userOid });
      // The known key, not a prefix listing (production IAM has no s3:ListBucket).
      expect(deleteFile).toHaveBeenCalledWith(`public/sharing/items/${itemId}/images/drill.jpg`);
      expect(deletePrefix).not.toHaveBeenCalledWith(expect.stringContaining('sharing'));
      expect(models.SharedItem.deleteMany).toHaveBeenCalledWith({
        _id: { $in: [itemId] },
        organizationId: orgOid,
        ownerId: userOid,
      });
      expect(deleteFile.mock.invocationCallOrder[0]).toBeLessThan(
        models.SharedItem.deleteMany.mock.invocationCallOrder[0],
      );
      expect(models.SharedItem.updateMany).toHaveBeenCalledWith(
        { organizationId: orgOid, borrowedBy: userOid },
        { $unset: { borrowedBy: '', borrowedAt: '' } },
      );
    });

    it('keeps a shared item whose images could not be deleted, so a re-run can retry', async () => {
      deleteFile.mockImplementation((key: string) =>
        key.includes('sharing') ? Promise.reject(new Error('S3 down')) : Promise.resolve(),
      );
      const summary = await service.deleteAccount(userId, orgId);
      expect(models.SharedItem.deleteMany).not.toHaveBeenCalled();
      expect(summary.s3Failures).toBe(1);
      expect(summary.completed).toBe(false);
    });

    it('always deletes a shared item that has no images, and touches no S3 for it', async () => {
      const bare = new Types.ObjectId();
      models.SharedItem.find.mockImplementation(() => query([{ _id: bare }]));
      deleteFile.mockRejectedValue(new Error('S3 down')); // would only matter if it were called for the item
      await service.deleteAccount(userId, orgId);
      expect(deleteFile).not.toHaveBeenCalledWith(expect.stringContaining('sharing'));
      expect(models.SharedItem.deleteMany).toHaveBeenCalledWith({
        _id: { $in: [bare] },
        organizationId: orgOid,
        ownerId: userOid,
      });
    });

    it('never deletes a gallery image or a key outside the item folder, and still deletes the item', async () => {
      const item = new Types.ObjectId();
      models.SharedItem.find.mockImplementation(() =>
        query([
          {
            _id: item,
            imageUrl: 'https://cdn.test/gallery/tools.jpg',
            imageUrls: [`https://cdn.test/sharing/items/${new Types.ObjectId()}/images/other.jpg`, `https://cdn.test/sharing/items/${item}/images/mine.jpg`],
          },
        ]),
      );
      await service.deleteAccount(userId, orgId);
      const sharingKeys = deleteFile.mock.calls.map(([key]) => key).filter((key: string) => !key.includes('avatars'));
      expect(sharingKeys).toEqual([`public/sharing/items/${item}/images/mine.jpg`]);
      expect(models.SharedItem.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ _id: { $in: [item] } }));
    });

    it('deletes help requests they made and reopens ones they were helping with', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.HelpRequest.deleteMany).toHaveBeenCalledWith({ organizationId: orgOid, requesterId: userOid });
      expect(models.HelpRequest.find).toHaveBeenCalledWith({
        organizationId: orgOid,
        helperId: userOid,
        status: HelpRequestStatus.ACCEPTED,
      });
      expect(models.HelpRequest.updateOne).toHaveBeenCalledWith(
        { _id: helpRequestId, organizationId: orgOid, helperId: userOid, status: HelpRequestStatus.ACCEPTED },
        { $set: { status: HelpRequestStatus.OPEN }, $unset: { helperId: '', acceptedAt: '' } },
      );
      expect(models.User.findOne).toHaveBeenCalledWith({ _id: requesterId, organizationId: orgOid });
      expect(createNotification).toHaveBeenCalledWith(
        String(requesterId),
        expect.any(String),
        expect.any(String),
        expect.stringContaining('Gå tur med hunden'),
        `/sharing/help-requests/${helpRequestId}`,
        true,
        expect.objectContaining({ email: 'ola@example.com' }),
      );
    });

    it('deletes support threads with their messages', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.Conversation.distinct).toHaveBeenCalledWith('_id', {
        organizationId: orgOid,
        type: 'support',
        participants: userOid,
      });
      expect(models.Message.deleteMany).toHaveBeenCalledWith({ conversationId: { $in: [supportConvId] } });
      expect(models.Conversation.deleteMany).toHaveBeenCalledWith({
        _id: { $in: [supportConvId] },
        organizationId: orgOid,
      });
    });

    it('replaces their messages in 1:1 threads and fixes preview and unread', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.Conversation.distinct).toHaveBeenCalledWith('_id', {
        organizationId: orgOid,
        type: { $ne: 'support' },
        participants: userOid,
      });
      expect(models.Message.updateMany).toHaveBeenCalledWith(
        { conversationId: { $in: [directConvId] }, senderId: userOid, content: { $ne: DELETED_MESSAGE_CONTENT } },
        { $set: { content: 'Meldingen er slettet' } },
      );
      expect(models.Conversation.updateOne).toHaveBeenCalledWith(
        { _id: directConvId, organizationId: orgOid },
        { $set: { lastMessagePreview: 'Meldingen er slettet' }, $unset: { [`unreadCount.${userId}`]: '' } },
      );
      expect(models.Conversation.deleteMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ _id: { $in: [directConvId] } }),
      );
    });

    it("leaves the preview alone when the partner's message is the latest", async () => {
      models.Message.findOne.mockImplementation(() => query({ senderId: new Types.ObjectId() }));
      await service.deleteAccount(userId, orgId);
      expect(models.Conversation.updateOne).toHaveBeenCalledWith(
        { _id: directConvId, organizationId: orgOid },
        { $unset: { [`unreadCount.${userId}`]: '' } },
      );
    });

    it('deletes the known avatar, sweeps the avatar folder, and deletes notifications last', async () => {
      await service.deleteAccount(userId, orgId);
      expect(deleteFile).toHaveBeenCalledWith(`public/avatars/${userId}/current.png`);
      expect(deletePrefix).toHaveBeenCalledWith(`public/avatars/${userId}/`);
      expect(deleteAllNotifications).toHaveBeenCalledWith(userOid);
      const last = deleteAllNotifications.mock.invocationCallOrder[0];
      for (const mock of [eventsCancel, bookingsCancel, createNotification, deletePrefix, deleteFile]) {
        expect(Math.max(...mock.mock.invocationCallOrder)).toBeLessThan(last);
      }
    });

    it('pulls the user from everyone\'s block list, before notifications are deleted', async () => {
      await service.deleteAccount(userId, orgId);
      expect(models.User.updateMany).toHaveBeenCalledWith(
        { organizationId: orgOid, blockedUserIds: userOid },
        { $pull: { blockedUserIds: userOid } },
      );
      expect(models.User.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        deleteAllNotifications.mock.invocationCallOrder[0],
      );
    });

    it('parks the avatar key in the tombstone write and unparks it once deleted', async () => {
      await service.deleteAccount(userId, orgId);
      const [, tombstone] = models.User.updateOne.mock.calls[0];
      expect(tombstone.$set.isDeleted).toBe(true);
      expect(tombstone.$addToSet).toEqual({ pendingS3Keys: { $each: [`public/avatars/${userId}/current.png`] } });
      expect(models.User.updateOne).toHaveBeenCalledWith(
        { _id: userOid, organizationId: orgOid },
        { $pull: { pendingS3Keys: `public/avatars/${userId}/current.png` } },
      );
    });

    it('carries on when the avatar delete fails, and leaves the key parked for the re-run', async () => {
      deleteFile.mockRejectedValue(new Error('S3 down'));
      await expect(service.deleteAccount(userId, orgId)).resolves.toMatchObject({ s3Failures: 2, completed: false });
      expect(deleteAllNotifications).toHaveBeenCalled();
      expect(models.User.updateOne.mock.calls[0][1].$addToSet).toEqual({ pendingS3Keys: { $each: [`public/avatars/${userId}/current.png`] } });
      for (const [, update] of models.User.updateOne.mock.calls) {
        expect(update).not.toHaveProperty('$pull');
      }
    });

    it('a sweep without s3:ListBucket (AccessDenied) only warns and does not leave the deletion incomplete', async () => {
      deletePrefix.mockRejectedValue(Object.assign(new Error('not authorized to perform: s3:ListBucket'), { name: 'AccessDenied' }));
      const summary = await service.deleteAccount(userId, orgId);
      expect(summary).toMatchObject({ s3Failures: 0, completed: true, failedSteps: [] });
      expect(deleteFile).toHaveBeenCalledWith(`public/avatars/${userId}/current.png`);
    });

    it('a re-run deletes avatar keys parked by the first run and unparks them', async () => {
      const parked = `public/avatars/${userId}/current.png`;
      models.User.findOne.mockImplementation((filter: any) =>
        query(
          filter._id === userId
            ? activeUser({ isActive: false, isDeleted: true, avatarUrl: undefined, pendingS3Keys: [parked, 'public/gallery/x.jpg'] })
            : null,
        ),
      );
      const summary = await service.deleteAccount(userId, orgId);
      expect(deleteFile).toHaveBeenCalledWith(parked);
      expect(deleteFile).not.toHaveBeenCalledWith('public/gallery/x.jpg');
      expect(models.User.updateOne).toHaveBeenCalledWith(
        { _id: userOid, organizationId: orgOid },
        { $pull: { pendingS3Keys: parked } },
      );
      expect(summary.completed).toBe(true);
    });

    it('does not delete an avatar URL outside the user folder', async () => {
      models.User.findOne.mockImplementation(() =>
        query(activeUser({ avatarUrl: 'https://cdn.test/gallery/avatar-default.png' })),
      );
      await service.deleteAccount(userId, orgId);
      expect(deleteFile).not.toHaveBeenCalledWith(expect.stringContaining('gallery'));
    });

    it('scopes every collection query that has an organisation by organizationId', async () => {
      await service.deleteAccount(userId, orgId);
      const orgless = new Set([Comment.name, Message.name]);
      for (const [name, model] of Object.entries(models)) {
        if (orgless.has(name)) continue;
        for (const [method, mock] of Object.entries(model)) {
          for (const args of (mock as jest.Mock).mock.calls) {
            const filter = method === 'distinct' ? args[1] : args[0];
            expect({ model: name, method, org: String(filter.organizationId) }).toEqual({
              model: name,
              method,
              org: orgId,
            });
          }
        }
      }
    });
  });

  describe('idempotency', () => {
    it('a second run on the tombstone does not throw and changes nothing', async () => {
      models.User.findOne.mockImplementation(() =>
        query(
          activeUser({
            isActive: false,
            isDeleted: true,
            email: `deleted+${userId}@deleted.invalid`,
            deletionCompletedAt: new Date(),
          }),
        ),
      );

      const summary = await service.deleteAccount(userId, orgId);

      expect(models.User.updateOne).not.toHaveBeenCalled();
      expect(models.User.countDocuments).not.toHaveBeenCalled();
      expect(models.Invitation.deleteMany).not.toHaveBeenCalled();
      expect(eventsCancel).not.toHaveBeenCalled();
      expect(bookingsCancel).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
      const { tombstoned, s3ObjectsDeleted, failedSteps, completed, ...counts } = summary;
      expect(tombstoned).toBe(false);
      expect(failedSteps).toEqual([]);
      expect(completed).toBe(true);
      expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    });

    it('a first run followed by a second run both succeed', async () => {
      seedData();
      await service.deleteAccount(userId, orgId);
      models.User.findOne.mockImplementation(() =>
        query(activeUser({ isActive: false, isDeleted: true, deletionCompletedAt: new Date() })),
      );
      await expect(service.deleteAccount(userId, orgId)).resolves.toMatchObject({ tombstoned: false });
      // Tombstone, avatar unpark and completion mark from the first run; the second writes none.
      expect(models.User.updateOne).toHaveBeenCalledTimes(3);
    });
  });
  describe('resumable cascade', () => {
    beforeEach(() => seedData());

    it('a step that throws still leaves the tombstone, succeeds, and is not marked complete', async () => {
      models.Group.updateMany.mockRejectedValue(new Error('Mongo blip'));

      const summary = await service.deleteAccount(userId, orgId);

      expect(summary.failedSteps).toEqual(['groups']);
      expect(summary.completed).toBe(false);
      // The tombstone, and the avatar unpark after its delete succeeded.
      expect(models.User.updateOne).toHaveBeenCalledTimes(2);
      expect(models.User.updateOne.mock.calls[0][1].$set.isDeleted).toBe(true);
      // The steps after the failing one still ran.
      expect(models.SharedItem.deleteMany).toHaveBeenCalled();
      expect(deleteAllNotifications).toHaveBeenCalled();
      for (const [, update] of models.User.updateOne.mock.calls) {
        expect(update.$set ?? {}).not.toHaveProperty('deletionCompletedAt');
      }
    });

    it('a failed delete of a known S3 object also leaves the deletion pending', async () => {
      deleteFile.mockRejectedValue(new Error('S3 down'));
      const summary = await service.deleteAccount(userId, orgId);
      expect(summary.completed).toBe(false);
      for (const [, update] of models.User.updateOne.mock.calls) {
        expect(update.$set ?? {}).not.toHaveProperty('deletionCompletedAt');
      }
    });

    it('a clean run sets deletionCompletedAt after the cascade', async () => {
      const summary = await service.deleteAccount(userId, orgId);
      expect(summary).toMatchObject({ completed: true, failedSteps: [] });
      expect(models.User.updateOne).toHaveBeenCalledTimes(3);
      const [filter, update] = models.User.updateOne.mock.calls[2];
      expect(filter).toEqual({ _id: userOid, organizationId: orgOid });
      expect(update.$set.deletionCompletedAt).toBeInstanceOf(Date);
      expect(models.User.updateOne.mock.invocationCallOrder[2]).toBeGreaterThan(
        deleteAllNotifications.mock.invocationCallOrder[0],
      );
    });

    it('a re-run of a pending tombstone finishes and marks it complete, without a new tombstone', async () => {
      models.User.findOne.mockImplementation((filter: any) => {
        calls.push('User.findOne');
        return query(
          filter._id === userId
            ? activeUser({ isActive: false, isDeleted: true, email: `deleted+${userId}@deleted.invalid` })
            : { _id: requesterId, email: 'ola@example.com', name: 'Ola Hansen' },
        );
      });
      const summary = await service.deleteAccount(userId, orgId);
      expect(summary.tombstoned).toBe(false);
      expect(models.User.updateOne).toHaveBeenCalledTimes(1);
      expect(models.User.updateOne.mock.calls[0][1]).toEqual({
        $set: { deletionCompletedAt: expect.any(Date) },
      });
    });

    it('if the invitation cleanup fails, nothing is tombstoned and the error surfaces', async () => {
      models.Invitation.deleteMany.mockRejectedValue(new Error('Mongo down'));
      await expect(service.deleteAccount(userId, orgId)).rejects.toThrow('Mongo down');
      expect(models.User.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('review follow-ups', () => {
    beforeEach(() => seedData());

    it('deletes invitations linked from their tenant profiles, before unsetting the link', async () => {
      const linked = new Types.ObjectId();
      models.TenantProfile.distinct.mockImplementation(() => {
        calls.push('TenantProfile.distinct');
        return Promise.resolve([linked]);
      });
      await service.deleteAccount(userId, orgId);
      expect(models.TenantProfile.distinct).toHaveBeenCalledWith('invitationId', {
        organizationId: orgOid,
        userId: userOid,
        invitationId: { $exists: true, $ne: null },
      });
      expect(models.Invitation.deleteMany).toHaveBeenCalledWith({ _id: { $in: [linked] }, organizationId: orgOid });
      expect(calls.indexOf('Invitation.deleteMany', 2)).toBeLessThan(calls.indexOf('TenantProfile.updateMany'));
    });

    it('notifies the helper of a request they accepted before deleting it', async () => {
      const helperId = new Types.ObjectId();
      models.HelpRequest.find.mockImplementation((filter: any) => {
        calls.push('HelpRequest.find');
        return query(
          filter.requesterId
            ? [{ _id: new Types.ObjectId(), helperId, title: 'Bære sofa' }]
            : [],
        );
      });
      models.User.findOne.mockImplementation((filter: any) => {
        calls.push('User.findOne');
        if (filter._id === userId) return query(activeUser());
        return query({ _id: helperId, email: 'helper@example.com', name: 'Per Hjelper' });
      });

      await service.deleteAccount(userId, orgId);

      expect(models.HelpRequest.find).toHaveBeenCalledWith({
        organizationId: orgOid,
        requesterId: userOid,
        status: HelpRequestStatus.ACCEPTED,
        helperId: { $exists: true, $ne: null },
      });
      expect(models.User.findOne).toHaveBeenCalledWith({ _id: helperId, organizationId: orgOid });
      expect(createNotification).toHaveBeenCalledWith(
        String(helperId),
        expect.any(String),
        expect.any(String),
        expect.stringContaining('Forespørselen «Bære sofa» er trukket tilbake'),
        undefined,
        true,
        expect.objectContaining({ email: 'helper@example.com' }),
      );
      expect(createNotification.mock.invocationCallOrder[0]).toBeLessThan(
        models.HelpRequest.deleteMany.mock.invocationCallOrder[0],
      );
    });

    it('tolerates a booking that was cancelled meanwhile (double DELETE)', async () => {
      bookingsCancel.mockRejectedValue(new BadRequestException('Booking is already cancelled'));
      const summary = await service.deleteAccount(userId, orgId);
      expect(summary.failedSteps).toEqual([]);
      expect(summary.bookingsCancelled).toBe(0);
    });

    it('still fails the bookings step on an unexpected error', async () => {
      bookingsCancel.mockRejectedValue(new Error('boom'));
      const summary = await service.deleteAccount(userId, orgId);
      expect(summary.failedSteps).toEqual(['bookings']);
    });

    it('skips an event that was cancelled meanwhile', async () => {
      models.Event.exists.mockResolvedValue(null);
      const summary = await service.deleteAccount(userId, orgId);
      expect(models.Event.exists).toHaveBeenCalledWith({
        _id: eventId,
        organizationId: orgOid,
        status: { $ne: EventStatus.CANCELLED },
      });
      expect(eventsCancel).not.toHaveBeenCalled();
      expect(summary.failedSteps).toEqual([]);
    });

    it("clears cancellationReason on the user's past bookings", async () => {
      await service.deleteAccount(userId, orgId);
      const call = models.Booking.updateMany.mock.calls.find(([, update]: any[]) => update.$unset?.cancellationReason !== undefined);
      expect(call[0]).toMatchObject({
        organizationId: orgOid,
        userId: userOid,
        cancellationReason: { $exists: true },
      });
      expect(call[0].endDate.$lte).toBeInstanceOf(Date);
    });
  });
});
