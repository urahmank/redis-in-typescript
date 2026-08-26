import type { RespValue } from '../resp/types.js';

/** Per-connection state a command handler might need beyond the shared keyspace. */
export interface ClientContext {
  id: number;
  /** True once the connection has issued SUBSCRIBE/PSUBSCRIBE and entered subscriber mode. */
  isSubscriber: boolean;
  send: (value: RespValue) => void;
}

/**
 * Pub/Sub fan-out. A subscribed connection isn't doing normal
 * request/response anymore — `PUBLISH` on one connection pushes a message
 * asynchronously to every other connection subscribed to that channel (or
 * to a matching pattern), independent of whatever command cycle those
 * connections are otherwise in.
 */
export class Broker {
  private channels = new Map<string, Set<ClientContext>>();
  private patterns = new Map<string, Set<ClientContext>>();

  subscribe(client: ClientContext, channel: string): void {
    client.isSubscriber = true;
    let subs = this.channels.get(channel);
    if (!subs) {
      subs = new Set();
      this.channels.set(channel, subs);
    }
    subs.add(client);
  }

  unsubscribe(client: ClientContext, channel: string): void {
    this.channels.get(channel)?.delete(client);
    client.isSubscriber = this.subscriptionCount(client) > 0;
  }

  psubscribe(client: ClientContext, pattern: string): void {
    client.isSubscriber = true;
    let subs = this.patterns.get(pattern);
    if (!subs) {
      subs = new Set();
      this.patterns.set(pattern, subs);
    }
    subs.add(client);
  }

  punsubscribe(client: ClientContext, pattern: string): void {
    this.patterns.get(pattern)?.delete(client);
    client.isSubscriber = this.subscriptionCount(client) > 0;
  }

  /** All channels a client is currently subscribed to (exact match only). */
  channelsFor(client: ClientContext): string[] {
    const out: string[] = [];
    for (const [channel, subs] of this.channels) if (subs.has(client)) out.push(channel);
    return out;
  }

  patternsFor(client: ClientContext): string[] {
    const out: string[] = [];
    for (const [pattern, subs] of this.patterns) if (subs.has(client)) out.push(pattern);
    return out;
  }

  subscriptionCount(client: ClientContext): number {
    return this.channelsFor(client).length + this.patternsFor(client).length;
  }

  /** Removes a disconnecting client from every channel and pattern it was subscribed to. */
  dropClient(client: ClientContext): void {
    for (const subs of this.channels.values()) subs.delete(client);
    for (const subs of this.patterns.values()) subs.delete(client);
  }

  publish(channel: string, message: string): number {
    let receivers = 0;

    const direct = this.channels.get(channel);
    if (direct) {
      for (const client of direct) {
        client.send({
          type: 'array',
          value: [
            { type: 'bulk', value: 'message' },
            { type: 'bulk', value: channel },
            { type: 'bulk', value: message },
          ],
        });
        receivers++;
      }
    }

    for (const [pattern, subs] of this.patterns) {
      if (!matchGlob(pattern, channel)) continue;
      for (const client of subs) {
        client.send({
          type: 'array',
          value: [
            { type: 'bulk', value: 'pmessage' },
            { type: 'bulk', value: pattern },
            { type: 'bulk', value: channel },
            { type: 'bulk', value: message },
          ],
        });
        receivers++;
      }
    }

    return receivers;
  }
}

function matchGlob(pattern: string, text: string): boolean {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`).test(text);
}
