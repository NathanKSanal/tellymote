import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RokuClient } from '../electron/core/remote/roku/client';

interface MockRoku {
  port: number;
  calls: Array<{ method: string; path: string }>;
  close: () => Promise<void>;
}

const servers: MockRoku[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function startMockRoku(): Promise<MockRoku> {
  const calls: Array<{ method: string; path: string }> = [];
  const server = http.createServer((req, res) => {
    calls.push({ method: req.method ?? '', path: req.url ?? '' });
    req.resume();
    if (req.url === '/query/device-info') {
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end(
        '<?xml version="1.0"?><device-info><friendly-device-name>Living Room Roku</friendly-device-name><model-name>Roku Ultra</model-name></device-info>',
      );
      return;
    }
    if (req.url === '/query/apps') {
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end(
        '<?xml version="1.0"?><apps><app id="12" type="appl" version="1.0">Netflix</app><app id="13" type="appl">YouTube &amp; TV</app><app id="14" type="appl">Prime Video</app></apps>',
      );
      return;
    }
    if (req.method === 'POST' && (req.url?.startsWith('/keypress/') || req.url?.startsWith('/launch/'))) {
      res.writeHead(200).end('ok');
      return;
    }
    res.writeHead(404).end('no');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const mock: MockRoku = {
    port,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  servers.push(mock);
  return mock;
}

describe('Roku ECP client', () => {
  it('reads the device name and model', async () => {
    const mock = await startMockRoku();
    const client = new RokuClient('127.0.0.1', mock.port);
    await expect(client.deviceInfo()).resolves.toEqual({ name: 'Living Room Roku', model: 'Roku Ultra' });
  });

  it('sends mapped keys and reports the round trip', async () => {
    const mock = await startMockRoku();
    const client = new RokuClient('127.0.0.1', mock.port);
    const result = await client.key('home');
    expect(result.rttMs).toBeGreaterThanOrEqual(0);
    expect(mock.calls.at(-1)).toEqual({ method: 'POST', path: '/keypress/Home' });
  });

  it('explains keys that Roku does not have', async () => {
    const mock = await startMockRoku();
    const client = new RokuClient('127.0.0.1', mock.port);
    await expect(client.key('input')).rejects.toThrow(/cannot send/);
    const menu = await client.key('menu');
    expect(menu.note).toMatch(/no menu key/i);
  });

  it('parses and decodes the app list', async () => {
    const mock = await startMockRoku();
    const client = new RokuClient('127.0.0.1', mock.port);
    const apps = await client.apps();
    expect(apps.map((app) => app.label)).toEqual(['Netflix', 'Prime Video', 'YouTube & TV']);
    expect(apps[2]?.packageName).toBe('13');
  });

  it('launches by id and rejects path injection', async () => {
    const mock = await startMockRoku();
    const client = new RokuClient('127.0.0.1', mock.port);
    await client.launch('12');
    expect(mock.calls.at(-1)).toEqual({ method: 'POST', path: '/launch/12' });
    await expect(client.launch('../evil')).rejects.toThrow(/Invalid Roku app id/);
  });

  it('sends literal ASCII input one character at a time', async () => {
    const mock = await startMockRoku();
    const client = new RokuClient('127.0.0.1', mock.port);
    const result = await client.text('a b');
    expect(result).toEqual({ sent: 3, dropped: 0 });
    const paths = mock.calls.filter((call) => call.path.startsWith('/keypress/Lit_')).map((call) => call.path);
    expect(paths).toEqual(['/keypress/Lit_a', '/keypress/Lit_%20', '/keypress/Lit_b']);
  });

  it('rejects a non-IPv4 host instead of doing DNS work', () => {
    expect(() => new RokuClient('example.com')).toThrow(/IPv4/);
  });
});
