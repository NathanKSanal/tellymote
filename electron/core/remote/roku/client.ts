import http from 'node:http';
import net from 'node:net';
import type { AppEntry, RemoteKey } from '../../../../shared/types';

export const ROKU_ECP_PORT = 8060;

/**
 * Roku External Control Protocol (ECP). It is unauthenticated HTTP on port 8060:
 * `POST /keypress/<key>`, `GET /query/apps`, `POST /launch/<id>`.
 *
 * Only used for Roku TVs and players. It cannot capture the screen.
 */
export class RokuClient {
  constructor(
    readonly host: string,
    readonly port = ROKU_ECP_PORT,
  ) {
    if (!net.isIPv4(host)) throw new Error('Roku ECP requires an IPv4 address.');
  }

  private request(method: 'GET' | 'POST', path: string, timeoutMs = 4000): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.host,
          port: this.port,
          method,
          path,
          timeout: timeoutMs,
          headers: { connection: 'close', 'content-length': 0 },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 512 * 1024) {
              req.destroy(new Error('Roku response was too large.'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`Roku ECP returned HTTP ${res.statusCode ?? 0}.`));
              return;
            }
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('Roku ECP timed out.')));
      req.on('error', reject);
      req.end();
    });
  }

  async deviceInfo(): Promise<{ name?: string; model?: string }> {
    const xml = await this.request('GET', '/query/device-info');
    return {
      name: tag(xml, 'friendly-device-name') ?? tag(xml, 'user-device-name'),
      model: tag(xml, 'model-name') ?? tag(xml, 'model-number'),
    };
  }

  /** Returns the local round-trip time in milliseconds. */
  async key(key: RemoteKey): Promise<{ rttMs: number; note?: string }> {
    const mapped = ROKU_KEY[key];
    if (!mapped) {
      throw new Error(`Roku ECP cannot send "${key}".`);
    }
    const started = performance.now();
    await this.request('POST', `/keypress/${encodeURIComponent(mapped.name)}`);
    return { rttMs: Math.round(performance.now() - started), note: mapped.note };
  }

  /** ECP literal input: one request per character. ASCII only, like ADB. */
  async text(text: string): Promise<{ sent: number; dropped: number }> {
    const ascii = text.replace(/[^\x20-\x7E]/g, '');
    const characters = [...ascii].slice(0, 200);
    for (const character of characters) {
      await this.request('POST', `/keypress/Lit_${encodeURIComponent(character)}`);
    }
    return { sent: characters.length, dropped: text.length - characters.length };
  }

  async apps(): Promise<AppEntry[]> {
    const xml = await this.request('GET', '/query/apps');
    const apps: AppEntry[] = [];
    const pattern = /<app\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/app>/gi;
    for (const match of xml.matchAll(pattern)) {
      const packageName = decodeXml(match[1] ?? '');
      const label = decodeXml(match[2] ?? '').trim();
      if (!packageName || !label) continue;
      apps.push({ packageName, label, thirdParty: true });
    }
    return apps.sort((a, b) => a.label.localeCompare(b.label));
  }

  async launch(appId: string): Promise<void> {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(appId)) throw new Error('Invalid Roku app id.');
    await this.request('POST', `/launch/${encodeURIComponent(appId)}`);
  }
}

const ROKU_KEY: Partial<Record<RemoteKey, { name: string; note?: string }>> = {
  power: { name: 'Power' },
  wake: { name: 'Power', note: 'Roku has one power key; it toggles standby.' },
  sleep: { name: 'Power', note: 'Roku has one power key; it toggles standby.' },
  up: { name: 'Up' },
  down: { name: 'Down' },
  left: { name: 'Left' },
  right: { name: 'Right' },
  select: { name: 'Select' },
  back: { name: 'Back' },
  home: { name: 'Home' },
  menu: { name: 'Info', note: 'Roku has no menu key; Info is the closest equivalent.' },
  settings: { name: 'Info', note: 'Roku has no settings key; Info is the closest equivalent.' },
  info: { name: 'Info' },
  volumeUp: { name: 'VolumeUp' },
  volumeDown: { name: 'VolumeDown' },
  mute: { name: 'VolumeMute' },
  playPause: { name: 'Play' },
  rewind: { name: 'Rev' },
  fastForward: { name: 'Fwd' },
  next: { name: 'Fwd', note: 'Roku ECP has no next-track key; Fwd is the closest.' },
  previous: { name: 'Rev', note: 'Roku ECP has no previous-track key; Rev is the closest.' },
  channelUp: { name: 'ChannelUp' },
  channelDown: { name: 'ChannelDown' },
  backspace: { name: 'Backspace' },
};

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return match ? decodeXml(match[1] ?? '').trim() : undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}
