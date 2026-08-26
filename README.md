<div align="center">
  <div>
    <img src="https://img.shields.io/badge/-TypeScript-black?style=for-the-badge&logoColor=white&logo=typescript&color=3178C6" alt="typescript" />
    <img src="https://img.shields.io/badge/-Node.js-black?style=for-the-badge&logoColor=white&logo=nodedotjs&color=339933" alt="node.js" />
    <img src="https://img.shields.io/badge/-Redis-black?style=for-the-badge&logoColor=white&logo=redis&color=DC382D" alt="redis" />
  </div>

  <h3 align="center">A Redis server, built from scratch in TypeScript</h3>
</div>

This is a from-scratch reimplementation of a Redis server: the RESP wire protocol, the core data types, and the networking layer, written in TypeScript on top of nothing but Node's built-in `net` module — no framework, no `redis`/`ioredis` dependency in the server itself. The payoff of implementing the protocol faithfully is that real Redis tooling works against it unmodified: `redis-cli` connects and behaves exactly as it would against real Redis, and the test suite drives the server with `ioredis` — a genuine client library, not a hand-rolled stub — to prove real wire compatibility rather than just internal self-consistency.

## Why

Most portfolio projects are CRUD apps with a database behind them. This one is deliberately not that: it's an exercise in binary protocol design, TCP networking without a framework, and implementing the actual data structures (a doubly linked list for Lists, a skip list for Sorted Sets) that make Redis fast, rather than reaching for a JS array and calling it done.

## Quick start

```bash
npm install
npm run dev        # starts the server on 127.0.0.1:6380 with hot reload
```

In another terminal, point the real Redis CLI at it:

```bash
redis-cli -p 6380 set foo bar
redis-cli -p 6380 get foo
redis-cli -p 6380 rpush mylist a b c
redis-cli -p 6380 lrange mylist 0 -1
```

Or build and run the compiled output:

```bash
npm run build
npm start
```

Set `PORT` / `HOST` env vars to change the listen address (defaults to `127.0.0.1:6380`).

## Supported commands

**Strings** — `SET` (with `EX`/`PX`/`NX`/`XX`), `GET`, `DEL`, `EXISTS`, `EXPIRE`, `PEXPIRE`, `TTL`, `PTTL`, `PERSIST`, `INCR`, `DECR`, `INCRBY`, `DECRBY`, `APPEND`, `STRLEN`, `GETSET`, `SETNX`, `MSET`, `MGET`

**Lists** — `LPUSH`, `RPUSH`, `LPOP`, `RPOP`, `LLEN`, `LRANGE`, `LINDEX`, `LSET`, `LREM`, `LTRIM`

**Hashes** — `HSET`, `HGET`, `HDEL`, `HGETALL`, `HEXISTS`, `HINCRBY`, `HKEYS`, `HVALS`, `HLEN`, `HMGET`

**Sets** — `SADD`, `SREM`, `SMEMBERS`, `SISMEMBER`, `SCARD`, `SPOP`, `SINTER`, `SUNION`, `SDIFF`

**Sorted sets** — `ZADD`, `ZSCORE`, `ZRANK`, `ZINCRBY`, `ZREM`, `ZCARD`, `ZRANGE` (with `WITHSCORES`), `ZRANGEBYSCORE` (inclusive and exclusive bounds, `-inf`/`+inf`)

**Pub/Sub** — `SUBSCRIBE`, `UNSUBSCRIBE`, `PSUBSCRIBE`, `PUNSUBSCRIBE`, `PUBLISH`

**Server / introspection** — `PING`, `ECHO`, `DBSIZE`, `FLUSHALL`, `FLUSHDB`, `TYPE`, `KEYS` (glob patterns), `SELECT` (DB 0 only), `INFO`, `CONFIG GET`/`SET` (stubbed), `CLIENT` (stubbed), `COMMAND` (stubbed) — the last few exist so real client libraries and `redis-cli` that probe these on connect get a well-formed reply instead of an error, without this project taking on full configuration/introspection support.

Real Redis behavior this project deliberately reproduces: `WRONGTYPE` errors when a command targets a key holding a different type, TTLs surviving `INCR`/`APPEND` but not `SET`/`GETSET`, `EXISTS`/`DEL` counting duplicate keys correctly, and glob-pattern matching for `KEYS`.

