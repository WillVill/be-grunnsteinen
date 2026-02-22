import { Param } from '@nestjs/common';
import { ParseObjectIdPipe } from '../pipes/parse-objectid.pipe';

/**
 * Decorator to validate MongoDB ObjectId from path parameters
 * Use this instead of @Param('id') for ObjectId validation
 * 
 * @example
 * @Get(':id')
 * async findOne(@ObjectIdParam('id') id: Types.ObjectId) {
 *   return this.service.findById(id);
 * }
 */
export const ObjectIdParam = (property?: string) => {
  return Param(property, new ParseObjectIdPipe());
};

