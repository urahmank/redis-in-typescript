/**
 * Incremental RESP2 command decoder.
 *
 * Real Redis connections are pipelined: a client can write several commands
 * back-to-back before reading any replies, and the OS is free to deliver
 * those bytes to us in arbitrarily-sized chunks — one command split across
 * two `data` events, or five commands arriving in a single event. This
 * parser is written as a small state machine over an internal buffer so it
 * copes with both: `push()` appends the new chunk, extracts every fully
 * formed command currently available, and leaves any trailing partial
 * command in the buffer for the next call.
 *
 * Two wire formats are supported, matching real Redis:
 *  - RESP multi-bulk arrays, e.g. `*2\r\n$3\r\nGET\r\n$3\r\nfoo\r\n` — what
 *    every real client library sends.
 *  - "Inline commands" — a bare line of space-separated words terminated by
 *    CRLF, e.g. `PING\r\n` — what you get typing directly into `nc`/`telnet`,
 *    and handy for manual testing.
 */

export class ProtocolError extends Error {}

interface ParseResult {
  command: string[];
  bytesConsumed: number;
}

export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);

  /** Feed newly received bytes in; get back zero or more fully parsed commands. */
  push(chunk: Buffer): string[][] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    const commands: string[][] = [];
    for (;;) {
      const result = this.tryParseOne();
      if (result === null) break;
      this.buffer = this.buffer.subarray(result.bytesConsumed);
      if (result.command.length > 0) commands.push(result.command);
    }
    return commands;
  }

  private tryParseOne(): ParseResult | null {
    if (this.buffer.length === 0) return null;
    return this.buffer[0] === ASTERISK ? this.tryParseMultiBulk() : this.tryParseInline();
  }

  private tryParseMultiBulk(): ParseResult | null {
    const buf = this.buffer;
    const headerEnd = indexOfCRLF(buf, 0);
    if (headerEnd === -1) return null;

    const count = parseInteger(buf, 1, headerEnd, '*');
    let pos = headerEnd + 2;

    if (count <= 0) return { command: [], bytesConsumed: pos };

    const args: string[] = [];
    for (let i = 0; i < count; i++) {
      if (pos >= buf.length) return null;
      if (buf[pos] !== DOLLAR) {
        throw new ProtocolError(`expected '$', got '${String.fromCharCode(buf[pos] as number)}'`);
      }

      const lenEnd = indexOfCRLF(buf, pos);
      if (lenEnd === -1) return null;

      const len = parseInteger(buf, pos + 1, lenEnd, '$');
      pos = lenEnd + 2;

      if (len < 0) {
        args.push('');
        continue;
      }

      if (pos + len + 2 > buf.length) return null; // need more data (payload + trailing CRLF)
      if (buf[pos + len] !== CR || buf[pos + len + 1] !== LF) {
        throw new ProtocolError('expected CRLF after bulk string payload');
      }

      args.push(buf.toString('utf8', pos, pos + len));
      pos += len + 2;
    }

    return { command: args, bytesConsumed: pos };
  }

  private tryParseInline(): ParseResult | null {
    const buf = this.buffer;
    if (buf.length > MAX_INLINE_LENGTH) {
      throw new ProtocolError('inline command too long');
    }

    const lineEnd = indexOfCRLF(buf, 0);
    if (lineEnd === -1) return null;

    const line = buf.toString('utf8', 0, lineEnd).trim();
    const bytesConsumed = lineEnd + 2;
    if (line.length === 0) return { command: [], bytesConsumed };

    return { command: line.split(/\s+/), bytesConsumed };
  }
}

const ASTERISK = '*'.charCodeAt(0);
const DOLLAR = '$'.charCodeAt(0);
const CR = '\r'.charCodeAt(0);
const LF = '\n'.charCodeAt(0);
const MAX_INLINE_LENGTH = 64 * 1024;

function indexOfCRLF(buf: Buffer, start: number): number {
  for (let i = start; i < buf.length - 1; i++) {
    if (buf[i] === CR && buf[i + 1] === LF) return i;
  }
  return -1;
}

function parseInteger(buf: Buffer, start: number, end: number, marker: string): number {
  const text = buf.toString('ascii', start, end);
  const value = Number.parseInt(text, 10);
  if (!Number.isFinite(value) || String(value) !== text.replace(/^\+/, '')) {
    throw new ProtocolError(`invalid ${marker === '*' ? 'multibulk length' : 'bulk length'}`);
  }
  return value;
}
