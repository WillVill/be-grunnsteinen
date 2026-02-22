import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserData {
  userId: string;
  email: string;
  role: string;
  organizationId: string;
  buildingIds: string[];
  primaryBuildingId?: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserData;

    if (!user) {
      return null;
    }

    // If a specific property is requested, return only that
    if (data) {
      return user[data];
    }

    return user;
  },
);

