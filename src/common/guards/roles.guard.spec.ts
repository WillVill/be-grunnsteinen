import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import { UserRole } from "../../modules/users/schemas/user.schema";

function contextFor(role: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    getHandler: () => null,
    getClass: () => null,
  } as unknown as ExecutionContext;
}

function guardWithRequiredRoles(required: string[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: () => required,
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe("RolesGuard", () => {
  it("allows when no roles are required", () => {
    const guard = guardWithRequiredRoles(undefined);
    expect(guard.canActivate(contextFor(UserRole.RESIDENT))).toBe(true);
  });

  it("lets host and caretaker through endpoints gated to the resident baseline", () => {
    // Regression: leaf roles must inherit RESIDENT, e.g. GET /buildings
    const guard = guardWithRequiredRoles([
      UserRole.ADMIN,
      UserRole.BOARD,
      UserRole.RESIDENT,
    ]);
    expect(guard.canActivate(contextFor(UserRole.HOST))).toBe(true);
    expect(guard.canActivate(contextFor(UserRole.CARETAKER))).toBe(true);
  });

  it("does NOT let host/caretaker reach board-or-admin-only endpoints", () => {
    const guard = guardWithRequiredRoles([UserRole.BOARD, UserRole.ADMIN]);
    expect(() => guard.canActivate(contextFor(UserRole.HOST))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(contextFor(UserRole.CARETAKER))).toThrow(
      ForbiddenException,
    );
  });

  it("keeps existing admin>board>resident inheritance", () => {
    const guard = guardWithRequiredRoles([UserRole.RESIDENT]);
    expect(guard.canActivate(contextFor(UserRole.ADMIN))).toBe(true);
    expect(guard.canActivate(contextFor(UserRole.BOARD))).toBe(true);
    expect(guard.canActivate(contextFor(UserRole.SUPER_ADMIN))).toBe(true);
  });
});
