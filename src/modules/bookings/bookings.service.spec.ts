import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingsService } from './bookings.service';
import { Booking, BookingStatus } from './schemas/booking.schema';
import { Resource } from '../resources/schemas/resource.schema';
import { User, UserRole } from '../users/schemas/user.schema';
import { NotificationService } from '../../shared/services/notification.service';
import { EmailService } from '../../shared/services/email.service';
import { ConceptsService } from '../concepts/concepts.service';

// S3Service (reached through the notification imports) pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const otherOrgId = new Types.ObjectId().toString();
const adminId = new Types.ObjectId().toString();
const bookingId = new Types.ObjectId().toString();
const resourceId = new Types.ObjectId().toString();

/** A Mongoose query stand-in: chainable, resolved by exec() or by awaiting it. */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
};

describe('BookingsService organisation scoping', () => {
  let service: BookingsService;
  let bookingFindOne: jest.Mock;
  let bookingFindOneAndUpdate: jest.Mock;
  let bookingCreate: jest.Mock;
  let resourceFindOne: jest.Mock;
  let booking: any;

  /** Records only exist in `orgId`: findOne honours the organisation like Mongo would. */
  const inOrg = (result: () => unknown) => (filter: { organizationId?: Types.ObjectId }) =>
    query(filter.organizationId?.equals(orgId) ? result() : null);

  beforeEach(async () => {
    booking = {
      _id: new Types.ObjectId(bookingId),
      organizationId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(),
      resourceId: new Types.ObjectId(resourceId),
      status: BookingStatus.PENDING,
      save: jest.fn(),
    };
    bookingFindOne = jest.fn(inOrg(() => booking));
    bookingFindOneAndUpdate = jest.fn(() => query(booking));
    bookingCreate = jest.fn();
    resourceFindOne = jest.fn(inOrg(() => ({ _id: new Types.ObjectId(resourceId), isActive: true })));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        {
          provide: getModelToken(Booking.name),
          useValue: {
            findOne: bookingFindOne,
            findOneAndUpdate: bookingFindOneAndUpdate,
            findById: jest.fn(() => query(booking)),
            create: bookingCreate,
          },
        },
        { provide: getModelToken(Resource.name), useValue: { findOne: resourceFindOne, findById: jest.fn().mockResolvedValue(null) } },
        { provide: getModelToken(User.name), useValue: { findById: jest.fn().mockResolvedValue({ role: UserRole.ADMIN }) } },
        { provide: NotificationService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: ConceptsService, useValue: {} },
      ],
    }).compile();

    service = module.get(BookingsService);
  });

  describe('foreign-org bookings read as not found', () => {
    it('approve', async () => {
      await expect(service.approve(bookingId, adminId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(booking.save).not.toHaveBeenCalled();
    });

    it('reject', async () => {
      await expect(service.reject(bookingId, adminId, otherOrgId, 'nei')).rejects.toBeInstanceOf(NotFoundException);
      expect(booking.save).not.toHaveBeenCalled();
    });

    it('cancel', async () => {
      booking.status = BookingStatus.CONFIRMED;
      await expect(service.cancel(bookingId, adminId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(booking.save).not.toHaveBeenCalled();
    });

    it('update', async () => {
      await expect(service.update(bookingId, adminId, true, otherOrgId, { adminNotes: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(bookingFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('GET by id', async () => {
      await expect(service.findById(bookingId, adminId, true, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('approves a booking in the own organisation', async () => {
    await service.approve(bookingId, adminId, orgId);
    expect(bookingFindOne.mock.calls[0][0]).toEqual({ _id: bookingId, organizationId: new Types.ObjectId(orgId) });
    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.save).toHaveBeenCalled();
  });

  it('update keeps the organisation in the write filter', async () => {
    await service.update(bookingId, adminId, true, orgId, { adminNotes: 'x' } as any);
    expect(bookingFindOneAndUpdate.mock.calls[0][0]).toEqual({ _id: bookingId, organizationId: new Types.ObjectId(orgId) });
  });

  it('create rejects a resource from another organisation', async () => {
    const dto = { resourceId, startDate: new Date(), endDate: new Date() } as any;
    await expect(service.create(adminId, otherOrgId, dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(resourceFindOne.mock.calls[0][0]).toEqual({ _id: resourceId, organizationId: new Types.ObjectId(otherOrgId) });
    expect(bookingCreate).not.toHaveBeenCalled();
  });
});
