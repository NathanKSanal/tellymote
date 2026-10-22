import { createPublicKey, randomBytes, verify } from 'node:crypto';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ADB_AUTH,
  ADB_CMD,
  ADB_MAX_DATA,
  ADB_VERSION,
  PacketDecoder,
  checksum,
  encodePacket,
  servicePayload,
  shellQuote,
} from '../electron/core/remote/adb/protocol';
import { AdbClient } from '../electron/core/remote/adb/client';
import { generateAdbIdentity, type AdbIdentity } from '../electron/core/security/identity';

let identity: AdbIdentity;
const cleanups: Array<() => void> = [];

beforeAll(() => {
  identity = generateAdbIdentity('lumaremote');
});

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

interface MockAdb {
  port: number;
  openServices: string[];
  signatureVerified: () => boolean | null;
  publicKey: () => string | null;
  handshakeCount: () => number;
}

async function startMockAdb(mode: 'accept' | 'reject' = 'accept'): Promise<MockAdb> {
  const openServices: string[] = [];
  let signatureOk: boolean | null = null;
  let receivedKey: string | null = null;
  let handshakes = 0;

  const server = net.createServer((socket) => {
    const decoder = new PacketDecoder();
    const token1 = randomBytes(20);
    let sentFirstToken = false;
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      let packets;
      try {
        packets = decoder.push(chunk);
      } catch {
        return;
      }
      for (const packet of packets) {
        if (packet.command === ADB_CMD.CNXN) {
          const payload = packet.payload.toString('utf8');
          if (!sentFirstToken && payload.startsWith('host::features=')) {
            sentFirstToken = true;
            socket.write(encodePacket(ADB_CMD.AUTH, ADB_AUTH.TOKEN, 0, token1));
          } else {
            handshakes += 1;
          }
          continue;
        }
        if (packet.command === ADB_CMD.AUTH && packet.arg0 === ADB_AUTH.SIGNATURE) {
          signatureOk = verify('sha1', token1, createPublicKey(identity.privateKeyPem), packet.payload);
          socket.write(encodePacket(ADB_CMD.AUTH, ADB_AUTH.TOKEN, 0, randomBytes(20)));
          continue;
        }
        if (packet.command === ADB_CMD.AUTH && packet.arg0 === ADB_AUTH.RSAPUBLICKEY) {
          receivedKey = packet.payload.toString('utf8').replace(/\0+$/g, '');
          if (mode === 'reject') {
            socket.write(encodePacket(ADB_CMD.AUTH, ADB_AUTH.TOKEN, 0, randomBytes(20)));
          } else {
            socket.write(
              encodePacket(
                ADB_CMD.CNXN,
                ADB_VERSION,
                ADB_MAX_DATA,
                Buffer.from('device=mock;model=MiTV4A;features=shell_v2,cmd', 'utf8'),
              ),
            );
          }
          continue;
        }
        if (packet.command === ADB_CMD.OPEN) {
          const service = packet.payload.toString('utf8').replace(/\0+$/g, '');
          openServices.push(service);
          const local = packet.arg0;
          // Real adbd sends its own stream id in arg0 and echoes the client's
          // local id in arg1. Use deliberately different numbers so a client
          // that confuses the two cannot pass.
          const remote = 100 + openServices.length;
          if (service === 'shell:failing') {
            // A real device answers CLSE (not OKAY) when it refuses a service.
            socket.write(encodePacket(ADB_CMD.CLSE, remote, local));
            continue;
          }
          if (service === 'shell:hang') {
            socket.write(encodePacket(ADB_CMD.OKAY, remote, local));
            continue;
          }
          socket.write(encodePacket(ADB_CMD.OKAY, remote, local));
          const output = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.from([0x00, 0x00, 0x00, 0x0d]),
            Buffer.from('IHDR', 'ascii'),
            Buffer.from([0x00, 0x04, 0x38, 0x00]),
          ]);
          setTimeout(() => {
            socket.write(encodePacket(ADB_CMD.WRTE, remote, local, output));
            setTimeout(() => socket.write(encodePacket(ADB_CMD.CLSE, remote, local)), 10);
          }, 5);
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  cleanups.push(() => {
    server.close();
    server.closeAllConnections?.();
  });
  return {
    port,
    openServices,
    signatureVerified: () => signatureOk,
    publicKey: () => receivedKey,
    handshakeCount: () => handshakes,
  };
}

describe('ADB packet codec', () => {
  it('encodes a 24-byte header with a little-endian checksum and magic', () => {
    const payload = Buffer.from('screencap -p');
    const wire = encodePacket(ADB_CMD.OPEN, 5, 0, payload);
    expect(wire).toHaveLength(24 + payload.length);
    expect(wire.readUInt32LE(0)).toBe(ADB_CMD.OPEN);
    expect(wire.readUInt32LE(4)).toBe(5);
    expect(wire.readUInt32LE(12)).toBe(payload.length);
    expect(wire.readUInt32LE(16)).toBe(checksum(payload));
    expect(wire.readUInt32LE(20)).toBe((ADB_CMD.OPEN ^ 0xffffffff) >>> 0);
    expect(wire.subarray(24)).toEqual(payload);
  });

  it('decodes packets split across arbitrary chunk boundaries', () => {
    const decoder = new PacketDecoder();
    const wire = Buffer.concat([
      encodePacket(ADB_CMD.OKAY, 1, 2),
      encodePacket(ADB_CMD.WRTE, 3, 4, Buffer.from([0, 1, 2, 3])),
    ]);
    const packets = [];
    for (let offset = 0; offset < wire.length; offset += 5) {
      packets.push(...decoder.push(wire.subarray(offset, Math.min(offset + 5, wire.length))));
    }
    expect(packets.map((p) => [p.command, p.arg0, p.arg1])).toEqual([
      [ADB_CMD.OKAY, 1, 2],
      [ADB_CMD.WRTE, 3, 4],
    ]);
    expect(packets[1].payload).toEqual(Buffer.from([0, 1, 2, 3]));
  });

  it('rejects a bad magic or an over-large payload', () => {
    const wire = encodePacket(ADB_CMD.OKAY, 1, 2);
    wire.writeUInt32LE(0, 20);
    expect(() => new PacketDecoder().push(wire)).toThrow(/magic mismatch/);

    const huge = Buffer.alloc(24);
    huge.writeUInt32LE(ADB_CMD.WRTE, 0);
    huge.writeUInt32LE(16 * 1024 * 1024 + 1, 12);
    huge.writeUInt32LE((ADB_CMD.WRTE ^ 0xffffffff) >>> 0, 20);
    expect(() => new PacketDecoder().push(huge)).toThrow(/payload too large/);
  });

  it('quotes service strings and device shell arguments safely', () => {
    expect(servicePayload('shell:getprop').toString()).toBe('shell:getprop\0');
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('plain text')).toBe("'plain text'");
  });
});

describe('ADB host client against a mock device', () => {
  it('authenticates with a signed token, offers its public key and reads the banner', async () => {
    const mock = await startMockAdb('accept');
    const client = await AdbClient.connect('127.0.0.1', identity, { port: mock.port, timeoutMs: 3000 });

    expect(mock.signatureVerified()).toBe(true);
    expect(mock.publicKey()).toBe(identity.publicKey);
    expect(client.info).toMatchObject({
      version: ADB_VERSION,
      maxData: ADB_MAX_DATA,
      device: 'mock',
      features: ['shell_v2', 'cmd'],
    });
    expect(mock.handshakeCount()).toBe(0); // the first CNXN is the greeting

    client.close();
  });

  it('runs a shell command and returns binary output intact', async () => {
    const mock = await startMockAdb('accept');
    const client = await AdbClient.connect('127.0.0.1', identity, { port: mock.port, timeoutMs: 3000 });

    const output = await client.exec('screencap -p');
    expect(output.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(output).toContain(0x00); // binary-zero bytes survive the stream
    expect(mock.openServices).toEqual(['shell:screencap -p']);

    client.close();
  });

  it('maps device remote ids correctly across several sequential streams', async () => {
    const mock = await startMockAdb('accept');
    const client = await AdbClient.connect('127.0.0.1', identity, { port: mock.port, timeoutMs: 3000 });

    const first = await client.exec('first');
    const second = await client.exec('second');
    const third = await client.exec('third');
    expect(first.length).toBeGreaterThan(8);
    expect(second.length).toBe(first.length);
    expect(third.length).toBe(first.length);
    expect(mock.openServices).toEqual(['shell:first', 'shell:second', 'shell:third']);

    client.close();
  });

  it('rejects a command that never finishes instead of returning partial data', async () => {
    const mock = await startMockAdb('accept');
    const client = await AdbClient.connect('127.0.0.1', identity, { port: mock.port, timeoutMs: 3000 });

    const error = await client.exec('hang', 150).then(
      () => null,
      (err: Error) => err,
    );
    expect(error?.message).toMatch(/timed out/);

    client.close();
  });

  it('rejects a stream that closes before the device acknowledges it', async () => {
    const mock = await startMockAdb('accept');
    const client = await AdbClient.connect('127.0.0.1', identity, { port: mock.port, timeoutMs: 3000 });
    const error = await client.exec('failing').then(
      () => null,
      (err: Error) => err,
    );
    expect(error?.message).toMatch(/closed before opening/);
    client.close();
  });

  it('fails with an authorization error when the device keeps asking for the key', async () => {
    const mock = await startMockAdb('reject');
    const error = await AdbClient.connect('127.0.0.1', identity, {
      port: mock.port,
      timeoutMs: 3000,
      authTimeoutMs: 4000,
    }).then(
      () => null,
      (err: { code?: string; message?: string }) => err,
    );
    expect(error?.code).toBe('ADB_UNAUTHORIZED');
    expect(error?.message).toMatch(/rejected this laptop/);
  });

  it('reports a clear error when nothing is listening', async () => {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const error = await AdbClient.connect('127.0.0.1', identity, { port, timeoutMs: 800 }).then(
      () => null,
      (err: { code?: string }) => err,
    );
    expect(error?.code).toBe('ADB_NOT_ENABLED');
  });
});
