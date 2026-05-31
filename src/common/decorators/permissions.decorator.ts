import { SetMetadata } from "@nestjs/common";
import { Permission } from "../permissions/permissions";

export const PERMISSIONS_KEY = "permissions";

/**
 * Decorator to require one or more capability permissions for a route.
 * Used with PermissionsGuard. A user passes if their role grants ALL listed
 * permissions.
 *
 * @example
 * @RequirePermissions(Permission.POST_MODERATE)
 * @UseGuards(PermissionsGuard)
 * @Patch(':id/pin')
 * pinPost() {}
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
