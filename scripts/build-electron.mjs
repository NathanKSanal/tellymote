import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const outDir = 'dist-electron';
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  external: ['electron'],
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
};

try {
  await build({
    ...shared,
    entryPoints: ['electron/main.ts'],
    outfile: path.join(outDir, 'main.cjs'),
  });
  await build({
    ...shared,
    entryPoints: ['electron/preload.ts'],
    outfile: path.join(outDir, 'preload.cjs'),
  });
  console.log('[build-electron] main.cjs and preload.cjs written.');
} catch (err) {
  console.error('[build-electron] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
