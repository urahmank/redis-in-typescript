import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/commands/index.js';
import { makeContext } from './testUtil.js';

function run(ctx: ReturnType<typeof makeContext>, ...args: string[]) {
  return dispatch(args, ctx);
}

describe('dispatch: unknown command / arity', () => {
  it('returns an error for an unknown command', () => {
    const ctx = makeContext();
    expect(run(ctx, 'NOPE')).toEqual({ type: 'error', value: expect.stringContaining('unknown command') });
  });

  it('returns a wrong-number-of-arguments error', () => {
    const ctx = makeContext();
    expect(run(ctx, 'GET')).toEqual({
      type: 'error',
      value: "ERR wrong number of arguments for 'get' command",
    });
  });

  it('is case-insensitive on command names', () => {
    const ctx = makeContext();
    expect(run(ctx, 'ping')).toEqual({ type: 'simple', value: 'PONG' });
    expect(run(ctx, 'PiNg')).toEqual({ type: 'simple', value: 'PONG' });
  });
});

describe('strings', () => {
  it('SET/GET round-trip and DEL', () => {
    const ctx = makeContext();
    expect(run(ctx, 'SET', 'foo', 'bar')).toEqual({ type: 'simple', value: 'OK' });
    expect(run(ctx, 'GET', 'foo')).toEqual({ type: 'bulk', value: 'bar' });
    expect(run(ctx, 'DEL', 'foo')).toEqual({ type: 'integer', value: 1 });
    expect(run(ctx, 'GET', 'foo')).toEqual({ type: 'null' });
  });

  it('SET NX/XX semantics', () => {
    const ctx = makeContext();
    expect(run(ctx, 'SET', 'k', 'v1', 'NX')).toEqual({ type: 'simple', value: 'OK' });
    expect(run(ctx, 'SET', 'k', 'v2', 'NX')).toEqual({ type: 'null' });
    expect(run(ctx, 'GET', 'k')).toEqual({ type: 'bulk', value: 'v1' });

    expect(run(ctx, 'SET', 'missing', 'v', 'XX')).toEqual({ type: 'null' });
    expect(run(ctx, 'SET', 'k', 'v3', 'XX')).toEqual({ type: 'simple', value: 'OK' });
  });

  it('SET EX applies a TTL', () => {
    const ctx = makeContext();
    run(ctx, 'SET', 'k', 'v', 'EX', '100');
    expect(ctx.keyspace.ttlMs('k')).toBeGreaterThan(0);
    expect(ctx.keyspace.ttlMs('k')).toBeLessThanOrEqual(100_000);
  });

  it('INCR/DECR/INCRBY/APPEND/STRLEN', () => {
    const ctx = makeContext();
    expect(run(ctx, 'INCR', 'counter')).toEqual({ type: 'integer', value: 1 });
    expect(run(ctx, 'INCRBY', 'counter', '10')).toEqual({ type: 'integer', value: 11 });
    expect(run(ctx, 'DECR', 'counter')).toEqual({ type: 'integer', value: 10 });
    expect(run(ctx, 'APPEND', 'greeting', 'hello')).toEqual({ type: 'integer', value: 5 });
    expect(run(ctx, 'APPEND', 'greeting', ' world')).toEqual({ type: 'integer', value: 11 });
    expect(run(ctx, 'STRLEN', 'greeting')).toEqual({ type: 'integer', value: 11 });
  });

  it('INCR on a non-numeric string is an error', () => {
    const ctx = makeContext();
    run(ctx, 'SET', 'k', 'notanumber');
    expect(run(ctx, 'INCR', 'k')).toEqual({ type: 'error', value: expect.stringContaining('not an integer') });
  });

  it('WRONGTYPE when a list command targets a string key', () => {
    const ctx = makeContext();
    run(ctx, 'SET', 'k', 'v');
    expect(run(ctx, 'LPUSH', 'k', 'x')).toEqual({ type: 'error', value: expect.stringContaining('WRONGTYPE') });
  });

  it('MSET/MGET', () => {
    const ctx = makeContext();
    run(ctx, 'MSET', 'a', '1', 'b', '2');
    expect(run(ctx, 'MGET', 'a', 'b', 'missing')).toEqual({
      type: 'array',
      value: [
        { type: 'bulk', value: '1' },
        { type: 'bulk', value: '2' },
        { type: 'null' },
      ],
    });
  });

  it('EXPIRE/TTL/PERSIST', () => {
    const ctx = makeContext();
    run(ctx, 'SET', 'k', 'v');
    expect(run(ctx, 'TTL', 'k')).toEqual({ type: 'integer', value: -1 });
    run(ctx, 'EXPIRE', 'k', '100');
    const ttl = run(ctx, 'TTL', 'k');
    expect(ttl).toMatchObject({ type: 'integer' });
    expect((ttl as { value: number }).value).toBeGreaterThan(0);
    expect(run(ctx, 'PERSIST', 'k')).toEqual({ type: 'integer', value: 1 });
    expect(run(ctx, 'TTL', 'k')).toEqual({ type: 'integer', value: -1 });
    expect(run(ctx, 'TTL', 'missing')).toEqual({ type: 'integer', value: -2 });
  });
});

