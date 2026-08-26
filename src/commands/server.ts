import { array as arrayResp, bulk, integer, simple } from '../resp/types.js';
import { OK } from '../resp/types.js';
import { typeLabel } from '../store/entry.js';
import type { CommandSpec } from './types.js';
import { err } from './types.js';

export const serverCommands: CommandSpec[] = [
  {
    name: 'PING',
    arity: -1,
    handler: (args) => (args.length > 1 ? bulk(args[1] as string) : simple('PONG')),
  },

  {
    name: 'ECHO',
    arity: 2,
    handler: (args) => bulk(args[1] as string),
  },

  {
    name: 'DBSIZE',
    arity: 1,
    handler: (_args, ctx) => integer(ctx.keyspace.size()),
  },

  {
    name: 'FLUSHALL',
    arity: -1,
    handler: (_args, ctx) => {
      ctx.keyspace.flushAll();
      return OK;
    },
  },
  {
    name: 'FLUSHDB',
    arity: -1,
    handler: (_args, ctx) => {
      ctx.keyspace.flushAll();
      return OK;
    },
  },

  {
    name: 'TYPE',
    arity: 2,
    handler: (args, ctx) => {
      const type = ctx.keyspace.type(args[1] as string);
      return simple(type ? typeLabel(type) : 'none');
    },
  },

  {
    name: 'KEYS',
    arity: 2,
    handler: (args, ctx) => arrayResp(ctx.keyspace.keys(args[1] as string).map(bulk)),
  },

  {
    name: 'SELECT',
    arity: 2,
    handler: (args) => (args[1] === '0' ? OK : err('ERR DB index is out of range (only DB 0 is supported)')),
  },

  {
    // Minimal but structurally real INFO reply — enough for real client
    // libraries' readiness checks (e.g. ioredis parses `role:` / `loading:`
    // from this) and for `redis-cli -3`/plain `redis-cli` to render sensibly.
    name: 'INFO',
    arity: -1,
    handler: (_args, ctx) => {
      const lines = [
        '# Server',
        'redis_version:7.4.0-typescript-clone',
        'redis_mode:standalone',
        `os:${process.platform}`,
        `process_id:${process.pid}`,
        '',
        '# Clients',
        'connected_clients:1',
        '',
        '# Memory',
        `used_memory:${process.memoryUsage().heapUsed}`,
        '',
        '# Persistence',
        'loading:0',
        '',
        '# Replication',
        'role:master',
        'connected_slaves:0',
        '',
        '# Keyspace',
        `db0:keys=${ctx.keyspace.size()},expires=0,avg_ttl=0`,
      ];
      return bulk(`${lines.join('\r\n')}\r\n`);
    },
  },

  {
    // Stubbed: this server has no tunable configuration, but responding
    // sensibly (rather than "unknown command") keeps real clients that
    // probe CONFIG on connect from treating the server as broken.
    name: 'CONFIG',
    arity: -2,
    handler: (args) => {
      const sub = (args[1] ?? '').toUpperCase();
      if (sub === 'GET') return arrayResp([]);
      if (sub === 'SET') return OK;
      return err(`ERR Unknown CONFIG subcommand '${args[1] ?? ''}'`);
    },
  },

  {
    // Stubbed for the same reason as CONFIG: modern redis-cli sends
    // CLIENT SETINFO on connect to report its name/version, and various
    // clients probe CLIENT GETNAME/ID. Answering permissively keeps them
    // happy without actually tracking per-connection metadata.
    name: 'CLIENT',
    arity: -2,
    handler: (args, ctx) => {
      const sub = (args[1] ?? '').toUpperCase();
      switch (sub) {
        case 'ID':
          return integer(ctx.client.id);
        case 'GETNAME':
        case 'LIST':
          return bulk('');
        default:
          return OK;
      }
    },
  },

  {
    // Stubbed command introspection table — enough that clients calling
    // `COMMAND`, `COMMAND COUNT`, or `COMMAND DOCS` on connect get a
    // well-formed (if empty) reply instead of an error.
    name: 'COMMAND',
    arity: -1,
    handler: (args) => {
      const sub = (args[1] ?? '').toUpperCase();
      if (sub === 'COUNT') return integer(0);
      return arrayResp([]);
    },
  },
];
