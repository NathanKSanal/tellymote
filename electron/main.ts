import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerSaveBlocker,
  safeStorage,
  session as electronSession,
  shell,
  Tray,
} from 'electron';
import type { AppInfo, AppSettings, Channel, EventMap, IpcResult, RemoteKey } from '../shared/types';
import { CHANNELS, EVENT_PREFIX, EVENTS, INVOKE_CHANNEL } from '../shared/channels';
import { AppLog } from './core/log';
import { SettingsStore } from './core/settings';
import { DeviceRegistry } from './core/registry/devices';
import { SecretVault, type SecretCipher } from './core/security/vault';
import { FrameServer } from './core/streaming/frameServer';
import { LumaSession } from './core/session';
import { migrateLegacyUserData } from './core/migrate';
import { appError, toAppError } from './core/errors';
import { KEY_CODES } from './core/remote/atv/messages';

const isDev = !app.isPackaged;
const smokeMode = process.argv.includes('--smoke');
app.setName('TellyMote');
const channelSet = new Set<string>(CHANNELS);
const eventSet = new Set<string>(EVENTS);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let blockerId: number | null = null;
let session: LumaSession;
let settingsStore: SettingsStore;
let frameServer: FrameServer;
let log: AppLog;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Sandbox every renderer, including any window created later.
  app.enableSandbox();
  // Software compositing keeps capturePage deterministic on headless/CI Windows
  // sessions, where the GPU path can fail with UnknownVizError.
  if (smokeMode) app.disableHardwareAcceleration();

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((err: unknown) => {
    dialog.showErrorBox('TellyMote could not start', err instanceof Error ? err.message : String(err));
    app.exit(1);
  });
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.tellymote.app');
  Menu.setApplicationMenu(null);

  const directory = app.getPath('userData');
  fs.mkdirSync(directory, { recursive: true });

  log = new AppLog();
  const migrated = migrateLegacyUserData(directory, path.join(app.getPath('appData'), 'lumaremote'));
  if (migrated.length > 0) {
    log.info('app', 'Imported data from the previous LumaRemote install.', { files: migrated.length });
  }
  settingsStore = new SettingsStore(directory);
  const registry = new DeviceRegistry(directory);

  const cipher: SecretCipher = {
    isAvailable: () => {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    encrypt: (plaintext) => safeStorage.encryptString(plaintext),
    decrypt: (payload) => safeStorage.decryptString(payload),
  };
  const vault = new SecretVault(directory, cipher);

  const appInfo: AppInfo = {
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    adbPath: null,
    mockServerSupported: false,
    userDataPath: directory,
    security: { vaultPersisted: vault.persisted, warning: vault.warning },
  };

  const emit = <K extends keyof EventMap>(channel: K, payload: EventMap[K]): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(`${EVENT_PREFIX}${channel}`, payload);
  };

  frameServer = new FrameServer();
  try {
    await frameServer.start();
  } catch (err) {
    log.error('streaming', 'The loopback frame server could not start.', { detail: (err as Error).message });
  }

  session = new LumaSession({
    directory,
    vault,
    settings: settingsStore,
    registry,
    log,
    frameServer,
    appInfo,
    emit,
  });
  await session.init();

  log.subscribe((entry) => emit('log:entry', entry));
  log.info('app', 'TellyMote started.', {
    version: appInfo.version,
    electron: appInfo.electron,
    vault: vault.persisted ? 'encrypted' : 'memory-only',
  });
  if (vault.warning) log.warn('security', vault.warning);

  applyCsp();
  registerIpc();
  createWindow();
  createTray();

  if (!smokeMode) {
    const settings = settingsStore.get();
    if (settings.scanOnStartup) {
      setTimeout(() => {
        void session
          .scan({ activeProbe: settings.activeProbeOnStartup, timeoutMs: 4200 })
          .catch((err: unknown) => log.warn('discovery', 'Startup scan failed.', { detail: (err as Error).message }));
      }, 700);
    }
    if (settings.autoReconnect && settings.lastDeviceId) {
      setTimeout(() => {
        void session.autoConnect();
      }, 2200);
    }
  }
}

function applyCsp(): void {
  if (isDev) return;
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http://127.0.0.1:*",
    "connect-src 'self' http://127.0.0.1:*",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });
  electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  electronSession.defaultSession.setPermissionCheckHandler(() => false);
}

function appIconPath(): string {
  return path.join(app.getAppPath(), 'build', 'icon.png');
}

function createWindow(): void {
  const icon = appIconPath();
  const win = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#07070a',
    title: 'TellyMote',
    icon: fs.existsSync(icon) ? icon : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: '#07070a', symbolColor: '#e9e9f2', height: 44 }
        : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (event) => {
    if (quitting || smokeMode || !tray) return;
    if (settingsStore.get().minimizeToTray) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedSender(url)) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    log.error('window', 'Renderer failed to load.', { code, description, url });
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('window', 'Renderer process ended.', { reason: details.reason, exitCode: details.exitCode });
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (smokeMode) scheduleSmokeCapture(win);
}

