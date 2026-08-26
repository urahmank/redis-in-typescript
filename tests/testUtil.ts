import { Broker, type ClientContext } from '../src/pubsub/broker.js';
import { Keyspace } from '../src/store/keyspace.js';
import type { CommandContext } from '../src/commands/types.js';
import type { RespValue } from '../src/resp/types.js';

/** Builds a fresh CommandContext for dispatch()-level tests, with a `sent` log for pub/sub assertions. */
export function makeContext(): CommandContext & { sent: RespValue[] } {
  const sent: RespValue[] = [];
  const client: ClientContext = {
    id: 1,
    isSubscriber: false,
    send: (value) => sent.push(value),
  };
  const ctx = { keyspace: new Keyspace(), broker: new Broker(), client } as CommandContext & { sent: RespValue[] };
  ctx.sent = sent;
  return ctx;
}
