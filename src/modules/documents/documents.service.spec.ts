import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentsService } from './documents.service';
import { Document } from './schemas/document.schema';
import { User, UserRole } from '../users/schemas/user.schema';
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

  /** The document only exists in `orgId`: findOne honours the organisation like Mongo would. */
  const inOrg = () => (filter: { organizationId?: Types.ObjectId }) =>
    query(filter.organizationId?.equals(orgId) ? document : null);

  beforeEach(async () => {
    document = { _id: new Types.ObjectId(documentId), organizationId: new Types.ObjectId(orgId), isPublic: true, fileKey: 'k', fileName: 'f.pdf' };
    docFindOne = jest.fn(inOrg());
    docFindOneAndUpdate = jest.fn(() => query(document));
    docDeleteOne = jest.fn();
    userFindById = jest.fn().mockResolvedValue({ role: UserRole.BOARD });
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
            create: jest.fn(async (d) => ({ _id: new Types.ObjectId(), ...d })),
          },
        },
        { provide: getModelToken(User.name), useValue: { findById: userFindById } },
        { provide: S3Service, useValue: s3 },
        { provide: ConceptsService, useValue: { assertConceptInOrg: jest.fn(), findConceptIdForBuilding: jest.fn() } },
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
});
