import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SharingService } from './sharing.service';
import { HelpRequest, HelpRequestStatus } from './schemas/help-request.schema';
import { SharedItem } from './schemas/shared-item.schema';
import { User, UserRole } from '../users/schemas/user.schema';
import { NotificationService } from '../../shared/services/notification.service';
import { EmailService } from '../../shared/services/email.service';
import { ConceptsService } from '../concepts/concepts.service';

// S3Service (reached through the notification imports) pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const otherOrgId = new Types.ObjectId().toString();
const ownerId = new Types.ObjectId().toString();
const outsiderId = new Types.ObjectId().toString();
const requestId = new Types.ObjectId().toString();
const itemId = new Types.ObjectId().toString();

/** A Mongoose query stand-in: chainable, resolved by exec() or by awaiting it. */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
};

describe('SharingService organisation scoping', () => {
  let service: SharingService;
  let helpFindOne: jest.Mock;
  let itemFindOne: jest.Mock;
  let itemFindOneAndUpdate: jest.Mock;
  let itemDeleteOne: jest.Mock;
  let createNotification: jest.Mock;
  let helpRequest: any;
  let item: any;
  let helpCreate: jest.Mock;
  let itemCreate: jest.Mock;
  let assertBuildingInConcept: jest.Mock;

  /** Records only exist in `orgId`: findOne honours the organisation like Mongo would. */
  const inOrg = (result: () => unknown) => (filter: { organizationId?: Types.ObjectId }) =>
    query(filter.organizationId?.equals(orgId) ? result() : null);

  beforeEach(async () => {
    helpRequest = {
      _id: new Types.ObjectId(requestId),
      requesterId: { _id: new Types.ObjectId(ownerId), name: 'Kari' },
      helperId: undefined,
      status: HelpRequestStatus.OPEN,
      save: jest.fn(),
    };
    item = {
      _id: new Types.ObjectId(itemId),
      ownerId: { _id: new Types.ObjectId(ownerId), name: 'Kari' },
      isAvailable: true,
      save: jest.fn(),
    };
    helpFindOne = jest.fn(inOrg(() => helpRequest));
    itemFindOne = jest.fn(inOrg(() => item));
    itemFindOneAndUpdate = jest.fn(() => query(item));
    itemDeleteOne = jest.fn();
    createNotification = jest.fn().mockResolvedValue(undefined);
    helpCreate = jest.fn();
    itemCreate = jest.fn();
    assertBuildingInConcept = jest.fn().mockRejectedValue(new NotFoundException('Building not found'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SharingService,
        { provide: getModelToken(HelpRequest.name), useValue: { findOne: helpFindOne, create: helpCreate, findById: jest.fn(() => query(helpRequest)) } },
        {
          provide: getModelToken(SharedItem.name),
          useValue: { findOne: itemFindOne, findOneAndUpdate: itemFindOneAndUpdate, deleteOne: itemDeleteOne, create: itemCreate, findById: jest.fn(() => query(item)) },
        },
        { provide: getModelToken(User.name), useValue: { findById: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), name: 'A B', email: 'a@b', role: UserRole.ADMIN, buildingIds: [] }) } },
        { provide: NotificationService, useValue: { createNotification } },
        { provide: EmailService, useValue: {} },
        { provide: ConceptsService, useValue: { assertConceptInOrg: jest.fn(), assertBuildingInConcept } },
      ],
    }).compile();

    service = module.get(SharingService);
  });

  describe('help requests from another organisation read as not found', () => {
    it('accept', async () => {
      await expect(service.acceptHelpRequest(requestId, outsiderId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(helpRequest.save).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('complete', async () => {
      helpRequest.status = HelpRequestStatus.ACCEPTED;
      await expect(service.completeHelpRequest(requestId, ownerId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(helpRequest.save).not.toHaveBeenCalled();
    });

    it('cancel (admin of the other org)', async () => {
      await expect(service.cancelHelpRequest(requestId, outsiderId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(helpRequest.save).not.toHaveBeenCalled();
    });

    it('GET by id', async () => {
      await expect(service.findHelpRequestById(requestId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('shared items from another organisation read as not found', () => {
    it('delete (admin of the other org)', async () => {
      await expect(service.deleteSharedItem(itemId, outsiderId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(itemDeleteOne).not.toHaveBeenCalled();
    });

    it('request-borrow', async () => {
      await expect(service.requestToBorrow(itemId, outsiderId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('toggle availability', async () => {
      await expect(service.toggleAvailability(itemId, ownerId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(item.save).not.toHaveBeenCalled();
    });

    it('update', async () => {
      await expect(service.updateSharedItem(itemId, ownerId, otherOrgId, { name: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(itemFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('owner check used before an image upload', async () => {
      await expect(service.assertItemOwner(itemId, ownerId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('own organisation', () => {
    it('accepts a help request and populates no email', async () => {
      const q = query(helpRequest);
      helpFindOne.mockReturnValue(q);
      await service.acceptHelpRequest(requestId, outsiderId, orgId);
      expect(helpRequest.status).toBe(HelpRequestStatus.ACCEPTED);
      expect(q.populate).toHaveBeenCalledWith('requesterId', 'name avatarUrl avatarColor role');
      expect(q.populate).toHaveBeenCalledWith('helperId', 'name avatarUrl avatarColor role');
    });

    it('update and delete keep the organisation in the write filter', async () => {
      const own = { _id: itemId, organizationId: new Types.ObjectId(orgId) };
      await service.updateSharedItem(itemId, ownerId, orgId, { name: 'x' } as any);
      expect(itemFindOneAndUpdate.mock.calls[0][0]).toEqual(own);
      await service.deleteSharedItem(itemId, ownerId, orgId);
      expect(itemDeleteOne).toHaveBeenCalledWith(own);
    });
  });

  describe('create with a concept and a building from outside it', () => {
    const conceptId = new Types.ObjectId().toString();
    const buildingId = new Types.ObjectId().toString();

    it('rejects a help request', async () => {
      await expect(
        service.createHelpRequest(ownerId, orgId, { title: 't', description: 'd', conceptId, buildingId } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(assertBuildingInConcept).toHaveBeenCalledWith(buildingId, conceptId, orgId);
      expect(helpCreate).not.toHaveBeenCalled();
    });

    it('rejects a shared item', async () => {
      await expect(
        service.createSharedItem(ownerId, orgId, { name: 'Drill', conceptId, buildingId } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(assertBuildingInConcept).toHaveBeenCalledWith(buildingId, conceptId, orgId);
      expect(itemCreate).not.toHaveBeenCalled();
    });
  });
});
