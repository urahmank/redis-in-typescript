import type { RespValue } from '../resp/types.js';
import { WrongTypeError } from '../store/entry.js';
import { hashCommands } from './hashes.js';
import { listCommands } from './lists.js';
import { pubsubCommands } from './pubsub.js';
import { serverCommands } from './server.js';
import { setCommands } from './sets.js';
import { stringCommands } from './strings.js';
import type { CommandContext, CommandSpec } from './types.js';
import { err, wrongArgs } from './types.js';
import { zsetCommands } from './zsets.js';

const allCommands: CommandSpec[] = [
  ...stringCommands,
  ...listCommands,
  ...hashCommands,
  ...setCommands,
  ...zsetCommands,
  ...pubsubCommands,
  ...serverCommands,
];

const table = new Map<string, CommandSpec>();
for (const spec of allCommands) table.set(spec.name, spec);

export function listCommandNames(): string[] {
  return [...table.keys()];
}

/**
 * Dispatches one already-parsed command (`args[0]` is the command name,
 * matching however the client cased it) and returns whatever should be
 * sent back — a single reply for almost every command, or an array of
 * replies for the handful of pub/sub commands that produce more than one.
 */
export function dispatch(args: string[], ctx: CommandContext): RespValue | RespValue[] {
  const name = (args[0] ?? '').toUpperCase();
  const spec = table.get(name);

  if (!spec) {
    const preview = args
      .slice(1, 3)
      .map((a) => `'${a}'`)
      .join(', ');
    return err(`ERR unknown command '${args[0] ?? ''}'${preview ? `, with args beginning with: ${preview}` : ''}`);
  }

  const argsOk = spec.arity >= 0 ? args.length === spec.arity : args.length >= -spec.arity;
  if (!argsOk) return wrongArgs(name);

  try {
    return spec.handler(args, ctx);
  } catch (error) {
    if (error instanceof WrongTypeError) return err(error.message);
    return err(`ERR ${error instanceof Error ? error.message : 'internal error'}`);
  }
}
