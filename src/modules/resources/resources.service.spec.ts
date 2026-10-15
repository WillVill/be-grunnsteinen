import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ResourcesService } from './resources.service';
import { Resource } from './schemas/resource.schema';
import { S3Service } from '../../shared/services/s3.service';
import { ConceptsService } from '../concepts/concepts.service';

// S3Service pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const otherOrgId = new Types.ObjectId().toString();
const resourceId = new Types.ObjectId().toString();

describe('ResourcesService organisation scoping', () => {
  let service: ResourcesService;
  let resourceFindOne: jest.Mock;
  let resourceFindOneAndUpdate: jest.Mock;
  let s3: { uploadFile: jest.Mock };
  let resource: any;

  const ownFilter = { _id: resourceId, organizationId: new Types.ObjectId(orgId) };
  /** The resource only exists in `orgId`: lookups honour the organisation like Mongo would. */
  const inOrg = (result: () => unknown) => (filter: { organizationId?: Types.ObjectId }) =>
    Promise.resolve(filter.organizationId?.equals(orgId) ? result() : null);

  beforeEach(async () => {
    resource = {
      _id: new Types.ObjectId(resourceId),
      name: 'Gjesteleilighet',
      isActive: true,
      imageUrls: ['https://old'],
      availableDays: [],
      availableTimeStart: '08:00',
      availableTimeEnd: '22:00',
      save: jest.fn(),
    };
    resourceFindOne = jest.fn(inOrg(() => resource));
    resourceFindOneAndUpdate = jest.fn(inOrg(() => resource));
    s3 = { uploadFile: jest.fn().mockResolvedValue('https://new') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourcesService,
        {
          provide: getModelToken(Resource.name),
          useValue: { findOne: resourceFindOne, findOneAndUpdate: resourceFindOneAndUpdate },
        },
        { provide: S3Service, useValue: s3 },
        { provide: ConceptsService, useValue: {} },
      ],
    }).compile();

    service = module.get(ResourcesService);
  });

  describe('foreign-org ids read as not found', () => {
    it('GET by id', async () => {
      await expect(service.findById(resourceId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('availability', async () => {
      await expect(service.getAvailability(resourceId, otherOrgId, new Date(), new Date())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('PATCH', async () => {
      await expect(service.update(resourceId, otherOrgId, { name: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deactivate', async () => {
      await expect(service.deactivate(resourceId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('add and remove images', async () => {
      await expect(service.addImages(resourceId, otherOrgId, ['https://x'])).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.removeImage(resourceId, otherOrgId, 'https://old')).rejects.toBeInstanceOf(NotFoundException);
      expect(resource.save).not.toHaveBeenCalled();
    });

    it('image upload, without writing to S3', async () => {
      await expect(service.uploadImage(resourceId, otherOrgId, { originalname: 'a.png' } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(s3.uploadFile).not.toHaveBeenCalled();
    });

    it('a malformed id, without writing to S3', async () => {
      await expect(service.uploadImage('nope', orgId, {} as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(resourceFindOne).not.toHaveBeenCalled();
      expect(s3.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('own organisation', () => {
    it('update and deactivate filter by organisation', async () => {
      await service.update(resourceId, orgId, { name: 'x' } as any);
      await service.deactivate(resourceId, orgId);
      expect(resourceFindOneAndUpdate.mock.calls[0][0]).toEqual(ownFilter);
      expect(resourceFindOneAndUpdate.mock.calls[1][0]).toEqual(ownFilter);
    });

    it('uploads the image after loading the resource and attaches it', async () => {
      const result = await service.uploadImage(resourceId, orgId, { originalname: 'a.png' } as any);
      expect(resourceFindOne.mock.calls[0][0]).toEqual(ownFilter);
      expect(s3.uploadFile).toHaveBeenCalledWith(expect.anything(), `public/resources/${resourceId}/images`);
      expect(result.imageUrls).toEqual(['https://old', 'https://new']);
      expect(resource.save).toHaveBeenCalled();
    });
  });
});
