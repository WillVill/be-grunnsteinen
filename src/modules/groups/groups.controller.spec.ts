import { ForbiddenException } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { UserRole } from '../users/schemas/user.schema';

// The real S3Service pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

describe('GroupsController.uploadImage', () => {
  const user = { userId: 'u1', organizationId: 'o1', role: UserRole.RESIDENT, email: 'u@x', buildingIds: [] };
  const file = { originalname: 'a.png' } as Express.Multer.File;
  let groupsService: { assertCanEdit: jest.Mock; setImage: jest.Mock };
  let s3Service: { uploadFile: jest.Mock };
  let controller: GroupsController;

  beforeEach(() => {
    groupsService = { assertCanEdit: jest.fn(), setImage: jest.fn() };
    s3Service = { uploadFile: jest.fn().mockResolvedValue('https://s3/img.png') };
    controller = new GroupsController(groupsService as any, s3Service as any);
  });

  it('checks edit rights before anything reaches S3', async () => {
    groupsService.assertCanEdit.mockRejectedValue(new ForbiddenException());
    await expect(controller.uploadImage(user, 'g1', file)).rejects.toBeInstanceOf(ForbiddenException);
    expect(groupsService.assertCanEdit).toHaveBeenCalledWith('g1', 'o1', 'u1');
    expect(s3Service.uploadFile).not.toHaveBeenCalled();
  });

  it('stores the image on the group the check returned', async () => {
    const group = { _id: 'g1' };
    groupsService.assertCanEdit.mockResolvedValue(group);
    await controller.uploadImage(user, 'g1', file);
    expect(groupsService.setImage).toHaveBeenCalledWith(group, 'https://s3/img.png');
  });
});
