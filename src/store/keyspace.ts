import type { Entry, EntryType, EntryValue } from './entry.js';
import { WrongTypeError } from './entry.js';

/**
 * The keyspace: every key in the database, keyed by name, each tagged with
 * its Redis type so we can raise a real `WRONGTYPE` error the way Redis
 * does (e.g. `LPUSH` on a key holding a string) instead of silently doing
 * the wrong thing or throwing a generic JS error.
 *
 * Expiry is handled the same conceptual way real Redis does it: lazily (a
 * key past its expiry is treated as absent the instant anything looks at
 * it) and actively (`startActiveExpiryCycle` runs a periodic sweep so idle
 * expired keys don't just sit in memory forever). The active sweep here is
 * a plain full scan on a timer rather than Redis's probabilistic sampling
 * algorithm — a deliberate simplification that's more than adequate at the
 * scale this project targets, but worth calling out as a difference from
 * production Redis.
 */
export class Keyspace {
  private entries = new Map<string, Entry>();
  private activeExpiryTimer: ReturnType<typeof setInterval> | null = null;

  private isExpired(entry: Entry, now: number): boolean {
    return entry.expireAt !== null && entry.expireAt <= now;
  }

  /** Raw entry lookup with lazy expiry applied. Returns undefined if absent or expired. */
  get(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry, Date.now())) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Returns the entry's value if it exists and matches `type`; throws WrongTypeError if it exists as a different type. */
  getTyped<T extends EntryValue>(key: string, type: EntryType): T | undefined {
    const entry = this.get(key);
    if (!entry) return undefined;
    if (entry.type !== type) throw new WrongTypeError();
    return entry.value as T;
  }

  /** Fetches the value for `key` as `type`, creating it via `factory` if absent. Throws WrongTypeError on a type mismatch. */
  getOrCreate<T extends EntryValue>(key: string, type: EntryType, factory: () => T): T {
    const existing = this.getTyped<T>(key, type);
    if (existing !== undefined) return existing;
    const value = factory();
    this.entries.set(key, { type, value, expireAt: null });
    return value;
  }

  /** Directly sets an entry, replacing whatever was there (used by SET, and by other commands that overwrite wholesale). */
  setEntry(key: string, type: EntryType, value: EntryValue, expireAt: number | null = null): void {
    this.entries.set(key, { type, value, expireAt });
  }

  delete(...keys: string[]): number {
    let count = 0;
    for (const key of keys) {
      if (this.get(key) !== undefined) {
        this.entries.delete(key);
        count++;
      }
    }
    return count;
  }

  type(key: string): EntryType | undefined {
    return this.get(key)?.type;
  }

  /** All live (non-expired) keys, optionally filtered by a Redis-style glob pattern. */
  keys(pattern?: string): string[] {
    const now = Date.now();
    const matcher = pattern !== undefined ? globToRegExp(pattern) : null;
    const out: string[] = [];
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry, now)) continue;
      if (!matcher || matcher.test(key)) out.push(key);
    }
    return out;
  }

  /** Count of live keys. O(n) because it has to skip expired-but-not-yet-swept entries. */
  size(): number {
    return this.keys().length;
  }

  /** Sets an absolute expiry time (ms since epoch). Returns false if the key doesn't exist. */
  expireAt(key: string, atMs: number): boolean {
    const entry = this.get(key);
    if (!entry) return false;
    entry.expireAt = atMs;
    return true;
  }

  persist(key: string): boolean {
    const entry = this.get(key);
    if (!entry || entry.expireAt === null) return false;
    entry.expireAt = null;
    return true;
  }

  /** TTL in ms: -2 if the key doesn't exist, -1 if it exists with no expiry, otherwise ms remaining. */
  ttlMs(key: string): number {
    const entry = this.get(key);
    if (!entry) return -2;
    if (entry.expireAt === null) return -1;
    return Math.max(entry.expireAt - Date.now(), 0);
  }

  flushAll(): void {
    this.entries.clear();
  }

  /** Starts a periodic full sweep that evicts expired keys even if nothing ever accesses them again. */
  startActiveExpiryCycle(intervalMs = 100): void {
    if (this.activeExpiryTimer) return;
    this.activeExpiryTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.entries) {
        if (this.isExpired(entry, now)) this.entries.delete(key);
      }
    }, intervalMs);
    this.activeExpiryTimer.unref?.();
  }

  stopActiveExpiryCycle(): void {
    if (this.activeExpiryTimer) {
      clearInterval(this.activeExpiryTimer);
      this.activeExpiryTimer = null;
    }
  }
}

/** Converts a Redis-style glob pattern (`*`, `?`, `[abc]`) into a RegExp. */
function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else if (c === '[') {
      const close = pattern.indexOf(']', i);
      if (close === -1) {
        out += '\\[';
      } else {
        out += `[${pattern.slice(i + 1, close)}]`;
        i = close;
      }
    } else {
      out += c.replace(/[.*+?^${}()|\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}
