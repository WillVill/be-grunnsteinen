import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentFoldersService } from './document-folders.service';
import { DocumentFolder } from './schemas/document-folder.schema';
import { Document as DocumentEntity } from '../documents/schemas/document.schema';
import { ConceptsService } from '../concepts/concepts.service';

// S3Service (reached through ConceptsService) pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const userId = new Types.ObjectId().toString();

describe('DocumentFoldersService.create', () => {
  let service: DocumentFoldersService;
  let folderCreate: jest.Mock;
  let assertBuildingInConcept: jest.Mock;

  beforeEach(async () => {
    folderCreate = jest.fn(async (d) => ({ _id: new Types.ObjectId(), ...d }));
    assertBuildingInConcept = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentFoldersService,
        { provide: getModelToken(DocumentFolder.name), useValue: { create: folderCreate } },
        { provide: getModelToken(DocumentEntity.name), useValue: {} },
        { provide: ConceptsService, useValue: { assertConceptInOrg: jest.fn(), assertBuildingInConcept } },
      ],
    }).compile();

    service = module.get(DocumentFoldersService);
  });

  it('rejects a building outside the caller\'s organisation or concept when a concept is also sent', async () => {
    const conceptId = new Types.ObjectId().toString();
    const buildingId = new Types.ObjectId().toString();
    assertBuildingInConcept.mockRejectedValue(new NotFoundException('Building not found'));
    await expect(service.create(userId, orgId, { name: 'Mappe', conceptId, buildingId } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(assertBuildingInConcept).toHaveBeenCalledWith(buildingId, conceptId, orgId);
    expect(folderCreate).not.toHaveBeenCalled();
  });

  it('creates a concept-level folder without a building check', async () => {
    const conceptId = new Types.ObjectId().toString();
    await service.create(userId, orgId, { name: 'Mappe', conceptId } as any);
    expect(assertBuildingInConcept).not.toHaveBeenCalled();
    expect(folderCreate).toHaveBeenCalled();
  });
});
