import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceRegistry } from '../electron/core/registry/devices';
import { unknownCapabilities } from '../shared/capabilities';
import type { DiscoveredDevice } from '../shared/types';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-registry-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function device(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    id: 'mac:aa:bb:cc:dd:ee:ff',
    name: 'TV at 192.168.0.60',
    host: '192.168.0.60',
    addresses: ['192.168.0.60'],
    protocols: ['atv-remote-v2', 'adb'],
    capabilities: unknownCapabilities(),
    source: 'ssdp',
    lastSeen: Date.now(),
    reachable: true,
    trusted: false,
    ...overrides,
  } as DiscoveredDevice;
}

describe('DeviceRegistry', () => {
  it('does not erase a discovered model when a stale device object is saved later', () => {
    const registry = new DeviceRegistry(tempDir());
    registry.upsert(device({ model: 'MiTV4I', manufacturer: 'Xiaomi' }));

    // A session markCapability call can hold a device captured before ADB read
    // the model. Its undefined model must not clobber the stored one.
    registry.upsert(device({ model: undefined, manufacturer: undefined }));

    const stored = registry.find({ id: 'mac:aa:bb:cc:dd:ee:ff' });
    expect(stored?.model).toBe('MiTV4I');
    expect(stored?.manufacturer).toBe('Xiaomi');
  });

  it('persists trust and capabilities across a reload', () => {
    const dir = tempDir();
    const registry = new DeviceRegistry(dir);
    registry.upsert(device({ model: 'MiTV4I' }), { trusted: true });
    registry.upsert(device({ model: 'MiTV4I', capabilities: { ...unknownCapabilities() } }));

    const reopened = new DeviceRegistry(dir);
    const stored = reopened.find({ id: 'mac:aa:bb:cc:dd:ee:ff' });
    expect(stored?.trusted).toBe(true);
    expect(stored?.model).toBe('MiTV4I');
  });
});
