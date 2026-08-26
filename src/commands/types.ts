import type { Keyspace } from '../store/keyspace.js';
import type { RespValue } from '../resp/types.js';
import type { Broker, ClientContext } from '../pubsub/broker.js';

export type { ClientContext } from '../pubsub/broker.js';

export interface CommandContext {
  keyspace: Keyspace;
  broker: Broker;
  client: ClientContext;
}

/**
 * A handler normally returns one RespValue, sent as the command's single
 * reply. SUBSCRIBE/UNSUBSCRIBE/PSUBSCRIBE/PUNSUBSCRIBE are the one place in
 * RESP2 where a single command legitimately produces several independent
 * top-level replies (one confirmation per channel) rather than one array —
 * a handler signals that by returning a plain JS array of RespValues.
 */
export type CommandHandler = (args: string[], ctx: CommandContext) => RespValue | RespValue[];

export interface CommandSpec {
  name: string;
  handler: CommandHandler;
  /** Minimum number of arguments *including* the command name itself, matching Redis's own arity convention. */
  arity: number;
}

export function err(message: string): RespValue {
  return { type: 'error', value: message };
}

export function wrongArgs(command: string): RespValue {
  return err(`ERR wrong number of arguments for '${command.toLowerCase()}' command`);
}

export function notInteger(): RespValue {
  return err('ERR value is not an integer or out of range');
}

export function notFloat(): RespValue {
  return err('ERR value is not a valid float');
}

/** Strict integer parsing matching Redis: "10" is fine, "10.0" and "abc" are not. */
export function parseIntStrict(text: string): number | null {
  if (!/^[-+]?\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

/** Strict float parsing matching Redis: rejects non-numeric garbage, accepts inf/-inf. */
export function parseFloatStrict(text: string): number | null {
  if (/^[-+]?inf(inity)?$/i.test(text)) return text.startsWith('-') ? -Infinity : Infinity;
  if (text.trim() === '' || Number.isNaN(Number(text))) return null;
  return Number(text);
}
