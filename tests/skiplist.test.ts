import { describe, expect, it } from 'vitest';
import { SortedSet } from '../src/store/skiplist.js';

describe('SortedSet', () => {
  it('keeps members ordered by score, then lexicographically for ties', () => {
    const zset = new SortedSet();
    zset.add('b', 1);
    zset.add('a', 1);
    zset.add('c', 2);
    zset.add('z', 0);

    expect(zset.toArray()).toEqual([
      { member: 'z', score: 0 },
      { member: 'a', score: 1 },
      { member: 'b', score: 1 },
      { member: 'c', score: 2 },
    ]);
  });

  it('reports added vs repositioned on ZADD', () => {
    const zset = new SortedSet();
    expect(zset.add('a', 1)).toBe(true);
    expect(zset.add('a', 5)).toBe(false);
    expect(zset.score('a')).toBe(5);
    expect(zset.size).toBe(1);
  });

  it('computes rank (0-based, ascending by score)', () => {
    const zset = new SortedSet();
    ['a', 'b', 'c', 'd', 'e'].forEach((m, i) => zset.add(m, i * 10));

    expect(zset.rank('a')).toBe(0);
    expect(zset.rank('e')).toBe(4);
    expect(zset.rank('missing')).toBeNull();
  });

  it('supports incrBy, creating the member if absent', () => {
    const zset = new SortedSet();
    expect(zset.incrBy('a', 5)).toBe(5);
    expect(zset.incrBy('a', 2.5)).toBe(7.5);
  });

  it('removes members and keeps the rest ordered', () => {
    const zset = new SortedSet();
    ['a', 'b', 'c'].forEach((m, i) => zset.add(m, i));
    expect(zset.remove('b')).toBe(true);
    expect(zset.remove('missing')).toBe(false);
    expect(zset.toArray().map((e) => e.member)).toEqual(['a', 'c']);
  });

  it('supports rangeByRank with negative indices like LRANGE', () => {
    const zset = new SortedSet();
    ['a', 'b', 'c', 'd', 'e'].forEach((m, i) => zset.add(m, i));

    expect(zset.rangeByRank(0, -1).map((e) => e.member)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(zset.rangeByRank(1, 2).map((e) => e.member)).toEqual(['b', 'c']);
    expect(zset.rangeByRank(-2, -1).map((e) => e.member)).toEqual(['d', 'e']);
  });

  it('supports rangeByScore with inclusive and exclusive bounds', () => {
    const zset = new SortedSet();
    zset.add('a', 1);
    zset.add('b', 2);
    zset.add('c', 3);

    expect(zset.rangeByScore(1, 2).map((e) => e.member)).toEqual(['a', 'b']);
    expect(zset.rangeByScore(1, 2, { minExclusive: true }).map((e) => e.member)).toEqual(['b']);
    expect(zset.rangeByScore(1, 3, { maxExclusive: true }).map((e) => e.member)).toEqual(['a', 'b']);
  });

  it('holds up under a larger randomized workload (stress-tests skip list levels)', () => {
    const zset = new SortedSet();
    const reference = new Map<string, number>();

    for (let i = 0; i < 2000; i++) {
      const member = `m${Math.floor(Math.random() * 500)}`;
      const score = Math.floor(Math.random() * 1000);
      zset.add(member, score);
      reference.set(member, score);
    }

    const expected = [...reference.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));

    expect(zset.toArray()).toEqual(expected);
    expect(zset.size).toBe(reference.size);

    for (const [member] of reference) {
      const expectedRank = expected.findIndex((e) => e.member === member);
      expect(zset.rank(member)).toBe(expectedRank);
    }
  });
});
