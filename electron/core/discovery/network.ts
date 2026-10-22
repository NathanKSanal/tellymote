import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface LocalInterface {
  name: string;
  address: string;
  mac: string | null;
  prefixLength: number;
  subnet: string;
  isPrivate: boolean;
}

export interface LocalSubnet {
  address: string;
  prefixLength: number;
  subnet: string;
  /** Hosts inside the immediate /24 only. LumaRemote never sweeps beyond it. */
  hosts: string[];
  interfaceName: string;
}

export function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function listLocalInterfaces(): LocalInterface[] {
  const result: LocalInterface[] = [];
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!isPrivateIPv4(entry.address)) continue;
      // Link-local and CGNAT (Tailscale) addresses are not the home LAN.
      if (entry.address.startsWith('169.254.')) continue;
      if (entry.address.startsWith('100.')) continue;
      const prefix = prefixFromNetmask(entry.netmask);
      result.push({
        name,
        address: entry.address,
        mac: entry.mac && entry.mac !== '00:00:00:00:00:00' ? entry.mac : null,
        prefixLength: prefix,
        subnet: subnetFor(entry.address, prefix),
        isPrivate: true,
      });
    }
  }
  // Prefer real Wi-Fi/Ethernet adapters over virtual switches. A Hyper-V
  // "vEthernet (Default Switch)" also matches /ethernet/i, so virtual names are
  // checked first and pushed to the back regardless of the word they contain.
  return rankInterfaces(result);
}

const VIRTUAL_ADAPTER = /(vethernet|hyper-?v|default switch|wsl|docker|virtualbox|vmware|tailscale|zerotier|wireguard|openvpn|\btap\b|\btun\b|bluetooth|npcap|radmin|hamachi|vpn|loopback)/i;
const WIFI_ADAPTER = /(wi-?fi|wlan|wireless)/i;
const ETHERNET_ADAPTER = /(ethernet|local area connection|\beth\d)/i;

/** Pure, deterministic adapter ordering so discovery picks the home LAN first. */
export function rankInterfaces(interfaces: LocalInterface[]): LocalInterface[] {
  const score = (i: LocalInterface) => {
    if (VIRTUAL_ADAPTER.test(i.name)) return 4;
    if (WIFI_ADAPTER.test(i.name)) return 0;
    if (ETHERNET_ADAPTER.test(i.name)) return 1;
    return 2;
  };
  return [...interfaces].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

function prefixFromNetmask(mask: string): number {
  return mask
    .split('.')
    .map((part) => Number(part).toString(2).padStart(8, '0'))
    .join('')
    .replace(/0+$/, '').length;
}

function subnetFor(address: string, prefix: number): string {
  const parts = address.split('.').map(Number);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const ip = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const net = ip & mask;
  return [net >>> 24, (net >>> 16) & 255, (net >>> 8) & 255, net & 255].join('.');
}

export function primarySubnet(preferred?: string): LocalSubnet | null {
  const interfaces = listLocalInterfaces();
  if (interfaces.length === 0) return null;
  const chosen = preferred ? (interfaces.find((i) => i.address === preferred) ?? interfaces[0]) : interfaces[0];
  const parts = chosen.address.split('.').map(Number);
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i++) {
    if (i === parts[3]) continue;
    hosts.push(`${parts[0]}.${parts[1]}.${parts[2]}.${i}`);
  }
  return {
    address: chosen.address,
    prefixLength: chosen.prefixLength,
    subnet: `${parts[0]}.${parts[1]}.${parts[2]}.0/24`,
    hosts,
    interfaceName: chosen.name,
  };
}

export interface ArpEntry {
  address: string;
  mac: string;
}

/** Reads the OS neighbour table; used only to enrich discovery, never required. */
export async function readArpTable(): Promise<ArpEntry[]> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync('arp', ['-a'], { timeout: 4000, windowsHide: true });
    const entries: ArpEntry[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})/i.exec(line);
      if (match) entries.push({ address: match[1], mac: match[2].replace(/-/g, ':').toLowerCase() });
    }
    return entries;
  } catch {
    return [];
  }
}

export async function readWifiInfo(): Promise<{ ssid: string | null; signal: number | null; linkMbps: number | null }> {
  if (process.platform !== 'win32') return { ssid: null, signal: null, linkMbps: null };
  try {
    const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces'], { timeout: 4000, windowsHide: true });
    const ssid = /^\s*SSID\s*:\s*(.+)$/m.exec(stdout)?.[1]?.trim() ?? null;
    const signal = Number.parseInt(/^\s*Signal\s*:\s*(\d+)%/m.exec(stdout)?.[1] ?? '', 10);
    const rx = Number.parseInt(/^\s*Receive rate \(Mbps\)\s*:\s*(\d+)/m.exec(stdout)?.[1] ?? '', 10);
    const tx = Number.parseInt(/^\s*Transmit rate \(Mbps\)\s*:\s*(\d+)/m.exec(stdout)?.[1] ?? '', 10);
    return {
      ssid: ssid && ssid !== '' ? ssid : null,
      signal: Number.isFinite(signal) ? signal : null,
      linkMbps: Number.isFinite(tx) && Number.isFinite(rx) ? Math.min(rx, tx) : null,
    };
  } catch {
    return { ssid: null, signal: null, linkMbps: null };
  }
}