describe('lists', () => {
  it('LPUSH/RPUSH/LRANGE/LLEN', () => {
    const ctx = makeContext();
    run(ctx, 'RPUSH', 'l', 'a', 'b', 'c');
    run(ctx, 'LPUSH', 'l', 'z');
    expect(run(ctx, 'LLEN', 'l')).toEqual({ type: 'integer', value: 4 });
    expect(run(ctx, 'LRANGE', 'l', '0', '-1')).toEqual({
      type: 'array',
      value: ['z', 'a', 'b', 'c'].map((v) => ({ type: 'bulk', value: v })),
    });
  });

  it('LPOP/RPOP on an empty or missing list return nil', () => {
    const ctx = makeContext();
    expect(run(ctx, 'LPOP', 'missing')).toEqual({ type: 'null' });
  });

  it('LSET and LINDEX', () => {
    const ctx = makeContext();
    run(ctx, 'RPUSH', 'l', 'a', 'b', 'c');
    run(ctx, 'LSET', 'l', '1', 'B');
    expect(run(ctx, 'LINDEX', 'l', '1')).toEqual({ type: 'bulk', value: 'B' });
  });

  it('LREM removes matches', () => {
    const ctx = makeContext();
    run(ctx, 'RPUSH', 'l', 'x', 'a', 'x', 'b', 'x');
    expect(run(ctx, 'LREM', 'l', '0', 'x')).toEqual({ type: 'integer', value: 3 });
  });
});

describe('hashes', () => {
  it('HSET/HGET/HGETALL/HDEL', () => {
    const ctx = makeContext();
    expect(run(ctx, 'HSET', 'h', 'f1', 'v1', 'f2', 'v2')).toEqual({ type: 'integer', value: 2 });
    expect(run(ctx, 'HGET', 'h', 'f1')).toEqual({ type: 'bulk', value: 'v1' });
    expect(run(ctx, 'HDEL', 'h', 'f1')).toEqual({ type: 'integer', value: 1 });
    expect(run(ctx, 'HEXISTS', 'h', 'f1')).toEqual({ type: 'integer', value: 0 });
  });

  it('HINCRBY', () => {
    const ctx = makeContext();
    expect(run(ctx, 'HINCRBY', 'h', 'count', '5')).toEqual({ type: 'integer', value: 5 });
    expect(run(ctx, 'HINCRBY', 'h', 'count', '-2')).toEqual({ type: 'integer', value: 3 });
  });
});

describe('sets', () => {
  it('SADD/SMEMBERS/SISMEMBER/SREM/SCARD', () => {
    const ctx = makeContext();
    expect(run(ctx, 'SADD', 's', 'a', 'b', 'a')).toEqual({ type: 'integer', value: 2 });
    expect(run(ctx, 'SCARD', 's')).toEqual({ type: 'integer', value: 2 });
    expect(run(ctx, 'SISMEMBER', 's', 'a')).toEqual({ type: 'integer', value: 1 });
    expect(run(ctx, 'SREM', 's', 'a')).toEqual({ type: 'integer', value: 1 });
  });

  it('SINTER/SUNION/SDIFF', () => {
    const ctx = makeContext();
    run(ctx, 'SADD', 'a', '1', '2', '3');
    run(ctx, 'SADD', 'b', '2', '3', '4');

    const inter = run(ctx, 'SINTER', 'a', 'b') as { value: Array<{ value: string }> };
    expect(inter.value.map((v) => v.value).sort()).toEqual(['2', '3']);

    const union = run(ctx, 'SUNION', 'a', 'b') as { value: Array<{ value: string }> };
    expect(union.value.map((v) => v.value).sort()).toEqual(['1', '2', '3', '4']);

    const diff = run(ctx, 'SDIFF', 'a', 'b') as { value: Array<{ value: string }> };
    expect(diff.value.map((v) => v.value)).toEqual(['1']);
  });
});

