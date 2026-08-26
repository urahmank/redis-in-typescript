/**
 * RESP2 reply value model used internally by command handlers.
 * Handlers return one of these and the encoder turns it into wire bytes.
 */
export type RespValue =
  | RespSimpleString
  | RespError
  | RespInteger
  | RespBulkString
  | RespNullBulkString
  | RespArray
  | RespNullArray;

export interface RespSimpleString {
  type: 'simple';
  value: string;
}

export interface RespError {
  type: 'error';
  value: string;
}

export interface RespInteger {
  type: 'integer';
  value: number;
}

export interface RespBulkString {
  type: 'bulk';
  value: string | Buffer;
}

export interface RespNullBulkString {
  type: 'null';
}

export interface RespArray {
  type: 'array';
  value: RespValue[];
}

export interface RespNullArray {
  type: 'nullarray';
}

// Convenience constructors -------------------------------------------------

export const simple = (value: string): RespSimpleString => ({ type: 'simple', value });
export const error = (value: string): RespError => ({ type: 'error', value });
export const integer = (value: number): RespInteger => ({ type: 'integer', value });
export const bulk = (value: string | Buffer): RespBulkString => ({ type: 'bulk', value });
export const nullBulk = (): RespNullBulkString => ({ type: 'null' });
export const array = (value: RespValue[]): RespArray => ({ type: 'array', value });
export const nullArray = (): RespNullArray => ({ type: 'nullarray' });

export const OK = simple('OK');
