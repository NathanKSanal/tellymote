import net from 'node:net';
import { EventEmitter } from 'node:events';
import { appError, describeNodeError, type AppError } from '../../errors';
import { adbSignToken, type AdbIdentity } from '../../security/identity';
import {
  ADB_AUTH,
  ADB_CMD,
  ADB_FEATURES,
  ADB_MAX_DATA,
  ADB_VERSION,
  PacketDecoder,
  StreamCollector,
  StreamHandle,
  encodePacket,
  servicePayload,
  type AdbPacket,
} from './protocol';

export const ADB_PORT = 5555;

export interface AdbBanner {
  version: number;
  maxData: number;
  features: string[];
  device: string;
  raw: string;
}

export interface AdbProps {
  model: string;
  manufacturer: string;
  androidVersion: string;
  sdk: number | null;
  serial: string;
  build: string;
  product: string;
  displayResolution: string | null;
}

export interface AdbConnectOptions {
  timeoutMs?: number;
  /** How long to wait for the user to accept the RSA prompt on the TV. */
  authTimeoutMs?: number;
  /** Override only for mock-server tests; real devices use 5555. */
  port?: number;
  onAuthorizing?: (fingerprint: string) => void;
}

export class AdbAuthError extends Error {
  constructor(
    message: string,
    readonly code: 'ADB_UNAUTHORIZED' | 'ADB_NOT_ENABLED',
  ) {
    super(message);
    this.name = 'AdbAuthError';
  }
}

export class AdbClient extends EventEmitter {
  private readonly decoder = new PacketDecoder();
  private readonly streams = new Map<number, StreamHandle>();
  private readonly pendingOpen = new Map<
    number,
    {
      service: string;
      timer: NodeJS.Timeout;
      resolve: (stream: StreamHandle) => void;
      reject: (err: Error) => void;
    }
  >();
  private localId = 1;
  private sentSignature = false;
  private sentPublicKey = false;
  private banner: AdbBanner | null = null;
  private closed = false;

  private constructor(
    private readonly socket: net.Socket,
    readonly host: string,
  ) {
    super();
  }

