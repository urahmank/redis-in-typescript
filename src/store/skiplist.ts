/**
 * Skip list keyed by (score, member), ordered first by score then
 * lexicographically by member to break ties — exactly the ordering Redis
 * sorted sets guarantee. This is the data structure that makes ZADD /
 * ZRANGE / ZRANK / ZRANGEBYSCORE all O(log n) instead of the O(n log n)
 * you'd get by re-sorting an array on every write, which is the whole
 * reason real Redis backs ZSETs with a skip list rather than something
 * simpler.
 *
 * Each forward pointer also carries a "span" — how many nodes it skips
 * over — which is what lets `rank(member)` and `nodeAtRank(rank)` run in
 * O(log n) instead of walking the bottom level one node at a time.
 */

const MAX_LEVEL = 32;
const P = 0.25; // probability a node is promoted to the next level up

interface Level {
  forward: SkiplistNode | null;
  span: number;
}

class SkiplistNode {
  member: string;
  score: number;
  backward: SkiplistNode | null = null;
  levels: Level[];

  constructor(level: number, score: number, member: string) {
    this.score = score;
    this.member = member;
    this.levels = Array.from({ length: level }, () => ({ forward: null, span: 0 }));
  }
}

function before(aScore: number, aMember: string, bScore: number, bMember: string): boolean {
  return aScore < bScore || (aScore === bScore && aMember < bMember);
}

function beforeOrEqual(aScore: number, aMember: string, bScore: number, bMember: string): boolean {
  return aScore < bScore || (aScore === bScore && aMember <= bMember);
}

export class Skiplist {
  private header = new SkiplistNode(MAX_LEVEL, 0, '');
  private tail: SkiplistNode | null = null;
  private level = 1;
  private length = 0;

  get size(): number {
    return this.length;
  }

  private randomLevel(): number {
    let level = 1;
    while (Math.random() < P && level < MAX_LEVEL) level++;
    return level;
  }

  insert(score: number, member: string): void {
    const update: SkiplistNode[] = new Array(MAX_LEVEL).fill(this.header);
    const rankAtLevel: number[] = new Array(MAX_LEVEL).fill(0);

    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      rankAtLevel[i] = i === this.level - 1 ? 0 : (rankAtLevel[i + 1] as number);
      let forward = x.levels[i] as Level;
      while (forward.forward && before(forward.forward.score, forward.forward.member, score, member)) {
        rankAtLevel[i] = (rankAtLevel[i] as number) + forward.span;
        x = forward.forward;
        forward = x.levels[i] as Level;
      }
      update[i] = x;
    }

    const level = this.randomLevel();
    if (level > this.level) {
      for (let i = this.level; i < level; i++) {
        rankAtLevel[i] = 0;
        update[i] = this.header;
      }
      this.level = level;
    }

    const node = new SkiplistNode(level, score, member);
    for (let i = 0; i < level; i++) {
      const updLevel = (update[i] as SkiplistNode).levels[i] as Level;
      node.levels[i] = { forward: updLevel.forward, span: updLevel.span - ((rankAtLevel[0] as number) - (rankAtLevel[i] as number)) };
      updLevel.forward = node;
      updLevel.span = (rankAtLevel[0] as number) - (rankAtLevel[i] as number) + 1;
    }
    for (let i = level; i < this.level; i++) {
      const updLevel = (update[i] as SkiplistNode).levels[i] as Level;
      updLevel.span++;
    }

    node.backward = update[0] === this.header ? null : (update[0] as SkiplistNode);
    if (node.levels[0]?.forward) (node.levels[0].forward as SkiplistNode).backward = node;
    else this.tail = node;

