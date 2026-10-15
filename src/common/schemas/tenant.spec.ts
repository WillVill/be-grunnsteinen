import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { assertIdsInOrg, findInOrg, inOrg } from './tenant';

describe('tenant helpers', () => {
  const orgId = new Types.ObjectId().toString();
  const id = new Types.ObjectId().toString();

  describe('inOrg', () => {
    it('builds an id + organisation filter', () => {
      expect(inOrg(id, orgId)).toEqual({ _id: id, organizationId: new Types.ObjectId(orgId) });
    });

    it('accepts ObjectIds and populated refs', () => {
      expect(inOrg(new Types.ObjectId(id), orgId)._id).toBe(id);
      expect(inOrg({ _id: new Types.ObjectId(id) }, orgId)._id).toBe(id);
    });

    it('reads a malformed or missing id as not found', () => {
      expect(() => inOrg('nope', orgId, 'Booking')).toThrow(new NotFoundException('Booking not found'));
      expect(() => inOrg(undefined, orgId)).toThrow(NotFoundException);
    });
  });

  describe('findInOrg', () => {
    it('returns the findOne query so callers can chain', () => {
      const q = { populate: jest.fn() };
      const model: any = { findOne: jest.fn(() => q) };
      expect(findInOrg(model, id, orgId, 'name')).toBe(q);
      expect(model.findOne).toHaveBeenCalledWith({ _id: id, organizationId: new Types.ObjectId(orgId) }, 'name');
    });

    it('throws NotFound for an invalid id without querying', () => {
      const model: any = { findOne: jest.fn() };
      expect(() => findInOrg(model, 'bad', orgId)).toThrow(NotFoundException);
      expect(model.findOne).not.toHaveBeenCalled();
    });
  });

  describe('assertIdsInOrg', () => {
    const a = new Types.ObjectId().toString();
    const b = new Types.ObjectId().toString();

    it('passes when every (deduplicated) id is in the organisation', async () => {
      const model: any = { countDocuments: jest.fn().mockResolvedValue(2) };
      await expect(assertIdsInOrg(model, [a, b, a], orgId, 'Building')).resolves.toBeUndefined();
      const filter = model.countDocuments.mock.calls[0][0];
      expect(filter._id.$in).toEqual([new Types.ObjectId(a), new Types.ObjectId(b)]);
      expect(filter.organizationId).toEqual(new Types.ObjectId(orgId));
    });

    it('rejects when an id is missing or in another organisation', async () => {
      const model: any = { countDocuments: jest.fn().mockResolvedValue(1) };
      await expect(assertIdsInOrg(model, [a, b], orgId, 'Building')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects malformed ids without querying', async () => {
      const model: any = { countDocuments: jest.fn() };
      await expect(assertIdsInOrg(model, ['x'], orgId)).rejects.toBeInstanceOf(BadRequestException);
      expect(model.countDocuments).not.toHaveBeenCalled();
    });

    it('passes empty lists without querying', async () => {
      const model: any = { countDocuments: jest.fn() };
      await assertIdsInOrg(model, [], orgId);
      await assertIdsInOrg(model, undefined, orgId);
      expect(model.countDocuments).not.toHaveBeenCalled();
    });
  });
});
