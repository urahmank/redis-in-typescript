import { describe, expect, it } from 'vitest';
import { RedisList } from '../src/store/list.js';

describe('RedisList', () => {
  it('pushes and pops from both ends', () => {
    const list = new RedisList();
    list.pushRight('a', 'b', 'c');
    list.pushLeft('z');
    expect(list.toArray()).toEqual(['z', 'a', 'b', 'c']);
    expect(list.popLeft()).toBe('z');
    expect(list.popRight()).toBe('c');
    expect(list.toArray()).toEqual(['a', 'b']);
  });

  it('supports indexed access with negative indices', () => {
    const list = new RedisList();
    list.pushRight('a', 'b', 'c');
    expect(list.at(0)).toBe('a');
    expect(list.at(-1)).toBe('c');
    expect(list.at(99)).toBeUndefined();
  });

  it('sets a value by index', () => {
    const list = new RedisList();
    list.pushRight('a', 'b', 'c');
    expect(list.set(1, 'B')).toBe(true);
    expect(list.toArray()).toEqual(['a', 'B', 'c']);
    expect(list.set(99, 'x')).toBe(false);
  });

  it('returns ranges with Redis clamping semantics', () => {
    const list = new RedisList();
    list.pushRight('a', 'b', 'c', 'd', 'e');
    expect(list.range(0, -1)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(list.range(1, 2)).toEqual(['b', 'c']);
    expect(list.range(-2, -1)).toEqual(['d', 'e']);
    expect(list.range(10, 20)).toEqual([]);
  });

  it('trims to a range in place', () => {
    const list = new RedisList();
    list.pushRight('a', 'b', 'c', 'd', 'e');
    list.trim(1, -2);
    expect(list.toArray()).toEqual(['b', 'c', 'd']);
  });

  it('removes matching elements with LREM semantics', () => {
    const list = new RedisList();
    list.pushRight('a', 'x', 'b', 'x', 'c', 'x');

    const removedFromHead = list.remove(2, 'x');
    expect(removedFromHead).toBe(2);
    expect(list.toArray()).toEqual(['a', 'b', 'c', 'x']);

    const removedFromTail = list.remove(-1, 'x');
    expect(removedFromTail).toBe(1);
    expect(list.toArray()).toEqual(['a', 'b', 'c']);
  });

  it('removes all matches when count is 0', () => {
    const list = new RedisList();
    list.pushRight('x', 'a', 'x', 'b', 'x');
    expect(list.remove(0, 'x')).toBe(3);
    expect(list.toArray()).toEqual(['a', 'b']);
  });
});
