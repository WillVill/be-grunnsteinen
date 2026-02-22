import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for a route
 * @param roles - Array of role strings (e.g., 'admin', 'board', 'resident')
 * @example
 * @Roles('admin', 'board')
 * @Get('admin-only')
 * adminEndpoint() {}
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