function createTray(): void {
  const iconPath = appIconPath();
  if (!fs.existsSync(iconPath)) return;
  try {
    const image = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
    if (image.isEmpty()) return;
    tray = new Tray(image);
    tray.setToolTip('TellyMote');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Open TellyMote',
          click: () => {
            mainWindow?.show();
            mainWindow?.focus();
          },
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) mainWindow.hide();
      else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    log.warn('app', 'Tray icon could not be created.', { detail: (err as Error).message });
    tray = null;
  }
}

const SMOKE_NAV: Record<string, string> = {
  dashboard: 'Dashboard',
  devices: 'Devices',
  live: 'Live screen',
  remote: 'Remote',
  apps: 'Apps & favourites',
  diagnostics: 'Diagnostics',
  settings: 'Settings',
};

function scheduleSmokeCapture(win: BrowserWindow): void {
  const outDir = process.env.LUMA_SMOKE_OUT || path.join(app.getPath('temp'), 'tellymote-smoke');
  const views = (process.env.LUMA_SMOKE_VIEWS || 'dashboard')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value in SMOKE_NAV);
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const captures: Array<{ view: string; file: string; clicked: boolean }> = [];
      try {
        for (const view of views.length ? views : ['dashboard']) {
          let clicked = true;
          if (view !== 'dashboard') {
            const label = JSON.stringify(SMOKE_NAV[view]);
            clicked = Boolean(
              await win.webContents.executeJavaScript(
                `(() => { const target = [...document.querySelectorAll('aside nav button')].find((button) => button.textContent && button.textContent.includes(${label})); if (!target) return false; target.click(); return true; })()`,
              ),
            );
            await new Promise((resolve) => setTimeout(resolve, view === 'diagnostics' ? 1900 : 750));
          }
          const image = await win.webContents.capturePage();
          const file = path.join(outDir, `${view}.png`);
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(file, image.toPNG());
          captures.push({ view, file, clicked });
        }
        const report = {
          ok: true,
          captures,
          title: win.getTitle(),
          url: win.webContents.getURL(),
          appInfo: session.appInfo,
          settings: session.getSettings(),
          status: session.getStatus(),
        };
        process.stdout.write(`\nLUMA_SMOKE ${JSON.stringify(report)}\n`);
      } catch (err) {
        process.stdout.write(`\nLUMA_SMOKE ${JSON.stringify({ ok: false, error: (err as Error).message, captures })}\n`);
      } finally {
        setTimeout(() => {
          quitting = true;
          app.exit(0);
        }, 250);
      }
    }, 2600);
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle(INVOKE_CHANNEL, async (event, rawChannel: unknown, rawArgs: unknown): Promise<IpcResult<unknown>> => {
    try {
      if (!isTrustedSender(event.senderFrame?.url ?? '')) {
        throw new Error('Rejected IPC call from an untrusted frame.');
      }
      if (typeof rawChannel !== 'string' || !channelSet.has(rawChannel)) {
        throw new Error(`Unknown channel: ${String(rawChannel)}`);
      }
      const args = Array.isArray(rawArgs) ? rawArgs : [];
      const value = await dispatch(rawChannel as Channel, args);
      return { ok: true, value };
    } catch (err) {
      const mapped = toAppError(err);
      log.warn('ipc', mapped.message, { code: mapped.code });
      return { ok: false, error: mapped };
    }
  });
}

function isTrustedSender(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (isDev && process.env.VITE_DEV_SERVER_URL) {
      return url.origin === new URL(process.env.VITE_DEV_SERVER_URL).origin;
    }
    if (url.protocol !== 'file:') return false;
    // Only the packaged index.html may use the bridge. Another local file must
    // not be able to navigate the window and inherit the preload API.
    const allowed = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html'));
    return decodeURIComponent(url.pathname).toLowerCase() === decodeURIComponent(allowed.pathname).toLowerCase();
  } catch {
    return false;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback = 0): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw appError('INVALID_INPUT', 'Expected an object.');
  }
  return value as Record<string, unknown>;
}

