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
const otherOrgId = new Types.ObjectId().toString();
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
  let postFindOne: jest.Mock;
  let postFindById: jest.Mock;
  let postFindByIdAndUpdate: jest.Mock;
  let postDeleteOne: jest.Mock;
  let commentFind: jest.Mock;
  let commentFindById: jest.Mock;
  let commentCreate: jest.Mock;
  let userFindById: jest.Mock;
  let postCreate: jest.Mock;
  let assertBuildingInConcept: jest.Mock;

  const privateGroup = { isPrivate: true, isConceptWide: false, buildingId: new Types.ObjectId(), members: [new Types.ObjectId(memberId)] };
  const groupPost = { _id: new Types.ObjectId(postId), organizationId: new Types.ObjectId(orgId), groupId: { _id: new Types.ObjectId(groupId), name: 'G' }, likes: [] };
  /** The post only exists in `orgId`: findOne honours the organisation in the filter like Mongo would. */
  const inOrg = (post: unknown) => (filter: { organizationId?: Types.ObjectId }) =>
    query(filter.organizationId?.equals(orgId) ? post : null);

  beforeEach(async () => {
    groupFindOne = jest.fn(() => query(privateGroup));
    groupDistinct = jest.fn().mockResolvedValue([]);
    postFind = jest.fn(() => query([]));
    postFindOne = jest.fn(inOrg(groupPost));
    postFindById = jest.fn(() => query(groupPost));
    postFindByIdAndUpdate = jest.fn(() => query(groupPost));
    postDeleteOne = jest.fn();
    commentFind = jest.fn(() => query([]));
    commentFindById = jest.fn();
    commentCreate = jest.fn();
    userFindById = jest.fn(() => query({ role: UserRole.RESIDENT, buildingIds: [] }));
    postCreate = jest.fn();
    assertBuildingInConcept = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        {
          provide: getModelToken(Post.name),
          useValue: {
            find: postFind,
            findOne: postFindOne,
            findById: postFindById,
            findByIdAndUpdate: postFindByIdAndUpdate,
            deleteOne: postDeleteOne,
            create: postCreate,
            countDocuments: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: getModelToken(Comment.name),
          useValue: {
            find: commentFind,
            findById: commentFindById,
            create: commentCreate,
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
            deleteOne: jest.fn(),
            countDocuments: jest.fn().mockResolvedValue(0),
          },
        },
        { provide: getModelToken(User.name), useValue: { findById: userFindById } },
        { provide: getModelToken(Group.name), useValue: { findOne: groupFindOne, distinct: groupDistinct } },
        { provide: NotificationService, useValue: {} },
        { provide: ConceptsService, useValue: { findConceptIdForBuilding: jest.fn(), assertConceptInOrg: jest.fn(), assertBuildingInConcept } },
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

    it('does not look the caller up when no private group is hidden', async () => {
      await service.findAll(orgId, {} as any, outsiderId);
      expect(userFindById).not.toHaveBeenCalled();
      expect(postFind.mock.calls[0][0].groupId).toBeUndefined();
    });

    it.each([UserRole.BOARD, UserRole.ADMIN, UserRole.SUPER_ADMIN])('keeps private-group posts in the feed for %s', async (role) => {
      groupDistinct.mockResolvedValue([new Types.ObjectId()]);
      userFindById.mockReturnValue(query({ role }));
      await service.findAll(orgId, {} as any, outsiderId);
      expect(postFind.mock.calls[0][0].groupId).toBeUndefined();
    });

    it('still hides them from a host', async () => {
      const hidden = [new Types.ObjectId()];
      groupDistinct.mockResolvedValue(hidden);
      userFindById.mockReturnValue(query({ role: UserRole.HOST }));
      await service.findAll(orgId, {} as any, outsiderId);
      expect(postFind.mock.calls[0][0].groupId).toEqual({ $nin: hidden });
    });

    it('skips the private-group lookup when group posts are excluded anyway', async () => {
      await service.findAll(orgId, { excludeGroupPosts: true } as any, outsiderId);
      expect(groupDistinct).not.toHaveBeenCalled();
    });
  });

  describe('single post reads', () => {
    it('forbids a private group post, its comments and likes to a non-member', async () => {
      await expect(service.findById(postId, outsiderId, orgId)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.getComments(postId, outsiderId, orgId)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.toggleLike(postId, outsiderId, orgId)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a member', async () => {
      await expect(service.findById(postId, memberId, orgId)).resolves.toBeDefined();
      await expect(service.getComments(postId, memberId, orgId)).resolves.toBeDefined();
    });

    it('allows reading a post whose group no longer exists', async () => {
      groupFindOne.mockReturnValue(query(null));
      await expect(service.findById(postId, outsiderId, orgId)).resolves.toBeDefined();
    });
  });

  describe('organisation scoping', () => {
    // An org-wide post the caller could otherwise read, like and moderate, so only the
    // organisation filter stands between a caller in another org and the post.
    const ownPost = () => ({
      _id: new Types.ObjectId(postId),
      organizationId: new Types.ObjectId(orgId),
      authorId: { _id: new Types.ObjectId(memberId) },
      likes: [] as Types.ObjectId[],
      likesCount: 0,
      commentsCount: 0,
      save: jest.fn(),
    });

    beforeEach(() => {
      postFindOne.mockImplementation(inOrg(ownPost()));
      userFindById.mockReturnValue(query({ role: UserRole.ADMIN, buildingIds: [], name: 'A', email: 'a@x' }));
    });

    it('looks single posts up inside the caller organisation', async () => {
      await service.findById(postId, memberId, orgId);
      expect(postFindOne).toHaveBeenCalledWith({ _id: postId, organizationId: new Types.ObjectId(orgId) });
    });

    it.each<[string, (s: PostsService, org: string) => Promise<unknown>]>([
      ['read', (s, org) => s.findById(postId, memberId, org)],
      ['comments', (s, org) => s.getComments(postId, memberId, org)],
      ['like', (s, org) => s.toggleLike(postId, memberId, org)],
      ['comment', (s, org) => s.addComment(postId, memberId, org, { content: 'hi' } as any)],
      ['update', (s, org) => s.update(postId, memberId, org, { title: 'x' } as any)],
      ['delete', (s, org) => s.delete(postId, memberId, org)],
      ['pin', (s, org) => s.togglePin(postId, memberId, org)],
    ])('reads another organisation\'s post as not found (%s)', async (_action, call) => {
      await expect(call(service, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(postFindByIdAndUpdate).not.toHaveBeenCalled();
      expect(postDeleteOne).not.toHaveBeenCalled();
      expect(commentCreate).not.toHaveBeenCalled();
    });

    it('lets the same calls through in the caller organisation', async () => {
      commentCreate.mockResolvedValue({ _id: new Types.ObjectId() });
      commentFindById.mockReturnValue(query({}));
      await expect(service.update(postId, memberId, orgId, { title: 'x' } as any)).resolves.toBeDefined();
      await expect(service.addComment(postId, memberId, orgId, { content: 'hi' } as any)).resolves.toBeDefined();
      await expect(service.delete(postId, memberId, orgId)).resolves.toBeUndefined();
      expect(postDeleteOne).toHaveBeenCalledWith({ _id: postId });
    });

    it('reads a malformed id as not found without querying', async () => {
      await expect(service.findById('not-an-id', memberId, orgId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.delete('not-an-id', memberId, orgId)).rejects.toBeInstanceOf(NotFoundException);
      expect(postFindOne).not.toHaveBeenCalled();
    });

    it('reads a comment on another organisation\'s post as not found', async () => {
      const commentId = new Types.ObjectId().toString();
      commentFindById.mockResolvedValue({ _id: commentId, postId: new Types.ObjectId(postId), authorId: new Types.ObjectId(memberId) });
      postFindOne.mockImplementation((filter: { organizationId?: Types.ObjectId }) =>
        Promise.resolve(filter.organizationId?.equals(orgId) ? ownPost() : null),
      );
      await expect(service.deleteComment(commentId, memberId, otherOrgId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.deleteComment(commentId, memberId, orgId)).resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    it('forbids posting into a private group the author is not in', async () => {
      userFindById.mockReturnValue(query({ role: UserRole.RESIDENT, buildingIds: [] }));
      await expect(
        service.create(outsiderId, orgId, { title: 't', content: 'c', buildingId: new Types.ObjectId().toString(), groupId } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a building outside the caller\'s organisation or concept when a concept is also sent', async () => {
      const buildingId = new Types.ObjectId().toString();
      const conceptId = new Types.ObjectId().toString();
      assertBuildingInConcept.mockRejectedValue(new NotFoundException('Building not found'));
      await expect(
        service.create(memberId, orgId, { title: 't', content: 'c', buildingId, conceptId } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(assertBuildingInConcept).toHaveBeenCalledWith(buildingId, conceptId, orgId);
      expect(postCreate).not.toHaveBeenCalled();
    });
  });
});
