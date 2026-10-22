import { describe, expect, it } from 'vitest';
import {
  FrameDecoder,
  ProtoError,
  ProtoWriter,
  decodeMessage,
  frame,
  getBytes,
  getString,
  getUint,
  hasField,
} from '../electron/core/remote/atv/protobuf';

function varint(value: number): Buffer {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Buffer.from(out);
}

describe('protobuf varint framing', () => {
  it('prefixes the payload with a varint length', () => {
    expect([...frame(Buffer.from([0xaa]))]).toEqual([1, 0xaa]);
    const big = Buffer.alloc(300, 0x11);
    const framed = frame(big);
    expect([...framed.subarray(0, 2)]).toEqual([0xac, 0x02]);
    expect(framed.subarray(2)).toEqual(big);
  });

  it('uses a multi-byte length for payloads over 127 bytes', () => {
    expect([...frame(Buffer.alloc(127))].slice(0, 1)).toEqual([127]);
    expect([...frame(Buffer.alloc(128))].slice(0, 2)).toEqual([0x80, 0x01]);
    expect([...frame(Buffer.alloc(16383))].slice(0, 2)).toEqual([0xff, 0x7f]);
    expect([...frame(Buffer.alloc(16384))].slice(0, 3)).toEqual([0x80, 0x80, 0x01]);
  });
});

describe('FrameDecoder', () => {
  it('splits two frames arriving in one chunk', () => {
    const decoder = new FrameDecoder();
    const a = frame(Buffer.from('one'));
    const b = frame(Buffer.from('two'));
    const out = decoder.push(Buffer.concat([a, b]));
    expect(out.map((buf) => buf.toString())).toEqual(['one', 'two']);
  });

  it('reassembles a frame split across header, length and payload boundaries', () => {
    const payload = Buffer.alloc(300, 0x5a);
    const wire = frame(payload);
    const decoder = new FrameDecoder();

    expect(decoder.push(wire.subarray(0, 1))).toEqual([]);
    expect(decoder.push(wire.subarray(1, 2))).toEqual([]);
    expect(decoder.push(wire.subarray(2, 40))).toEqual([]);
    const out = decoder.push(wire.subarray(40));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(payload);
  });

  it('drains many frames from many chunks without copying payloads twice', () => {
    const decoder = new FrameDecoder();
    const frames = Array.from({ length: 20 }, (_, i) => frame(Buffer.from(`f${i}`)));
    const wire = Buffer.concat(frames);
    const out: Buffer[] = [];
    for (let offset = 0; offset < wire.length; offset += 3) {
      out.push(...decoder.push(wire.subarray(offset, Math.min(offset + 3, wire.length))));
    }
    expect(out.map((b) => b.toString())).toEqual(frames.map((_, i) => `f${i}`));
  });

  it('rejects a zero-length or over-large frame', () => {
    expect(() => new FrameDecoder().push(Buffer.from([0]))).toThrow(/Invalid frame length/);
    const length = varint(4 * 1024 * 1024 + 1);
    expect(() => new FrameDecoder().push(Buffer.concat([length, Buffer.alloc(10)]))).toThrow(/Invalid frame length/);
  });

  it('rejects an unterminated length varint', () => {
    expect(() => new FrameDecoder().push(Buffer.alloc(11, 0x80))).toThrow(/too long/);
  });

  it('reset discards a partial frame', () => {
    const decoder = new FrameDecoder();
    decoder.push(frame(Buffer.from('hello')).subarray(0, 3));
    decoder.reset();
    const out = decoder.push(frame(Buffer.from('ok')));
    expect(out.map((b) => b.toString())).toEqual(['ok']);
  });
});

describe('protobuf message codec', () => {
  it('round-trips uint, string, bool and nested messages', () => {
    const w = new ProtoWriter();
    w.uint(1, 42);
    w.string(2, 'Mi TV 4A');
    w.bool(3, true);
    w.message(4, (nested) => {
      nested.uintAlways(1, 0);
      nested.string(2, 'nested');
    });

    const msg = decodeMessage(w.finish());
    expect(getUint(msg, 1)).toBe(42);
    expect(getString(msg, 2)).toBe('Mi TV 4A');
    expect(getUint(msg, 3)).toBe(1);
    const nested = decodeMessage(getBytes(msg, 4) as Buffer);
    expect(getUint(nested, 1)).toBe(0);
    expect(getString(nested, 2)).toBe('nested');
  });

  it('omits proto-default values unless uintAlways is used', () => {
    const w = new ProtoWriter();
    w.uint(1, 0);
    w.bool(2, false);
    w.uintAlways(3, 0);
    const msg = decodeMessage(w.finish());
    expect(hasField(msg, 1)).toBe(false);
    expect(hasField(msg, 2)).toBe(false);
    expect(getUint(msg, 3)).toBe(0);
  });

  it('keeps every repeated value and returns the last one from getters', () => {
    const w = new ProtoWriter();
    w.uintAlways(1, 5);
    w.uintAlways(1, 9);
    w.uintAlways(1, 12);
    const msg = decodeMessage(w.finish());
    expect(msg.get(1)).toHaveLength(3);
    expect(getUint(msg, 1)).toBe(12);
  });

  it('decodes fixed32 and fixed64 values', () => {
    const fixed32 = Buffer.alloc(5);
    fixed32[0] = 0x0d; // field 1, wire type 5
    fixed32.writeUInt32LE(0xdeadbeef, 1);
    expect(decodeMessage(fixed32).get(1)?.[0]).toEqual({ kind: 'fixed32', number: 0xdeadbeef });

    const fixed64 = Buffer.alloc(9);
    fixed64[0] = 0x09; // field 1, wire type 1
    fixed64.writeBigUInt64LE(0x0123456789abcdefn, 1);
    expect(decodeMessage(fixed64).get(1)?.[0]).toEqual({ kind: 'fixed64', number: 0x0123456789abcdefn });
  });

  it('decodes UTF-8 strings, including non-ASCII names', () => {
    const w = new ProtoWriter();
    w.string(1, '小米电视');
    expect(getString(decodeMessage(w.finish()), 1)).toBe('小米电视');
  });

  it('rejects truncated, malformed and unsupported wire data', () => {
    expect(() => decodeMessage(Buffer.from([0x08]))).toThrow(ProtoError);
    expect(() => decodeMessage(Buffer.from([0x0a, 0x05, 0x01]))).toThrow(/Truncated length-delimited/);
    expect(() => decodeMessage(Buffer.from([0x0b]))).toThrow(/Unsupported wire type/);
    expect(() => decodeMessage(Buffer.from([0x00]))).toThrow(/Invalid field number/);
    expect(() => decodeMessage(Buffer.alloc(11, 0x80))).toThrow(/Varint too long/);
  });

  it('refuses to encode negative or unsafe varints', () => {
    expect(() => new ProtoWriter().uint(1, -1)).toThrow(/Invalid varint value/);
    expect(() => new ProtoWriter().uint(1, 1.5)).toThrow(/Invalid varint value/);
    expect(() => new ProtoWriter().uint(0, 1)).toThrow(/Invalid field number/);
  });

  it('round-trips large varint values', () => {
    for (const value of [0x7f, 0x80, 0x3fff, 0x4000, 0x7fffffff, 0xffffffff]) {
      const w = new ProtoWriter();
      w.uint(1, value);
      expect(getUint(decodeMessage(w.finish()), 1)).toBe(value);
    }
  });
});
