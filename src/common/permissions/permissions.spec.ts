import {
  Permission,
  ROLE_PERMISSIONS,
  hasPermission,
  canModerateInBuilding,
} from "./permissions";
import { UserRole } from "../../modules/users/schemas/user.schema";

describe("permissions", () => {
  describe("ROLE_PERMISSIONS matrix", () => {
    it("grants resident and caretaker no permissions", () => {
      expect(ROLE_PERMISSIONS[UserRole.RESIDENT]).toEqual([]);
      expect(ROLE_PERMISSIONS[UserRole.CARETAKER]).toEqual([]);
    });

    it("grants host community-moderation but NOT formal permissions", () => {
      expect(hasPermission(UserRole.HOST, Permission.POST_MODERATE)).toBe(true);
      expect(hasPermission(UserRole.HOST, Permission.EVENT_MANAGE_ALL)).toBe(true);
      expect(hasPermission(UserRole.HOST, Permission.GROUP_MODERATE)).toBe(true);
      expect(hasPermission(UserRole.HOST, Permission.SHARING_MODERATE)).toBe(true);
      expect(hasPermission(UserRole.HOST, Permission.BROADCAST_MESSAGE)).toBe(true);

      expect(hasPermission(UserRole.HOST, Permission.DOCUMENT_PUBLISH)).toBe(false);
      expect(hasPermission(UserRole.HOST, Permission.BOOKING_APPROVE)).toBe(false);
      expect(hasPermission(UserRole.HOST, Permission.RESOURCE_MANAGE)).toBe(false);
      expect(hasPermission(UserRole.HOST, Permission.USER_MANAGE)).toBe(false);
    });

    it("grants board the formal permissions hosts lack", () => {
      expect(hasPermission(UserRole.BOARD, Permission.DOCUMENT_PUBLISH)).toBe(true);
      expect(hasPermission(UserRole.BOARD, Permission.BOOKING_APPROVE)).toBe(true);
      expect(hasPermission(UserRole.BOARD, Permission.RESOURCE_MANAGE)).toBe(true);
      // ...but not user/org management
      expect(hasPermission(UserRole.BOARD, Permission.USER_MANAGE)).toBe(false);
    });

    it("grants admin and super_admin every permission", () => {
      for (const p of Object.values(Permission)) {
        expect(hasPermission(UserRole.ADMIN, p)).toBe(true);
        expect(hasPermission(UserRole.SUPER_ADMIN, p)).toBe(true);
      }
    });

    it("denies unknown roles", () => {
      expect(hasPermission("nonsense", Permission.POST_MODERATE)).toBe(false);
    });
  });

  describe("canModerateInBuilding", () => {
    const buildingA = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const buildingB = "bbbbbbbbbbbbbbbbbbbbbbbb";

    it("lets admin moderate any building, including org-wide content", () => {
      const admin = { role: UserRole.ADMIN, buildingIds: [] };
      expect(canModerateInBuilding(admin, buildingA, Permission.POST_MODERATE)).toBe(true);
      expect(canModerateInBuilding(admin, null, Permission.POST_MODERATE)).toBe(true);
    });

    it("scopes a host to assigned buildings only", () => {
      const host = { role: UserRole.HOST, buildingIds: [buildingA] };
      expect(canModerateInBuilding(host, buildingA, Permission.POST_MODERATE)).toBe(true);
      expect(canModerateInBuilding(host, buildingB, Permission.POST_MODERATE)).toBe(false);
    });

    it("blocks a host from moderating org-wide / concept-wide content", () => {
      const host = { role: UserRole.HOST, buildingIds: [buildingA] };
      expect(canModerateInBuilding(host, null, Permission.POST_MODERATE)).toBe(false);
    });

    it("blocks a host for permissions they do not hold", () => {
      const host = { role: UserRole.HOST, buildingIds: [buildingA] };
      expect(canModerateInBuilding(host, buildingA, Permission.DOCUMENT_PUBLISH)).toBe(false);
    });

    it("keeps board org-wide (not building-scoped)", () => {
      const board = { role: UserRole.BOARD, buildingIds: [buildingA] };
      expect(canModerateInBuilding(board, buildingB, Permission.POST_MODERATE)).toBe(true);
      expect(canModerateInBuilding(board, null, Permission.POST_MODERATE)).toBe(true);
    });

    it("denies residents and caretakers", () => {
      const resident = { role: UserRole.RESIDENT, buildingIds: [buildingA] };
      const caretaker = { role: UserRole.CARETAKER, buildingIds: [buildingA] };
      expect(canModerateInBuilding(resident, buildingA, Permission.POST_MODERATE)).toBe(false);
      expect(canModerateInBuilding(caretaker, buildingA, Permission.POST_MODERATE)).toBe(false);
    });

    it("normalizes ObjectId-like building ids via toString()", () => {
      const host = {
        role: UserRole.HOST,
        buildingIds: [{ toString: () => buildingA }],
      };
      const resourceBuildingId = { toString: () => buildingA };
      expect(
        canModerateInBuilding(host, resourceBuildingId, Permission.POST_MODERATE),
      ).toBe(true);
    });
  });
});
