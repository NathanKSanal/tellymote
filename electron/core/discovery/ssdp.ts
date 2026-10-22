import dgram from 'node:dgram';
import net from 'node:net';

export interface SsdpDevice {
  address: string;
  location: string | null;
  server: string;
  usn: string;
  st: string;
  lastSeen: number;
  description?: UpnpDescription;
}

export interface UpnpDescription {
  friendlyName?: string;
  manufacturer?: string;
  modelName?: string;
  modelNumber?: string;
  deviceType?: string;
  serialNumber?: string;
  firmwareVersion?: string;
}

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:dial-multiscreen-org:service:dial:1',
  'roku:ecp',
  'ssdp:all',
];

function isPrivateHost(host: string): boolean {
  if (net.isIPv4(host)) {
    const parts = host.split('.').map(Number);
    return (
      parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    );
  }
  return false;
}

function safeLocation(location: string | null): string | null {
  if (!location) return null;
  try {
    const url = new URL(location);
    if (url.protocol !== 'http:') return null;
    if (!isPrivateHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseSsdpResponse(raw: string, address: string): SsdpDevice | null {
  const lines = raw.split(/\r?\n/);
  if (!/^HTTP\/1\.[01]\s+200/i.test(lines[0] ?? '')) return null;
  const headers = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
  }
  const location = safeLocation(headers.get('location') ?? null);
  const usn = headers.get('usn') ?? '';
  const st = headers.get('st') ?? '';
  if (!usn && !st) return null;
  return {
    address,
    location,
    server: headers.get('server') ?? '',
    usn,
    st,
    lastSeen: Date.now(),
  };
}

function extractTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  if (!match) return undefined;
  return decodeXmlEntities(match[1].trim());
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

export function parseUpnpDescription(xml: string): UpnpDescription {
  return {
    friendlyName: extractTag(xml, 'friendlyName'),
    manufacturer: extractTag(xml, 'manufacturer'),
    modelName: extractTag(xml, 'modelName'),
    modelNumber: extractTag(xml, 'modelNumber'),
    deviceType: extractTag(xml, 'deviceType'),
    serialNumber: extractTag(xml, 'serialNumber'),
    firmwareVersion: extractTag(xml, 'firmwareVersion') ?? extractTag(xml, 'softwareVersion'),
  };
}

async function fetchDescription(location: string): Promise<UpnpDescription | null> {
  try {
    const response = await fetch(location, {
      signal: AbortSignal.timeout(1600),
      headers: { 'user-agent': 'LumaRemote/1.0 UPnP/1.1' },
      redirect: 'error',
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 512 * 1024) return null;
    return parseUpnpDescription(text);
  } catch {
    return null;
  }
}

/**
 * SSDP discovery over UDP. Responses are collected for `timeoutMs`; UPnP
 * descriptions are fetched only for private-network HTTP locations.
 */
export async function discoverSsdp(timeoutMs = 2600, maxDescriptions = 6): Promise<SsdpDevice[]> {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const found = new Map<string, SsdpDevice>();

  socket.on('message', (buf, rinfo) => {
    const raw = buf.toString('utf8', 0, Math.min(buf.length, 8192));
    const parsed = parseSsdpResponse(raw, rinfo.address);
    if (!parsed) return;
    const key = `${parsed.address}|${parsed.usn || parsed.st}`;
    const existing = found.get(key);
    if (existing) {
      existing.lastSeen = Date.now();
      return;
    }
    found.set(key, parsed);
  });

  await new Promise<void>((resolve) => {
    socket.once('error', () => resolve());
    socket.bind(0, () => resolve());
  }).catch(() => undefined);

  const send = () => {
    for (const st of SEARCH_TARGETS) {
      const message = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 2',
        `ST: ${st}`,
        'USER-AGENT: LumaRemote/1.0 UPnP/1.1',
        '',
        '',
      ].join('\r\n');
      const payload = Buffer.from(message, 'utf8');
      try {
        socket.send(payload, 0, payload.length, SSDP_PORT, SSDP_ADDRESS);
      } catch {
        /* offline */
      }
    }
  };
  send();
  const repeat = setInterval(send, 700);
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  clearInterval(repeat);
  try {
    socket.close();
  } catch {
    /* noop */
  }

  const devices = [...found.values()];
  const tvish = devices.filter((device) => {
    const haystack = `${device.server} ${device.st} ${device.usn}`.toLowerCase();
    return (
      /android|google|xiaomi|mitv|cast|bravia|roku|webos|tizen|smart-?tv|mediarenderer|dial/.test(haystack) ||
      device.location !== null
    );
  });
  const candidates = tvish.filter((d) => d.location).slice(0, maxDescriptions);
  await Promise.all(
    candidates.map(async (device) => {
      if (!device.location) return;
      const description = await fetchDescription(device.location);
      if (description) device.description = description;
    }),
  );
  return tvish;
}