  static connect(host: string, identity: AdbIdentity, options: AdbConnectOptions = {}): Promise<AdbClient> {
    const timeoutMs = options.timeoutMs ?? 5000;
    const authTimeoutMs = options.authTimeoutMs ?? 120_000;
    const port = options.port ?? ADB_PORT;
    return new Promise((resolve, reject) => {
      let settled = false;
      let authTimer: NodeJS.Timeout | null = null;
      const socket = net.connect({ host, port: port });
      const client = new AdbClient(socket, host);
      socket.setNoDelay(true);
      socket.setTimeout(timeoutMs);

      const fail = (err: AppError) => {
        if (settled) return;
        settled = true;
        if (authTimer) clearTimeout(authTimer);
        socket.destroy();
        reject(err);
      };

      socket.once('connect', () => {
        socket.setTimeout(0);
        socket.write(
          encodePacket(ADB_CMD.CNXN, ADB_VERSION, ADB_MAX_DATA, Buffer.from(`host::features=${ADB_FEATURES}`, 'utf8')),
        );
      });

      socket.on('data', (chunk: Buffer) => {
        let packets: AdbPacket[];
        try {
          packets = client.decoder.push(chunk);
        } catch (err) {
          fail(appError('INTERNAL', 'Malformed ADB response.', (err as Error).message));
          return;
        }
        for (const packet of packets) {
          if (packet.command === ADB_CMD.AUTH) {
            if (packet.arg0 === ADB_AUTH.TOKEN) {
              const token = packet.payload;
              if (!client.sentSignature) {
                client.sentSignature = true;
                socket.write(encodePacket(ADB_CMD.AUTH, ADB_AUTH.SIGNATURE, 0, adbSignToken(identity.privateKeyPem, token)));
              } else if (!client.sentPublicKey) {
                client.sentPublicKey = true;
                options.onAuthorizing?.(identity.fingerprint);
                socket.write(
                  encodePacket(ADB_CMD.AUTH, ADB_AUTH.RSAPUBLICKEY, 0, Buffer.from(identity.publicKey + '\0', 'utf8')),
                );
                if (authTimer) clearTimeout(authTimer);
                authTimer = setTimeout(() => {
                  fail(
                    appError(
                      'ADB_UNAUTHORIZED',
                      'The TV did not accept this laptop’s debugging key in time.',
                      'Approve the prompt on the TV, then connect again.',
                    ),
                  );
                }, authTimeoutMs);
                authTimer.unref?.();
              } else {
                fail(
                  appError(
                    'ADB_UNAUTHORIZED',
                    'The TV rejected this laptop’s debugging key.',
                    'Remove the old authorisation on the TV or approve the prompt when it appears.',
                  ),
                );
              }
            }
            continue;
          }
          if (packet.command === ADB_CMD.CNXN) {
            const raw = packet.payload.toString('utf8').replace(/\0+$/g, '');
            const props = new Map<string, string>();
            for (const part of raw.split(';')) {
              const idx = part.indexOf('=');
              if (idx > 0) props.set(part.slice(0, idx), part.slice(idx + 1));
            }
            client.banner = {
              version: packet.arg0,
              maxData: packet.arg1,
              features: (props.get('features') ?? '').split(',').filter(Boolean),
              device: props.get('device') ?? 'unknown',
              raw,
            };
            settled = true;
            if (authTimer) clearTimeout(authTimer);
            resolve(client);
            continue;
          }
          client.handlePacket(packet);
        }
      });

      socket.once('error', (err) => {
        const details = describeNodeError(err);
        fail(
          client.sentPublicKey
            ? appError('ADB_UNAUTHORIZED', 'The TV closed the debugging connection.', details.message)
            : appError('ADB_NOT_ENABLED', `Could not connect to ADB on ${host}:${port}.`, details.message),
        );
      });

      socket.once('close', () => {
        client.closed = true;
        for (const [, stream] of client.streams) stream.close();
        client.streams.clear();
        for (const [, pending] of client.pendingOpen) {
          clearTimeout(pending.timer);
          pending.reject(new Error('ADB connection closed'));
        }
        client.pendingOpen.clear();
        if (!settled) {
          fail(
            client.sentPublicKey
              ? appError('ADB_UNAUTHORIZED', 'The TV did not authorise this laptop.')
              : appError('ADB_NOT_ENABLED', 'The ADB connection closed before it was established.'),
          );
        }
      });

      socket.setTimeout(timeoutMs, () => {
        fail(appError('ADB_NOT_ENABLED', `No ADB service answered on ${host}:${port}.`));
      });
    });
  }

  get isOpen(): boolean {
    return !this.closed && !this.socket.destroyed;
  }

  get info(): AdbBanner | null {
    return this.banner;
  }

  private handlePacket(packet: AdbPacket): void {
    switch (packet.command) {
      // On the wire the device addresses us with its remote id in arg0 and our
      // local id in arg1. Streams are stored by local id, so every lookup must
      // use arg1. (These ids only coincide for the first stream, which is why
      // treating arg0 as the local id appears to work until a second command.)
      case ADB_CMD.OKAY: {
        const stream = this.streams.get(packet.arg1);
        const pending = this.pendingOpen.get(packet.arg1);
        if (stream && pending) {
          clearTimeout(pending.timer);
          this.pendingOpen.delete(packet.arg1);
          stream.remoteId = packet.arg0;
          pending.resolve(stream);
        }
        return;
      }
      case ADB_CMD.WRTE: {
        const stream = this.streams.get(packet.arg1);
        if (stream) {
          stream.push(packet.payload);
          this.socket.write(encodePacket(ADB_CMD.OKAY, packet.arg1, packet.arg0));
        }
        return;
      }
      case ADB_CMD.CLSE: {
        const stream = this.streams.get(packet.arg1);
        if (stream) {
          this.socket.write(encodePacket(ADB_CMD.CLSE, packet.arg1, packet.arg0));
          this.streams.delete(packet.arg1);
          stream.close();
        }
        return;
      }
      default:
        return;
    }
  }

