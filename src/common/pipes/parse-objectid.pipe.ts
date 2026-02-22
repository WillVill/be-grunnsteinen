import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Pipe to validate and transform MongoDB ObjectId from path/query parameters
 * Ensures all ObjectIds are properly validated before use
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, Types.ObjectId> {
  transform(value: string, metadata: ArgumentMetadata): Types.ObjectId {
    if (!value) {
      throw new BadRequestException(`Invalid ${metadata.data || 'ID'}: value is required`);
    }

    // Trim any whitespace that might have been added
    const trimmedValue = value.trim();

    if (!Types.ObjectId.isValid(trimmedValue)) {
      throw new BadRequestException(
        `Invalid ObjectId format${metadata.data ? ` for ${metadata.data}` : ''} (received: "${value}", length: ${value.length})`,
      );
    }

    return new Types.ObjectId(trimmedValue);
  }
}