    this.length++;
  }

  delete(score: number, member: string): boolean {
    const update: SkiplistNode[] = new Array(MAX_LEVEL).fill(this.header);

    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      let forward = x.levels[i] as Level;
      while (forward.forward && before(forward.forward.score, forward.forward.member, score, member)) {
        x = forward.forward;
        forward = x.levels[i] as Level;
      }
      update[i] = x;
    }

    const candidate = (x.levels[0] as Level).forward;
    if (!candidate || candidate.score !== score || candidate.member !== member) return false;

    for (let i = 0; i < this.level; i++) {
      const updLevel = (update[i] as SkiplistNode).levels[i] as Level;
      if (updLevel.forward === candidate) {
        updLevel.span += candidate.levels[i]!.span - 1;
        updLevel.forward = candidate.levels[i]!.forward;
      } else {
        updLevel.span -= 1;
      }
    }

    if (candidate.levels[0]?.forward) (candidate.levels[0].forward as SkiplistNode).backward = candidate.backward;
    else this.tail = candidate.backward;

    while (this.level > 1 && !this.header.levels[this.level - 1]?.forward) this.level--;
    this.length--;
    return true;
  }

  /** 0-based rank of (score, member) in ascending order, or null if not present. */
  rank(score: number, member: string): number | null {
    let x: SkiplistNode = this.header;
    let rank = 0;

    for (let i = this.level - 1; i >= 0; i--) {
      let forward = x.levels[i] as Level;
      while (forward.forward && beforeOrEqual(forward.forward.score, forward.forward.member, score, member)) {
        rank += forward.span;
        x = forward.forward;
        forward = x.levels[i] as Level;
      }
    }

    return x !== this.header && x.member === member ? rank - 1 : null;
  }

  /** 0-based rank lookup by position, e.g. for ZRANGE by rank. */
  nodeAtRank(rank: number): { member: string; score: number } | null {
    let x: SkiplistNode = this.header;
    let traversed = 0;
    const target = rank + 1;

    for (let i = this.level - 1; i >= 0; i--) {
      let forward = x.levels[i] as Level;
      while (forward.forward && traversed + forward.span <= target) {
        traversed += forward.span;
        x = forward.forward;
        forward = x.levels[i] as Level;
      }
      if (traversed === target) return x === this.header ? null : { member: x.member, score: x.score };
    }
    return null;
  }

  /** All nodes with score in [min, max] (or exclusive at either end), in ascending order. */
  rangeByScore(
    min: number,
    max: number,
    opts: { minExclusive?: boolean; maxExclusive?: boolean } = {},
  ): Array<{ member: string; score: number }> {
    let x: SkiplistNode = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      let forward = x.levels[i] as Level;
      while (
        forward.forward &&
        (opts.minExclusive ? forward.forward.score <= min : forward.forward.score < min)
      ) {
        x = forward.forward;
        forward = x.levels[i] as Level;
      }
    }

    let node = (x.levels[0] as Level).forward;
    const out: Array<{ member: string; score: number }> = [];
    while (node) {
      if (opts.maxExclusive ? node.score >= max : node.score > max) break;
      out.push({ member: node.member, score: node.score });
      node = (node.levels[0] as Level).forward;
    }
    return out;
  }

  toArray(): Array<{ member: string; score: number }> {
    const out: Array<{ member: string; score: number }> = [];
    for (let node = (this.header.levels[0] as Level).forward; node; node = (node.levels[0] as Level).forward) {
      out.push({ member: node.member, score: node.score });
    }
    return out;
  }
}

/**
 * Redis Sorted Set: the skip list above gives ordered/ranked access, paired
 * with a plain member -> score map for O(1) ZSCORE lookups and to detect
 * "this member already exists, reposition it" on ZADD — mirroring how real
 * Redis backs a ZSET with both a skiplist and a dict.
 */
export class SortedSet {
  private skiplist = new Skiplist();
  private scores = new Map<string, number>();

  get size(): number {
    return this.scores.size;
  }

  /** Returns true if the member was newly added (false if it already existed and was repositioned). */
  add(member: string, score: number): boolean {
    const existing = this.scores.get(member);
    if (existing !== undefined) {
      if (existing !== score) {
        this.skiplist.delete(existing, member);
        this.skiplist.insert(score, member);
        this.scores.set(member, score);
      }
      return false;
    }
    this.skiplist.insert(score, member);
    this.scores.set(member, score);
    return true;
  }

  incrBy(member: string, delta: number): number {
    const next = (this.scores.get(member) ?? 0) + delta;
    this.add(member, next);
    return next;
  }

  score(member: string): number | undefined {
    return this.scores.get(member);
  }

  has(member: string): boolean {
    return this.scores.has(member);
  }

  remove(member: string): boolean {
    const existing = this.scores.get(member);
    if (existing === undefined) return false;
    this.skiplist.delete(existing, member);
    this.scores.delete(member);
    return true;
  }

  rank(member: string): number | null {
    const existing = this.scores.get(member);
    return existing === undefined ? null : this.skiplist.rank(existing, member);
  }

  rangeByRank(start: number, end: number): Array<{ member: string; score: number }> {
    const length = this.size;
    if (length === 0) return [];

    let s = start < 0 ? Math.max(length + start, 0) : start;
    let e = end < 0 ? length + end : end;
    if (e >= length) e = length - 1;
    if (s > e || s >= length || e < 0) return [];

    const out: Array<{ member: string; score: number }> = [];
    for (let rank = s; rank <= e; rank++) {
      const node = this.skiplist.nodeAtRank(rank);
      if (node) out.push(node);
    }
    return out;
  }

  rangeByScore(min: number, max: number, opts?: { minExclusive?: boolean; maxExclusive?: boolean }): Array<{ member: string; score: number }> {
    return this.skiplist.rangeByScore(min, max, opts);
  }

  toArray(): Array<{ member: string; score: number }> {
    return this.skiplist.toArray();
  }
}
