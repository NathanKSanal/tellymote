import { context } from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: 'inline',
  external: ['electron'],
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"development"' },
};

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5179/';
server.printUrls();

let child = null;
let restartTimer = null;
let shuttingDown = false;

const startElectron = () => {
  if (shuttingDown) return;
  child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url, NODE_ENV: 'development' },
  });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    if (code !== 0) console.log(`[dev] Electron exited with code ${code}. Waiting for changes…`);
    child = null;
  });
};

const restart = () => {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (child) {
      child.kill();
      child = null;
    }
    setTimeout(startElectron, 180);
  }, 260);
};

const rebuildPlugin = {
  name: 'relaunch-electron',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) {
        console.error('[dev] main process build failed; keeping the previous window.');
        return;
      }
      restart();
    });
  },
};

await context({
  ...shared,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.cjs',
  plugins: [rebuildPlugin],
}).then((ctx) => ctx.watch());

await context({
  ...shared,
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist-electron/preload.cjs',
}).then((ctx) => ctx.watch());

console.log('[dev] Building the main process, then starting Electron…');

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child) child.kill();
  await server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  if (child) child.kill();
});
