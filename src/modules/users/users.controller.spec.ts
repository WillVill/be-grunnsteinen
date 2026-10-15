// S3Service pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AccountDeletionService } from './account-deletion.service';
import { S3Service } from '../../shared/services/s3.service';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';

describe('UsersController account deletion', () => {
  const me: CurrentUserData = {
    userId: '507f1f77bcf86cd799439012',
    email: 'kari@example.com',
    role: 'resident',
    organizationId: '507f1f77bcf86cd799439011',
    buildingIds: [],
  };
  let controller: UsersController;
  let deleteAccount: jest.Mock;
  let usersService: { deactivate: jest.Mock; deactivateUser: jest.Mock };

  beforeEach(() => {
    deleteAccount = jest.fn().mockResolvedValue({});
    usersService = { deactivate: jest.fn(), deactivateUser: jest.fn() };
    controller = new UsersController(
      usersService as unknown as UsersService,
      {} as S3Service,
      { deleteAccount } as unknown as AccountDeletionService,
    );
  });

  it('DELETE /users/me deletes the account, scoped to the caller org', async () => {
    await expect(controller.deleteMe(me)).resolves.toEqual({ message: 'Account deleted' });
    expect(deleteAccount).toHaveBeenCalledWith(me.userId, me.organizationId);
    expect(usersService.deactivate).not.toHaveBeenCalled();
  });

  it('DELETE /users/me passes the last-admin 409 through', async () => {
    deleteAccount.mockRejectedValue(new ConflictException('last admin'));
    await expect(controller.deleteMe(me)).rejects.toBeInstanceOf(ConflictException);
  });

  it('DELETE /users/:id (admin) still only deactivates', async () => {
    await controller.deactivateUser(me, '507f1f77bcf86cd799439013');
    expect(usersService.deactivateUser).toHaveBeenCalledWith(me.organizationId, '507f1f77bcf86cd799439013');
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});

describe('UsersController GET /users/:id and deleted accounts', () => {
  it('404s for a tombstone', async () => {
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        organizationId: '507f1f77bcf86cd799439011',
        isDeleted: true,
        name: 'Slettet bruker',
      }),
    };
    const controller = new UsersController(
      usersService as unknown as UsersService,
      {} as S3Service,
      {} as AccountDeletionService,
    );
    await expect(
      controller.findOne(
        { userId: 'a', email: 'x', role: 'admin', organizationId: '507f1f77bcf86cd799439011', buildingIds: [] },
        '507f1f77bcf86cd799439013',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
