// concepts.service transitively imports the ESM-only `uuid` package (via
// s3.service), which Jest can't parse — stub the module out.
jest.mock('../concepts/concepts.service', () => ({
  ConceptsService: class ConceptsService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { Building } from './schemas/building.schema';
import { User, UserRole } from '../users/schemas/user.schema';
import { TenantProfile } from '../tenant-profiles/schemas/tenant-profile.schema';
import { Apartment } from '../apartments/schemas/apartment.schema';
import { EmailService } from '../../shared/services/email.service';
import { TwilioService } from '../../shared/services/twilio.service';
import { ConceptsService } from '../concepts/concepts.service';
import { MessagesService } from '../messages/messages.service';

const orgId = '507f1f77bcf86cd799439011';
const buildingId = '507f1f77bcf86cd799439013';
const residentA = '507f1f77bcf86cd799439021';
const residentB = '507f1f77bcf86cd799439022';

const currentUser = (role: UserRole) =>
  ({
    userId: '507f1f77bcf86cd799439012',
    email: 'staff@example.com',
    role,
    organizationId: orgId,
    buildingIds: [buildingId],
  }) as any;

describe('BuildingsService broadcast channels', () => {
  let service: BuildingsService;
  let broadcastSupportMessage: jest.Mock;
  let sendEmail: jest.Mock;

  const users = [
    { _id: new Types.ObjectId(residentA), email: 'a@example.com', phone: '+4798765432' },
    { _id: new Types.ObjectId(residentB), email: 'b@example.com', phone: undefined },
  ];
  const profiles = [{ email: 'profil@example.com', phone: undefined }];

  const buildModule = async () => {
    broadcastSupportMessage = jest.fn().mockResolvedValue({ sent: 2, failed: 0 });
    sendEmail = jest.fn().mockResolvedValue(undefined);

    const tenantProfileModel: any = {
      find: jest.fn().mockReturnValue({ exec: async () => profiles }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildingsService,
        { provide: getModelToken(Building.name), useValue: {} },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getModelToken(TenantProfile.name), useValue: tenantProfileModel },
        { provide: getModelToken(Apartment.name), useValue: {} },
        { provide: EmailService, useValue: { sendEmail } },
        {
          provide: TwilioService,
          useValue: {
            isConfigured: () => true,
            normalizeE164: (p?: string) => (p ? p : null),
            sendSms: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ConceptsService, useValue: {} },
        { provide: MessagesService, useValue: { broadcastSupportMessage } },
      ],
    }).compile();

    service = module.get<BuildingsService>(BuildingsService);
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ name: 'Bygg A' } as any);
    jest.spyOn(service, 'getBuildingUsers').mockResolvedValue(users as any);
  };

  describe('sendMessageToTenants', () => {
    it('throws when no channel is selected', async () => {
      await buildModule();
      await expect(
        service.sendMessageToTenants(currentUser(UserRole.ADMIN), buildingId, {
          channels: {},
          body: 'Hei',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(broadcastSupportMessage).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('broadcasts in-app to registered users only, on the grunnsteinen channel for admins', async () => {
      await buildModule();

      const result = await service.sendMessageToTenants(
        currentUser(UserRole.ADMIN),
        buildingId,
        { channels: { inApp: true }, body: 'Hei alle' } as any,
      );

      expect(broadcastSupportMessage).toHaveBeenCalledTimes(1);
      const [staffUserId, org, residentIds, channel, content, options] =
        broadcastSupportMessage.mock.calls[0];
      expect(staffUserId).toBe(currentUser(UserRole.ADMIN).userId);
      expect(org).toBe(orgId);
      expect(residentIds).toEqual([residentA, residentB]); // profiles excluded
      expect(channel).toBe('grunnsteinen');
      expect(content).toBe('Hei alle');
      expect(options).toMatchObject({
        suppressEmailNotification: false,
        preferredBuildingId: buildingId,
      });
      expect((result as any).sentInApp).toBe(2);
      expect((result as any).failedInApp).toBe(0);
      // in-app only: no emails sent
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('broadcasts on the husvert channel for hosts', async () => {
      await buildModule();

      await service.sendMessageToTenants(currentUser(UserRole.HOST), buildingId, {
        channels: { inApp: true },
        body: 'Hei',
      } as any);

      expect(broadcastSupportMessage.mock.calls[0][3]).toBe('husvert');
    });

    it('suppresses the notification email when email channel is also on', async () => {
      await buildModule();

      await service.sendMessageToTenants(currentUser(UserRole.ADMIN), buildingId, {
        channels: { inApp: true, email: true },
        subject: 'Info',
        body: 'Hei',
      } as any);

      expect(broadcastSupportMessage.mock.calls[0][5]).toMatchObject({
        suppressEmailNotification: true,
      });
      // email still goes to both users and the reachable profile
      expect(sendEmail).toHaveBeenCalledTimes(3);
    });
  });

  describe('countMessageRecipients', () => {
    it('counts in-app reach as registered users and flags unreachable profiles', async () => {
      await buildModule();

      const count = await service.countMessageRecipients(
        currentUser(UserRole.ADMIN),
        buildingId,
        { channels: { inApp: true }, body: 'Hei' } as any,
      );

      expect((count as any).reachableInApp).toBe(2);
      expect((count as any).skippedNoApp).toBe(1);
    });

    it('reports zero in-app reach when the channel is off', async () => {
      await buildModule();

      const count = await service.countMessageRecipients(
        currentUser(UserRole.ADMIN),
        buildingId,
        { channels: { email: true }, subject: 'Info', body: 'Hei' } as any,
      );

      expect((count as any).reachableInApp).toBe(0);
      expect((count as any).skippedNoApp).toBe(0);
      expect((count as any).reachableEmail).toBe(3);
    });
  });
});
