/**
 * Normalizes a Redis-style start/stop index pair (as used by LRANGE, LTRIM,
 * ZRANGE by rank, ...) against a collection of a given length.
 *
 * Negative indices count from the end (-1 is the last element). Out-of-range
 * indices are clamped rather than treated as errors, matching Redis. Returns
 * `null` when the resulting range is empty.
 */
export function normalizeRange(start: number, stop: number, length: number): [number, number] | null {
  if (length === 0) return null;

  let s = start < 0 ? Math.max(length + start, 0) : start;
  let e = stop < 0 ? length + stop : stop;

  if (e >= length) e = length - 1;
  if (s > e || s >= length || e < 0) return null;

  return [s, e];
}

/** Normalizes a single Redis-style index (negative counts from the end). Returns null if out of bounds. */
export function normalizeIndex(index: number, length: number): number | null {
  const i = index < 0 ? length + index : index;
  return i >= 0 && i < length ? i : null;
}
