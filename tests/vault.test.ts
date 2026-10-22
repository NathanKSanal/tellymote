import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SecretVault, type SecretCipher } from '../electron/core/security/vault';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-vault-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Reversible test cipher: not encryption, just enough to prove the vault round-trip. */
const xorCipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plaintext) => Buffer.from(plaintext, 'utf8').map((byte) => byte ^ 0x5a),
  decrypt: (payload) => Buffer.from(payload.map((byte) => byte ^ 0x5a)).toString('utf8'),
};

const unavailableCipher: SecretCipher = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('not available');
  },
  decrypt: () => {
    throw new Error('not available');
  },
};

describe('SecretVault', () => {
  it('persists values encrypted through the OS cipher', () => {
    const dir = tempDir();
    const vault = new SecretVault(dir, xorCipher);
    expect(vault.persisted).toBe(true);
    expect(vault.warning).toBeNull();

    vault.set('pairing.cert', 'certificate-pem');
    vault.setJson('device.pin', { host: '192.168.0.50', fingerprint: 'abc' });

    const file = fs.readFileSync(path.join(dir, 'secrets.bin'), 'utf8');
    expect(file).not.toContain('certificate-pem');
    expect(file).not.toContain('192.168.0.50');

    const reloaded = new SecretVault(dir, xorCipher);
    expect(reloaded.get('pairing.cert')).toBe('certificate-pem');
    expect(reloaded.getJson('device.pin')).toEqual({ host: '192.168.0.50', fingerprint: 'abc' });
  });

  it('deletes values and keeps the file in sync', () => {
    const dir = tempDir();
    const vault = new SecretVault(dir, xorCipher);
    vault.set('a', '1');
    vault.set('b', '2');
    vault.delete('a');
    expect(vault.get('a')).toBeNull();
    expect(new SecretVault(dir, xorCipher).get('a')).toBeNull();
    expect(new SecretVault(dir, xorCipher).get('b')).toBe('2');
  });

  it('returns null for missing or invalid JSON entries', () => {
    const dir = tempDir();
    const vault = new SecretVault(dir, xorCipher);
    expect(vault.get('missing')).toBeNull();
    expect(vault.getJson('missing')).toBeNull();
    vault.set('bad-json', '{nope');
    expect(vault.getJson('bad-json')).toBeNull();
  });

  it('keeps secrets in memory only when OS encryption is unavailable', () => {
    const dir = tempDir();
    const vault = new SecretVault(dir, unavailableCipher);
    expect(vault.persisted).toBe(false);
    expect(vault.warning).toMatch(/session/);
    vault.set('pairing.cert', 'memory-only');
    expect(vault.get('pairing.cert')).toBe('memory-only');
    expect(fs.existsSync(path.join(dir, 'secrets.bin'))).toBe(false);
  });

  it('survives a corrupt vault file without losing the ability to store new secrets', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'secrets.bin'), 'garbage', 'utf8');
    const vault = new SecretVault(dir, xorCipher);
    expect(vault.get('anything')).toBeNull();
    vault.set('pairing.cert', 'fresh');
    expect(new SecretVault(dir, xorCipher).get('pairing.cert')).toBe('fresh');
  });

  it('ignores entries encrypted with a different key instead of throwing', () => {
    const dir = tempDir();
    const first = new SecretVault(dir, xorCipher);
    first.set('pairing.cert', 'secret');
    const different: SecretCipher = {
      isAvailable: () => true,
      encrypt: (text) => Buffer.from(text, 'utf8'),
      decrypt: () => {
        throw new Error('wrong key');
      },
    };
    const second = new SecretVault(dir, different);
    expect(second.get('pairing.cert')).toBeNull();
    second.set('other', 'ok');
    expect(second.get('other')).toBe('ok');
  });
});
