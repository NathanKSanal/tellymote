import fs from 'node:fs';
import path from 'node:path';

/** Files that hold user state; caches and logs are deliberately not copied. */
const LEGACY_FILES = ['devices.json', 'settings.json', 'secrets.bin'] as const;

/**
 * One-time migration from the project's previous name (LumaRemote). The new
 * user-data folder is left alone if it already has any state, so this can run
 * on every start without overwriting newer data.
 *
 * `secrets.bin` is DPAPI-encrypted per Windows user; copying it preserves the
 * pairing without ever handling the plaintext.
 */
export function migrateLegacyUserData(newDirectory: string, oldDirectory: string): string[] {
  if (path.resolve(newDirectory).toLowerCase() === path.resolve(oldDirectory).toLowerCase()) {
    return [];
  }
  if (LEGACY_FILES.some((file) => fs.existsSync(path.join(newDirectory, file)))) {
    return [];
  }

  const copied: string[] = [];
  for (const file of LEGACY_FILES) {
    const source = path.join(oldDirectory, file);
    if (!fs.existsSync(source)) continue;
    fs.mkdirSync(newDirectory, { recursive: true });
    fs.copyFileSync(source, path.join(newDirectory, file));
    copied.push(file);
  }
  return copied;
}
