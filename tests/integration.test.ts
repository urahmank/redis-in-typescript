import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import Redis from 'ioredis';
import { createServer } from '../src/server.js';

/**
 * Drives the real, running TCP server with `ioredis` — a real Redis client
 * library, not a hand-rolled test harness — over an actual socket on an
 * ephemeral local port. This is the test that proves the RESP protocol
 * implementation is genuinely wire-compatible, not just "passes its own
 * unit tests": if `ioredis`'s own command encoding/parsing round-trips
 * cleanly against this server, real Redis tooling will too.
 */
describe('integration: ioredis against the live server', () => {
  let close: () => void;
  let redis: Redis;

  beforeAll(async () => {
    const { server, keyspace } = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    redis = new Redis({ port, host: '127.0.0.1', lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();

    close = () => {
      keyspace.stopActiveExpiryCycle();
      redis.disconnect();
      server.close();
    };
  });

  afterAll(() => {
    close();
  });

  it('PING/ECHO', async () => {
    expect(await redis.ping()).toBe('PONG');
    expect(await redis.echo('hello')).toBe('hello');
  });

  it('strings: SET/GET/INCR/TTL', async () => {
    await redis.set('foo', 'bar');
    expect(await redis.get('foo')).toBe('bar');

    await redis.incr('counter');
    await redis.incrby('counter', 4);
    expect(await redis.get('counter')).toBe('5');

    await redis.set('withTtl', 'v', 'EX', 100);
    const ttl = await redis.ttl('withTtl');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(100);
  });

  it('lists: RPUSH/LRANGE/LPOP', async () => {
    await redis.rpush('mylist', 'a', 'b', 'c');
    expect(await redis.lrange('mylist', 0, -1)).toEqual(['a', 'b', 'c']);
    expect(await redis.lpop('mylist')).toBe('a');
  });

  it('hashes: HSET/HGETALL', async () => {
    await redis.hset('myhash', 'f1', 'v1', 'f2', 'v2');
    expect(await redis.hgetall('myhash')).toEqual({ f1: 'v1', f2: 'v2' });
  });

  it('sets: SADD/SMEMBERS', async () => {
    await redis.sadd('myset', 'a', 'b', 'a');
    const members = await redis.smembers('myset');
    expect(members.sort()).toEqual(['a', 'b']);
  });

  it('sorted sets: ZADD/ZRANGE WITHSCORES', async () => {
    await redis.zadd('myzset', 1, 'a', 2, 'b', 3, 'c');
    expect(await redis.zrange('myzset', 0, -1)).toEqual(['a', 'b', 'c']);
    expect(await redis.zrange('myzset', 0, -1, 'WITHSCORES')).toEqual(['a', '1', 'b', '2', 'c', '3']);
    expect(await redis.zscore('myzset', 'b')).toBe('2');
  });

  it('a wrong-type operation surfaces a real WRONGTYPE error to the client', async () => {
    await redis.set('astring', 'v');
    await expect(redis.lpush('astring', 'x')).rejects.toThrow(/WRONGTYPE/);
  });

  it('pub/sub: a second connection receives a published message', async () => {
    const port = (redis as unknown as { options: { port: number } }).options.port;
    const subscriber = new Redis({ port, host: '127.0.0.1', lazyConnect: true });
    await subscriber.connect();

    const received = new Promise<string>((resolve) => {
      subscriber.on('message', (_channel, message) => resolve(message));
    });
    await subscriber.subscribe('news');

    // Give the SUBSCRIBE a moment to land before publishing, same as any real client would.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await redis.publish('news', 'hello world');

    expect(await received).toBe('hello world');
    subscriber.disconnect();
  });

  it('DBSIZE and FLUSHALL', async () => {
    await redis.flushall();
    await redis.set('a', '1');
    await redis.set('b', '2');
    expect(await redis.dbsize()).toBe(2);
    await redis.flushall();
    expect(await redis.dbsize()).toBe(0);
  });
});
