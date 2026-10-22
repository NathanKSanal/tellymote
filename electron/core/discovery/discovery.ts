import dns from 'node:dns/promises';
import net from 'node:net';
import type { DiscoveredDevice, DeviceProtocol, DiscoverOptions, ScanStatus } from '../../../shared/types';
import { unknownCapabilities, withRemoteSupport } from '../../../shared/capabilities';
import { readArpTable, primarySubnet, type ArpEntry } from './network';
import { discoverMdns, type MdnsService } from './mdns';
import { discoverSsdp, type SsdpDevice } from './ssdp';
import { probeHost, sweepSubnet } from './probe';

export const PORT_ATV_REMOTE = 6466;
export const PORT_ATV_PAIRING = 6467;
export const PORT_ADB = 5555;
export const PORT_CAST = 8009;
export const PORT_ROKU = 8060;

const TV_VENDOR =
  /xiaomi|google|sony|tcl|hisense|philips|sharp|panasonic|lg electronics|samsung|vizio|skyworth|changhong|haier|nvidia|amlogic|oneplus|realme|toshiba|jvc|grundig|telefunken/i;
const TV_MODEL = /\btv\b|bravia|shield|patchwall|mitv|android tv|google tv|smart tv|fire tv|roku/i;

export interface DiscoveryDeps {
  mdns?: typeof discoverMdns;
  ssdp?: typeof discoverSsdp;
  sweep?: typeof sweepSubnet;
  probe?: typeof probeHost;
  arp?: () => Promise<ArpEntry[]>;
  resolve?: (host: string) => Promise<string | null>;
}

export interface DiscoveryOutcome {
  devices: DiscoveredDevice[];
  status: ScanStatus;
}

interface Candidate {
  host: string;
  ports: Set<number>;
  ssdp?: SsdpDevice;
  mdns: MdnsService[];
  mac?: string;
  manual?: boolean;
  saved?: boolean;
  simulated?: boolean;
}

function isTvLike(text: string | undefined | null): boolean {
  if (!text) return false;
  return TV_VENDOR.test(text) || TV_MODEL.test(text);
}

function protocolList(ports: Set<number>): DeviceProtocol[] {
  const protocols: DeviceProtocol[] = [];
  if (ports.has(PORT_ATV_REMOTE)) protocols.push('atv-remote-v2');
  if (ports.has(PORT_ATV_PAIRING) && !ports.has(PORT_ATV_REMOTE)) protocols.push('atv-remote-v2');
  if (ports.has(PORT_ADB)) protocols.push('adb');
  if (ports.has(PORT_CAST)) protocols.push('cast');
  if (ports.has(PORT_ROKU)) protocols.push('roku-ecp');
  return protocols;
}

function pickName(candidate: Candidate): { name: string; model?: string; manufacturer?: string; firmware?: string; serial?: string } {
  const upnp = candidate.ssdp?.description;
  const atv = candidate.mdns.find((s) => s.serviceType.startsWith('_androidtvremote2'));
  const cast = candidate.mdns.find((s) => s.serviceType.startsWith('_googlecast'));
  const name =
    upnp?.friendlyName ??
    cast?.txt.fn ??
    cast?.txt.name ??
    atv?.txt.fn ??
    (atv ? atv.instance.split('.')[0] : undefined) ??
    (candidate.manual ? candidate.host : `TV at ${candidate.host}`);
  const model = upnp?.modelName ?? cast?.txt.md ?? atv?.txt.md;
  const manufacturer = upnp?.manufacturer ?? (cast?.txt.mf || undefined) ?? (atv?.txt.mf || undefined);
  const serial = upnp?.serialNumber ?? cast?.txt.id ?? undefined;
  const firmware = upnp?.firmwareVersion;
  return { name, model, manufacturer, firmware, serial };
}

function shouldInclude(candidate: Candidate): boolean {
  if (candidate.manual || candidate.saved || candidate.simulated) return true;
  if (candidate.ports.has(PORT_ATV_REMOTE) || candidate.ports.has(PORT_ATV_PAIRING)) return true;
  if (candidate.ports.has(PORT_ROKU)) return true;
  const { model, manufacturer } = pickName(candidate);
  if (candidate.ssdp?.description?.deviceType?.includes('MediaRenderer') && isTvLike(`${model} ${manufacturer}`)) return true;
  if (isTvLike(`${model} ${manufacturer}`)) return true;
  const cast = candidate.mdns.find((s) => s.serviceType.startsWith('_googlecast'));
  if (cast && isTvLike(`${cast.txt.md} ${cast.txt.mf} ${cast.txt.fn}`)) return true;
  return false;
}

