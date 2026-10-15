import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { EventsService } from './events.service';
import { Event } from './schemas/event.schema';
import { User, UserRole } from '../users/schemas/user.schema';
import { Group } from '../groups/schemas/group.schema';
import { NotificationService } from '../../shared/services/notification.service';
import { EmailService } from '../../shared/services/email.service';
import { S3Service } from '../../shared/services/s3.service';
import { ConceptsService } from '../concepts/concepts.service';

// The real S3Service pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const otherOrgId = new Types.ObjectId().toString();
const memberId = new Types.ObjectId().toString();
const outsiderId = new Types.ObjectId().toString();
const groupId = new Types.ObjectId().toString();
const eventId = new Types.ObjectId().toString();

/** A Mongoose query stand-in: chainable, resolved by exec() or by awaiting it. */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
};

describe('EventsService organisation and group privacy', () => {
  let service: EventsService;
  let eventFind: jest.Mock;
  let eventFindOne: jest.Mock;
  let eventCreate: jest.Mock;
  let eventFindByIdAndUpdate: jest.Mock;
  let eventDeleteOne: jest.Mock;
  let groupFindOne: jest.Mock;
  let groupDistinct: jest.Mock;
  let groupFindById: jest.Mock;
  let createBulkNotifications: jest.Mock;
  let userFindById: jest.Mock;
  let userFind: jest.Mock;
  let assertBuildingInConcept: jest.Mock;

  const privateGroup = { isPrivate: true, isConceptWide: false, buildingId: new Types.ObjectId(), members: [new Types.ObjectId(memberId)] };
  /** Organised by the outsider, so only group privacy / organisation decide access. */
  const groupEvent = () => ({
    _id: new Types.ObjectId(eventId),
    organizationId: new Types.ObjectId(orgId),
    organizerId: { _id: new Types.ObjectId(outsiderId) },
    groupId: new Types.ObjectId(groupId),
    participants: [] as Types.ObjectId[],
    participantsCount: 0,
    maxParticipants: 0,
    startDate: new Date(),
    endDate: new Date(),
    save: jest.fn(),
  });
  /** The event only exists in `orgId`: findOne honours the organisation in the filter like Mongo would. */
  const inOrg = (event: unknown) => (filter: { organizationId?: Types.ObjectId }) =>
    query(filter.organizationId?.equals(orgId) ? event : null);

  beforeEach(async () => {
    eventFind = jest.fn(() => query([]));
    eventFindOne = jest.fn(inOrg(groupEvent()));
    eventCreate = jest.fn();
    eventFindByIdAndUpdate = jest.fn(() => query(groupEvent()));
    eventDeleteOne = jest.fn();
    groupFindOne = jest.fn(() => query(privateGroup));
    groupDistinct = jest.fn().mockResolvedValue([]);
    groupFindById = jest.fn(() => query(privateGroup));
    createBulkNotifications = jest.fn().mockResolvedValue(undefined);
    userFindById = jest.fn(() => query({ role: UserRole.RESIDENT, buildingIds: [], name: 'U', email: 'u@x' }));
    userFind = jest.fn(() => query([]));
    assertBuildingInConcept = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: getModelToken(Event.name),
          useValue: {
            find: eventFind,
            findOne: eventFindOne,
            findById: jest.fn(() => query(groupEvent())),
            create: eventCreate,
            findByIdAndUpdate: eventFindByIdAndUpdate,
            deleteOne: eventDeleteOne,
            countDocuments: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: getModelToken(User.name),
          useValue: { findById: userFindById, find: userFind, countDocuments: jest.fn().mockResolvedValue(0) },
        },
        { provide: getModelToken(Group.name), useValue: { findOne: groupFindOne, findById: groupFindById, distinct: groupDistinct } },
        { provide: NotificationService, useValue: { createNotification: jest.fn().mockResolvedValue(undefined), createBulkNotifications } },
        { provide: EmailService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: ConceptsService, useValue: { findConceptIdForBuilding: jest.fn(), assertConceptInOrg: jest.fn(), assertBuildingInConcept } },
      ],
    }).compile();

    service = module.get(EventsService);
  });

  const createDto = (overrides: Record<string, unknown> = {}) =>
    ({
      title: 't',
      location: 'l',
      startDate: new Date('2030-01-01'),
      endDate: new Date('2030-01-02'),
      buildingId: new Types.ObjectId().toString(),
      groupId,
      ...overrides,
    }) as any;

  describe('create', () => {
    it('forbids creating an event in a private group the organizer is not in', async () => {
      await expect(service.create(outsiderId, orgId, createDto())).rejects.toBeInstanceOf(ForbiddenException);
      expect(eventCreate).not.toHaveBeenCalled();
    });

    it('reads a group from another organisation as not found', async () => {
      groupFindOne.mockReturnValue(query(null));
      await expect(service.create(memberId, orgId, createDto())).rejects.toBeInstanceOf(NotFoundException);
      expect(groupFindOne.mock.calls[0][0]).toEqual({ _id: groupId, organizationId: new Types.ObjectId(orgId) });
      expect(eventCreate).not.toHaveBeenCalled();
    });

    it('lets a member create it', async () => {
      eventCreate.mockResolvedValue({ _id: new Types.ObjectId(), startDate: new Date() });
      groupFindOne.mockReturnValue(query(privateGroup));
      await expect(service.create(memberId, orgId, createDto({ groupId: undefined }))).resolves.toBeDefined();
      await expect(service.create(memberId, orgId, createDto())).resolves.toBeDefined();
      expect(eventCreate).toHaveBeenCalledTimes(2);
    });

    it('rejects a building outside the caller\'s organisation or concept when a concept is also sent', async () => {
      const conceptId = new Types.ObjectId().toString();
      const dto = createDto({ groupId: undefined, conceptId });
      assertBuildingInConcept.mockRejectedValue(new NotFoundException('Building not found'));
      await expect(service.create(memberId, orgId, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(assertBuildingInConcept).toHaveBeenCalledWith(dto.buildingId, conceptId, orgId);
      expect(eventCreate).not.toHaveBeenCalled();
    });
  });

  describe('create notifications', () => {
    it('does not fall through to the building when the group has no members besides the organizer', async () => {
      eventCreate.mockResolvedValue({
        _id: new Types.ObjectId(),
        title: 't',
        location: 'l',
        startDate: new Date(),
        groupId: new Types.ObjectId(groupId),
        buildingId: new Types.ObjectId(),
        isConceptWide: true,
      });
      // Only the organizer is a member of the group.
      groupFindById.mockReturnValue(query(privateGroup));
      userFind.mockClear();

      await service.create(memberId, orgId, createDto());

      expect(groupFindById).toHaveBeenCalled();
      expect(userFind).not.toHaveBeenCalled();
      expect(createBulkNotifications).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('forbids moving an event into a private group the caller is not in', async () => {
      // The outsider organises the event, so only the group check stops them.
      await expect(service.update(eventId, outsiderId, orgId, { groupId } as any)).rejects.toBeInstanceOf(ForbiddenException);
      expect(eventFindByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('skips the group check when the group is not being changed', async () => {
      await expect(service.update(eventId, outsiderId, orgId, { title: 'x' } as any)).resolves.toBeDefined();
      expect(groupFindOne).not.toHaveBeenCalled();
    });
  });

  describe('organisation scoping', () => {
    it.each<[string, (s: EventsService, org: string) => Promise<unknown>]>([
      ['read', (s, org) => s.findOneForUser(eventId, org, outsiderId)],
      ['update', (s, org) => s.update(eventId, outsiderId, org, { title: 'x' } as any)],
      ['delete', (s, org) => s.delete(eventId, outsiderId, org)],
      ['cancel', (s, org) => s.cancel(eventId, outsiderId, org)],
      ['join', (s, org) => s.join(eventId, memberId, org)],
      ['leave', (s, org) => s.leave(eventId, outsiderId, org)],
      ['participants', (s, org) => s.getParticipants(eventId, org, memberId)],
    ])('reads another organisation\'s event as not found (%s)', async (_action, call) => {
      await expect(call(service, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(eventFindByIdAndUpdate).not.toHaveBeenCalled();
      expect(eventDeleteOne).not.toHaveBeenCalled();
    });

    it('reads a malformed id as not found without querying', async () => {
      await expect(service.findById('nope', orgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(eventFindOne).not.toHaveBeenCalled();
    });

    it('lets the organizer delete their event in their organisation', async () => {
      await expect(service.delete(eventId, outsiderId, orgId)).resolves.toBeUndefined();
      expect(eventDeleteOne).toHaveBeenCalledWith({ _id: eventId });
    });
  });

  describe('single event reads', () => {
    beforeEach(() => {
      // Organised by someone else, so the outsider has no organizer rights.
      eventFindOne.mockImplementation(inOrg({ ...groupEvent(), organizerId: { _id: new Types.ObjectId() } }));
    });

    it('forbids a private group event, its participants and joining it to a non-member', async () => {
      await expect(service.findOneForUser(eventId, orgId, outsiderId)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.getParticipants(eventId, orgId, outsiderId)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.join(eventId, outsiderId, orgId)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a member', async () => {
      await expect(service.findOneForUser(eventId, orgId, memberId)).resolves.toBeDefined();
      await expect(service.getParticipants(eventId, orgId, memberId)).resolves.toBeDefined();
    });

    it('never selects participant emails', async () => {
      const q = query([]);
      userFind.mockReturnValue(q);
      await service.getParticipants(eventId, orgId, memberId);
      expect(q.select).toHaveBeenCalledWith('name avatarUrl avatarColor');
      expect(q.select.mock.calls.flat().join(' ')).not.toContain('email');
    });

    it('lets board see it', async () => {
      userFindById.mockReturnValue(query({ role: UserRole.BOARD, buildingIds: [] }));
      await expect(service.findOneForUser(eventId, orgId, outsiderId)).resolves.toBeDefined();
    });

    it('allows reading an event whose group no longer exists', async () => {
      groupFindOne.mockReturnValue(query(null));
      await expect(service.findOneForUser(eventId, orgId, outsiderId)).resolves.toBeDefined();
    });

    it('forbids managing someone else\'s event to a resident', async () => {
      await expect(service.findManageable(eventId, orgId, outsiderId)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findAll / getUpcoming', () => {
    it('leaves events from private groups the caller is not in out of the list', async () => {
      const hidden = [new Types.ObjectId()];
      groupDistinct.mockResolvedValue(hidden);
      await service.findAll(orgId, outsiderId, {} as any);
      expect(groupDistinct).toHaveBeenCalledWith('_id', {
        organizationId: new Types.ObjectId(orgId),
        isPrivate: true,
        members: { $ne: new Types.ObjectId(outsiderId) },
      });
      expect(eventFind.mock.calls[0][0].groupId).toEqual({ $nin: hidden });
    });

    it('does not look the caller up when no private group is hidden', async () => {
      await service.findAll(orgId, outsiderId, {} as any);
      expect(userFindById).not.toHaveBeenCalled();
      expect(eventFind.mock.calls[0][0].groupId).toBeUndefined();
    });

    it.each([UserRole.BOARD, UserRole.ADMIN])('keeps private-group events for %s', async (role) => {
      groupDistinct.mockResolvedValue([new Types.ObjectId()]);
      userFindById.mockReturnValue(query({ role }));
      await service.findAll(orgId, outsiderId, {} as any);
      expect(eventFind.mock.calls[0][0].groupId).toBeUndefined();
    });

    it('applies the same exclusion to upcoming events', async () => {
      const hidden = [new Types.ObjectId()];
      groupDistinct.mockResolvedValue(hidden);
      await service.getUpcoming(orgId, outsiderId);
      expect(eventFind.mock.calls[0][0].groupId).toEqual({ $nin: hidden });
      expect(eventFind.mock.calls[0][0].organizationId).toEqual(new Types.ObjectId(orgId));
    });
  });
});
