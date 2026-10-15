import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentsService } from './documents.service';
import { Document } from './schemas/document.schema';
import { User, UserRole } from '../users/schemas/user.schema';
import { Apartment } from '../apartments/schemas/apartment.schema';
import { S3Service } from '../../shared/services/s3.service';
import { ConceptsService } from '../concepts/concepts.service';
import { DocumentFoldersService } from '../document-folders/document-folders.service';

// S3Service pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const otherOrgId = new Types.ObjectId().toString();
const userId = new Types.ObjectId().toString();
const documentId = new Types.ObjectId().toString();

/** A Mongoose query stand-in: chainable, resolved by exec() or by awaiting it. */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
};

describe('DocumentsService organisation scoping', () => {
  let service: DocumentsService;
  let docFindOne: jest.Mock;
  let docFindOneAndUpdate: jest.Mock;
  let docDeleteOne: jest.Mock;
  let userFindById: jest.Mock;
  let s3: { deleteFile: jest.Mock; getPresignedDownloadUrl: jest.Mock; uploadBuffer: jest.Mock; generateKey: jest.Mock };
  let document: Record<string, unknown>;
  let docCreate: jest.Mock;
  let apartmentFindOne: jest.Mock;
  let assertBuildingInConcept: jest.Mock;

  /** The document only exists in `orgId`: findOne honours the organisation like Mongo would. */
  const inOrg = () => (filter: { organizationId?: Types.ObjectId }) =>
    query(filter.organizationId?.equals(orgId) ? document : null);

  beforeEach(async () => {
    document = { _id: new Types.ObjectId(documentId), organizationId: new Types.ObjectId(orgId), isPublic: true, fileKey: 'k', fileName: 'f.pdf' };
    docFindOne = jest.fn(inOrg());
    docFindOneAndUpdate = jest.fn(() => query(document));
    docDeleteOne = jest.fn();
    userFindById = jest.fn().mockResolvedValue({ role: UserRole.BOARD });
    docCreate = jest.fn(async (d) => ({ _id: new Types.ObjectId(), ...d }));
    apartmentFindOne = jest.fn(() => query(null));
    assertBuildingInConcept = jest.fn();
    s3 = {
      deleteFile: jest.fn(),
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://signed'),
      uploadBuffer: jest.fn().mockResolvedValue('https://s3/x'),
      generateKey: jest.fn(() => 'key'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        {
          provide: getModelToken(Document.name),
          useValue: {
            findOne: docFindOne,
            findOneAndUpdate: docFindOneAndUpdate,
            deleteOne: docDeleteOne,
            findById: jest.fn(() => query(document)),
            create: docCreate,
          },
        },
        { provide: getModelToken(User.name), useValue: { findById: userFindById } },
        { provide: getModelToken(Apartment.name), useValue: { findOne: apartmentFindOne } },
        { provide: S3Service, useValue: s3 },
        { provide: ConceptsService, useValue: { assertConceptInOrg: jest.fn(), findConceptIdForBuilding: jest.fn(), assertBuildingInConcept } },
        { provide: DocumentFoldersService, useValue: { assertFolderMatchesScope: jest.fn(), incrementCount: jest.fn(), decrementCount: jest.fn() } },
      ],
    }).compile();

    service = module.get(DocumentsService);
  });

  describe('foreign-org ids read as not found', () => {
    it('GET by id', async () => {
      await expect(service.findByIdForUser(documentId, otherOrgId, UserRole.ADMIN)).rejects.toBeInstanceOf(NotFoundException);
      expect(docFindOne.mock.calls[0][0]).toEqual({ _id: documentId, organizationId: new Types.ObjectId(otherOrgId) });
    });

    it('download', async () => {
      await expect(service.getDownloadUrl(documentId, userId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(s3.getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('PATCH', async () => {
      await expect(service.update(documentId, userId, otherOrgId, { isPublic: true } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(docFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('DELETE', async () => {
      await expect(service.delete(documentId, userId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(s3.deleteFile).not.toHaveBeenCalled();
      expect(docDeleteOne).not.toHaveBeenCalled();
    });

    it('a malformed id', async () => {
      await expect(service.findByIdForUser('not-an-id', orgId, UserRole.ADMIN)).rejects.toBeInstanceOf(NotFoundException);
      expect(docFindOne).not.toHaveBeenCalled();
    });
  });

  describe('own organisation', () => {
    it('PATCH and DELETE keep the organisation in the write filter', async () => {
      await service.update(documentId, userId, orgId, { title: 'Ny' } as any);
      expect(docFindOneAndUpdate.mock.calls[0][0]).toEqual({ _id: documentId, organizationId: new Types.ObjectId(orgId) });
      await service.delete(documentId, userId, orgId);
      expect(docDeleteOne).toHaveBeenCalledWith({ _id: documentId, organizationId: new Types.ObjectId(orgId) });
    });

    it('does not populate the uploader email', async () => {
      const q = query(document);
      docFindOne.mockReturnValue(q);
      await service.findByIdForUser(documentId, orgId, UserRole.RESIDENT);
      expect(q.populate).toHaveBeenCalledWith('uploadedById', 'name avatarUrl avatarColor role');
    });
  });

  describe('private documents', () => {
    beforeEach(() => {
      document.isPublic = false;
    });

    it('are hidden from residents on GET', async () => {
      await expect(service.findByIdForUser(documentId, orgId, UserRole.RESIDENT)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('are hidden from residents on download', async () => {
      userFindById.mockResolvedValue({ role: UserRole.RESIDENT });
      await expect(service.getDownloadUrl(documentId, userId, orgId)).rejects.toBeInstanceOf(ForbiddenException);
      expect(s3.getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('are readable by board', async () => {
      await expect(service.findByIdForUser(documentId, orgId, UserRole.BOARD)).resolves.toBe(document);
      await expect(service.getDownloadUrl(documentId, userId, orgId)).resolves.toBe('https://signed');
    });
  });

  describe('upload validates foreign ids before writing to S3', () => {
    const file = { originalname: 'a.pdf', buffer: Buffer.from(''), mimetype: 'application/pdf', size: 1 } as any;
    const buildingId = new Types.ObjectId().toString();

    it('rejects a building outside the caller\'s organisation or concept when a concept is also sent', async () => {
      const conceptId = new Types.ObjectId().toString();
      assertBuildingInConcept.mockRejectedValue(new NotFoundException('Building not found'));
      await expect(service.upload(userId, orgId, file, { title: 't', conceptId, buildingId } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(assertBuildingInConcept).toHaveBeenCalledWith(buildingId, conceptId, orgId);
      expect(s3.uploadBuffer).not.toHaveBeenCalled();
      expect(docCreate).not.toHaveBeenCalled();
    });

    it('rejects an apartment from another organisation', async () => {
      const apartmentId = new Types.ObjectId().toString();
      await expect(service.upload(userId, orgId, file, { title: 't', apartmentId } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(apartmentFindOne.mock.calls[0][0]).toEqual({ _id: new Types.ObjectId(apartmentId), organizationId: new Types.ObjectId(orgId) });
      expect(s3.uploadBuffer).not.toHaveBeenCalled();
    });

    it('rejects an apartment in another building', async () => {
      apartmentFindOne.mockReturnValue(query({ buildingId: new Types.ObjectId() }));
      await expect(
        service.upload(userId, orgId, file, { title: 't', buildingId, apartmentId: new Types.ObjectId().toString() } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s3.uploadBuffer).not.toHaveBeenCalled();
    });

    it('accepts an apartment in the organisation and building', async () => {
      apartmentFindOne.mockReturnValue(query({ buildingId: new Types.ObjectId(buildingId) }));
      await service.upload(userId, orgId, file, { title: 't', buildingId, apartmentId: new Types.ObjectId().toString() } as any);
      expect(s3.uploadBuffer).toHaveBeenCalled();
      expect(docCreate).toHaveBeenCalled();
    });

    it('rejects an apartment in another concept than the one sent', async () => {
      const conceptId = new Types.ObjectId().toString();
      apartmentFindOne.mockReturnValue(query({ buildingId: new Types.ObjectId(buildingId), conceptId: new Types.ObjectId() }));
      await expect(
        service.upload(userId, orgId, file, { title: 't', conceptId, apartmentId: new Types.ObjectId().toString() } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s3.uploadBuffer).not.toHaveBeenCalled();
      expect(docCreate).not.toHaveBeenCalled();
    });

    it('stores the apartment\'s building and concept when only apartmentId is sent', async () => {
      const aptBuilding = new Types.ObjectId();
      const aptConcept = new Types.ObjectId();
      apartmentFindOne.mockReturnValue(query({ buildingId: aptBuilding, conceptId: aptConcept }));
      await service.upload(userId, orgId, file, { title: 't', apartmentId: new Types.ObjectId().toString() } as any);
      expect(apartmentFindOne.mock.results[0].value).toBeDefined();
      const created = docCreate.mock.calls[0][0];
      expect(created.buildingId.equals(aptBuilding)).toBe(true);
      expect(created.conceptId.equals(aptConcept)).toBe(true);
    });
  });
});