function buildDevice(candidate: Candidate, manual?: { name?: string }): DiscoveredDevice {
  const info = pickName(candidate);
  const protocols = protocolList(candidate.ports);
  const capabilities = withRemoteSupport(
    unknownCapabilities(),
    candidate.ports.has(PORT_ATV_REMOTE) || candidate.ports.has(PORT_ATV_PAIRING),
    candidate.ports.has(PORT_ADB),
    candidate.ports.has(PORT_CAST),
    candidate.ports.has(PORT_ROKU),
  );
  const id = info.serial ? `serial:${info.serial}` : candidate.mac ? `mac:${candidate.mac}` : `host:${candidate.host}`;
  return {
    id,
    name: manual?.name ?? info.name,
    model: info.model,
    manufacturer: info.manufacturer,
    firmware: info.firmware,
    serial: info.serial,
    host: candidate.host,
    addresses: [candidate.host],
    protocols,
    capabilities,
    source: candidate.simulated
      ? 'mock'
      : candidate.ssdp
        ? 'ssdp'
        : candidate.mdns.length
          ? 'mdns'
          : candidate.manual
            ? 'manual'
            : candidate.saved
              ? 'saved'
              : 'probe',
    lastSeen: Date.now(),
    reachable: candidate.ports.size > 0,
    trusted: false,
    simulated: candidate.simulated,
    notes: candidate.ssdp?.server ? [`UPnP server: ${candidate.ssdp.server}`] : undefined,
  };
}

export class DiscoveryService {
  private status: ScanStatus = {
    running: false,
    startedAt: null,
    finishedAt: null,
    hostsProbed: 0,
    hostsTotal: 0,
    localAddress: null,
    subnet: null,
    methods: [],
    errors: [],
  };
  private cancelled = false;
  private active: Promise<DiscoveryOutcome> | null = null;

  constructor(
    private readonly deps: DiscoveryDeps = {},
    private readonly onStatus?: (status: ScanStatus) => void,
  ) {}

  getStatus(): ScanStatus {
    return { ...this.status };
  }

  cancel(): void {
    this.cancelled = true;
  }

  isRunning(): boolean {
    return this.status.running;
  }

  async scan(options: DiscoverOptions & { savedDevices?: DiscoveredDevice[] } = {}): Promise<DiscoveryOutcome> {
    if (this.active) return this.active;
    this.cancelled = false;
    const timeoutMs = Math.max(1200, Math.min(options.timeoutMs ?? 4200, 15000));
    const subnet = primarySubnet();
    const saved = options.savedDevices ?? [];
    const manualHosts = (options.hosts ?? []).filter((h) => net.isIPv4(h) || /^[a-z0-9.-]+$/i.test(h));
    this.status = {
      running: true,
      startedAt: Date.now(),
      finishedAt: null,
      hostsProbed: 0,
      hostsTotal: subnet ? subnet.hosts.length : 0,
      localAddress: subnet?.address ?? null,
      subnet: subnet?.subnet ?? null,
      methods: ['mDNS', 'SSDP', subnet ? `TCP sweep ${subnet.subnet}` : 'no local subnet'],
      errors: [],
    };
    this.emitStatus();

    this.active = this.run(options, timeoutMs, subnet, manualHosts, saved).finally(() => {
      this.active = null;
      this.status.running = false;
      this.status.finishedAt = Date.now();
      this.emitStatus();
    });
    return this.active;
  }

