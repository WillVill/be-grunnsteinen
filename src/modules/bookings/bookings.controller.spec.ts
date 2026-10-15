// The controller's module graph reaches S3Service, which imports ESM-only uuid.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { UserRole } from '../users/schemas/user.schema';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';

const user = (role: string) =>
  ({ userId: 'u1', organizationId: 'o1', role }) as unknown as CurrentUserData;

describe('BookingsController board access', () => {
  let service: { findAll: jest.Mock; findById: jest.Mock; update: jest.Mock };
  let controller: BookingsController;

  beforeEach(() => {
    service = { findAll: jest.fn(), findById: jest.fn(), update: jest.fn() };
    controller = new BookingsController(service as unknown as BookingsService);
  });

  it.each([
    [UserRole.SUPER_ADMIN, true],
    [UserRole.ADMIN, true],
    [UserRole.BOARD, true],
    [UserRole.HOST, false],
    [UserRole.RESIDENT, false],
  ])('treats %s as board: %s', async (role, expected) => {
    await controller.findAll(user(role), {} as never);
    await controller.findOne(user(role), 'b1');
    await controller.update(user(role), 'b1', {} as never);
    expect(service.findAll).toHaveBeenCalledWith('o1', 'u1', {}, expected);
    expect(service.findById).toHaveBeenCalledWith('b1', 'u1', expected, 'o1');
    expect(service.update).toHaveBeenCalledWith('b1', 'u1', expected, 'o1', {});
  });
});
