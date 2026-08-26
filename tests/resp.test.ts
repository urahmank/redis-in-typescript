import { describe, expect, it } from 'vitest';
import { RespParser, ProtocolError } from '../src/resp/parser.js';
import { encode } from '../src/resp/encoder.js';
import { array, bulk, error, integer, nullArray, nullBulk, simple } from '../src/resp/types.js';

describe('RespParser', () => {
  it('parses a single multi-bulk command', () => {
    const parser = new RespParser();
    const commands = parser.push(Buffer.from('*2\r\n$3\r\nGET\r\n$3\r\nfoo\r\n'));
    expect(commands).toEqual([['GET', 'foo']]);
  });

  it('parses a command split across multiple chunks', () => {
    const parser = new RespParser();
    expect(parser.push(Buffer.from('*2\r\n$3\r\nGE'))).toEqual([]);
    expect(parser.push(Buffer.from('T\r\n$3\r\nfoo\r\n'))).toEqual([['GET', 'foo']]);
  });

  it('parses multiple pipelined commands arriving in one chunk', () => {
    const parser = new RespParser();
    const commands = parser.push(
      Buffer.from('*1\r\n$4\r\nPING\r\n*2\r\n$3\r\nGET\r\n$1\r\na\r\n'),
    );
    expect(commands).toEqual([['PING'], ['GET', 'a']]);
  });

  it('parses inline commands', () => {
    const parser = new RespParser();
    expect(parser.push(Buffer.from('PING\r\n'))).toEqual([['PING']]);
    expect(parser.push(Buffer.from('SET foo bar\r\n'))).toEqual([['SET', 'foo', 'bar']]);
  });

  it('ignores empty inline lines', () => {
    const parser = new RespParser();
    expect(parser.push(Buffer.from('\r\nPING\r\n'))).toEqual([['PING']]);
  });

  it('handles binary-safe bulk strings containing embedded CRLF bytes', () => {
    const parser = new RespParser();
    // Second bulk string declares length 5 and its payload is "a\r\nb\r" — an
    // embedded CRLF that a naive line-based parser would mistake for the
    // terminator. Because we read exactly `len` bytes rather than scanning
    // for CRLF, this must come through intact.
    const commands = parser.push(Buffer.from('*2\r\n$3\r\nfoo\r\n$5\r\na\r\nb\r\r\n'));
    expect(commands).toEqual([['foo', 'a\r\nb\r']]);
  });

  it('throws a ProtocolError on a malformed multibulk length', () => {
    const parser = new RespParser();
    expect(() => parser.push(Buffer.from('*abc\r\n'))).toThrow(ProtocolError);
  });

  it('throws a ProtocolError when a bulk string is not prefixed with $', () => {
    const parser = new RespParser();
    expect(() => parser.push(Buffer.from('*1\r\n:5\r\n'))).toThrow(ProtocolError);
  });
});

describe('encode', () => {
  it('encodes simple strings', () => {
    expect(encode(simple('OK'))).toEqual(Buffer.from('+OK\r\n'));
  });

  it('encodes errors', () => {
    expect(encode(error('ERR bad'))).toEqual(Buffer.from('-ERR bad\r\n'));
  });

  it('encodes integers', () => {
    expect(encode(integer(42))).toEqual(Buffer.from(':42\r\n'));
  });

  it('encodes bulk strings', () => {
    expect(encode(bulk('foo'))).toEqual(Buffer.from('$3\r\nfoo\r\n'));
  });

  it('encodes null bulk strings', () => {
    expect(encode(nullBulk())).toEqual(Buffer.from('$-1\r\n'));
  });

  it('encodes null arrays', () => {
    expect(encode(nullArray())).toEqual(Buffer.from('*-1\r\n'));
  });

  it('encodes arrays of mixed types', () => {
    expect(encode(array([bulk('a'), integer(1), simple('OK')]))).toEqual(
      Buffer.from('*3\r\n$1\r\na\r\n:1\r\n+OK\r\n'),
    );
  });

  it('encodes nested arrays', () => {
    expect(encode(array([array([bulk('a'), bulk('b')])]))).toEqual(
      Buffer.from('*1\r\n*2\r\n$1\r\na\r\n$1\r\nb\r\n'),
    );
  });
});
