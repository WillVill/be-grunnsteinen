import { Types } from 'mongoose';
import { refId } from './ref-id';

describe('refId', () => {
  const id = new Types.ObjectId();

  it('reads a bare ObjectId', () => {
    expect(refId(id)).toBe(id.toString());
  });

  it('reads the _id of a populated document', () => {
    expect(refId({ _id: id, name: 'Kari' })).toBe(id.toString());
  });

  it('passes strings through', () => {
    expect(refId('abc')).toBe('abc');
  });

  it('returns undefined for missing refs', () => {
    expect(refId(undefined)).toBeUndefined();
    expect(refId(null)).toBeUndefined();
  });
});
