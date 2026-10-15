import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ApartmentsService } from './apartments.service';
import { Apartment } from './schemas/apartment.schema';
import { Building } from '../buildings/schemas/building.schema';
import { User } from '../users/schemas/user.schema';

const orgId = new Types.ObjectId().toString();
const apartmentId = new Types.ObjectId().toString();
const userId = new Types.ObjectId().toString();

describe('ApartmentsService.assignTenant and deleted accounts', () => {
  let service: ApartmentsService;
  let apartmentUpdateOne: jest.Mock;
  let userUpdateOne: jest.Mock;

  beforeEach(async () => {
    apartmentUpdateOne = jest.fn();
    userUpdateOne = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApartmentsService,
        {
          provide: getModelToken(Apartment.name),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              _id: new Types.ObjectId(apartmentId),
              buildingId: new Types.ObjectId(),
              tenantIds: [],
            }),
            updateOne: apartmentUpdateOne,
            findByIdAndUpdate: apartmentUpdateOne,
          },
        },
        { provide: getModelToken(Building.name), useValue: {} },
        {
          provide: getModelToken(User.name),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              _id: new Types.ObjectId(userId),
              organizationId: new Types.ObjectId(orgId),
              buildingIds: [],
              isDeleted: true,
            }),
            updateOne: userUpdateOne,
          },
        },
      ],
    }).compile();

    service = module.get(ApartmentsService);
  });

  it('404s for a deleted account and links nothing', async () => {
    await expect(service.assignTenant(orgId, apartmentId, { userId } as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(apartmentUpdateOne).not.toHaveBeenCalled();
    expect(userUpdateOne).not.toHaveBeenCalled();
  });
});
