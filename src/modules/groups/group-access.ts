import {
  Permission,
  canModerateInBuilding,
  type ModeratorContext,
} from '../../common/permissions/permissions';
import { refId } from '../../common/schemas/ref-id';

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