  private async run(
    options: DiscoverOptions,
    timeoutMs: number,
    subnet: ReturnType<typeof primarySubnet>,
    manualHosts: string[],
    saved: DiscoveredDevice[],
  ): Promise<DiscoveryOutcome> {
    const mdnsRun = this.deps.mdns ?? discoverMdns;
    const ssdpRun = this.deps.ssdp ?? discoverSsdp;
    const sweepRun = this.deps.sweep ?? sweepSubnet;
    const probe = this.deps.probe ?? probeHost;
    const arpRun = this.deps.arp ?? readArpTable;
    const resolve = this.deps.resolve ?? (async (host: string) => {
      try {
        const result = await dns.lookup(host, { family: 4 });
        return result.address;
      } catch {
        return null;
      }
    });

    const activeProbe = options.activeProbe !== false;
    const ports = [PORT_ATV_REMOTE, PORT_ADB, PORT_CAST, PORT_ROKU];

    const [ssdpResult, mdnsResult, sweepResult, arpEntries] = await Promise.all([
      ssdpRun(Math.min(timeoutMs, 2800)).catch((err: Error) => {
        this.status.errors.push(`SSDP: ${err.message}`);
        return [] as SsdpDevice[];
      }),
      mdnsRun(undefined, Math.min(timeoutMs, 2600)).catch((err: Error) => {
        this.status.errors.push(`mDNS: ${err.message}`);
        return [] as MdnsService[];
      }),
      activeProbe && subnet
        ? sweepRun(subnet.hosts, ports, {
            concurrency: 64,
            timeoutMs: 380,
            isCancelled: () => this.cancelled,
            onProgress: (done, total) => {
              this.status.hostsProbed = done;
              this.status.hostsTotal = total;
              if (done % 24 === 0 || done === total) this.emitStatus();
            },
          }).catch((err: Error) => {
            this.status.errors.push(`Probe: ${err.message}`);
            return new Map<string, number[]>();
          })
        : Promise.resolve(new Map<string, number[]>()),
      arpRun().catch(() => [] as ArpEntry[]),
    ]);

    const candidates = new Map<string, Candidate>();
    const ensure = (host: string): Candidate => {
      let candidate = candidates.get(host);
      if (!candidate) {
        candidate = { host, ports: new Set<number>(), mdns: [] };
        candidates.set(host, candidate);
      }
      return candidate;
    };

    for (const [host, openPorts] of sweepResult) {
      const candidate = ensure(host);
      for (const port of openPorts) candidate.ports.add(port);
    }
    for (const entry of arpEntries) {
      const candidate = candidates.get(entry.address);
      if (candidate) candidate.mac = entry.mac;
    }
    for (const device of ssdpResult) {
      const candidate = ensure(device.address);
      if (!candidate.ssdp) candidate.ssdp = device;
    }
    for (const service of mdnsResult) {
      for (const address of service.addresses) {
        const candidate = ensure(address);
        candidate.mdns.push(service);
        if (service.serviceType.startsWith('_androidtvremote')) candidate.ports.add(PORT_ATV_REMOTE);
        if (service.serviceType.startsWith('_googlecast')) candidate.ports.add(PORT_CAST);
      }
    }

    for (const device of saved) {
      const candidate = ensure(device.host);
      candidate.saved = true;
      if (device.simulated) candidate.simulated = true;
    }

    for (const host of manualHosts) {
      const resolved = net.isIPv4(host) ? host : await resolve(host);
      if (!resolved) {
        this.status.errors.push(`Could not resolve ${host}`);
        continue;
      }
      const result = await probe(resolved, [...ports, PORT_ATV_PAIRING], 700);
      const candidate = ensure(resolved);
      candidate.manual = true;
      for (const port of result.open) candidate.ports.add(port);
    }

    const devices: DiscoveredDevice[] = [];
    for (const candidate of candidates.values()) {
      if (this.cancelled) break;
      if (!shouldInclude(candidate)) continue;
      const savedMatch = saved.find((d) => d.host === candidate.host);
      const device = buildDevice(candidate, savedMatch ? { name: savedMatch.name } : undefined);
      if (savedMatch) {
        device.trusted = savedMatch.trusted;
        device.id = savedMatch.id;
        device.capabilities = mergeTrustedCapabilities(device, savedMatch);
      }
      devices.push(device);
    }

    // Keep saved devices visible even when the TV is currently offline.
    for (const device of saved) {
      if (!devices.some((d) => d.id === device.id || d.host === device.host)) {
        devices.push({ ...device, reachable: false, lastSeen: device.lastSeen, source: 'saved' });
      }
    }

    devices.sort((a, b) => {
      const rank = (d: DiscoveredDevice) => (d.reachable ? 0 : 1) + (d.simulated ? 2 : 0) + (d.id.startsWith('host:') ? 0.5 : 0);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });

    if (devices.length === 0) {
      this.status.errors.push(
        'No compatible TV answered. The TV may be off, on another network, or the router may isolate clients.',
      );
    }
    this.status.methods = [
      'mDNS',
      'SSDP',
      ...(activeProbe ? [`TCP probe ${ports.join('/')}`] : []),
      ...(manualHosts.length ? ['manual host'] : []),
    ];
    return { devices, status: this.getStatus() };
  }

  private emitStatus(): void {
    this.onStatus?.({ ...this.status });
  }
}

function mergeTrustedCapabilities(device: DiscoveredDevice, saved: DiscoveredDevice): DiscoveredDevice['capabilities'] {
  const merged = { ...device.capabilities };
  for (const key of Object.keys(merged) as Array<keyof typeof merged>) {
    if (saved.capabilities[key]?.state === 'verified') merged[key] = saved.capabilities[key];
  }
  return merged;
}