describe('sorted sets', () => {
  it('ZADD/ZSCORE/ZRANK/ZRANGE', () => {
    const ctx = makeContext();
    run(ctx, 'ZADD', 'z', '1', 'a', '2', 'b', '3', 'c');
    expect(run(ctx, 'ZSCORE', 'z', 'b')).toEqual({ type: 'bulk', value: '2' });
    expect(run(ctx, 'ZRANK', 'z', 'c')).toEqual({ type: 'integer', value: 2 });

    const range = run(ctx, 'ZRANGE', 'z', '0', '-1') as { value: Array<{ value: string }> };
    expect(range.value.map((v) => v.value)).toEqual(['a', 'b', 'c']);

    const withScores = run(ctx, 'ZRANGE', 'z', '0', '-1', 'WITHSCORES') as { value: Array<{ value: string }> };
    expect(withScores.value.map((v) => v.value)).toEqual(['a', '1', 'b', '2', 'c', '3']);
  });

  it('ZRANGEBYSCORE with exclusive bounds', () => {
    const ctx = makeContext();
    run(ctx, 'ZADD', 'z', '1', 'a', '2', 'b', '3', 'c');
    const result = run(ctx, 'ZRANGEBYSCORE', 'z', '(1', '3') as { value: Array<{ value: string }> };
    expect(result.value.map((v) => v.value)).toEqual(['b', 'c']);
  });

  it('ZINCRBY creates the member if absent', () => {
    const ctx = makeContext();
    expect(run(ctx, 'ZINCRBY', 'z', '5', 'a')).toEqual({ type: 'bulk', value: '5' });
    expect(run(ctx, 'ZINCRBY', 'z', '2.5', 'a')).toEqual({ type: 'bulk', value: '7.5' });
  });
});

describe('server commands', () => {
  it('TYPE reports the right label, or "none"', () => {
    const ctx = makeContext();
    run(ctx, 'SET', 'k', 'v');
    expect(run(ctx, 'TYPE', 'k')).toEqual({ type: 'simple', value: 'string' });
    expect(run(ctx, 'TYPE', 'missing')).toEqual({ type: 'simple', value: 'none' });
  });

  it('DBSIZE and FLUSHALL', () => {
    const ctx = makeContext();
    run(ctx, 'SET', 'a', '1');
    run(ctx, 'SET', 'b', '2');
    expect(run(ctx, 'DBSIZE')).toEqual({ type: 'integer', value: 2 });
    run(ctx, 'FLUSHALL');
    expect(run(ctx, 'DBSIZE')).toEqual({ type: 'integer', value: 0 });
  });

  it('KEYS supports glob patterns', () => {
    const ctx = makeContext();
    run(ctx, 'SET', 'foo1', 'x');
    run(ctx, 'SET', 'foo2', 'x');
    run(ctx, 'SET', 'bar', 'x');
    const keys = run(ctx, 'KEYS', 'foo*') as { value: Array<{ value: string }> };
    expect(keys.value.map((v) => v.value).sort()).toEqual(['foo1', 'foo2']);
  });
});

describe('pub/sub', () => {
  it('SUBSCRIBE replies once per channel and PUBLISH reaches subscribers', () => {
    const publisher = makeContext();
    const subscriber = makeContext();
    // Share the same broker so the publisher's PUBLISH reaches the subscriber.
    publisher.broker = subscriber.broker;

    const subscribeReply = run(subscriber, 'SUBSCRIBE', 'news', 'sports');
    expect(subscribeReply).toEqual([
      { type: 'array', value: [{ type: 'bulk', value: 'subscribe' }, { type: 'bulk', value: 'news' }, { type: 'integer', value: 1 }] },
      { type: 'array', value: [{ type: 'bulk', value: 'subscribe' }, { type: 'bulk', value: 'sports' }, { type: 'integer', value: 2 }] },
    ]);

    const publishReply = run(publisher, 'PUBLISH', 'news', 'hello');
    expect(publishReply).toEqual({ type: 'integer', value: 1 });
    expect(subscriber.sent).toEqual([
      {
        type: 'array',
        value: [
          { type: 'bulk', value: 'message' },
          { type: 'bulk', value: 'news' },
          { type: 'bulk', value: 'hello' },
        ],
      },
    ]);
  });

  it('UNSUBSCRIBE with no arguments unsubscribes from everything', () => {
    const ctx = makeContext();
    run(ctx, 'SUBSCRIBE', 'a', 'b');
    const reply = run(ctx, 'UNSUBSCRIBE') as Array<{ value: unknown }>;
    expect(reply).toHaveLength(2);
    expect(ctx.client.isSubscriber).toBe(false);
  });
});
