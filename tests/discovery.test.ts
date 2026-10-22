import { describe, expect, it } from 'vitest';
import { DiscoveryService, type DiscoveryDeps } from '../electron/core/discovery/discovery';
import type { MdnsService } from '../electron/core/discovery/mdns';
import type { DiscoveredDevice, ScanStatus } from '../shared/types';
import { cap, unknownCapabilities, withRemoteSupport } from '../shared/capabilities';

function emptyDeps(overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    mdns: async () => [],
    ssdp: async () => [],
    sweep: async () => new Map(),
    probe: async (host, ports) => ({ host, open: ports }),
    arp: async () => [],
    resolve: async () => null,
    ...overrides,
  };
}

function atvService(overrides: Partial<MdnsService> = {}): MdnsService {
  return {
    serviceType: '_androidtvremote2._tcp.local',
    instance: 'Mi TV 4A._androidtvremote2._tcp.local',
    host: 'MiTV4A.local',
    port: 6466,
    txt: { fn: 'Mi TV 4A', md: 'MiTV4A-43', mf: 'Xiaomi' },
    addresses: ['192.168.0.50'],
    lastSeen: Date.now(),
    ...overrides,
  };
}

function savedDevice(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    id: 'host:192.168.0.99',
    name: 'Bedroom TV',
    host: '192.168.0.99',
    addresses: ['192.168.0.99'],
    protocols: ['atv-remote-v2'],
    capabilities: withRemoteSupport(unknownCapabilities(), true, false, false),
    source: 'saved',
    lastSeen: Date.now() - 60_000,
    reachable: false,
    trusted: true,
    ...overrides,
  };
}

const options = { activeProbe: false, timeoutMs: 1200 } as const;

describe('DiscoveryService', () => {
  it('turns an Android TV mDNS service into a controllable device', async () => {
    const service = new DiscoveryService(emptyDeps({ mdns: async () => [atvService()] }));
    const { devices, status } = await service.scan(options);

    expect(devices).toHaveLength(1);
    const device = devices[0];
    expect(device.name).toBe('Mi TV 4A');
    expect(device.model).toBe('MiTV4A-43');
    expect(device.manufacturer).toBe('Xiaomi');
    expect(device.host).toBe('192.168.0.50');
    expect(device.protocols).toEqual(['atv-remote-v2']);
    expect(device.source).toBe('mdns');
    expect(device.reachable).toBe(true);
    expect(device.capabilities.remote.state).toBe('supported');
    expect(device.capabilities.screenCapture.state).toBe('unknown');
    expect(status.errors).toEqual([]);
  });

  it('keeps saved devices visible while offline and preserves their verified facts', async () => {
    const saved = savedDevice();
    saved.capabilities.remote = cap('verified', 'Key presses accepted.', 'measured');
    const service = new DiscoveryService(emptyDeps({ mdns: async () => [atvService()] }));
    const { devices } = await service.scan({ ...options, savedDevices: [saved] });

    expect(devices).toHaveLength(2);
    const online = devices.find((d) => d.host === '192.168.0.50');
    const offline = devices.find((d) => d.host === '192.168.0.99');
    expect(online?.capabilities.remote.state).toBe('supported');
    expect(offline).toBeDefined();
    expect(offline?.source).toBe('saved');
    expect(offline?.reachable).toBe(false);
    expect(offline?.trusted).toBe(true);
    expect(devices[0].reachable).toBe(true);
  });

  it('merges a verified capability from the saved record into the fresh one', async () => {
    const saved = savedDevice({ host: '192.168.0.50', id: 'serial:MOCK123' });
    saved.capabilities.remote = cap('verified', 'Measured on this TV.', 'measured');
    const service = new DiscoveryService(emptyDeps({ mdns: async () => [atvService()] }));
    const { devices } = await service.scan({ ...options, savedDevices: [saved] });

    const device = devices.find((d) => d.host === '192.168.0.50');
    expect(device?.id).toBe('serial:MOCK123');
    expect(device?.trusted).toBe(true);
    expect(device?.capabilities.remote).toEqual(saved.capabilities.remote);
    expect(device?.capabilities.screenCapture.state).toBe('unknown');
  });

  it('resolves and probes a manually entered hostname', async () => {
    const probes: string[] = [];
    const service = new DiscoveryService(
      emptyDeps({
        resolve: async (host) => (host === 'living-room.local' ? '192.168.0.60' : null),
        probe: async (host, ports) => {
          probes.push(host);
          return { host, open: ports };
        },
      }),
    );
    const { devices, status } = await service.scan({ ...options, hosts: ['living-room.local'] });

    expect(probes).toEqual(['192.168.0.60']);
    expect(devices).toHaveLength(1);
    expect(devices[0].host).toBe('192.168.0.60');
    expect(devices[0].source).toBe('manual');
    expect(devices[0].protocols).toEqual(['atv-remote-v2', 'adb', 'cast', 'roku-ecp']);
    expect(devices[0].capabilities.remote.state).toBe('supported');
    expect(devices[0].capabilities.adb.state).toBe('conditional');
    expect(status.errors).toEqual([]);
  });

  it('reports an unresolved hostname instead of inventing a device', async () => {
    const service = new DiscoveryService(emptyDeps({ resolve: async () => null }));
    const { devices, status } = await service.scan({ ...options, hosts: ['missing.local'] });
    expect(devices).toEqual([]);
    expect(status.errors.some((error) => error.includes('missing.local'))).toBe(true);
  });

  it('records a useful error when nothing answers', async () => {
    const service = new DiscoveryService(emptyDeps());
    const { devices, status } = await service.scan(options);
    expect(devices).toEqual([]);
    expect(status.errors.some((error) => error.includes('No compatible TV answered'))).toBe(true);
    expect(status.methods).toContain('mDNS');
    expect(status.methods).toContain('SSDP');
  });

  it('emits scan status transitions and finishes cleanly', async () => {
    const updates: ScanStatus[] = [];
    const service = new DiscoveryService(emptyDeps(), (status) => updates.push(status));
    expect(service.isRunning()).toBe(false);
    await service.scan(options);

    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates[0].running).toBe(true);
    expect(updates[updates.length - 1].running).toBe(false);
    expect(updates[updates.length - 1].finishedAt).toBeTypeOf('number');
    expect(service.isRunning()).toBe(false);
    expect(service.getStatus().finishedAt).toBeTypeOf('number');
  });

  it('does not start a second scan while one is running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new DiscoveryService(
      emptyDeps({
        mdns: async () => {
          await gate;
          return [atvService()];
        },
      }),
    );
    const first = service.scan(options);
    const second = service.scan(options);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(b.devices).toEqual(a.devices);
    expect(service.isRunning()).toBe(false);
  });
});
