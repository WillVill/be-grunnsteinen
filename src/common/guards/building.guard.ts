import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "../../modules/users/schemas/user.schema";
import { CurrentUserData } from "../decorators/current-user.decorator";

export const BUILDING_KEY = "buildingId";
export const SKIP_BUILDING_CHECK = "skipBuildingCheck";

/**
 * Decorator to specify where to get the buildingId from in the request
 * @param source - 'params' | 'body' | 'query' - where to look for buildingId
 * @param key - the property name containing the buildingId (default: 'buildingId')
 */
export const BuildingId = (
  source: "params" | "body" | "query" = "params",
  key: string = "buildingId",
) => SetMetadata(BUILDING_KEY, { source, key });

/**
 * Decorator to skip building check for specific endpoints
 */
export const SkipBuildingCheck = () => SetMetadata(SKIP_BUILDING_CHECK, true);

@Injectable()
export class BuildingGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if building check should be skipped
    const skipCheck = this.reflector.getAllAndOverride<boolean>(
      SKIP_BUILDING_CHECK,
      [context.getHandler(), context.getClass()],
    );

    if (skipCheck) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as CurrentUserData;

    if (!user) {
      return false;
    }

    // Only super admins have access to all buildings in their organization
    // Regular admins are scoped to their assigned buildings
    if (user.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    // Get building metadata to know where to find the buildingId
    const buildingMeta = this.reflector.getAllAndOverride<{
      source: "params" | "body" | "query";
      key: string;
    }>(BUILDING_KEY, [context.getHandler(), context.getClass()]);

    // If no building metadata is set, allow access (building filtering handled in service)
    if (!buildingMeta) {
      return true;
    }

    const { source, key } = buildingMeta;
    let buildingId: string | undefined;

    switch (source) {
      case "params":
        buildingId = request.params?.[key];
        break;
      case "body":
        buildingId = request.body?.[key];
        break;
      case "query":
        buildingId = request.query?.[key];
        break;
    }

    // If no buildingId specified in request, allow (might be for org-wide access)
    if (!buildingId) {
      return true;
    }

    // Check if user has access to this building
    const hasAccess = user.buildingIds?.includes(buildingId);

    if (!hasAccess) {
      throw new ForbiddenException(
        "You do not have access to this building's data",
      );
    }

    return true;
  }
}
