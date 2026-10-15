import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PostsService } from './posts.service';
import { Post } from './schemas/post.schema';
import { Comment } from './schemas/comment.schema';
import { User, UserRole } from '../users/schemas/user.schema';
import { Group } from '../groups/schemas/group.schema';
import { NotificationService } from '../../shared/services/notification.service';
import { ConceptsService } from '../concepts/concepts.service';

// S3Service (reached through the notification imports) pulls in ESM-only uuid, which Jest can't parse.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

const orgId = new Types.ObjectId().toString();
const memberId = new Types.ObjectId().toString();
const outsiderId = new Types.ObjectId().toString();
const groupId = new Types.ObjectId().toString();
const postId = new Types.ObjectId().toString();

/** A Mongoose query stand-in: chainable, resolved by exec() or by awaiting it. */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
};

describe('PostsService group privacy', () => {
  let service: PostsService;
  let groupFindOne: jest.Mock;
  let groupDistinct: jest.Mock;
  let postFind: jest.Mock;
  let postFindById: jest.Mock;
  let commentFind: jest.Mock;
  let userFindById: jest.Mock;

  const privateGroup = { isPrivate: true, isConceptWide: false, buildingId: new Types.ObjectId(), members: [new Types.ObjectId(memberId)] };
  const groupPost = { _id: new Types.ObjectId(postId), organizationId: new Types.ObjectId(orgId), groupId: { _id: new Types.ObjectId(groupId), name: 'G' }, likes: [] };

  beforeEach(async () => {
    groupFindOne = jest.fn(() => query(privateGroup));
    groupDistinct = jest.fn().mockResolvedValue([]);
    postFind = jest.fn(() => query([]));
    postFindById = jest.fn(() => query(groupPost));
    commentFind = jest.fn(() => query([]));
    userFindById = jest.fn(() => query({ role: UserRole.RESIDENT, buildingIds: [] }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: getModelToken(Post.name), useValue: { find: postFind, findById: postFindById, countDocuments: jest.fn().mockResolvedValue(0) } },
        { provide: getModelToken(Comment.name), useValue: { find: commentFind, countDocuments: jest.fn().mockResolvedValue(0) } },
        { provide: getModelToken(User.name), useValue: { findById: userFindById } },
        { provide: getModelToken(Group.name), useValue: { findOne: groupFindOne, distinct: groupDistinct } },
        { provide: NotificationService, useValue: {} },
        { provide: ConceptsService, useValue: { findConceptIdForBuilding: jest.fn() } },
      ],
    }).compile();

    service = module.get(PostsService);
  });

  describe('findAll', () => {
    it('forbids ?groupId= of a private group to a non-member', async () => {
      await expect(service.findAll(orgId, { groupId } as any, outsiderId)).rejects.toBeInstanceOf(ForbiddenException);
      expect(postFind).not.toHaveBeenCalled();
    });

    it('lists a private group to a member', async () => {
      await service.findAll(orgId, { groupId } as any, memberId);
      expect(postFind.mock.calls[0][0].groupId).toEqual(new Types.ObjectId(groupId));
    });

    it('reads a group from another organisation as not found', async () => {
      groupFindOne.mockReturnValue(query(null));
      await expect(service.findAll(orgId, { groupId } as any, memberId)).rejects.toBeInstanceOf(NotFoundException);
      expect(groupFindOne.mock.calls[0][0]).toEqual({ _id: groupId, organizationId: new Types.ObjectId(orgId) });
    });

    it('leaves posts from private groups the caller is not in out of mixed feeds', async () => {
      const hidden = [new Types.ObjectId()];
      groupDistinct.mockResolvedValue(hidden);
      await service.findAll(orgId, {} as any, outsiderId);
      expect(groupDistinct).toHaveBeenCalledWith('_id', {
        organizationId: new Types.ObjectId(orgId),
        isPrivate: true,
        members: { $ne: new Types.ObjectId(outsiderId) },
      });
      expect(postFind.mock.calls[0][0].groupId).toEqual({ $nin: hidden });
    });

    it('skips the private-group lookup when group posts are excluded anyway', async () => {
      await service.findAll(orgId, { excludeGroupPosts: true } as any, outsiderId);
      expect(groupDistinct).not.toHaveBeenCalled();
    });
  });

  describe('single post reads', () => {
    it('forbids a private group post, its comments and likes to a non-member', async () => {
      await expect(service.findById(postId, outsiderId)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.getComments(postId, outsiderId)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.toggleLike(postId, outsiderId)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a member', async () => {
      await expect(service.findById(postId, memberId)).resolves.toBeDefined();
      await expect(service.getComments(postId, memberId)).resolves.toBeDefined();
    });

    it('allows reading a post whose group no longer exists', async () => {
      groupFindOne.mockReturnValue(query(null));
      await expect(service.findById(postId, outsiderId)).resolves.toBeDefined();
    });
  });

  describe('create', () => {
    it('forbids posting into a private group the author is not in', async () => {
      userFindById.mockReturnValue(query({ role: UserRole.RESIDENT, buildingIds: [] }));
      await expect(
        service.create(outsiderId, orgId, { title: 't', content: 'c', buildingId: new Types.ObjectId().toString(), groupId } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
