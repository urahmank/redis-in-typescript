import { array as arrayResp, bulk, integer, nullBulk } from '../resp/types.js';
import { RedisList } from '../store/list.js';
import type { CommandSpec } from './types.js';
import { notInteger, parseIntStrict } from './types.js';

export const listCommands: CommandSpec[] = [
  {
    name: 'LPUSH',
    arity: -3,
    handler: (args, ctx) => {
      const list = ctx.keyspace.getOrCreate(args[1] as string, 'list', () => new RedisList());
      return integer(list.pushLeft(...args.slice(2)));
    },
  },

  {
    name: 'RPUSH',
    arity: -3,
    handler: (args, ctx) => {
      const list = ctx.keyspace.getOrCreate(args[1] as string, 'list', () => new RedisList());
      return integer(list.pushRight(...args.slice(2)));
    },
  },

  {
    name: 'LPOP',
    arity: 2,
    handler: (args, ctx) => {
      const list = ctx.keyspace.getTyped<RedisList>(args[1] as string, 'list');
      if (!list) return nullBulk();
      const value = list.popLeft();
      return value === undefined ? nullBulk() : bulk(value);
    },
  },

  {
    name: 'RPOP',
    arity: 2,
    handler: (args, ctx) => {
      const list = ctx.keyspace.getTyped<RedisList>(args[1] as string, 'list');
      if (!list) return nullBulk();
      const value = list.popRight();
      return value === undefined ? nullBulk() : bulk(value);
    },
  },

  {
    name: 'LLEN',
    arity: 2,
    handler: (args, ctx) => integer(ctx.keyspace.getTyped<RedisList>(args[1] as string, 'list')?.size ?? 0),
  },

  {
    name: 'LRANGE',
    arity: 4,
    handler: (args, ctx) => {
      const start = parseIntStrict(args[2] as string);
      const stop = parseIntStrict(args[3] as string);
      if (start === null || stop === null) return notInteger();
      const list = ctx.keyspace.getTyped<RedisList>(args[1] as string, 'list');
      return arrayResp((list?.range(start, stop) ?? []).map(bulk));
    },
  },

  {
    name: 'LINDEX',
    arity: 3,
    handler: (args, ctx) => {
      const index = parseIntStrict(args[2] as string);
      if (index === null) return notInteger();
      const list = ctx.keyspace.getTyped<RedisList>(args[1] as string, 'list');
      const value = list?.at(index);
      return value === undefined ? nullBulk() : bulk(value);
    },
  },

  {
    name: 'LSET',
    arity: 4,
    handler: (args, ctx) => {
      const index = parseIntStrict(args[2] as string);
      if (index === null) return notInteger();
      const list = ctx.keyspace.getTyped<RedisList>(args[1] as string, 'list');
      if (!list || !list.set(index, args[3] as string)) {
        return { type: 'error', value: 'ERR no such key' };
      }
      return { type: 'simple', value: 'OK' };
    },
  },

  {
    name: 'LREM',
    arity: 4,
    handler: (args, ctx) => {
      const count = parseIntStrict(args[2] as string);
      if (count === null) return notInteger();
      const list = ctx.keyspace.getTyped<RedisList>(args[1] as string, 'list');
      return integer(list?.remove(count, args[3] as string) ?? 0);
    },
  },

  {
    name: 'LTRIM',
    arity: 4,
    handler: (args, ctx) => {
      const start = parseIntStrict(args[2] as string);
      const stop = parseIntStrict(args[3] as string);
      if (start === null || stop === null) return notInteger();
      const list = ctx.keyspace.getTyped<RedisList>(args[1] as string, 'list');
      list?.trim(start, stop);
      return { type: 'simple', value: 'OK' };
    },
  },
];
