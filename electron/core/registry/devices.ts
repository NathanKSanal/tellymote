import fs from 'node:fs';
import path from 'node:path';
import type { DiscoveredDevice, StoredDevice } from '../../../shared/types';

/** Saved devices and cached capability profiles. No secrets live here. */
export class DeviceRegistry {
  private devices: StoredDevice[] = [];
  private readonly file: string;

  constructor(directory: string) {
    this.file = path.join(directory, 'devices.json');
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return;
      this.devices = parsed
        .filter((item): item is StoredDevice => {
          if (!item || typeof item !== 'object') return false;
          const device = item as Partial<StoredDevice>;
          return typeof device.id === 'string' && typeof device.host === 'string' && typeof device.name === 'string';
        })
        .slice(0, 50);
    } catch {
      this.devices = [];
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.devices, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch {
      /* persistence is best-effort; the UI still works this session */
    }
  }

  list(): StoredDevice[] {
    return structuredClone(this.devices);
  }

  find(query: { id?: string; host?: string }): StoredDevice | undefined {
    return this.devices.find((device) => (query.id && device.id === query.id) || (query.host && device.host === query.host));
  }

  upsert(device: DiscoveredDevice, patch: Partial<StoredDevice> = {}): StoredDevice {
    const existing = this.devices.find((d) => d.id === device.id || d.host === device.host);
    if (existing) {
      // Trust is a local decision: a stale device object must never revoke it.
      const wasTrusted = existing.trusted;
      // Never let a stale in-memory device (e.g. one captured before ADB
      // reported the model) erase fields with undefined values.
      const defined = Object.fromEntries(Object.entries(device).filter(([, value]) => value !== undefined));
      Object.assign(existing, defined, patch, { id: existing.id, savedAt: existing.savedAt });
      if (patch.trusted === undefined) existing.trusted = device.trusted || wasTrusted;
      this.save();
      return structuredClone(existing);
    }
    const stored: StoredDevice = { ...device, savedAt: Date.now(), ...patch };
    this.devices.push(stored);
    if (this.devices.length > 50) this.devices = this.devices.slice(-50);
    this.save();
    return structuredClone(stored);
  }

  patch(id: string, patch: Partial<StoredDevice>): StoredDevice | null {
    const device = this.devices.find((d) => d.id === id);
    if (!device) return null;
    Object.assign(device, patch);
    this.save();
    return structuredClone(device);
  }

  remove(id: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  rename(id: string, name: string): StoredDevice | null {
    const trimmed = name.trim().slice(0, 64);
    if (!trimmed) return null;
    return this.patch(id, { name: trimmed });
  }
}
