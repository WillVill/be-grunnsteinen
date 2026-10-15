import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import {
  Permission,
  canModerateInBuilding,
  type ModeratorContext,
} from '../../common/permissions/permissions';
import { refId } from '../../common/schemas/ref-id';
import { isBoardOrAbove, type UserDocument } from '../users/schemas/user.schema';
import type { GroupDocument } from './schemas/group.schema';

/** Only the model methods the helpers below use, so tests can pass plain mocks. */
type GroupLookup = Pick<Model<GroupDocument>, 'findOne'>;
type GroupDistinct = Pick<Model<GroupDocument>, 'distinct'>;
type UserLookup = Pick<Model<UserDocument>, 'findById'>;

/** The group fields that decide who may see it. Works on populated and bare documents. */
export interface GroupAccessTarget {
  isPrivate?: boolean;
  isConceptWide?: boolean;
  buildingId?: unknown;
  members?: unknown[];
}

export function isGroupMember(group: GroupAccessTarget, userId: string): boolean {
  return (group.members ?? []).some((member) => refId(member) === userId);
}

/**
 * A public group is visible to everyone in its organisation. A private group is
 * visible to its members and to moderators of its building (any building for a
 * concept-wide group follows `canModerateInBuilding` with a null building).
 */
export function canViewGroup(
  group: GroupAccessTarget,
  userId: string,
  user: ModeratorContext | null | undefined,
): boolean {
  if (!group.isPrivate) return true;
  if (isGroupMember(group, userId)) return true;
  const scopeBuildingId = group.isConceptWide ? null : (group.buildingId as string | null | undefined);
  return !!user && canModerateInBuilding(user, scopeBuildingId, Permission.GROUP_MODERATE);
}

/**
 * Content tied to a group (posts, events) is only visible to people who can see
 * the group. A group outside the caller's organisation, or a malformed id, reads
 * as not found. `allowMissing` lets reads of content whose group has since been
 * removed fall through. Members are let through without a user lookup.
 */
export async function assertGroupVisible(
  groupModel: GroupLookup,
  userModel: UserLookup,
  groupRef: unknown,
  organizationId: string,
  userId: string,
  { allowMissing = false }: { allowMissing?: boolean } = {},
): Promise<void> {
  const groupId = refId(groupRef);
  const group =
    groupId && Types.ObjectId.isValid(groupId)
      ? await groupModel
          .findOne({ _id: groupId, organizationId: new Types.ObjectId(organizationId) })
          .select('isPrivate isConceptWide buildingId members')
          .lean()
          .exec()
      : null;
  if (!group) {
    if (allowMissing) return;
    throw new NotFoundException('Group not found');
  }
  if (!group.isPrivate || isGroupMember(group, userId)) return;
  const user = await userModel.findById(userId).select('role buildingIds').lean().exec();
  if (!canViewGroup(group, userId, user)) {
    throw new ForbiddenException('This group is private');
  }
}

/**
 * Private groups whose content a mixed feed must leave out for this caller: the
 * ones they aren't a member of. Board and admins moderate the whole organisation,
 * so nothing is hidden from them; their role is only looked up when there is
 * something to hide. Hosts keep the exclusion (their reach is per building).
 */
export async function findHiddenGroupIds(
  groupModel: GroupDistinct,
  userModel: UserLookup,
  organizationId: string,
  userId: string,
): Promise<Types.ObjectId[]> {
  const hidden = await groupModel.distinct('_id', {
    organizationId: new Types.ObjectId(organizationId),
    isPrivate: true,
    members: { $ne: new Types.ObjectId(userId) },
  });
  if (hidden.length === 0) return [];
  const user = await userModel.findById(userId).select('role').lean().exec();
  return user && isBoardOrAbove(user.role) ? [] : (hidden as Types.ObjectId[]);
}
