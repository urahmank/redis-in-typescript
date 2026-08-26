import type { RedisList } from './list.js';
import type { SortedSet } from './skiplist.js';

export type EntryType = 'string' | 'list' | 'hash' | 'set' | 'zset';

export type EntryValue = string | RedisList | Map<string, string> | Set<string> | SortedSet;

export interface Entry<T extends EntryValue = EntryValue> {
  type: EntryType;
  value: T;
  /** Absolute expiry time in ms since epoch, or null if the key has no TTL. */
  expireAt: number | null;
}

/** Thrown when a command targets a key holding a different type, e.g. LPUSH on a string. */
export class WrongTypeError extends Error {
  constructor() {
    super('WRONGTYPE Operation against a key holding the wrong kind of value');
  }
}

const TYPE_LABEL: Record<EntryType, string> = {
  string: 'string',
  list: 'list',
  hash: 'hash',
  set: 'set',
  zset: 'zset',
};

export function typeLabel(type: EntryType): string {
  return TYPE_LABEL[type];
}
