import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { User, UserRole } from '../users/schemas/user.schema';
import { Organization } from '../organizations/schemas/organization.schema';
import { Apartment } from '../apartments/schemas/apartment.schema';
import { EmailService } from '../../shared/services/email.service';
import { InvitationsService } from '../invitations/invitations.service';
import { TenantProfilesService } from '../tenant-profiles/tenant-profiles.service';

function hashToken(plain: string) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

describe('AuthService admin setup flow', () => {
  let service: AuthService;
  let userModelFindOne: jest.Mock;
  let userModelFindById: jest.Mock;
  let save: jest.Mock;

  const buildModule = async (userDoc: any = null) => {
    save = jest.fn().mockResolvedValue(undefined);
    userModelFindOne = jest.fn();
    userModelFindById = jest.fn();

    // findOne(...).select(...) => Promise<userDoc>
    userModelFindOne.mockImplementation(() => ({
      select: () => Promise.resolve(userDoc),
    }));
    // findById(id).select(...) => Promise<userDoc>
    userModelFindById.mockImplementation(() => ({
      select: () => Promise.resolve(userDoc),
    }));

    const userModel = { findOne: userModelFindOne, findById: userModelFindById };
    const organizationModel = {
      findById: jest.fn().mockResolvedValue({ name: 'Test Org' }),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Organization.name), useValue: organizationModel },
        { provide: getModelToken(Apartment.name), useValue: { findOneAndUpdate: jest.fn() } },
        { provide: JwtService, useValue: { sign: () => 'token-xyz', verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'secret' } },
        { provide: EmailService, useValue: { sendEmail: jest.fn(), sendWelcomeEmail: jest.fn(), sendPasswordResetEmail: jest.fn() } },
        { provide: InvitationsService, useValue: { validate: jest.fn(), markAccepted: jest.fn() } },
        { provide: TenantProfilesService, useValue: { markRegistered: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  };

  describe('validateSetupToken', () => {
    it('returns email/role/org when token is valid', async () => {
      const plain = 'plain-abc';
      await buildModule({
        email: 'invitee@example.com',
        role: UserRole.ADMIN,
        organizationId: new Types.ObjectId('507f1f77bcf86cd799439011'),
      });
      const result = await service.validateSetupToken(plain);
      expect(result.email).toBe('invitee@example.com');
      expect(result.role).toBe(UserRole.ADMIN);
      expect(result.organizationName).toBe('Test Org');
    });

    it('throws when token is invalid/expired (no user found)', async () => {
      await buildModule(null);
      await expect(service.validateSetupToken('bogus')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('completeSetup', () => {
    it('activates the user, clears token, and returns tokens', async () => {
      const pending: any = {
        _id: new Types.ObjectId('507f1f77bcf86cd799439013'),
        email: 'invitee@example.com',
        role: UserRole.ADMIN,
        organizationId: new Types.ObjectId('507f1f77bcf86cd799439011'),
        buildingIds: [],
        isActive: false,
        setupToken: hashToken('plain-abc'),
        setupTokenExpires: new Date(Date.now() + 60 * 1000),
        toObject() { return { ...this }; },
        save: jest.fn().mockResolvedValue(undefined),
      };
      await buildModule(pending);

      const result = await service.completeSetup({
        token: 'plain-abc',
        name: 'Invitee',
        phone: '+4712345678',
        password: 'password1!',
      });

      expect(pending.name).toBe('Invitee');
      expect(pending.phone).toBe('+4712345678');
      expect(pending.password).toBe('password1!');
      expect(pending.isActive).toBe(true);
      expect(pending.setupToken).toBeUndefined();
      expect(pending.setupTokenExpires).toBeUndefined();
      expect(pending.save).toHaveBeenCalled();
      expect(result.accessToken).toBe('token-xyz');
      expect(result.refreshToken).toBe('token-xyz');
    });

    it('throws when token is invalid', async () => {
      await buildModule(null);
      await expect(
        service.completeSetup({ token: 'bogus', name: 'X', password: 'password1!' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('login pending detection', () => {
    it('throws UnauthorizedException with ACCOUNT_PENDING_SETUP code when user is pending', async () => {
      const pending: any = {
        _id: new Types.ObjectId(),
        email: 'pending@example.com',
        password: undefined,
        isActive: false,
        setupTokenExpires: new Date(Date.now() + 60 * 1000),
        role: UserRole.ADMIN,
        organizationId: new Types.ObjectId('507f1f77bcf86cd799439011'),
        buildingIds: [],
        save: jest.fn(),
        comparePassword: jest.fn().mockResolvedValue(false),
      };
      await buildModule(pending);

      try {
        await service.login({ email: pending.email, password: 'anything' } as any);
        fail('expected to throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        expect(e.getResponse()).toEqual(expect.objectContaining({ code: 'ACCOUNT_PENDING_SETUP' }));
      }
    });
  });
});
