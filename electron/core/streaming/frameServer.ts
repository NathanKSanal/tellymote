import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_WAITERS = 8;

export interface PublishedFrame {
  seq: number;
  png: Buffer;
  width: number;
  height: number;
  requestedAt: number;
  firstByteAt: number;
  completedAt: number;
  deviceCaptureMs: number | null;
}

export interface FrameServerHandle {
  url: string;
  token: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Loopback-only frame server. The renderer pulls the newest frame with a
 * long-poll request, which gives natural newest-frame semantics: if decoding
 * falls behind, stale frames are never queued.
 */
export class FrameServer {
  private server: http.Server | null = null;
  private latest: PublishedFrame | null = null;
  private waiters: Array<(frame: PublishedFrame | null) => void> = [];
  private tokenValue = '';
  private portValue = 0;

  /** `longPollMs` is configurable so tests do not have to wait the full window. */
  constructor(private readonly longPollMs = 1500) {}

  get baseUrl(): string {
    return this.portValue ? `http://127.0.0.1:${this.portValue}` : '';
  }

  get accessToken(): string {
    return this.tokenValue;
  }

  async start(): Promise<FrameServerHandle> {
    this.tokenValue = randomBytes(24).toString('hex');
    const server = http.createServer((req, res) => this.handle(req, res));
    server.keepAliveTimeout = 5000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Frame server failed to bind');
    this.portValue = address.port;
    this.server = server;
    return {
      url: `http://127.0.0.1:${this.portValue}`,
      token: this.tokenValue,
      port: this.portValue,
      close: () => this.stop(),
    };
  }

  publish(frame: PublishedFrame): void {
    this.latest = frame;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(frame);
  }

  get lastFrame(): PublishedFrame | null {
    return this.latest;
  }

  private tokenMatches(candidate: string): boolean {
    const supplied = Buffer.from(candidate);
    const expected = Buffer.from(this.tokenValue);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    // DNS-rebinding defence: only the exact loopback authority is accepted.
    if (req.headers.host !== `127.0.0.1:${this.portValue}`) {
      res.writeHead(421, { 'content-type': 'text/plain' }).end('misdirected');
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET' }).end();
      return;
    }
    res.setHeader('x-content-type-options', 'nosniff');
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.portValue}`);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('ok');
      return;
    }
    if (url.pathname !== '/frame') {
      res.writeHead(404).end('not found');
      return;
    }
    if (!this.tokenMatches(url.searchParams.get('token') ?? '')) {
      res.writeHead(401).end('unauthorized');
      return;
    }
    if (this.waiters.length >= MAX_WAITERS) {
      res.writeHead(429, { 'retry-after': '1' }).end();
      return;
    }
    const requestedSeq = Number.parseInt(url.searchParams.get('seq') ?? '0', 10) || 0;
    res.setHeader('cache-control', 'no-store');
    const send = (frame: PublishedFrame | null) => {
      if (!frame || frame.seq <= requestedSeq) {
        res.writeHead(204, { 'cache-control': 'no-store' }).end();
        return;
      }
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': frame.png.length,
        'x-luma-seq': String(frame.seq),
        'x-luma-width': String(frame.width),
        'x-luma-height': String(frame.height),
        'x-luma-requested-at': String(frame.requestedAt),
        'x-luma-first-byte-at': String(frame.firstByteAt),
        'x-luma-completed-at': String(frame.completedAt),
        'x-luma-device-capture-ms': String(frame.deviceCaptureMs ?? ''),
      });
      res.end(frame.png);
    };
    if (this.latest && this.latest.seq > requestedSeq) {
      send(this.latest);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      send(null);
    }, this.longPollMs);
    this.waiters.push((frame) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      send(frame);
    });
  }

  async stop(): Promise<void> {
    for (const resolve of this.waiters) resolve(null);
    this.waiters = [];
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
