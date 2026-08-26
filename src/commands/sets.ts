import { array as arrayResp, bulk, integer, nullBulk } from '../resp/types.js';
import type { CommandSpec } from './types.js';

function getSets(ctx: Parameters<CommandSpec['handler']>[1], keys: string[]): Array<Set<string>> {
  return keys.map((key) => ctx.keyspace.getTyped<Set<string>>(key, 'set') ?? new Set<string>());
}

export const setCommands: CommandSpec[] = [
  {
    name: 'SADD',
    arity: -3,
    handler: (args, ctx) => {
      const set = ctx.keyspace.getOrCreate(args[1] as string, 'set', () => new Set<string>());
      let added = 0;
      for (const member of args.slice(2)) {
        if (!set.has(member)) {
          set.add(member);
          added++;
        }
      }
      return integer(added);
    },
  },

  {
    name: 'SREM',
    arity: -3,
    handler: (args, ctx) => {
      const set = ctx.keyspace.getTyped<Set<string>>(args[1] as string, 'set');
      if (!set) return integer(0);
      let removed = 0;
      for (const member of args.slice(2)) if (set.delete(member)) removed++;
      return integer(removed);
    },
  },

  {
    name: 'SMEMBERS',
    arity: 2,
    handler: (args, ctx) => arrayResp([...(ctx.keyspace.getTyped<Set<string>>(args[1] as string, 'set') ?? [])].map(bulk)),
  },

  {
    name: 'SISMEMBER',
    arity: 3,
    handler: (args, ctx) =>
      integer(ctx.keyspace.getTyped<Set<string>>(args[1] as string, 'set')?.has(args[2] as string) ? 1 : 0),
  },

  {
    name: 'SCARD',
    arity: 2,
    handler: (args, ctx) => integer(ctx.keyspace.getTyped<Set<string>>(args[1] as string, 'set')?.size ?? 0),
  },

  {
    name: 'SPOP',
    arity: 2,
    handler: (args, ctx) => {
      const set = ctx.keyspace.getTyped<Set<string>>(args[1] as string, 'set');
      if (!set || set.size === 0) return nullBulk();
      const member = set.values().next().value as string;
      set.delete(member);
      return bulk(member);
    },
  },

  {
    name: 'SINTER',
    arity: -2,
    handler: (args, ctx) => {
      const sets = getSets(ctx, args.slice(1));
      const [first, ...rest] = sets;
      const result = [...(first ?? [])].filter((member) => rest.every((s) => s.has(member)));
      return arrayResp(result.map(bulk));
    },
  },

  {
    name: 'SUNION',
    arity: -2,
    handler: (args, ctx) => {
      const result = new Set<string>();
      for (const set of getSets(ctx, args.slice(1))) for (const member of set) result.add(member);
      return arrayResp([...result].map(bulk));
    },
  },

  {
    name: 'SDIFF',
    arity: -2,
    handler: (args, ctx) => {
      const sets = getSets(ctx, args.slice(1));
      const [first, ...rest] = sets;
      const result = [...(first ?? [])].filter((member) => rest.every((s) => !s.has(member)));
      return arrayResp(result.map(bulk));
    },
  },
];
