import { array as arrayResp, bulk, integer, nullBulk } from '../resp/types.js';
import { SortedSet } from '../store/skiplist.js';
import type { CommandSpec } from './types.js';
import { notFloat, notInteger, parseFloatStrict, parseIntStrict, wrongArgs } from './types.js';

function formatScore(score: number): string {
  if (score === Infinity) return 'inf';
  if (score === -Infinity) return '-inf';
  return String(score);
}

interface ScoreBound {
  value: number;
  exclusive: boolean;
}

function parseScoreBound(text: string): ScoreBound | null {
  const exclusive = text.startsWith('(');
  const value = parseFloatStrict(exclusive ? text.slice(1) : text);
  return value === null ? null : { value, exclusive };
}

function formatEntries(entries: Array<{ member: string; score: number }>, withScores: boolean) {
  const out: string[] = [];
  for (const entry of entries) {
    out.push(entry.member);
    if (withScores) out.push(formatScore(entry.score));
  }
  return arrayResp(out.map(bulk));
}

export const zsetCommands: CommandSpec[] = [
  {
    name: 'ZADD',
    arity: -4,
    handler: (args, ctx) => {
      if ((args.length - 2) % 2 !== 0) return wrongArgs('ZADD');
      const zset = ctx.keyspace.getOrCreate(args[1] as string, 'zset', () => new SortedSet());

      let added = 0;
      for (let i = 2; i < args.length; i += 2) {
        const score = parseFloatStrict(args[i] as string);
        if (score === null) return notFloat();
        if (zset.add(args[i + 1] as string, score)) added++;
      }
      return integer(added);
    },
  },

  {
    name: 'ZSCORE',
    arity: 3,
    handler: (args, ctx) => {
      const zset = ctx.keyspace.getTyped<SortedSet>(args[1] as string, 'zset');
      const score = zset?.score(args[2] as string);
      return score === undefined ? nullBulk() : bulk(formatScore(score));
    },
  },

  {
    name: 'ZRANK',
    arity: 3,
    handler: (args, ctx) => {
      const zset = ctx.keyspace.getTyped<SortedSet>(args[1] as string, 'zset');
      const rank = zset?.rank(args[2] as string);
      return rank === undefined || rank === null ? nullBulk() : integer(rank);
    },
  },

  {
    name: 'ZINCRBY',
    arity: 4,
    handler: (args, ctx) => {
      const delta = parseFloatStrict(args[2] as string);
      if (delta === null) return notFloat();
      const zset = ctx.keyspace.getOrCreate(args[1] as string, 'zset', () => new SortedSet());
      return bulk(formatScore(zset.incrBy(args[3] as string, delta)));
    },
  },

  {
    name: 'ZREM',
    arity: -3,
    handler: (args, ctx) => {
      const zset = ctx.keyspace.getTyped<SortedSet>(args[1] as string, 'zset');
      if (!zset) return integer(0);
      let removed = 0;
      for (const member of args.slice(2)) if (zset.remove(member)) removed++;
      return integer(removed);
    },
  },

  {
    name: 'ZCARD',
    arity: 2,
    handler: (args, ctx) => integer(ctx.keyspace.getTyped<SortedSet>(args[1] as string, 'zset')?.size ?? 0),
  },

  {
    name: 'ZRANGE',
    arity: -4,
    handler: (args, ctx) => {
      const start = parseIntStrict(args[2] as string);
      const stop = parseIntStrict(args[3] as string);
      if (start === null || stop === null) return notInteger();

      const withScores = (args[4] ?? '').toUpperCase() === 'WITHSCORES';
      const zset = ctx.keyspace.getTyped<SortedSet>(args[1] as string, 'zset');
      return formatEntries(zset?.rangeByRank(start, stop) ?? [], withScores);
    },
  },

  {
    name: 'ZRANGEBYSCORE',
    arity: -4,
    handler: (args, ctx) => {
      const min = parseScoreBound(args[2] as string);
      const max = parseScoreBound(args[3] as string);
      if (!min || !max) return notFloat();

      const withScores = (args[4] ?? '').toUpperCase() === 'WITHSCORES';
      const zset = ctx.keyspace.getTyped<SortedSet>(args[1] as string, 'zset');
      const entries =
        zset?.rangeByScore(min.value, max.value, { minExclusive: min.exclusive, maxExclusive: max.exclusive }) ?? [];
      return formatEntries(entries, withScores);
    },
  },
];
