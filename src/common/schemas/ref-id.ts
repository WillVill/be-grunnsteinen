/**
 * The id behind a reference field, whether it holds a bare ObjectId or a
 * populated document. A populated doc's toString() is the whole document, so
 * `ref.toString() === userId` silently fails after `.populate()` — use this.
 */
export function refId(ref: unknown): string | undefined {
  if (ref && typeof ref === 'object' && '_id' in ref) {
    return String((ref as { _id: unknown })._id);
  }
  return ref == null ? undefined : String(ref);
}
