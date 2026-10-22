import type {
  AppEntry,
  AppError,
  AppInfo,
  AppSettings,
  CaptureMetrics,
  CaptureProbeReport,
  CaptureStartResult,
  CaptureStatus,
  Channel,
  CommandResult,
  ConnectionState,
  DiagnosticsSnapshot,
  DiscoveredDevice,
  DiscoverOptions,
  EventMap,
  NetworkQuality,
  PerformanceProfile,
  RemoteKey,
  ScanStatus,
  SessionStatus,
} from '@shared/types';

export class LumaError extends Error {
  readonly code: AppError['code'];
  readonly hint?: string;
  readonly detail?: string;
  readonly at: number;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'LumaError';
    this.code = error.code;
    this.hint = error.hint;
    this.detail = error.detail;
    this.at = error.at;
  }
}

async function call<T>(channel: Channel, ...args: unknown[]): Promise<T> {
  if (!window.luma) throw new LumaError({ code: 'INTERNAL', message: 'The application bridge is unavailable.', at: Date.now() });
  const result = await window.luma.invoke<T>(channel, ...args);
  if (!result.ok) throw new LumaError(result.error);
  return result.value;
}

export function onEvent<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): () => void {
  if (!window.luma) return () => undefined;
  return window.luma.on(event, listener);
}

export const api = {
  appInfo: () => call<AppInfo>('app:info'),

  getSettings: () => call<AppSettings>('settings:get'),
  setSettings: (partial: Partial<AppSettings>) => call<AppSettings>('settings:set', partial),
  resetSettings: () => call<AppSettings>('settings:reset'),

  listDevices: () => call<DiscoveredDevice[]>('devices:list'),
  scan: (options: DiscoverOptions = {}) => call<{ devices: DiscoveredDevice[]; status: ScanStatus }>('devices:scan', options),
  cancelScan: () => call<true>('devices:cancelScan'),
  addManual: (host: string, name?: string) => call<DiscoveredDevice>('devices:addManual', host, name),
  forget: (deviceId: string) => call<true>('devices:forget', deviceId),
  rename: (deviceId: string, name: string) => call<DiscoveredDevice | null>('devices:rename', deviceId, name),
  probe: (host: string) => call<{ devices: DiscoveredDevice[]; status: ScanStatus }>('devices:probe', host),

  status: () => call<SessionStatus>('connection:status'),
  connect: (deviceId: string) => call<ConnectionState>('connection:connect', deviceId),
  disconnect: () => call<SessionStatus>('connection:disconnect'),
  autoConnect: () => call<ConnectionState | null>('connection:autoConnect'),

  startPairing: (deviceId: string) => call<true>('pairing:start', deviceId),
  submitPairingCode: (code: string) => call<true>('pairing:submitCode', code),
  cancelPairing: () => call<true>('pairing:cancel'),

  key: (key: RemoteKey, action: 'tap' | 'down' | 'up' = 'tap') => call<CommandResult>('remote:key', key, action),
  tap: (x: number, y: number) => call<CommandResult>('remote:tap', x, y),
  text: (text: string) => call<CommandResult>('remote:text', text),
  launchApp: (packageName: string) => call<CommandResult>('remote:app', packageName),
  listApps: () => call<AppEntry[]>('remote:apps'),

  startCapture: (preference?: 'h264' | 'png') => call<CaptureStartResult>('capture:start', preference),
  stopCapture: () => call<CaptureMetrics>('capture:stop'),
  captureStatus: () => call<CaptureStatus>('capture:status'),
  probeCaptureMethods: () => call<CaptureProbeReport>('capture:probeMethods'),
  captureParameterSets: () =>
    call<{ data: string; bytes: number } | null>('capture:parameterSets'),
  restartVideo: () => call<boolean>('capture:restartVideo'),
  reportRender: (renderMs: number, dropped: number, stats?: { width?: number; height?: number; fps?: number }) =>
    call<true>('capture:reportRender', renderMs, dropped, stats),
  setCapturePaused: (paused: boolean) => call<true>('capture:setPaused', paused),

  applyProfile: (mode: PerformanceProfile['mode']) => call<AppSettings>('performance:apply', mode),
  benchmark: () => call<CaptureProbeReport>('performance:benchmark'),

  diagnostics: () => call<DiagnosticsSnapshot>('diagnostics:snapshot'),
  ping: () => call<NetworkQuality>('diagnostics:ping'),
  exportDiagnostics: () => call<string | null>('diagnostics:export'),

  setFullscreen: (fullscreen: boolean) => call<boolean>('window:setFullscreen', fullscreen),
  minimize: () => call<true>('window:minimize'),
  close: () => call<true>('window:close'),
  openExternal: (url: string) => call<true>('shell:openExternal', url),
};
