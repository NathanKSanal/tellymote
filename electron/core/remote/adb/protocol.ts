/**
 * ADB wire protocol (host side), implemented from the public protocol
 * documentation (AOSP packages/modules/adb/protocol.txt). No adb binary and no
 * native module is required, so the app works on a clean Windows machine.
 */
import { EventEmitter } from 'node:events';

export const ADB_CMD = {
  SYNC: 0x434e5953,
  CNXN: 0x4e584e43,
  OPEN: 0x4e45504f,
  OKAY: 0x59414b4f,
  CLSE: 0x45534c43,
  WRTE: 0x45545257,
  AUTH: 0x48545541,
  STLS: 0x534c5453,
} as const;

export const ADB_AUTH = { TOKEN: 1, SIGNATURE: 2, RSAPUBLICKEY: 3 } as const;
export const ADB_VERSION = 0x01000000;
export const ADB_MAX_DATA = 256 * 1024;

export const ADB_FEATURES = [
  'shell_v2',
  'cmd',
  'stat_v2',
  'ls_v2',
  'fixed_push_mkdir',
  'apex',
  'abb',
  'abb_exec',
  'remount_shell',
  'track_app',
  'sendrecv_v2',
  'sendrecv_v2_brotli',
  'sendrecv_v2_lz4',
  'sendrecv_v2_zstd',
  'sendrecv_v2_dry_run_send',
].join(',');

export interface AdbPacket {
  command: number;
  arg0: number;
  arg1: number;
  payload: Buffer;
}

export function checksum(data: Buffer): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum = (sum + data[i]) >>> 0;
  return sum;
}

export function encodePacket(command: number, arg0: number, arg1: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(command >>> 0, 0);
  header.writeUInt32LE(arg0 >>> 0, 4);
  header.writeUInt32LE(arg1 >>> 0, 8);
  header.writeUInt32LE(payload.length, 12);
  header.writeUInt32LE(checksum(payload), 16);
  header.writeUInt32LE((command ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([header, payload]);
}

export interface AdbPacketDecoder {
  push(chunk: Buffer): AdbPacket[];
}

export class PacketDecoder implements AdbPacketDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxPayload = 16 * 1024 * 1024) {}

  push(chunk: Buffer): AdbPacket[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const packets: AdbPacket[] = [];
    while (this.buffer.length >= 24) {
      const command = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(12);
      const magic = this.buffer.readUInt32LE(20);
      if ((command ^ 0xffffffff) >>> 0 !== magic) {
        throw new Error('ADB packet magic mismatch');
      }
      if (length > this.maxPayload) throw new Error(`ADB payload too large: ${length}`);
      if (this.buffer.length < 24 + length) break;
      packets.push({
        command,
        arg0: this.buffer.readUInt32LE(4),
        arg1: this.buffer.readUInt32LE(8),
        payload: this.buffer.subarray(24, 24 + length),
      });
      this.buffer = this.buffer.subarray(24 + length);
    }
    return packets;
  }
}

/** NUL-terminated service string, as required by the OPEN message. */
export function servicePayload(service: string): Buffer {
  return Buffer.from(service + '\0', 'utf8');
}

/** Quotes a string for the device shell. */
export function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface AdbStream extends EventEmitter {
  on(event: 'data', listener: (chunk: Buffer) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export class StreamHandle extends EventEmitter {
  readonly chunks: Buffer[] = [];
  closed = false;
  exitCode: number | null = null;
  remoteId: number;

  constructor(
    readonly localId: number,
    remoteId = 0,
  ) {
    super();
    this.remoteId = remoteId;
  }

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.emit('data', chunk);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

export class StreamCollector {
  private readonly chunks: Buffer[] = [];
  bytes = 0;

  add(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.bytes += chunk.length;
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
