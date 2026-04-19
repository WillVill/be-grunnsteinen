import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User, UserRole } from './schemas/user.schema';
import { Organization } from '../organizations/schemas/organization.schema';
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

  const buildModule = async (existingUser: any = null) => {
    saveMock = jest.fn().mockResolvedValue(undefined);
    deleteOneMock = jest.fn().mockResolvedValue({ deletedCount: 1 });
    userModelFindOne = jest.fn();
    userModelFindById = jest.fn().mockReturnValue({ name: 'Inviter' });
    sendAdminSetupEmail = jest.fn().mockResolvedValue(undefined);

    const userModelCtor: any = function (doc: any) {
      Object.assign(this, doc);
      this.save = saveMock;
      this._id = new Types.ObjectId(targetId);
    };
    userModelCtor.findOne = userModelFindOne;
    userModelCtor.findById = userModelFindById;
    userModelCtor.deleteOne = deleteOneMock;

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
});
