import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model, ProjectionType, QueryFilter, Types } from 'mongoose';
import { refId } from './ref-id';

/**
 * `{ _id, organizationId }` for a record that must live in the caller's
 * organisation. A malformed id can never match, so it reads as not found
 * (same as a foreign id) instead of surfacing as a CastError 500.
 * Use it for follow-up writes too (`findOneAndUpdate`, `deleteOne`).
 */
export function inOrg<T = unknown>(id: unknown, orgId: string, label = 'Resource'): QueryFilter<T> {
  const value = refId(id);
  if (!value || !Types.ObjectId.isValid(value)) {
    throw new NotFoundException(`${label} not found`);
  }
  return { _id: value, organizationId: new Types.ObjectId(orgId) } as QueryFilter<T>;
}

/**
 * `model.findOne({ _id: id, organizationId: orgId })`, returned as the query so
 * callers can chain `.populate()` / `.select()` / `.lean()`. The caller still
 * checks the result for null (a foreign id simply matches nothing). An invalid
 * ObjectId throws NotFoundException synchronously.
 */
export function findInOrg<T>(
  model: Model<T>,
  id: unknown,
  orgId: string,
  projection?: ProjectionType<T> | null,
  label = 'Resource',
) {
  return model.findOne(inOrg<T>(id, orgId, label), projection);
}

/**
 * Throws BadRequestException unless every id is a valid ObjectId of a record in
 * the caller's organisation. For ids sent in a request body (building ids on a
 * user, an apartment on a document, ...), where "not found" means bad input.
 * Duplicates are fine; empty/undefined lists pass.
 */
export async function assertIdsInOrg<T>(
  model: Pick<Model<T>, 'countDocuments'>,
  ids: readonly unknown[] | null | undefined,
  orgId: string,
  label = 'Resource',
): Promise<void> {
  const unique = [...new Set((ids ?? []).map((id) => refId(id)))];
  if (unique.length === 0) return;
  if (unique.some((id) => !id || !Types.ObjectId.isValid(id))) {
    throw new BadRequestException(`${label} not found in this organization`);
  }
  const count = await model.countDocuments({
    _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
    organizationId: new Types.ObjectId(orgId),
  } as QueryFilter<T>);
  if (count !== unique.length) {
    throw new BadRequestException(`${label} not found in this organization`);
  }
}
