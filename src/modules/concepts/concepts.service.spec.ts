import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ConceptsService } from './concepts.service';
import { Concept } from './schemas/concept.schema';
import { Building } from '../buildings/schemas/building.schema';
import { S3Service } from '../../shared/services/s3.service';

// S3Service pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const otherOrgId = new Types.ObjectId().toString();
const conceptId = new Types.ObjectId().toString();
const otherConceptId = new Types.ObjectId().toString();
const buildingId = new Types.ObjectId().toString();

describe('ConceptsService.assertBuildingInConcept', () => {
  let service: ConceptsService;
  let buildingFindOne: jest.Mock;
  let buildingConceptId: Types.ObjectId | undefined;

  beforeEach(async () => {
    buildingConceptId = new Types.ObjectId(conceptId);
    // The building only exists in `orgId`: findOne honours the organisation like Mongo would.
    buildingFindOne = jest.fn((filter: { organizationId: Types.ObjectId }) => ({
      select: () => Promise.resolve(filter.organizationId.equals(orgId) ? { conceptId: buildingConceptId } : null),
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConceptsService,
        { provide: getModelToken(Concept.name), useValue: {} },
        { provide: getModelToken(Building.name), useValue: { findOne: buildingFindOne } },
        { provide: S3Service, useValue: {} },
      ],
    }).compile();

    service = module.get(ConceptsService);
  });

  it('passes for a building of that concept in the organisation', async () => {
    await expect(service.assertBuildingInConcept(buildingId, conceptId, orgId)).resolves.toBeUndefined();
  });

  it('reads a building of another organisation as not found', async () => {
    await expect(service.assertBuildingInConcept(buildingId, conceptId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a building of another concept in the same organisation', async () => {
    await expect(service.assertBuildingInConcept(buildingId, otherConceptId, orgId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a building with no concept', async () => {
    buildingConceptId = undefined;
    await expect(service.assertBuildingInConcept(buildingId, conceptId, orgId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads a malformed building id as not found', async () => {
    await expect(service.assertBuildingInConcept('nope', conceptId, orgId)).rejects.toBeInstanceOf(NotFoundException);
    expect(buildingFindOne).not.toHaveBeenCalled();
  });
});
