import { array as arrayResp, bulk, integer, nullBulk } from '../resp/types.js';
import { OK } from '../resp/types.js';
import type { CommandSpec } from './types.js';
import { err, notInteger, parseIntStrict, wrongArgs } from './types.js';

function currentExpireAt(ctx: Parameters<CommandSpec['handler']>[1], key: string): number | null {
  return ctx.keyspace.get(key)?.expireAt ?? null;
}

function incrByHelper(ctx: Parameters<CommandSpec['handler']>[1], key: string, delta: number) {
  const current = ctx.keyspace.getTyped<string>(key, 'string');
  let currentValue = 0;
  if (current !== undefined) {
    const parsed = parseIntStrict(current);
    if (parsed === null) return notInteger();
    currentValue = parsed;
  }

  const next = currentValue + delta;
  if (!Number.isSafeInteger(next)) return err('ERR increment or decrement would overflow');

  ctx.keyspace.setEntry(key, 'string', String(next), currentExpireAt(ctx, key));
  return integer(next);
}

export const stringCommands: CommandSpec[] = [
  {
    name: 'SET',
    arity: -3,
    handler: (args, ctx) => {
      const [key, value] = [args[1] as string, args[2] as string];
      let ttlMs: number | null = null;
      let nx = false;
      let xx = false;

      for (let i = 3; i < args.length; i++) {
        const opt = (args[i] as string).toUpperCase();
        if (opt === 'EX' || opt === 'PX') {
          const raw = args[++i];
          const n = raw === undefined ? null : parseIntStrict(raw);
          if (n === null || n <= 0) return err("ERR invalid expire time in 'set' command");
          ttlMs = opt === 'EX' ? n * 1000 : n;
        } else if (opt === 'NX') {
          nx = true;
        } else if (opt === 'XX') {
          xx = true;
        } else {
          return err('ERR syntax error');
        }
      }
      if (nx && xx) return err('ERR syntax error');

      const exists = ctx.keyspace.has(key);
      if (nx && exists) return nullBulk();
      if (xx && !exists) return nullBulk();

      ctx.keyspace.setEntry(key, 'string', value, ttlMs !== null ? Date.now() + ttlMs : null);
      return OK;
    },
  },

  {
    name: 'GET',
    arity: 2,
    handler: (args, ctx) => {
      const value = ctx.keyspace.getTyped<string>(args[1] as string, 'string');
      return value === undefined ? nullBulk() : bulk(value);
    },
  },

  {
    name: 'DEL',
    arity: -2,
    handler: (args, ctx) => integer(ctx.keyspace.delete(...args.slice(1))),
  },

  {
    name: 'EXISTS',
    arity: -2,
    handler: (args, ctx) => integer(args.slice(1).filter((k) => ctx.keyspace.has(k)).length),
  },

  {
    name: 'EXPIRE',
    arity: 3,
    handler: (args, ctx) => {
      const seconds = parseIntStrict(args[2] as string);
      if (seconds === null) return notInteger();
      return integer(ctx.keyspace.expireAt(args[1] as string, Date.now() + seconds * 1000) ? 1 : 0);
    },
  },

  {
    name: 'PEXPIRE',
    arity: 3,
    handler: (args, ctx) => {
      const ms = parseIntStrict(args[2] as string);
      if (ms === null) return notInteger();
      return integer(ctx.keyspace.expireAt(args[1] as string, Date.now() + ms) ? 1 : 0);
    },
  },

  {
    name: 'TTL',
    arity: 2,
    handler: (args, ctx) => {
      const ms = ctx.keyspace.ttlMs(args[1] as string);
      return integer(ms < 0 ? ms : Math.ceil(ms / 1000));
    },
  },

  {
    name: 'PTTL',
    arity: 2,
    handler: (args, ctx) => integer(ctx.keyspace.ttlMs(args[1] as string)),
  },

  {
    name: 'PERSIST',
    arity: 2,
    handler: (args, ctx) => integer(ctx.keyspace.persist(args[1] as string) ? 1 : 0),
  },

  { name: 'INCR', arity: 2, handler: (args, ctx) => incrByHelper(ctx, args[1] as string, 1) },
  { name: 'DECR', arity: 2, handler: (args, ctx) => incrByHelper(ctx, args[1] as string, -1) },

  {
    name: 'INCRBY',
    arity: 3,
    handler: (args, ctx) => {
      const delta = parseIntStrict(args[2] as string);
      return delta === null ? notInteger() : incrByHelper(ctx, args[1] as string, delta);
    },
  },

  {
    name: 'DECRBY',
    arity: 3,
    handler: (args, ctx) => {
      const delta = parseIntStrict(args[2] as string);
      return delta === null ? notInteger() : incrByHelper(ctx, args[1] as string, -delta);
    },
  },

  {
    name: 'APPEND',
    arity: 3,
    handler: (args, ctx) => {
      const key = args[1] as string;
      const current = ctx.keyspace.getTyped<string>(key, 'string') ?? '';
      const next = current + (args[2] as string);
      ctx.keyspace.setEntry(key, 'string', next, currentExpireAt(ctx, key));
      return integer(next.length);
    },
  },

  {
    name: 'STRLEN',
    arity: 2,
    handler: (args, ctx) => integer((ctx.keyspace.getTyped<string>(args[1] as string, 'string') ?? '').length),
  },

  {
    name: 'GETSET',
    arity: 3,
    handler: (args, ctx) => {
      const key = args[1] as string;
      const old = ctx.keyspace.getTyped<string>(key, 'string');
      ctx.keyspace.setEntry(key, 'string', args[2] as string, null);
      return old === undefined ? nullBulk() : bulk(old);
    },
  },

  {
    name: 'SETNX',
    arity: 3,
    handler: (args, ctx) => {
      const key = args[1] as string;
      if (ctx.keyspace.has(key)) return integer(0);
      ctx.keyspace.setEntry(key, 'string', args[2] as string, null);
      return integer(1);
    },
  },

  {
    name: 'MSET',
    arity: -3,
    handler: (args, ctx) => {
      if ((args.length - 1) % 2 !== 0) return wrongArgs('MSET');
      for (let i = 1; i < args.length; i += 2) {
        ctx.keyspace.setEntry(args[i] as string, 'string', args[i + 1] as string, null);
      }
      return OK;
    },
  },

  {
    name: 'MGET',
    arity: -2,
    handler: (args, ctx) =>
      arrayResp(
        args.slice(1).map((key) => {
          try {
            const value = ctx.keyspace.getTyped<string>(key, 'string');
            return value === undefined ? nullBulk() : bulk(value);
          } catch {
            // Real Redis returns nil for a wrong-type key in MGET rather than failing the whole command.
            return nullBulk();
          }
        }),
      ),
  },
];
