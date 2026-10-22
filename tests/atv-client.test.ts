import { EventEmitter, once } from 'node:events';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AtvRemoteClient } from '../electron/core/remote/atv/client';
import { FrameDecoder, ProtoWriter, decodeMessage, frame, getBytes, getString, getUint } from '../electron/core/remote/atv/protobuf';
import { generateClientCertificate, type ClientCertificate } from '../electron/core/security/identity';
import { makeCertificate, type TestCertificate } from './helpers/certs';

let clientCert: ClientCertificate;
let serverCert: TestCertificate;

interface MockTv {
  port: number;
  events: EventEmitter;
  server: tls.Server;
  send: (build: (w: ProtoWriter) => void) => void;
}

const cleanup: Array<() => void> = [];

beforeAll(() => {
  clientCert = generateClientCertificate();
  serverCert = makeCertificate('Mock TV', 'server');
});

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

async function startMockTv(featureMask = 622): Promise<MockTv> {
  const events = new EventEmitter();
  const sockets: tls.TLSSocket[] = [];
  const server = tls.createServer({ key: serverCert.keyPem, cert: serverCert.certPem, minVersion: 'TLSv1.2' }, (socket) => {
    sockets.push(socket);
    const decoder = new FrameDecoder();
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      let frames: Buffer[];
      try {
        frames = decoder.push(chunk);
      } catch {
        return;
      }
      for (const payload of frames) {
        const msg = decodeMessage(payload);
        if (msg.has(1)) {
          const w = new ProtoWriter();
          w.message(1, (m) => {
            m.uintAlways(1, featureMask);
            m.message(2, (info) => {
              info.string(1, 'Mi TV 4A');
              info.string(2, 'Xiaomi');
              info.string(6, '2.0.0');
            });
          });
          socket.write(frame(w.finish()));
        } else if (msg.has(2)) {
          events.emit('setactive', getUint(decodeMessage(getBytes(msg, 2) as Buffer), 1) ?? null);
        } else if (msg.has(10)) {
          const key = decodeMessage(getBytes(msg, 10) as Buffer);
          events.emit('key', { code: getUint(key, 1), direction: getUint(key, 2) });
        } else if (msg.has(8)) {
          const val = getUint(decodeMessage(getBytes(msg, 8) as Buffer), 1) ?? 0;
          const w = new ProtoWriter();
          w.message(9, (m) => m.uintAlways(1, val));
          socket.write(frame(w.finish()));
          events.emit('ping', val);
        } else if (msg.has(9)) {
          events.emit('pingresponse', getUint(decodeMessage(getBytes(msg, 9) as Buffer), 1) ?? 0);
        } else if (msg.has(90)) {
          events.emit('applink', getString(decodeMessage(getBytes(msg, 90) as Buffer), 1));
        } else if (msg.has(21)) {
          const ime = decodeMessage(getBytes(msg, 21) as Buffer);
          const edit = decodeMessage(getBytes(ime, 3) as Buffer);
          const field = decodeMessage(getBytes(edit, 2) as Buffer);
          events.emit('ime', getString(field, 3));
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  cleanup.push(() => {
    server.close();
    server.closeAllConnections?.();
  });
  return {
    port,
    events,
    server,
    send: (build) => {
      const w = new ProtoWriter();
      build(w);
      for (const socket of sockets) socket.write(frame(w.finish()));
    },
  };
}

function makeClient(port: number): AtvRemoteClient {
  const client = new AtvRemoteClient('127.0.0.1', clientCert, port, 60_000);
  cleanup.push(() => client.close());
  return client;
}

describe('Android TV remote client', () => {
  it('negotiates the feature mask, goes active and reports device info', async () => {
    const tv = await startMockTv(622);
    const client = makeClient(tv.port);
    const setActive = once(tv.events, 'setactive');

    const info = await client.connect();
    expect(info).toEqual({ model: 'Mi TV 4A', vendor: 'Xiaomi', appVersion: '2.0.0' });
    expect(client.isConnected).toBe(true);
    expect(client.features).toBe(622);
    expect(await setActive).toEqual([622]);
  });

  it('intersects the TV mask with what this client supports', async () => {
    const tv = await startMockTv(622 | 16 | 1024);
    const client = makeClient(tv.port);
    const setActive = once(tv.events, 'setactive');
    await client.connect();
    // Unknown bits requested by the TV are ignored, known ones retained.
    expect(await setActive).toEqual([622]);
  });

  it('refuses a TV that does not advertise key injection', async () => {
    const tv = await startMockTv(604); // APP_LINK | VOLUME | VOICE | IME, no KEY
    const client = makeClient(tv.port);
    const error = await client.connect().then(
      () => null,
      (err: { code?: string; message?: string }) => err,
    );
    expect(error?.code).toBe('REMOTE_UNAVAILABLE');
    expect(error?.message).toMatch(/key injection/);
    expect(client.isConnected).toBe(false);
  });

  it('completes a protocol ping and answers TV-initiated pings', async () => {
    const tv = await startMockTv(622);
    const client = makeClient(tv.port);
    await client.connect();

    const rtt = await client.ping();
    expect(rtt).toBeGreaterThanOrEqual(0);
    expect(client.rttMs).not.toBeNull();

    const answer = once(tv.events, 'pingresponse');
    tv.send((w) => {
      w.message(8, (m) => m.uintAlways(1, 4242));
    });
    expect(await answer).toEqual([4242]);
  });

  it('sends key presses with the right codes and long-press directions', async () => {
    const tv = await startMockTv(622);
    const client = makeClient(tv.port);
    await client.connect();

    const short = once(tv.events, 'key');
    client.key('home');
    expect(await short).toEqual([{ code: 3, direction: 3 }]);

    const down = once(tv.events, 'key');
    client.key('select', { action: 'down' });
    expect(await down).toEqual([{ code: 23, direction: 1 }]);

    const up = once(tv.events, 'key');
    client.key('select', { action: 'up' });
    expect(await up).toEqual([{ code: 23, direction: 2 }]);

    expect(client.commandsSent).toBe(3);
  });

  it('coalesces repeated taps of the same key but delivers distinct keys and long-press edges', async () => {
    const tv = await startMockTv(622);
    const client = makeClient(tv.port);
    await client.connect();

    const keys: Array<{ code: number; direction: number }> = [];
    tv.events.on('key', (event) => keys.push(event));

    client.key('up');
    client.key('up'); // identical tap inside the 24 ms window
    expect(client.suppressed).toBe(1);

    client.key('down');
    client.key('select', { action: 'down' });
    client.key('select', { action: 'up' });

    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(keys).toEqual([
      { code: 19, direction: 3 },
      { code: 20, direction: 3 },
      { code: 23, direction: 1 },
      { code: 23, direction: 2 },
    ]);
    expect(client.commandsSent).toBe(4);
  });

  it('surfaces volume, power and app events from the TV', async () => {
    const tv = await startMockTv(622);
    const client = makeClient(tv.port);
    await client.connect();

    const volume = once(client, 'volume');
    tv.send((w) => {
      w.message(50, (m) => {
        m.uintAlways(7, 12);
        m.uintAlways(6, 30);
        m.uintAlways(8, 1);
      });
    });
    expect(await volume).toEqual([{ level: 12, max: 30, muted: true }]);

    const power = once(client, 'power');
    tv.send((w) => w.message(40, (m) => m.uintAlways(1, 1)));
    expect(await power).toEqual([true]);
    expect(client.isOn).toBe(true);

    const app = once(client, 'app');
    tv.send((w) =>
      w.message(20, (m) => {
        m.message(1, (info) => info.string(12, 'com.netflix.ninja'));
        m.message(2, (field) => field.uintAlways(1, 3));
      }),
    );
    expect(await app).toEqual(['com.netflix.ninja']);
    expect(client.currentApp).toBe('com.netflix.ninja');
  });

  it('sends app links and gates IME text on the negotiated features', async () => {
    const tv = await startMockTv(622);
    const client = makeClient(tv.port);
    await client.connect();

    const link = once(tv.events, 'applink');
    client.appLink('https://www.netflix.com/title/1');
    expect(await link).toEqual(['https://www.netflix.com/title/1']);

    const ime = once(tv.events, 'ime');
    client.imeText('hello');
    expect(await ime).toEqual(['hello']);
  });

  it('rejects IME text when the TV did not advertise it', async () => {
    const tv = await startMockTv(618); // KEY and everything else, no IME
    const client = makeClient(tv.port);
    await client.connect();
    expect(() => client.imeText('hello')).toThrow(/did not advertise text input/);
  });

  it('rejects commands before the session is ready', async () => {
    const tv = await startMockTv(622);
    const client = makeClient(tv.port);
    expect(() => client.key('home')).toThrow(/not connected/);
    await client.connect();
    client.close();
    expect(() => client.key('home')).toThrow(/not connected/);
  });
});
