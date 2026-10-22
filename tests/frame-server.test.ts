import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { FrameServer, type PublishedFrame } from '../electron/core/streaming/frameServer';

const servers: FrameServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});

function frame(seq: number, size = 8): PublishedFrame {
  const now = Date.now();
  return {
    seq,
    png: Buffer.alloc(size, seq & 0xff),
    width: 1920,
    height: 1080,
    requestedAt: now - 40,
    firstByteAt: now - 25,
    completedAt: now - 10,
    deviceCaptureMs: 180,
  };
}

async function start(longPollMs = 90) {
  const server = new FrameServer(longPollMs);
  servers.push(server);
  const handle = await server.start();
  return { server, handle };
}

function frameUrl(base: string, token: string, seq: number): string {
  return `${base}/frame?token=${encodeURIComponent(token)}&seq=${seq}`;
}

describe('loopback frame server', () => {
  it('binds loopback only with an unguessable token', async () => {
    const { handle } = await start();
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(handle.token).toMatch(/^[0-9a-f]{48}$/);
    expect(handle.url).not.toContain(handle.token);
  });

  it('serves a health check without a token', async () => {
    const { handle } = await start();
    const response = await fetch(`${handle.url}/health`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('rejects a missing or wrong token and unknown paths', async () => {
    const { handle } = await start();
    const bad = await fetch(`${handle.url}/frame?token=deadbeef&seq=0`);
    expect(bad.status).toBe(401);
    const missing = await fetch(`${handle.url}/frame?seq=0`);
    expect(missing.status).toBe(401);
    const unknown = await fetch(`${handle.url}/nope`);
    expect(unknown.status).toBe(404);
  });

  it('returns 204 when no frame exists and closes the long poll', async () => {
    const { handle } = await start(70);
    const started = Date.now();
    const response = await fetch(frameUrl(handle.url, handle.token, 0));
    expect(response.status).toBe(204);
    expect(Date.now() - started).toBeGreaterThanOrEqual(60);
  });

  it('returns the newest frame with sequence and timing headers', async () => {
    const { server, handle } = await start();
    server.publish(frame(1, 16));
    const response = await fetch(frameUrl(handle.url, handle.token, 0));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-luma-seq')).toBe('1');
    expect(response.headers.get('x-luma-width')).toBe('1920');
    expect(response.headers.get('x-luma-height')).toBe('1080');
    expect(response.headers.get('x-luma-device-capture-ms')).toBe('180');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(frame(1, 16).png);
  });

  it('skips intermediate frames instead of queueing them', async () => {
    const { server, handle } = await start();
    server.publish(frame(2));
    server.publish(frame(3));
    const response = await fetch(frameUrl(handle.url, handle.token, 0));
    expect(response.headers.get('x-luma-seq')).toBe('3');
  });

  it('wakes a waiting request as soon as a newer frame arrives', async () => {
    const { server, handle } = await start(2000);
    server.publish(frame(5));
    const pending = fetch(frameUrl(handle.url, handle.token, 5));
    await new Promise((resolve) => setTimeout(resolve, 40));
    server.publish(frame(6));
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get('x-luma-seq')).toBe('6');
  });

  it('does not resend a frame the renderer already has', async () => {
    const { server, handle } = await start(60);
    server.publish(frame(9));
    const response = await fetch(frameUrl(handle.url, handle.token, 9));
    expect(response.status).toBe(204);
  });

  it('releases pending polls when the server stops', async () => {
    const { server, handle } = await start(5000);
    server.publish(frame(1));
    const pending = fetch(frameUrl(handle.url, handle.token, 1));
    await new Promise((resolve) => setTimeout(resolve, 40));
    await server.stop();
    const response = await pending;
    expect(response.status).toBe(204);
  });
});

describe('frame server hardening', () => {
  it('rejects a non-loopback Host header', async () => {
    const { handle } = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: handle.port, path: '/health', headers: { host: 'evil.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(421);
  });

  it('rejects methods other than GET', async () => {
    const { handle } = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: handle.port, method: 'POST', path: '/health', headers: { 'content-length': 0 } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(405);
  });
});