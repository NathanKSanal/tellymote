import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(payload: Buffer): string;
}

interface VaultFile {
  version: 1;
  scheme: 'dpapi' | 'none';
  entries: Record<string, string>;
}

/**
 * Encrypted key/value store for certificates, private keys and pairing pins.
 *
 * On Windows the cipher is Electron safeStorage (DPAPI-backed, per user). If the
 * OS cannot encrypt, secrets stay in memory for the session only — they are
 * never silently written to disk in plaintext.
 */
export class SecretVault {
  private entries = new Map<string, Buffer>();
  private readonly file: string;
  private readonly cipher: SecretCipher;
  private readonly memoryOnly: boolean;
  private dirty = false;
  readonly warning: string | null;

  constructor(directory: string, cipher: SecretCipher) {
    this.file = path.join(directory, 'secrets.bin');
    this.cipher = cipher;
    this.memoryOnly = !cipher.isAvailable();
    this.warning = this.memoryOnly
      ? 'Windows credential encryption is unavailable, so pairing keys are kept only for this session.'
      : null;
    if (!this.memoryOnly) this.load();
  }

  get persisted(): boolean {
    return !this.memoryOnly;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as VaultFile;
      if (parsed.version !== 1 || parsed.scheme !== 'dpapi') return;
      for (const [key, value] of Object.entries(parsed.entries)) {
        try {
          const plaintext = this.cipher.decrypt(Buffer.from(value, 'base64'));
          this.entries.set(key, Buffer.from(plaintext, 'utf8'));
        } catch {
          // A single unreadable entry (e.g. copied profile) must not destroy the rest.
        }
      }
    } catch {
      // Corrupt vault: start empty, the user can re-pair.
      this.entries.clear();
    }
  }

  get(key: string): string | null {
    const value = this.entries.get(key);
    return value ? value.toString('utf8') : null;
  }

  getJson<T>(key: string): T | null {
    const raw = this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    this.entries.set(key, Buffer.from(value, 'utf8'));
    this.dirty = true;
    this.flush();
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }

  delete(key: string): void {
    if (this.entries.delete(key)) {
      this.dirty = true;
      this.flush();
    }
  }

  private flush(): void {
    if (this.memoryOnly || !this.dirty) return;
    const payload: VaultFile = { version: 1, scheme: 'dpapi', entries: {} };
    for (const [key, buffer] of this.entries) {
      payload.entries[key] = this.cipher.encrypt(buffer.toString('utf8')).toString('base64');
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch {
      // Keep the value in memory; the UI reports that persistence failed.
    }
  }
}
