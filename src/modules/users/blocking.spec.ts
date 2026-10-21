import { Types } from 'mongoose';
import { getBlockedIds, isBlockedEitherWay } from './blocking';

const a = '507f1f77bcf86cd799439011';
const b = '507f1f77bcf86cd799439012';

const query = (result: any) => {
  const q: any = {};
  q.select = jest.fn().mockReturnValue(q);
  q.lean = jest.fn().mockReturnValue(q);
  q.exec = jest.fn().mockResolvedValue(result);
  return q;
};

describe('blocking helpers', () => {
  describe('getBlockedIds', () => {
    it('returns [] when the field is missing', async () => {
      const q = query({ _id: a });
      const model: any = { findById: jest.fn().mockReturnValue(q) };
      expect(await getBlockedIds(model, a)).toEqual([]);
      expect(q.select).toHaveBeenCalledWith('+blockedUserIds');
    });

    it('returns [] when the user is not found', async () => {
      const model: any = { findById: jest.fn().mockReturnValue(query(null)) };
      expect(await getBlockedIds(model, a)).toEqual([]);
    });

    it('returns ObjectIds when set', async () => {
      const model: any = { findById: jest.fn().mockReturnValue(query({ blockedUserIds: [new Types.ObjectId(b)] })) };
      const ids = await getBlockedIds(model, a);
      expect(ids).toHaveLength(1);
      expect(ids[0]).toBeInstanceOf(Types.ObjectId);
      expect(ids[0].toString()).toBe(b);
    });
  });

  describe('isBlockedEitherWay', () => {
    it('builds the two-direction $or and returns true on a hit', async () => {
      const model: any = { countDocuments: jest.fn().mockResolvedValue(1) };
      expect(await isBlockedEitherWay(model, a, b)).toBe(true);
      const filter = model.countDocuments.mock.calls[0][0];
      expect(filter.$or).toHaveLength(2);
      expect(filter.$or[0]._id.toString()).toBe(a);
      expect(filter.$or[0].blockedUserIds.toString()).toBe(b);
      expect(filter.$or[1]._id.toString()).toBe(b);
      expect(filter.$or[1].blockedUserIds.toString()).toBe(a);
    });

    it('returns false when the count is 0', async () => {
      const model: any = { countDocuments: jest.fn().mockResolvedValue(0) };
      expect(await isBlockedEitherWay(model, a, b)).toBe(false);
    });
  });
});
