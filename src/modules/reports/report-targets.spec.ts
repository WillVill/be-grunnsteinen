import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

import { EXCERPT_MAX, ReportTargetModels, Reporter, resolveReportTarget } from './report-targets';
import { ReportTargetType } from './schemas/report.schema';

const oid = () => new Types.ObjectId();

/** A Mongoose query stand-in: chainable, resolved by exec() or by awaiting it. */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
};

const orgId = oid().toString();
const reporterOid = oid();
const reporter: Reporter = { userId: reporterOid.toString(), role: 'resident', buildingIds: [] };
const ownerOid = oid();

const mkModels = () => {
  const m = (...fns: string[]) => Object.fromEntries(fns.map((f) => [f, jest.fn()]));
  return {
    post: m('findOne'),
    comment: m('findById'),
    message: m('findById'),
    conversation: m('findOne'),
    group: m('findOne'),
  } as unknown as Record<keyof ReportTargetModels, { findOne: jest.Mock; findById: jest.Mock }>;
};

describe('resolveReportTarget', () => {
  let models: ReturnType<typeof mkModels>;
  const run = (type: ReportTargetType, id: string) =>
    resolveReportTarget(models as unknown as ReportTargetModels, type, id, reporter, orgId);

  beforeEach(() => {
    models = mkModels();
  });

  describe('post', () => {
    const postId = oid();
    it('resolves a post in the org', async () => {
      models.post.findOne.mockReturnValue(query({ _id: postId, authorId: ownerOid, title: 'Tittel', content: 'Tekst' }));
      await expect(run(ReportTargetType.POST, String(postId))).resolves.toEqual({
        ownerId: String(ownerOid),
        excerpt: 'Tittel — Tekst',
        webPath: `/posts/${postId}`,
      });
      expect(models.post.findOne).toHaveBeenCalledWith({ _id: String(postId), organizationId: new Types.ObjectId(orgId) });
    });
    it('404s when not found (e.g. other org)', async () => {
      models.post.findOne.mockReturnValue(query(null));
      await expect(run(ReportTargetType.POST, String(postId))).rejects.toBeInstanceOf(NotFoundException);
    });
    it('404s on a malformed id', async () => {
      await expect(run(ReportTargetType.POST, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('404s for a post in a private group the reporter cannot see', async () => {
      const groupId = oid();
      models.post.findOne.mockReturnValue(query({ _id: postId, authorId: ownerOid, title: 'T', content: 'C', groupId }));
      models.group.findOne.mockReturnValue(query({ _id: groupId, isPrivate: true, members: [oid()] }));
      await expect(run(ReportTargetType.POST, String(postId))).rejects.toBeInstanceOf(NotFoundException);
    });
    it('resolves a post in a private group the reporter belongs to', async () => {
      const groupId = oid();
      models.post.findOne.mockReturnValue(query({ _id: postId, authorId: ownerOid, title: 'T', content: 'C', groupId }));
      models.group.findOne.mockReturnValue(query({ _id: groupId, isPrivate: true, members: [reporterOid] }));
      await expect(run(ReportTargetType.POST, String(postId))).resolves.toMatchObject({ excerpt: 'T — C' });
    });
    it('resolves a post whose group was deleted (matches PostsService read path)', async () => {
      const groupId = oid();
      models.post.findOne.mockReturnValue(query({ _id: postId, authorId: ownerOid, title: 'T', content: 'C', groupId }));
      models.group.findOne.mockReturnValue(query(null));
      await expect(run(ReportTargetType.POST, String(postId))).resolves.toMatchObject({ excerpt: 'T — C' });
    });
    it('cuts the excerpt by code points so an emoji is never split', async () => {
      models.post.findOne.mockReturnValue(query({ _id: postId, authorId: ownerOid, content: '😀'.repeat(300) }));
      const { excerpt } = await run(ReportTargetType.POST, String(postId));
      expect(Array.from(excerpt)).toHaveLength(EXCERPT_MAX);
      expect(excerpt.endsWith('…')).toBe(true);
      expect(excerpt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });
    it('cuts a long excerpt to 280 characters ending in an ellipsis', async () => {
      models.post.findOne.mockReturnValue(query({ _id: postId, authorId: ownerOid, title: 'T', content: 'x'.repeat(600) }));
      const { excerpt } = await run(ReportTargetType.POST, String(postId));
      expect(excerpt).toHaveLength(EXCERPT_MAX);
      expect(excerpt.endsWith('…')).toBe(true);
    });
  });

  describe('comment', () => {
    const commentId = oid();
    const postId = oid();
    it('resolves a comment via its post', async () => {
      models.comment.findById.mockReturnValue(query({ _id: commentId, postId, authorId: ownerOid, content: 'Kommentar' }));
      models.post.findOne.mockReturnValue(query({ _id: postId }));
      await expect(run(ReportTargetType.COMMENT, String(commentId))).resolves.toEqual({
        ownerId: String(ownerOid),
        excerpt: 'Kommentar',
        webPath: `/posts/${postId}`,
      });
      expect(models.post.findOne).toHaveBeenCalledWith({ _id: postId, organizationId: new Types.ObjectId(orgId) });
    });
    it('404s when the comment is missing', async () => {
      models.comment.findById.mockReturnValue(query(null));
      await expect(run(ReportTargetType.COMMENT, String(commentId))).rejects.toBeInstanceOf(NotFoundException);
    });
    it('404s when its post is in another org', async () => {
      models.comment.findById.mockReturnValue(query({ _id: commentId, postId, authorId: ownerOid, content: 'K' }));
      models.post.findOne.mockReturnValue(query(null));
      await expect(run(ReportTargetType.COMMENT, String(commentId))).rejects.toBeInstanceOf(NotFoundException);
    });
    it('404s when its post is in a private group the reporter cannot see', async () => {
      const groupId = oid();
      models.comment.findById.mockReturnValue(query({ _id: commentId, postId, authorId: ownerOid, content: 'K' }));
      models.post.findOne.mockReturnValue(query({ _id: postId, groupId }));
      models.group.findOne.mockReturnValue(query({ _id: groupId, isPrivate: true, members: [] }));
      await expect(run(ReportTargetType.COMMENT, String(commentId))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('message', () => {
    const messageId = oid();
    const conversationId = oid();
    const msg = { _id: messageId, conversationId, senderId: ownerOid, content: 'Hei' };
    it('resolves a message in a conversation the reporter is in', async () => {
      models.message.findById.mockReturnValue(query(msg));
      models.conversation.findOne.mockReturnValue(query({ _id: conversationId, participants: [reporterOid, ownerOid] }));
      await expect(run(ReportTargetType.MESSAGE, String(messageId))).resolves.toEqual({
        ownerId: String(ownerOid),
        excerpt: 'Hei',
        webPath: undefined,
      });
      expect(models.conversation.findOne).toHaveBeenCalledWith({
        _id: conversationId,
        organizationId: new Types.ObjectId(orgId),
      });
    });
    it('404s when the reporter is not a participant', async () => {
      models.message.findById.mockReturnValue(query(msg));
      models.conversation.findOne.mockReturnValue(query({ _id: conversationId, participants: [oid(), ownerOid] }));
      await expect(run(ReportTargetType.MESSAGE, String(messageId))).rejects.toBeInstanceOf(NotFoundException);
    });
    it('404s when the conversation is in another org', async () => {
      models.message.findById.mockReturnValue(query(msg));
      models.conversation.findOne.mockReturnValue(query(null));
      await expect(run(ReportTargetType.MESSAGE, String(messageId))).rejects.toBeInstanceOf(NotFoundException);
    });
    it('404s when the message is missing', async () => {
      models.message.findById.mockReturnValue(query(null));
      await expect(run(ReportTargetType.MESSAGE, String(messageId))).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