async function dispatch(channel: Channel, args: unknown[]): Promise<unknown> {
  switch (channel) {
    case 'app:info':
      return session.appInfo;

    case 'settings:get':
      return session.getSettings();

    case 'settings:set': {
      const partial = plainObject(args[0]) as Partial<AppSettings>;
      const settings = session.updateSettings(partial);
      applyLoginItem(settings);
      return settings;
    }

    case 'settings:reset': {
      const settings = session.resetSettings();
      applyLoginItem(settings);
      return settings;
    }

    case 'devices:list':
      return session.getDevices();

    case 'devices:scan':
      return session.scan((args[0] ?? {}) as Record<string, never>);

    case 'devices:cancelScan':
      session.cancelScan();
      return true;

    case 'devices:addManual':
      return session.addManual(asString(args[0]), optionalString(args[1]));

    case 'devices:forget':
      session.forget(asString(args[0]));
      return true;

    case 'devices:rename':
      return session.rename(asString(args[0]), asString(args[1]));

    case 'devices:probe':
      return session.scan({ hosts: [asString(args[0])], activeProbe: false, timeoutMs: 2600 });

    case 'connection:connect':
      return session.connect(asString(args[0]), { autoPair: true });

    case 'connection:disconnect':
      await session.disconnect();
      stopPowerBlocker();
      return session.getStatus();

    case 'connection:status':
      return session.getStatus();

    case 'connection:autoConnect':
      return session.autoConnect();

    case 'pairing:start':
      await session.startPairing(asString(args[0]));
      return true;

    case 'pairing:submitCode':
      await session.submitPairingCode(asString(args[0]));
      return true;

    case 'pairing:cancel':
      session.cancelPairing();
      return true;

    case 'remote:key': {
      const key = asString(args[0]);
      if (!Object.prototype.hasOwnProperty.call(KEY_CODES, key)) {
        throw appError('INVALID_INPUT', 'Unknown remote key.');
      }
      const action = args[1] === 'down' || args[1] === 'up' ? args[1] : 'tap';
      return session.sendKey(key as RemoteKey, action);
    }

    case 'remote:tap':
      return session.sendTap(Number(args[0]), Number(args[1]));

    case 'remote:text':
      return session.sendText(asString(args[0]));

    case 'remote:app':
      return session.launchApp(asString(args[0]));

    case 'remote:apps':
      return session.listApps();

    case 'capture:start': {
      const preference = args[0] === 'h264' || args[0] === 'png' ? args[0] : undefined;
      const result = await session.startCapture(preference);
      startPowerBlocker();
      return result;
    }

    case 'capture:stop':
      session.stopCapture();
      stopPowerBlocker();
      return session.getCaptureMetrics();

    case 'capture:status':
      return session.getCaptureStatus();

    case 'capture:probeMethods':
      return session.probeCaptureMethods();

    case 'capture:parameterSets':
      return session.getCaptureParameterSets();

    case 'capture:restartVideo':
      return session.restartVideo();

    case 'capture:reportRender': {
      const rawStats = (args[2] ?? {}) as { width?: unknown; height?: unknown; fps?: unknown };
      const stats = {
        width: rawStats.width === undefined ? undefined : Math.round(clampNumber(rawStats.width, 0, 16384)),
        height: rawStats.height === undefined ? undefined : Math.round(clampNumber(rawStats.height, 0, 16384)),
        fps: rawStats.fps === undefined ? undefined : clampNumber(rawStats.fps, 0, 240),
      };
      session.reportRender(
        clampNumber(args[0], 0, 60_000),
        Math.round(clampNumber(args[1], 0, 1_000_000)),
        stats,
      );
      return true;
    }

    case 'capture:setPaused':
      session.setCapturePaused(Boolean(args[0]));
      return true;

    case 'performance:apply':
      return session.applyProfile(args[0] as AppSettings['performanceProfile']['mode']);

    case 'performance:benchmark':
      return session.benchmark();

    case 'diagnostics:snapshot':
      return session.diagnostics();

    case 'diagnostics:ping':
      return session.ping();

    case 'diagnostics:adbShell':
      return session.adbShell(asString(args[0]));

    case 'diagnostics:export':
      return exportDiagnostics();

    case 'window:setFullscreen':
      mainWindow?.setFullScreen(Boolean(args[0]));
      return Boolean(mainWindow?.isFullScreen());

    case 'window:minimize':
      mainWindow?.minimize();
      return true;

    case 'window:close':
      mainWindow?.close();
      return true;

    case 'shell:openExternal': {
      const url = asString(args[0]);
      if (!/^https:\/\//i.test(url)) throw new Error('Only https links can be opened.');
      await shell.openExternal(url);
      return true;
    }

    default:
      throw new Error(`Unhandled channel: ${channel satisfies never}`);
  }
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string argument.');
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function applyLoginItem(settings: AppSettings): void {
  try {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: ['--minimized'] });
  } catch {
    /* login items are best-effort */
  }
}

function startPowerBlocker(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return;
  blockerId = powerSaveBlocker.start('prevent-display-sleep');
}

function stopPowerBlocker(): void {
  if (blockerId !== null) {
    try {
      if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
    } catch {
      /* already stopped */
    }
    blockerId = null;
  }
}

async function exportDiagnostics(): Promise<string | null> {
  const includeIps = session.getSettings().includeIpsInExports;
  const { filename, content } = session.buildExport(includeIps);
  const parent = mainWindow ?? undefined;
  const result = parent
    ? await dialog.showSaveDialog(parent, {
        title: 'Export diagnostics',
        defaultPath: path.join(app.getPath('documents'), filename),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
    : await dialog.showSaveDialog({
        title: 'Export diagnostics',
        defaultPath: path.join(app.getPath('documents'), filename),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, content, 'utf8');
  log.info('diagnostics', 'Diagnostics exported.', { file: path.basename(result.filePath), includeIps });
  return result.filePath;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.on('before-quit', () => {
  quitting = true;
  stopPowerBlocker();
  void frameServer?.stop();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
  else mainWindow.show();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitting = true;
    app.quit();
  }
});