## Architecture

```
src/
  server.ts            TCP entrypoint: wires the parser + dispatcher + pub/sub broker to each connection
  resp/
    parser.ts           incremental RESP2 decoder — handles pipelined and chunk-split commands
    encoder.ts           RESP2 encoder
    types.ts              RESP reply value model used internally
  store/
    keyspace.ts          the keyspace: typed entries, lazy + active expiry, WRONGTYPE enforcement
    entry.ts               entry/type model
    list.ts                 doubly linked list backing Lists (O(1) push/pop at both ends)
    skiplist.ts            skip list backing Sorted Sets (O(log n) insert/rank/range)
    rangeUtil.ts           shared Redis-style index normalization (negative indices, clamping)
  commands/
    strings.ts, lists.ts, hashes.ts, sets.ts, zsets.ts, pubsub.ts, server.ts
    index.ts                command table + dispatcher
    types.ts                 shared command types/helpers
  pubsub/
    broker.ts             channel/pattern subscriber bookkeeping and fan-out
tests/
  resp.test.ts, list.test.ts, skiplist.test.ts, keyspace.test.ts, commands.test.ts
  integration.test.ts    drives the live server with a real ioredis client
```

A TCP connection's incoming bytes go through an incremental RESP parser (built to handle Redis's actual wire behavior: a command split across multiple TCP reads, or several pipelined commands arriving in one read) into a command dispatcher, which validates arity, looks up a handler, and runs it against a shared in-memory keyspace. Every stored value is tagged with its Redis type so operating on a key with the wrong command (e.g. `LPUSH` on a key holding a string) raises a real `WRONGTYPE` error instead of silently doing the wrong thing. Sorted sets are backed by a skip list with span-tracked forward pointers — the same conceptual structure real Redis uses — specifically so `ZRANK` and ranged reads are O(log n) instead of requiring a full re-sort.

## Testing

```bash
npm test
```

75 tests across six files: unit tests for the RESP parser/encoder (including chunked and pipelined input, and binary-safe bulk strings with embedded CRLF), the doubly linked list, the skip list (including a 2,000-operation randomized stress test checked against a reference implementation), the keyspace/expiry model, every command group via direct dispatch, and an integration suite that starts the real server on an ephemeral port and drives it with `ioredis` — covering strings, lists, hashes, sets, sorted sets, `WRONGTYPE` errors, and a real pub/sub round-trip between two connections.

Also verified manually against the real `redis-cli` and `redis-benchmark` (see below) as a compatibility check beyond the automated suite.

### Benchmark

Single instance, single-threaded, on modest hardware, via `redis-benchmark -n 20000`:

| Command | Requests/sec |
| --- | --- |
| SET | ~30,000 |
| GET | ~35,500 |
| INCR | ~37,400 |
| LPUSH | ~45,800 |
| SADD | ~39,800 |
| ZADD | ~36,700 |

Not real-Redis speed (nothing beats a single-threaded C event loop with decades of tuning), but a solid number for a first-pass TypeScript implementation, and a useful baseline to improve on.

## Scope — what's here, and what's intentionally not

This is v1: the core protocol plus the common data types (strings, lists, hashes, sets, sorted sets) and pub/sub. Deliberately out of scope for now, to keep v1 shippable rather than open-ended:

- **Persistence** (RDB snapshotting / append-only file) — the dataset is in-memory only and does not survive a restart.
- **Replication** and **cluster-mode sharding**.
- **Transactions** (`MULTI`/`EXEC`/`WATCH`) and **Lua scripting** (`EVAL`).
- **`AUTH`/ACLs** — there's no authentication.
- Strict enforcement of subscriber-mode command restrictions (real Redis limits a subscribed connection to `(P)SUBSCRIBE`/`(P)UNSUBSCRIBE`/`PING`/`QUIT`; this server tracks subscriber state but doesn't enforce the restriction).
- The active expiry sweep is a plain periodic full scan rather than Redis's probabilistic sampling algorithm — a simplification that's more than adequate at this scale.

These are natural v2 candidates, listed here deliberately so the current scope reads as a decision rather than an unfinished project.

## License

MIT
