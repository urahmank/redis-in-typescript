import { array as arrayResp, bulk, integer, nullBulk } from '../resp/types.js';
import type { CommandSpec } from './types.js';
import { notInteger, parseIntStrict, wrongArgs } from './types.js';

export const hashCommands: CommandSpec[] = [
  {
    name: 'HSET',
    arity: -4,
    handler: (args, ctx) => {
      if ((args.length - 2) % 2 !== 0) return wrongArgs('HSET');
      const hash = ctx.keyspace.getOrCreate(args[1] as string, 'hash', () => new Map<string, string>());
      let added = 0;
      for (let i = 2; i < args.length; i += 2) {
        const field = args[i] as string;
        if (!hash.has(field)) added++;
        hash.set(field, args[i + 1] as string);
      }
      return integer(added);
    },
  },

  {
    name: 'HGET',
    arity: 3,
    handler: (args, ctx) => {
      const hash = ctx.keyspace.getTyped<Map<string, string>>(args[1] as string, 'hash');
      const value = hash?.get(args[2] as string);
      return value === undefined ? nullBulk() : bulk(value);
    },
  },

  {
    name: 'HDEL',
    arity: -3,
    handler: (args, ctx) => {
      const hash = ctx.keyspace.getTyped<Map<string, string>>(args[1] as string, 'hash');
      if (!hash) return integer(0);
      let removed = 0;
      for (const field of args.slice(2)) if (hash.delete(field)) removed++;
      return integer(removed);
    },
  },

  {
    name: 'HGETALL',
    arity: 2,
    handler: (args, ctx) => {
      const hash = ctx.keyspace.getTyped<Map<string, string>>(args[1] as string, 'hash');
      const out: string[] = [];
      if (hash) for (const [field, value] of hash) out.push(field, value);
      return arrayResp(out.map(bulk));
    },
  },

  {
    name: 'HEXISTS',
    arity: 3,
    handler: (args, ctx) => {
      const hash = ctx.keyspace.getTyped<Map<string, string>>(args[1] as string, 'hash');
      return integer(hash?.has(args[2] as string) ? 1 : 0);
    },
  },

  {
    name: 'HINCRBY',
    arity: 4,
    handler: (args, ctx) => {
      const delta = parseIntStrict(args[3] as string);
      if (delta === null) return notInteger();

      const hash = ctx.keyspace.getOrCreate(args[1] as string, 'hash', () => new Map<string, string>());
      const field = args[2] as string;
      const current = hash.get(field);
      let currentValue = 0;
      if (current !== undefined) {
        const parsed = parseIntStrict(current);
        if (parsed === null) return notInteger();
        currentValue = parsed;
      }

      const next = currentValue + delta;
      hash.set(field, String(next));
      return integer(next);
    },
  },

  {
    name: 'HKEYS',
    arity: 2,
    handler: (args, ctx) => {
      const hash = ctx.keyspace.getTyped<Map<string, string>>(args[1] as string, 'hash');
      return arrayResp([...(hash?.keys() ?? [])].map(bulk));
    },
  },

  {
    name: 'HVALS',
    arity: 2,
    handler: (args, ctx) => {
      const hash = ctx.keyspace.getTyped<Map<string, string>>(args[1] as string, 'hash');
      return arrayResp([...(hash?.values() ?? [])].map(bulk));
    },
  },

  {
    name: 'HLEN',
    arity: 2,
    handler: (args, ctx) => integer(ctx.keyspace.getTyped<Map<string, string>>(args[1] as string, 'hash')?.size ?? 0),
  },

  {
    name: 'HMGET',
    arity: -3,
    handler: (args, ctx) => {
      const hash = ctx.keyspace.getTyped<Map<string, string>>(args[1] as string, 'hash');
      return arrayResp(
        args.slice(2).map((field) => {
          const value = hash?.get(field);
          return value === undefined ? nullBulk() : bulk(value);
        }),
      );
    },
  },
];
