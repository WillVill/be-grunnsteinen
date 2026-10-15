import { Transform } from 'class-transformer';

/**
 * Query-string boolean ("true" / "false").
 *
 * Reads the raw value from the source object: the global ValidationPipe runs with
 * `enableImplicitConversion`, so by the time a `@Transform` sees `value` it has already
 * been coerced to the declared type, and `Boolean('false') === true`.
 * Anything else passes through unchanged so `@IsBoolean()` can reject it.
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ obj, key }) => {
    const raw = obj[key];
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    return raw;
  });
}
