import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../users/schemas/user.schema';
import { assertGroupVisible, canViewGroup, findHiddenGroupIds, isGroupMember } from './group-access';

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
    const host = { role: UserRole.HOST, buildingIds: [buildingId] };
    expect(canViewGroup(privateGroup, outsiderId, host)).toBe(true);
    expect(canViewGroup({ ...privateGroup, buildingId: otherBuildingId }, outsiderId, host)).toBe(false);
  });

  it('keeps a concept-wide private group from a host but not from board', () => {
    const conceptWide = { ...privateGroup, isConceptWide: true };
    const host = { role: UserRole.HOST, buildingIds: [buildingId] };
    expect(canViewGroup(conceptWide, outsiderId, host)).toBe(false);
    expect(canViewGroup(conceptWide, outsiderId, board)).toBe(true);
    expect(canViewGroup(conceptWide, memberId, resident)).toBe(true);
  });
});

/** A Mongoose query stand-in: chainable select/lean, resolved by exec(). */
const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['select', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  return q;
};

describe('assertGroupVisible', () => {
  const orgId = new Types.ObjectId().toString();
  const groupId = new Types.ObjectId().toString();
  const privateGroup = { isPrivate: true, buildingId, members: [new Types.ObjectId(memberId)] };
  let groupModel: { findOne: jest.Mock };
  let userModel: { findById: jest.Mock };
  const check = (userId: string, opts?: { allowMissing?: boolean }, ref: unknown = groupId) =>
    assertGroupVisible(groupModel as any, userModel as any, ref, orgId, userId, opts);

  beforeEach(() => {
    groupModel = { findOne: jest.fn(() => query(privateGroup)) };
    userModel = { findById: jest.fn(() => query({ role: UserRole.RESIDENT, buildingIds: [] })) };
  });

  it('looks the group up inside the organisation', async () => {
    await check(memberId);
    expect(groupModel.findOne).toHaveBeenCalledWith({ _id: groupId, organizationId: new Types.ObjectId(orgId) });
  });

  it('lets a member through without a user lookup', async () => {
    await expect(check(memberId)).resolves.toBeUndefined();
    expect(userModel.findById).not.toHaveBeenCalled();
  });

  it('accepts a populated group ref', async () => {
    await expect(check(memberId, {}, { _id: new Types.ObjectId(groupId), name: 'G' })).resolves.toBeUndefined();
  });

  it('forbids a non-member resident', async () => {
    await expect(check(outsiderId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets board through', async () => {
    userModel.findById.mockReturnValue(query(board));
    await expect(check(outsiderId)).resolves.toBeUndefined();
  });

  it('reads a missing / foreign group as not found unless allowMissing', async () => {
    groupModel.findOne.mockReturnValue(query(null));
    await expect(check(memberId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(check(memberId, { allowMissing: true })).resolves.toBeUndefined();
  });

  it('reads a malformed id as not found without querying', async () => {
    await expect(check(memberId, {}, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(groupModel.findOne).not.toHaveBeenCalled();
  });
});

describe('findHiddenGroupIds', () => {
  const orgId = new Types.ObjectId().toString();
  const hidden = [new Types.ObjectId()];
  let groupModel: { distinct: jest.Mock };
  let userModel: { findById: jest.Mock };
  const run = () => findHiddenGroupIds(groupModel as any, userModel as any, orgId, outsiderId);

  beforeEach(() => {
    groupModel = { distinct: jest.fn().mockResolvedValue(hidden) };
    userModel = { findById: jest.fn(() => query({ role: UserRole.RESIDENT })) };
  });

  it('returns the private groups the caller is not in', async () => {
    await expect(run()).resolves.toEqual(hidden);
    expect(groupModel.distinct).toHaveBeenCalledWith('_id', {
      organizationId: new Types.ObjectId(orgId),
      isPrivate: true,
      members: { $ne: new Types.ObjectId(outsiderId) },
    });
  });

  it('skips the user lookup when nothing is hidden', async () => {
    groupModel.distinct.mockResolvedValue([]);
    await expect(run()).resolves.toEqual([]);
    expect(userModel.findById).not.toHaveBeenCalled();
  });

  it.each([UserRole.BOARD, UserRole.ADMIN, UserRole.SUPER_ADMIN])('hides nothing from %s', async (role) => {
    userModel.findById.mockReturnValue(query({ role }));
    await expect(run()).resolves.toEqual([]);
  });

  it.each([UserRole.HOST, UserRole.CARETAKER])('still hides them from %s', async (role) => {
    userModel.findById.mockReturnValue(query({ role }));
    await expect(run()).resolves.toEqual(hidden);
  });
});
