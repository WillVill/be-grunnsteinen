import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User, UserRole } from './schemas/user.schema';
import { Organization } from '../organizations/schemas/organization.schema';
import { Building } from '../buildings/schemas/building.schema';
import { EmailService } from '../../shared/services/email.service';

const orgId = '507f1f77bcf86cd799439011';
const inviterId = '507f1f77bcf86cd799439012';
const targetId = '507f1f77bcf86cd799439013';

describe('UsersService admin invitation flow', () => {
  let service: UsersService;
  let saveMock: jest.Mock;
  let userModelFindOne: jest.Mock;
  let userModelFindById: jest.Mock;
  let deleteOneMock: jest.Mock;
  let sendAdminSetupEmail: jest.Mock;
  let buildingCountDocuments: jest.Mock;
  let userModelFindByIdAndUpdate: jest.Mock;

  const buildModule = async (existingUser: any = null) => {
    saveMock = jest.fn().mockResolvedValue(undefined);
    deleteOneMock = jest.fn().mockResolvedValue({ deletedCount: 1 });
    userModelFindOne = jest.fn();
    userModelFindById = jest.fn().mockReturnValue({ name: 'Inviter' });
    sendAdminSetupEmail = jest.fn().mockResolvedValue(undefined);
    // Buildings in the caller's org: every id passed counts as found unless a test says otherwise.
    buildingCountDocuments = jest.fn(async (filter: any) => filter._id.$in.length);
    userModelFindByIdAndUpdate = jest.fn(async (_id: any, update: any) => ({ email: 'x@y', ...update.$set }));

    const userModelCtor: any = function (doc: any) {
      Object.assign(this, doc);
      this.save = saveMock;
      this._id = new Types.ObjectId(targetId);
    };
    userModelCtor.findOne = userModelFindOne;
    userModelCtor.findById = userModelFindById;
    userModelCtor.deleteOne = deleteOneMock;
    userModelCtor.findByIdAndUpdate = userModelFindByIdAndUpdate;

    // Default findOne returns `existingUser` for email-duplicate check
    userModelFindOne.mockImplementation((query: any) => {
      if (query.email) return Promise.resolve(existingUser);
      // For resendAdminInvite / deactivate: findOne with select chain
      return {
        select: () => Promise.resolve(existingUser),
      };
    });

    const organizationModel = {
      findById: jest.fn().mockResolvedValue({ name: 'Test Org' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModelCtor },
        { provide: getModelToken(Organization.name), useValue: organizationModel },
        { provide: getModelToken(Building.name), useValue: { countDocuments: buildingCountDocuments } },
        { provide: EmailService, useValue: { sendAdminSetupEmail } },
        { provide: ConfigService, useValue: { get: () => 'https://example.com' } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  };

  describe('createAdminUser', () => {
    it('creates a pending user with setup token and sends email', async () => {
      await buildModule(null);
      await service.createAdminUser(orgId, {
        email: 'NEW@Example.com',
        role: UserRole.ADMIN,
        buildingIds: [],
      } as any, inviterId);

      expect(saveMock).toHaveBeenCalledTimes(1);
      // Wait for the fire-and-forget send to settle
      await new Promise((r) => setImmediate(r));
      expect(sendAdminSetupEmail).toHaveBeenCalledTimes(1);
      const [toEmail, orgName, inviterName, roleLabel, setupLink] = sendAdminSetupEmail.mock.calls[0];
      expect(toEmail).toBe('new@example.com');
      expect(orgName).toBe('Test Org');
      expect(inviterName).toBe('Inviter');
      expect(roleLabel).toBe('administrator');
      expect(setupLink).toMatch(/^https:\/\/example\.com\/setup-account\?token=[0-9a-f]{64}$/);
    });

    it('rejects when email already exists', async () => {
      await buildModule({ email: 'existing@example.com' });
      await expect(
        service.createAdminUser(orgId, {
          email: 'existing@example.com',
          role: UserRole.ADMIN,
        } as any, inviterId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(saveMock).not.toHaveBeenCalled();
    });
  });

  describe('resendAdminInvite', () => {
    it('rotates the token and re-sends email for a pending user', async () => {
      const pendingUser: any = {
        _id: targetId,
        email: 'pending@example.com',
        role: UserRole.ADMIN,
        organizationId: orgId,
        isActive: false,
        setupTokenExpires: new Date(Date.now() + 1000),
        save: jest.fn().mockResolvedValue(undefined),
      };
      await buildModule(pendingUser);

      await service.resendAdminInvite(orgId, targetId, inviterId);

      expect(pendingUser.save).toHaveBeenCalled();
      expect(pendingUser.setupToken).toMatch(/^[0-9a-f]{64}$/);
      expect(pendingUser.setupTokenExpires.getTime()).toBeGreaterThan(Date.now());
      await new Promise((r) => setImmediate(r));
      expect(sendAdminSetupEmail).toHaveBeenCalled();
    });

    it('throws BadRequest when target user is already active', async () => {
      const activeUser: any = {
        _id: targetId,
        email: 'active@example.com',
        isActive: true,
        setupTokenExpires: undefined,
      };
      await buildModule(activeUser);
      await expect(
        service.resendAdminInvite(orgId, targetId, inviterId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when target user does not exist', async () => {
      await buildModule(null);
      await expect(
        service.resendAdminInvite(orgId, targetId, inviterId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deactivateUser', () => {
    it('hard-deletes a pending user', async () => {
      const pendingUser: any = {
        _id: new Types.ObjectId(targetId),
        email: 'pending@example.com',
        isActive: false,
        setupTokenExpires: new Date(Date.now() + 1000),
        save: jest.fn(),
      };
      await buildModule(pendingUser);

      await service.deactivateUser(orgId, targetId);

      expect(deleteOneMock).toHaveBeenCalledWith({ _id: pendingUser._id });
      expect(pendingUser.save).not.toHaveBeenCalled();
    });

    it('soft-deactivates an active user', async () => {
      const activeUser: any = {
        _id: new Types.ObjectId(targetId),
        email: 'active@example.com',
        isActive: true,
        setupTokenExpires: undefined,
        save: jest.fn().mockResolvedValue(undefined),
      };
      await buildModule(activeUser);

      await service.deactivateUser(orgId, targetId);

      expect(deleteOneMock).not.toHaveBeenCalled();
      expect(activeUser.isActive).toBe(false);
      expect(activeUser.save).toHaveBeenCalled();
    });
  });

  describe('admin buildingIds must be in the organisation', () => {
    const ownBuilding = new Types.ObjectId().toString();
    const foreignBuilding = new Types.ObjectId().toString();
    /** Only `ownBuilding` exists in `orgId`. */
    const onlyOwn = async (filter: any) =>
      filter.organizationId.equals(orgId)
        ? filter._id.$in.filter((id: Types.ObjectId) => id.equals(ownBuilding)).length
        : 0;

    it('createAdminUser rejects a building from another organisation', async () => {
      await buildModule(null);
      buildingCountDocuments.mockImplementation(onlyOwn);
      await expect(
        service.createAdminUser(orgId, { email: 'host@example.com', role: UserRole.ADMIN, buildingIds: [ownBuilding, foreignBuilding] } as any, inviterId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(saveMock).not.toHaveBeenCalled();
    });

    it('createAdminUser accepts buildings in the organisation', async () => {
      await buildModule(null);
      buildingCountDocuments.mockImplementation(onlyOwn);
      await service.createAdminUser(orgId, { email: 'host@example.com', role: UserRole.ADMIN, buildingIds: [ownBuilding] } as any, inviterId);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it('updateAdminUser rejects a building from another organisation', async () => {
      await buildModule(null);
      buildingCountDocuments.mockImplementation(onlyOwn);
      userModelFindOne.mockResolvedValue({ _id: new Types.ObjectId(targetId), role: UserRole.ADMIN, email: 'a@b' });
      await expect(
        service.updateAdminUser(orgId, targetId, { buildingIds: [foreignBuilding] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(userModelFindByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('updateAdminUser sets buildings (and the primary building) in the organisation', async () => {
      await buildModule(null);
      buildingCountDocuments.mockImplementation(onlyOwn);
      userModelFindOne.mockResolvedValue({ _id: new Types.ObjectId(targetId), role: UserRole.ADMIN, email: 'a@b' });
      await service.updateAdminUser(orgId, targetId, { buildingIds: [ownBuilding] } as any);
      const set = userModelFindByIdAndUpdate.mock.calls[0][1].$set;
      expect(set.primaryBuildingId).toEqual(new Types.ObjectId(ownBuilding));
    });
  });
});

describe('UsersService hides deleted accounts from lists', () => {
  let service: UsersService;
  let find: jest.Mock;
  let countDocuments: jest.Mock;

  beforeEach(async () => {
    const chain: any = {};
    for (const m of ['sort', 'skip', 'limit', 'select']) chain[m] = jest.fn(() => chain);
    chain.exec = jest.fn().mockResolvedValue([]);
    find = jest.fn(() => chain);
    countDocuments = jest.fn().mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: { find, countDocuments } },
        { provide: getModelToken(Organization.name), useValue: {} },
        { provide: getModelToken(Building.name), useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://example.com' } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it.each([
    ['the users list', {}],
    ['the admins list (which also shows pending invites)', { onlyRoles: 'admin,super_admin' }],
  ])('%s filters out isDeleted', async (_label, query) => {
    await service.findByOrganization(orgId, { page: 1, limit: 20, ...query } as any);
    expect(find.mock.calls[0][0]).toMatchObject({
      organizationId: new Types.ObjectId(orgId),
      isDeleted: { $ne: true },
    });
    expect(countDocuments.mock.calls[0][0]).toMatchObject({ isDeleted: { $ne: true } });
  });

  it('the helpful-neighbours list filters out isDeleted', async () => {
    await service.getHelpfulNeighbors(orgId);
    expect(find.mock.calls[0][0]).toMatchObject({
      organizationId: new Types.ObjectId(orgId),
      isActive: true,
      isDeleted: { $ne: true },
    });
  });
});

describe('UsersService admin edits refuse deleted accounts', () => {
  let service: UsersService;
  let findOne: jest.Mock;
  let findOneAndUpdate: jest.Mock;

  beforeEach(async () => {
    findOne = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(targetId),
      role: UserRole.ADMIN,
      isDeleted: true,
      save: jest.fn(),
    });
    findOneAndUpdate = jest.fn().mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: { findOne, findOneAndUpdate } },
        { provide: getModelToken(Organization.name), useValue: {} },
        { provide: getModelToken(Building.name), useValue: { countDocuments: jest.fn() } },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://example.com' } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('updateAdminUser 404s for a tombstone', async () => {
    await expect(service.updateAdminUser(orgId, targetId, { name: 'X' } as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updateCareInfo excludes tombstones from its match, so it 404s', async () => {
    await expect(service.updateCareInfo(orgId, targetId, { pets: { hasPets: true } } as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      organizationId: new Types.ObjectId(orgId),
      isDeleted: { $ne: true },
    });
  });
});

describe('UsersService blocking', () => {
  let service: UsersService;
  let findOne: jest.Mock;
  let updateOne: jest.Mock;
  let findById: jest.Mock;
  const me = '507f1f77bcf86cd799439021';

  beforeEach(async () => {
    findOne = jest.fn().mockResolvedValue({ _id: new Types.ObjectId(targetId), isDeleted: false });
    updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const q: any = {};
    q.select = jest.fn().mockReturnValue(q);
    q.lean = jest.fn().mockReturnValue(q);
    q.exec = jest.fn().mockResolvedValue({ blockedUserIds: [new Types.ObjectId(targetId)] });
    findById = jest.fn().mockReturnValue(q);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: { findOne, updateOne, findById } },
        { provide: getModelToken(Organization.name), useValue: {} },
        { provide: getModelToken(Building.name), useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://example.com' } },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  describe('blockUser', () => {
    it('refuses to block yourself', async () => {
      await expect(service.blockUser(me, me, orgId)).rejects.toBeInstanceOf(BadRequestException);
      expect(updateOne).not.toHaveBeenCalled();
    });

    it('404s for a user outside the org', async () => {
      findOne.mockResolvedValue(null);
      await expect(service.blockUser(me, targetId, orgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(findOne.mock.calls[0][0]).toMatchObject({
        _id: targetId,
        organizationId: new Types.ObjectId(orgId),
      });
      expect(updateOne).not.toHaveBeenCalled();
    });

    it('404s for a deleted user', async () => {
      findOne.mockResolvedValue({ _id: new Types.ObjectId(targetId), isDeleted: true });
      await expect(service.blockUser(me, targetId, orgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(updateOne).not.toHaveBeenCalled();
    });

    it('adds the target with $addToSet', async () => {
      await service.blockUser(me, targetId, orgId);
      expect(updateOne).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(me), organizationId: new Types.ObjectId(orgId) },
        { $addToSet: { blockedUserIds: new Types.ObjectId(targetId) } },
      );
    });
  });

  describe('unblockUser', () => {
    it('removes the target with $pull', async () => {
      await service.unblockUser(me, targetId, orgId);
      expect(updateOne).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(me), organizationId: new Types.ObjectId(orgId) },
        { $pull: { blockedUserIds: new Types.ObjectId(targetId) } },
      );
    });

    it('404s on a malformed id', async () => {
      await expect(service.unblockUser(me, 'nope', orgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(updateOne).not.toHaveBeenCalled();
    });
  });

  it('getBlockedUserIds returns strings', async () => {
    expect(await service.getBlockedUserIds(me)).toEqual([targetId]);
  });
});
