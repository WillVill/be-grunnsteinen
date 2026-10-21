import { NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { inOrg } from '../../common/schemas/tenant';
import { refId } from '../../common/schemas/ref-id';
import { canViewGroup } from '../groups/group-access';
import { ReportTargetType } from './schemas/report.schema';

export interface ReportTargetModels {
  post: Model<any>;
  comment: Model<any>;
  message: Model<any>;
  conversation: Model<any>;
  group: Model<any>;
}

/** The reporter, as `CurrentUserData` provides it (enough for `canViewGroup`). */
export interface Reporter {
  userId: string;
  role: string;
  buildingIds?: string[];
}

export interface ResolvedTarget {
  ownerId?: string;
  excerpt: string;
  webPath?: string;
}

export const EXCERPT_MAX = 280;

export function excerptOf(...parts: (string | undefined | null)[]): string {
  const text = parts
    .filter((p) => p && p.trim())
    .join(' — ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  return chars.length > EXCERPT_MAX ? chars.slice(0, EXCERPT_MAX - 1).join('') + '…' : text;
}

const notFound = () => new NotFoundException('Content not found');

/**
 * Mirrors `PostsService.assertPostVisible`: a group that no longer exists does not
 * hide its posts (`allowMissing`), but an existing group the reporter cannot view does.
 */
async function assertGroupVisibleTo(models: ReportTargetModels, groupId: unknown, reporter: Reporter, orgId: string) {
  const id = refId(groupId);
  if (!id || !Types.ObjectId.isValid(id)) throw notFound();
  const group = await models.group
    .findOne({ _id: id, organizationId: new Types.ObjectId(orgId) })
    .lean()
    .exec();
  if (!group) return undefined;
  if (!canViewGroup(group, reporter.userId, reporter)) throw notFound();
  return group;
}

/**
 * Loads the reported target scoped to the reporter's organisation and to what
 * the reporter can see. Anything missing or invisible reads as 404.
 */
export async function resolveReportTarget(
  models: ReportTargetModels,
  type: ReportTargetType,
  targetId: string,
  reporter: Reporter,
  orgId: string,
): Promise<ResolvedTarget> {
  switch (type) {
    case ReportTargetType.POST: {
      const post = await models.post.findOne(inOrg(targetId, orgId, 'Content')).lean().exec();
      if (!post) throw notFound();
      if (post.groupId) await assertGroupVisibleTo(models, post.groupId, reporter, orgId);
      return { ownerId: refId(post.authorId), excerpt: excerptOf(post.title, post.content), webPath: `/posts/${targetId}` };
    }
    case ReportTargetType.COMMENT: {
      const comment = Types.ObjectId.isValid(targetId) ? await models.comment.findById(targetId).lean().exec() : null;
      if (!comment) throw notFound();
      const post = await models.post
        .findOne({ _id: comment.postId, organizationId: new Types.ObjectId(orgId) })
        .lean()
        .exec();
      if (!post) throw notFound();
      if (post.groupId) await assertGroupVisibleTo(models, post.groupId, reporter, orgId);
      return { ownerId: refId(comment.authorId), excerpt: excerptOf(comment.content), webPath: `/posts/${refId(post._id)}` };
    }
    case ReportTargetType.MESSAGE: {
      const message = Types.ObjectId.isValid(targetId) ? await models.message.findById(targetId).lean().exec() : null;
      if (!message) throw notFound();
      const conversation = await models.conversation
        .findOne({ _id: message.conversationId, organizationId: new Types.ObjectId(orgId) })
        .lean()
        .exec();
      const isParticipant = conversation?.participants?.some((p: unknown) => refId(p) === reporter.userId);
      if (!isParticipant) throw notFound();
      return { ownerId: refId(message.senderId), excerpt: excerptOf(message.content) };
    }
  }
}
