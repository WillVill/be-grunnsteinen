import { Types } from 'mongoose';
import { UserRole } from '../users/schemas/user.schema';
import { canViewGroup, isGroupMember } from './group-access';

const memberId = new Types.ObjectId().toString();
const outsiderId = new Types.ObjectId().toString();
const buildingId = new Types.ObjectId();
const otherBuildingId = new Types.ObjectId();

const resident = { role: UserRole.RESIDENT, buildingIds: [buildingId] };
const board = { role: UserRole.BOARD, buildingIds: [] };

describe('isGroupMember', () => {
  it('matches bare and populated member refs', () => {
    expect(isGroupMember({ members: [new Types.ObjectId(memberId)] }, memberId)).toBe(true);
    expect(isGroupMember({ members: [{ _id: new Types.ObjectId(memberId), name: 'A' }] }, memberId)).toBe(true);
    expect(isGroupMember({ members: [new Types.ObjectId(memberId)] }, outsiderId)).toBe(false);
    expect(isGroupMember({}, memberId)).toBe(false);
  });
});

describe('canViewGroup', () => {
  const privateGroup = { isPrivate: true, buildingId, members: [new Types.ObjectId(memberId)] };

  it('lets anyone see a public group', () => {
    expect(canViewGroup({ isPrivate: false, members: [] }, outsiderId, resident)).toBe(true);
  });

  it('lets members see a private group', () => {
    expect(canViewGroup(privateGroup, memberId, resident)).toBe(true);
  });

  it('hides a private group from a resident who is not a member', () => {
    expect(canViewGroup(privateGroup, outsiderId, resident)).toBe(false);
    expect(canViewGroup(privateGroup, outsiderId, null)).toBe(false);
  });

  it('lets a board member (org-wide moderator) see it', () => {
    expect(canViewGroup(privateGroup, outsiderId, board)).toBe(true);
  });

  it('lets a building-scoped moderator see it only in their building', () => {
    const host = { role: 'host', buildingIds: [buildingId] };
    expect(canViewGroup(privateGroup, outsiderId, host)).toBe(
      canViewGroup({ ...privateGroup, buildingId }, outsiderId, host),
    );
    expect(canViewGroup({ ...privateGroup, buildingId: otherBuildingId }, outsiderId, { role: 'host', buildingIds: [buildingId] })).toBe(false);
  });
});
