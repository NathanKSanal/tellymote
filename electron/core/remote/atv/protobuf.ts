/**
 * Minimal, dependency-free protobuf wire codec.
 *
 * Only the features used by the Google TV pairing protocol and the Android TV
 * Remote Service v2 are implemented: varints, length-delimited payloads and
 * nested messages. The codec is deliberately strict so malformed frames from a
 * device are rejected instead of silently mis-parsed.
 */

export type ProtoValue =
  | { kind: 'varint'; number: number }
  | { kind: 'fixed64'; number: bigint }
  | { kind: 'bytes'; bytes: Buffer }
  | { kind: 'fixed32'; number: number };

export type ProtoMessage = Map<number, ProtoValue[]>;

export class ProtoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtoError';
  }
}

function encodeVarint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProtoError(`Invalid varint value: ${value}`);
  }
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Buffer.from(out);
}

function tag(field: number, wireType: number): Buffer {
  if (!Number.isInteger(field) || field <= 0) throw new ProtoError(`Invalid field number: ${field}`);
  return encodeVarint(field * 8 + wireType);
}

export class ProtoWriter {
  private readonly parts: Buffer[] = [];

  uint(field: number, value: number): this {
    if (value === 0) return this;
    this.parts.push(tag(field, 0), encodeVarint(value));
    return this;
  }

  /** Encodes even when the value is the proto default (needed for required proto2 fields). */
  uintAlways(field: number, value: number): this {
    this.parts.push(tag(field, 0), encodeVarint(value));
    return this;
  }

  bool(field: number, value: boolean): this {
    return this.uint(field, value ? 1 : 0);
  }

  bytes(field: number, value: Uint8Array): this {
    this.parts.push(tag(field, 2), encodeVarint(value.length), Buffer.from(value));
    return this;
  }

  string(field: number, value: string): this {
    return this.bytes(field, Buffer.from(value, 'utf8'));
  }

  message(field: number, body: (w: ProtoWriter) => void): this {
    const nested = new ProtoWriter();
    body(nested);
    return this.bytes(field, nested.finish());
  }

  finish(): Buffer {
    return Buffer.concat(this.parts);
  }
}

function readVarint(buf: Buffer, offset: number): { value: number; offset: number } {
  let result = 0;
  let multiplier = 1;
  let pos = offset;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new ProtoError('Truncated varint');
    const byte = buf[pos++];
    result += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value: result, offset: pos };
    multiplier *= 128;
  }
  throw new ProtoError('Varint too long');
}

export function decodeMessage(buf: Buffer): ProtoMessage {
  const fields: ProtoMessage = new Map();
  let offset = 0;
  while (offset < buf.length) {
    const key = readVarint(buf, offset);
    offset = key.offset;
    const field = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (field <= 0) throw new ProtoError(`Invalid field number ${field}`);
    let value: ProtoValue;
    switch (wire) {
      case 0: {
        const v = readVarint(buf, offset);
        offset = v.offset;
        value = { kind: 'varint', number: v.value };
        break;
      }
      case 1: {
        if (offset + 8 > buf.length) throw new ProtoError('Truncated fixed64');
        value = { kind: 'fixed64', number: buf.readBigUInt64LE(offset) };
        offset += 8;
        break;
      }
      case 2: {
        const len = readVarint(buf, offset);
        offset = len.offset;
        if (offset + len.value > buf.length) throw new ProtoError('Truncated length-delimited field');
        value = { kind: 'bytes', bytes: buf.subarray(offset, offset + len.value) };
        offset += len.value;
        break;
      }
      case 5: {
        if (offset + 4 > buf.length) throw new ProtoError('Truncated fixed32');
        value = { kind: 'fixed32', number: buf.readUInt32LE(offset) };
        offset += 4;
        break;
      }
      default:
        throw new ProtoError(`Unsupported wire type ${wire}`);
    }
    const list = fields.get(field);
    if (list) list.push(value);
    else fields.set(field, [value]);
  }
  return fields;
}

export function getUint(msg: ProtoMessage, field: number): number | undefined {
  const values = msg.get(field);
  if (!values || values.length === 0) return undefined;
  const last = values[values.length - 1];
  return last.kind === 'varint' ? last.number : undefined;
}

export function getBytes(msg: ProtoMessage, field: number): Buffer | undefined {
  const values = msg.get(field);
  if (!values || values.length === 0) return undefined;
  const last = values[values.length - 1];
  return last.kind === 'bytes' ? last.bytes : undefined;
}

export function getString(msg: ProtoMessage, field: number): string | undefined {
  const bytes = getBytes(msg, field);
  return bytes ? bytes.toString('utf8') : undefined;
}

export function hasField(msg: ProtoMessage, field: number): boolean {
  return msg.has(field);
}

/**
 * Frames a protobuf payload the way both Android TV ports do: a varint byte
 * length followed by the payload (not a fixed 4-byte header).
 */
export function frame(payload: Uint8Array): Buffer {
  return Buffer.concat([encodeVarint(payload.length), Buffer.from(payload)]);
}

function tryReadVarint(buf: Buffer, offset: number): { value: number; offset: number } | null {
  let result = 0;
  let multiplier = 1;
  for (let i = 0; i < 10; i++) {
    const pos = offset + i;
    if (pos >= buf.length) return null;
    const byte = buf[pos];
    result += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value: result, offset: pos + 1 };
    multiplier *= 128;
  }
  throw new ProtoError('Frame length varint is too long');
}

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxFrame = 4 * 1024 * 1024) {}

  push(chunk: Buffer): Buffer[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out: Buffer[] = [];
    while (this.buffer.length > 0) {
      const header = tryReadVarint(this.buffer, 0);
      if (!header) break;
      const length = header.value;
      if (length <= 0 || length > this.maxFrame) {
        throw new ProtoError(`Invalid frame length: ${length}`);
      }
      if (this.buffer.length < header.offset + length) break;
      out.push(this.buffer.subarray(header.offset, header.offset + length));
      this.buffer = this.buffer.subarray(header.offset + length);
    }
    return out;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
