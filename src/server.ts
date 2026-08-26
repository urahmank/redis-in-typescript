import net from 'node:net';
import { dispatch } from './commands/index.js';
import { encode } from './resp/encoder.js';
import type { RespValue } from './resp/types.js';
import { ProtocolError, RespParser } from './resp/parser.js';
import { Broker, type ClientContext } from './pubsub/broker.js';
import { Keyspace } from './store/keyspace.js';

const DEFAULT_PORT = 6380;
const DEFAULT_HOST = '127.0.0.1';

/**
 * Builds a ready-to-listen server plus the shared state (keyspace, pub/sub
 * broker) backing it. Split out from `main()` so tests can spin up a real
 * server on an ephemeral port and drive it with a real client, rather than
 * only unit-testing individual pieces in isolation.
 */
export function createServer() {
  const keyspace = new Keyspace();
  keyspace.startActiveExpiryCycle();

  const broker = new Broker();
  let nextClientId = 1;

  const server = net.createServer((socket) => {
    socket.setNoDelay(true);

    const parser = new RespParser();
    const client: ClientContext = {
      id: nextClientId++,
      isSubscriber: false,
      send: (value: RespValue) => {
        if (!socket.destroyed) socket.write(encode(value));
      },
    };

    socket.on('data', (chunk: Buffer) => {
      let commands: string[][];
      try {
        commands = parser.push(chunk);
      } catch (error) {
        const message = error instanceof ProtocolError ? error.message : 'invalid request';
        socket.write(encode({ type: 'error', value: `ERR Protocol error: ${message}` }));
        socket.destroy();
        return;
      }

      for (const command of commands) {
        if (command.length === 0) continue;
        const result = dispatch(command, { keyspace, broker, client });
        if (Array.isArray(result)) {
          for (const reply of result) client.send(reply);
        } else {
          client.send(result);
        }
      }
    });

    socket.on('close', () => {
      broker.dropClient(client);
    });

    // A destroyed/reset socket still fires 'close' afterwards, so it's safe
    // to just swallow the error here rather than handle cleanup twice.
    socket.on('error', () => {});
  });

  return { server, keyspace, broker };
}

function main(): void {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const host = process.env.HOST ?? DEFAULT_HOST;

  const { server } = createServer();
  server.listen(port, host, () => {
    console.log(`redis-in-typescript listening on ${host}:${port}`);
  });
}

// Only auto-start when this file is run directly (`node dist/server.js`),
// not when `createServer` is imported elsewhere — most importantly, by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
