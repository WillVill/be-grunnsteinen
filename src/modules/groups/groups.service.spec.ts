import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { GroupsService } from './groups.service';
import { Group } from './schemas/group.schema';
import { User, UserRole } from '../users/schemas/user.schema';
import { NotificationService } from '../../shared/services/notification.service';
import { S3Service } from '../../shared/services/s3.service';
import { ConceptsService } from '../concepts/concepts.service';

// The real S3Service pulls in ESM-only uuid, which Jest can't parse; GroupsService never calls it here.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const memberId = new Types.ObjectId().toString();
const outsiderId = new Types.ObjectId().toString();
const groupId = new Types.ObjectId().toString();
const buildingId = new Types.ObjectId();

/** A Mongoose query stand-in: chainable populate/select/sort/skip/limit, resolved by exec(). */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  return q;
};

describe('GroupsService organisation and privacy scoping', () => {
  let service: GroupsService;
  let groupFindOne: jest.Mock;
  let groupFind: jest.Mock;
  let userFindById: jest.Mock;
  let userFind: jest.Mock;

  const group = (overrides: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(groupId),
    organizationId: new Types.ObjectId(orgId),
    buildingId,
    isPrivate: false,
    isConceptWide: false,
    isActive: true,
    members: [{ _id: new Types.ObjectId(memberId), name: 'Member' }],
    ...overrides,
  });

  beforeEach(async () => {
    groupFindOne = jest.fn();
    groupFind = jest.fn(() => query([]));
    userFindById = jest.fn();
    userFind = jest.fn(() => query([]));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        {
          provide: getModelToken(Group.name),
          useValue: { findOne: groupFindOne, find: groupFind, countDocuments: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: getModelToken(User.name),
          useValue: { findById: userFindById, find: userFind, countDocuments: jest.fn().mockResolvedValue(1) },
        },
        { provide: NotificationService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: ConceptsService, useValue: { findConceptIdForBuilding: jest.fn() } },
      ],
    }).compile();

    service = module.get(GroupsService);
  });

  describe('findById', () => {
    it('looks the group up inside the caller organisation and never populates member emails', async () => {
      const q = query(group());
      groupFindOne.mockReturnValue(q);
      await service.findById(groupId, orgId);
      expect(groupFindOne).toHaveBeenCalledWith({ _id: groupId, organizationId: new Types.ObjectId(orgId) });
      for (const [, fields] of q.populate.mock.calls) expect(fields).not.toContain('email');
    });

    it('reads a group from another organisation (or a bad id) as not found', async () => {
      groupFindOne.mockReturnValue(query(null));
      await expect(service.findById(groupId, orgId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findById('not-an-id', orgId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findOneForUser', () => {
    it('returns a public group to anyone in the organisation', async () => {
      groupFindOne.mockReturnValue(query(group()));
      await expect(service.findOneForUser(groupId, orgId, outsiderId)).resolves.toBeDefined();
      expect(userFindById).not.toHaveBeenCalled();
    });

    it('returns a private group to a member without a user lookup', async () => {
      groupFindOne.mockReturnValue(query(group({ isPrivate: true })));
      await expect(service.findOneForUser(groupId, orgId, memberId)).resolves.toBeDefined();
      expect(userFindById).not.toHaveBeenCalled();
    });

    it('forbids a private group to a resident who is not a member', async () => {
      groupFindOne.mockReturnValue(query(group({ isPrivate: true })));
      userFindById.mockResolvedValue({ role: UserRole.RESIDENT, buildingIds: [buildingId] });
      await expect(service.findOneForUser(groupId, orgId, outsiderId)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a board member see a private group', async () => {
      groupFindOne.mockReturnValue(query(group({ isPrivate: true })));
      userFindById.mockResolvedValue({ role: UserRole.BOARD, buildingIds: [] });
      await expect(service.findOneForUser(groupId, orgId, outsiderId)).resolves.toBeDefined();
    });
  });

  describe('getMembers', () => {
    it('forbids the member list of a private group to outsiders', async () => {
      groupFindOne.mockReturnValue(query(group({ isPrivate: true })));
      userFindById.mockResolvedValue({ role: UserRole.RESIDENT, buildingIds: [] });
      await expect(service.getMembers(groupId, orgId, outsiderId)).rejects.toBeInstanceOf(ForbiddenException);
      expect(userFind).not.toHaveBeenCalled();
    });

    it('selects no email for members', async () => {
      groupFindOne.mockReturnValue(query(group()));
      const q = query([]);
      userFind.mockReturnValue(q);
      await service.getMembers(groupId, orgId, memberId);
      expect(q.select).toHaveBeenCalledWith('name avatarUrl avatarColor');
    });
  });

  describe('findAll', () => {
    it('limits ?isPrivate=true to private groups the caller is a member of', async () => {
      await service.findAll(orgId, outsiderId, { isPrivate: true } as any);
      const filter = groupFind.mock.calls[0][0];
      expect(filter.isPrivate).toBe(true);
      expect(filter.members).toEqual(new Types.ObjectId(outsiderId));
      expect(filter.organizationId).toEqual(new Types.ObjectId(orgId));
    });

    it('lists public groups plus the caller private ones by default', async () => {
      await service.findAll(orgId, outsiderId, {} as any);
      const filter = groupFind.mock.calls[0][0];
      expect(filter.$or).toEqual([{ isPrivate: false }, { members: new Types.ObjectId(outsiderId) }]);
    });
  });

  describe('addMember', () => {
    it('refuses to add a user from another organisation', async () => {
      groupFindOne.mockReturnValue(query(group()));
      userFindById
        .mockResolvedValueOnce({ role: UserRole.BOARD, buildingIds: [] }) // inviter
        .mockResolvedValueOnce({ _id: new Types.ObjectId(outsiderId), organizationId: new Types.ObjectId() }); // target
      await expect(
        service.addMember(groupId, memberId, orgId, { userId: outsiderId } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
