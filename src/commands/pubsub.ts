import { array as arrayResp, bulk, integer, nullBulk } from '../resp/types.js';
import type { CommandSpec } from './types.js';

/**
 * Note on scope: real Redis restricts a connection in subscriber mode to
 * only (P)SUBSCRIBE / (P)UNSUBSCRIBE / PING / QUIT / RESET, rejecting any
 * other command with an error. This implementation tracks subscriber state
 * (`ClientContext.isSubscriber`) but doesn't enforce that restriction, to
 * keep the command dispatcher simple — a deliberate v1 simplification.
 */
export const pubsubCommands: CommandSpec[] = [
  {
    name: 'SUBSCRIBE',
    arity: -2,
    handler: (args, ctx) =>
      args.slice(1).map((channel) => {
        ctx.broker.subscribe(ctx.client, channel);
        return arrayResp([bulk('subscribe'), bulk(channel), integer(ctx.broker.subscriptionCount(ctx.client))]);
      }),
  },

  {
    name: 'UNSUBSCRIBE',
    arity: -1,
    handler: (args, ctx) => {
      const channels = args.length > 1 ? args.slice(1) : ctx.broker.channelsFor(ctx.client);
      if (channels.length === 0) {
        return arrayResp([bulk('unsubscribe'), nullBulk(), integer(ctx.broker.subscriptionCount(ctx.client))]);
      }
      return channels.map((channel) => {
        ctx.broker.unsubscribe(ctx.client, channel);
        return arrayResp([bulk('unsubscribe'), bulk(channel), integer(ctx.broker.subscriptionCount(ctx.client))]);
      });
    },
  },

  {
    name: 'PSUBSCRIBE',
    arity: -2,
    handler: (args, ctx) =>
      args.slice(1).map((pattern) => {
        ctx.broker.psubscribe(ctx.client, pattern);
        return arrayResp([bulk('psubscribe'), bulk(pattern), integer(ctx.broker.subscriptionCount(ctx.client))]);
      }),
  },

  {
    name: 'PUNSUBSCRIBE',
    arity: -1,
    handler: (args, ctx) => {
      const patterns = args.length > 1 ? args.slice(1) : ctx.broker.patternsFor(ctx.client);
      if (patterns.length === 0) {
        return arrayResp([bulk('punsubscribe'), nullBulk(), integer(ctx.broker.subscriptionCount(ctx.client))]);
      }
      return patterns.map((pattern) => {
        ctx.broker.punsubscribe(ctx.client, pattern);
        return arrayResp([bulk('punsubscribe'), bulk(pattern), integer(ctx.broker.subscriptionCount(ctx.client))]);
      });
    },
  },

  {
    name: 'PUBLISH',
    arity: 3,
    handler: (args, ctx) => integer(ctx.broker.publish(args[1] as string, args[2] as string)),
  },
];
