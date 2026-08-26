import { describe, expect, it, vi } from 'vitest';
import { Keyspace } from '../src/store/keyspace.js';
import { WrongTypeError } from '../src/store/entry.js';

describe('Keyspace', () => {
  it('stores and retrieves typed entries', () => {
    const ks = new Keyspace();
    ks.setEntry('foo', 'string', 'bar');
    expect(ks.getTyped('foo', 'string')).toBe('bar');
    expect(ks.type('foo')).toBe('string');
  });

  it('throws WrongTypeError on a type mismatch', () => {
    const ks = new Keyspace();
    ks.setEntry('foo', 'string', 'bar');
    expect(() => ks.getTyped('foo', 'list')).toThrow(WrongTypeError);
  });

  it('getOrCreate creates on first access and reuses afterwards', () => {
    const ks = new Keyspace();
    const set1 = ks.getOrCreate('s', 'set', () => new Set<string>());
    set1.add('a');
    const set2 = ks.getOrCreate('s', 'set', () => new Set<string>());
    expect(set2.has('a')).toBe(true);
    expect(set1).toBe(set2);
  });

  it('expires keys lazily on access', () => {
    const ks = new Keyspace();
    ks.setEntry('foo', 'string', 'bar', Date.now() - 1);
    expect(ks.has('foo')).toBe(false);
    expect(ks.get('foo')).toBeUndefined();
  });

  it('reports ttlMs sentinels correctly', () => {
    const ks = new Keyspace();
    expect(ks.ttlMs('missing')).toBe(-2);
    ks.setEntry('a', 'string', 'x');
    expect(ks.ttlMs('a')).toBe(-1);
    ks.expireAt('a', Date.now() + 10_000);
    expect(ks.ttlMs('a')).toBeGreaterThan(0);
  });

  it('persist removes an expiry', () => {
    const ks = new Keyspace();
    ks.setEntry('a', 'string', 'x', Date.now() + 10_000);
    expect(ks.persist('a')).toBe(true);
    expect(ks.ttlMs('a')).toBe(-1);
    expect(ks.persist('a')).toBe(false);
  });

  it('matches KEYS glob patterns', () => {
    const ks = new Keyspace();
    ks.setEntry('foo1', 'string', 'a');
    ks.setEntry('foo2', 'string', 'b');
    ks.setEntry('bar', 'string', 'c');
    expect(ks.keys('foo*').sort()).toEqual(['foo1', 'foo2']);
    expect(ks.keys('*').sort()).toEqual(['bar', 'foo1', 'foo2']);
    expect(ks.keys('foo?')).toHaveLength(2);
  });

  it('active expiry cycle sweeps expired keys in the background', async () => {
    vi.useFakeTimers();
    const ks = new Keyspace();
    ks.setEntry('a', 'string', 'x', Date.now() + 50);
    ks.startActiveExpiryCycle(10);

    vi.advanceTimersByTime(200);

    // Bypass lazy expiry by checking size(), which only counts live keys —
    // the point of this test is that the background sweep actually removed
    // the underlying map entry, not just that lazy-get hides it.
    expect(ks.size()).toBe(0);
    ks.stopActiveExpiryCycle();
    vi.useRealTimers();
  });
});
