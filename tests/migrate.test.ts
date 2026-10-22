import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyUserData } from '../electron/core/migrate';

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('legacy user-data migration', () => {
  it('copies devices, settings and the encrypted vault once', () => {
    const oldDir = tempDir('luma-old-');
    const newDir = tempDir('telly-new-');
    fs.writeFileSync(path.join(oldDir, 'devices.json'), '{"devices":[]}');
    fs.writeFileSync(path.join(oldDir, 'settings.json'), '{"theme":"dark"}');
    fs.writeFileSync(path.join(oldDir, 'secrets.bin'), 'encrypted');
    fs.writeFileSync(path.join(oldDir, 'Cache'), 'not-a-file-we-want');

    const copied = migrateLegacyUserData(newDir, oldDir);
    expect(copied.sort()).toEqual(['devices.json', 'secrets.bin', 'settings.json']);
    expect(fs.readFileSync(path.join(newDir, 'devices.json'), 'utf8')).toContain('devices');
    expect(fs.existsSync(path.join(newDir, 'Cache'))).toBe(false);
  });

  it('does not overwrite a profile that already has state', () => {
    const oldDir = tempDir('luma-old-');
    const newDir = tempDir('telly-new-');
    fs.writeFileSync(path.join(oldDir, 'settings.json'), '{"old":true}');
    fs.writeFileSync(path.join(newDir, 'settings.json'), '{"new":true}');

    expect(migrateLegacyUserData(newDir, oldDir)).toEqual([]);
    expect(fs.readFileSync(path.join(newDir, 'settings.json'), 'utf8')).toBe('{"new":true}');
  });

  it('is a no-op when the folders are the same', () => {
    const dir = tempDir('telly-same-');
    fs.writeFileSync(path.join(dir, 'devices.json'), '{}');
    expect(migrateLegacyUserData(dir, dir)).toEqual([]);
  });
});
