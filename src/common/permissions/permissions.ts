import { UserRole, isAdminRole } from "../../modules/users/schemas/user.schema";

/**
 * Minimal actor shape needed for moderation checks. Compatible with both the
 * request-scoped CurrentUserData (buildingIds: string[]) and a Mongoose user
 * document (buildingIds: ObjectId[]) — ids are normalized via toString().
 */
export interface ModeratorContext {
  role: string;
  buildingIds?: Array<string | { toString(): string }>;
}

/**
 * Capability-based permissions layer.
 *
 * The role hierarchy (resident < board < admin < super_admin) cannot express
 * the Host role, which needs SOME board-like powers (moderate community life)
 * but explicitly NOT others (publish documents, change booking rules, manage
 * users). Permissions decouple "what you can do" from the linear role chain.
 *
 * String values are intentional: stable, debuggable and serialization-safe.
 */
export enum Permission {
  POST_MODERATE = "post_moderate", // pin / delete others' posts, post as official
  EVENT_MANAGE_ALL = "event_manage_all", // edit/delete any event
  GROUP_MODERATE = "group_moderate", // moderate / close any group
  SHARING_MODERATE = "sharing_moderate", // remove others' shared content / help requests
  BROADCAST_MESSAGE = "broadcast_message", // send building-wide messages
  DOCUMENT_PUBLISH = "document_publish", // upload/edit/archive documents
  BOOKING_APPROVE = "booking_approve", // approve/reject/override bookings
  RESOURCE_MANAGE = "resource_manage", // booking rules, prices, resources
  USER_MANAGE = "user_manage", // create/change/remove access
  BUILDING_MANAGE = "building_manage",
  ORG_MANAGE = "org_manage",
}

/** Powers that make a Host the social/practical face of the buildings. */
const HOST_PERMISSIONS: Permission[] = [
  Permission.POST_MODERATE,
  Permission.EVENT_MANAGE_ALL,
  Permission.GROUP_MODERATE,
  Permission.SHARING_MODERATE,
  Permission.BROADCAST_MESSAGE,
];

/** Formal/operational control reserved for board and above. */
const BOARD_PERMISSIONS: Permission[] = [
  ...HOST_PERMISSIONS,
  Permission.DOCUMENT_PUBLISH,
  Permission.BOOKING_APPROVE,
  Permission.RESOURCE_MANAGE,
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...BOARD_PERMISSIONS,
  Permission.USER_MANAGE,
  Permission.BUILDING_MANAGE,
  Permission.ORG_MANAGE,
];

/**
 * Single source of truth: role -> granted permissions.
 *
 * Caretaker is intentionally empty in v1 (resident-level participation only);
 * the role exists to be assignable and building-scoped until the operational
 * cases workflow is built.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.RESIDENT]: [],
  [UserRole.CARETAKER]: [],
  [UserRole.HOST]: HOST_PERMISSIONS,
  [UserRole.BOARD]: BOARD_PERMISSIONS,
  [UserRole.ADMIN]: ADMIN_PERMISSIONS,
  [UserRole.SUPER_ADMIN]: ADMIN_PERMISSIONS,
};

/** Whether a role is granted a given permission. */
export function hasPermission(role: string, permission: Permission): boolean {
  const granted = ROLE_PERMISSIONS[role as UserRole];
  return granted ? granted.includes(permission) : false;
}

/**
 * Building-scoped moderation check used in service layers.
 *
 * - admin / super_admin: always allowed (span all buildings)
 * - board: allowed org-wide (kept unscoped to avoid regressing existing tenants)
 * - host: only when the resource is tied to one of the host's assigned buildings
 * - org-wide content (no buildingId): admin only — a host cannot moderate it
 * - anyone else (incl. caretaker / resident): denied
 */
export function canModerateInBuilding(
  user: ModeratorContext,
  resourceBuildingId: string | { toString(): string } | null | undefined,
  permission: Permission,
): boolean {
  if (!user) return false;

  // Admins span everything.
  if (isAdminRole(user.role)) return true;

  // Must hold the capability at all.
  if (!hasPermission(user.role, permission)) return false;

  // Board keeps org-wide reach.
  if (user.role === UserRole.BOARD) return true;

  // Host (and any other scoped role): only within assigned buildings.
  // Org-wide / concept-wide content has no buildingId and is out of reach.
  if (!resourceBuildingId) return false;
  const target = resourceBuildingId.toString();
  return (
    user.buildingIds?.some((id) => id.toString() === target) ?? false
  );
}
