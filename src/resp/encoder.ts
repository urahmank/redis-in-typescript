import type { RespValue } from './types.js';

const CRLF = '\r\n';

/**
 * Encodes a RespValue into RESP2 wire bytes.
 * https://redis.io/docs/latest/develop/reference/protocol-spec/
 */
export function encode(value: RespValue): Buffer {
  switch (value.type) {
    case 'simple':
      return Buffer.from(`+${value.value}${CRLF}`, 'utf8');

    case 'error':
      return Buffer.from(`-${value.value}${CRLF}`, 'utf8');

    case 'integer':
      return Buffer.from(`:${value.value}${CRLF}`, 'utf8');

    case 'null':
      return Buffer.from(`$-1${CRLF}`, 'utf8');

    case 'nullarray':
      return Buffer.from(`*-1${CRLF}`, 'utf8');

    case 'bulk': {
      const body = typeof value.value === 'string' ? Buffer.from(value.value, 'utf8') : value.value;
      return Buffer.concat([Buffer.from(`$${body.length}${CRLF}`, 'utf8'), body, Buffer.from(CRLF, 'utf8')]);
    }

    case 'array': {
      const header = Buffer.from(`*${value.value.length}${CRLF}`, 'utf8');
      const parts = value.value.map(encode);
      return Buffer.concat([header, ...parts]);
    }
  }
}

/** Convenience: encode a plain JS array of strings as a RESP array of bulk strings. */
export function encodeStringArray(items: string[]): Buffer {
  return encode({
    type: 'array',
    value: items.map((item) => ({ type: 'bulk', value: item })),
  });
}