  openStream(service: string, timeoutMs = 8000): Promise<StreamHandle> {
    if (!this.isOpen) return Promise.reject(new Error('ADB connection is closed'));
    const id = this.localId;
    this.localId += 1;
    const handle = new StreamHandle(id, 0);
    this.streams.set(id, handle);
    return new Promise<StreamHandle>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOpen.delete(id);
        this.streams.delete(id);
        reject(new Error(`ADB stream open timed out (${service})`));
      }, timeoutMs);
      timer.unref?.();
      this.pendingOpen.set(id, { service, timer, resolve, reject });
      handle.once('close', () => {
        const pending = this.pendingOpen.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingOpen.delete(id);
          reject(new Error(`ADB stream closed before opening (${service})`));
        }
      });
      this.socket.write(encodePacket(ADB_CMD.OPEN, id, 0, servicePayload(service)));
    });
  }

  /** Runs a command and resolves with its combined stdout (binary safe). */
  async exec(command: string, timeoutMs = 15000): Promise<Buffer> {
    if (!this.isOpen) throw new Error('ADB connection is closed');
    const stream = await this.openStream(`shell:${command}`, Math.min(timeoutMs, 15000));
    const collector = new StreamCollector();
    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.closeStream(stream);
          reject(err);
        } else {
          resolve(collector.finish());
        }
      };
      const timer = setTimeout(() => {
        finish(new Error(`ADB command timed out after ${timeoutMs} ms: ${command.slice(0, 60)}`));
      }, timeoutMs);
      timer.unref?.();
      stream.on('data', (chunk) => collector.add(chunk));
      stream.once('close', () => finish(null));
    });
  }

  async execText(command: string, timeoutMs = 15000): Promise<string> {
    return (await this.exec(command, timeoutMs)).toString('utf8').trim();
  }

  closeStream(stream: StreamHandle): void {
    if (this.isOpen) {
      try {
        this.socket.write(encodePacket(ADB_CMD.CLSE, stream.localId, stream.remoteId));
      } catch {
        /* socket gone */
      }
    }
    this.streams.delete(stream.localId);
    stream.close();
  }

  close(): void {
    this.closed = true;
    for (const [, stream] of this.streams) stream.close();
    this.streams.clear();
    try {
      this.socket.destroy();
    } catch {
      /* noop */
    }
  }

  async readProperties(): Promise<AdbProps> {
    const keys = [
      'ro.product.model',
      'ro.product.manufacturer',
      'ro.build.version.release',
      'ro.build.version.sdk',
      'ro.serialno',
      'ro.build.display.id',
      'ro.product.name',
    ];
    const command = keys.map((k) => `getprop ${k}`).join('; ');
    const lines = (await this.execText(command, 10000)).split(/\r?\n/);
    const value = (i: number) => (lines[i] ?? '').trim();
    const resolution = (await this.execText('wm size | head -n 1', 6000)).replace(/^Physical size:\s*/i, '').trim();
    return {
      model: value(0) || 'Android TV',
      manufacturer: value(1) || 'Unknown',
      androidVersion: value(2) || 'unknown',
      sdk: Number.parseInt(value(3), 10) || null,
      serial: value(4) || '',
      build: value(5) || '',
      product: value(6) || '',
      displayResolution: /^\d+x\d+$/.test(resolution) ? resolution : null,
    };
  }
}

export function adbErrorToAppError(err: unknown): AppError {
  if (err instanceof AdbAuthError) return appError(err.code, err.message);
  const message = err instanceof Error ? err.message : String(err);
  return appError('ADB_NOT_ENABLED', 'The debugging connection failed.', message);
}
