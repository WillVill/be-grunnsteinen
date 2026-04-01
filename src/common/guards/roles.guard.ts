import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../modules/users/schemas/user.schema';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Role hierarchy: SUPER_ADMIN > ADMIN > BOARD > RESIDENT
    const hasRole = requiredRoles.some((role) => {
      if (user.role === role) return true;
      // SUPER_ADMIN inherits all roles
      if (user.role === UserRole.SUPER_ADMIN) return true;
      // ADMIN inherits BOARD and RESIDENT permissions
      if (user.role === UserRole.ADMIN && (role === UserRole.BOARD || role === UserRole.RESIDENT)) return true;
      // BOARD inherits RESIDENT permissions
      if (user.role === UserRole.BOARD && role === UserRole.RESIDENT) return true;
      return false;
    });

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}

