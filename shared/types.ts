/**
 * Shared domain types. Imported by the Electron main process, preload, renderer and tests.
 * Nothing in here performs I/O.
 */

export type CapabilityState = 'verified' | 'supported' | 'conditional' | 'unsupported' | 'unknown';

export interface Capability {
  state: CapabilityState;
  /** Human readable reason, always present for conditional/unsupported. */
  detail?: string;
  /** Where the fact came from: measured, declared by device, inferred from protocol. */
  source?: 'measured' | 'declared' | 'protocol' | 'user';
}

export interface Capabilities {
  remote: Capability;
  keyboardText: Capability;
  power: Capability;
  volume: Capability;
  mute: Capability;
  mediaTransport: Capability;
  channelKeys: Capability;
  appLaunch: Capability;
  appList: Capability;
  screenCapture: Capability;
  continuousStream: Capability;
  audioCapture: Capability;
  pointerInput: Capability;
  inputSelection: Capability;
  settingsKey: Capability;
  hardwareEncoding: Capability;
  adb: Capability;
  receiverInstall: Capability;
}

export type DeviceProtocol = 'atv-remote-v2' | 'atv-remote-v1' | 'adb' | 'cast' | 'roku-ecp' | 'upnp' | 'mock';

export interface DiscoveredDevice {
  /** Stable identity: hardware serial/fingerprint when known, otherwise a host-derived key. */
  id: string;
  name: string;
  model?: string;
  manufacturer?: string;
  firmware?: string;
  serial?: string;
  host: string;
  /** Addresses observed for this device, most recent first. */
  addresses: string[];
  protocols: DeviceProtocol[];
  capabilities: Capabilities;
  source: 'ssdp' | 'mdns' | 'probe' | 'manual' | 'saved' | 'mock';
  lastSeen: number;
  /** True when the device answered an authenticated protocol probe. */
  reachable: boolean;
  /** True when the app has completed pairing (ATV) or ADB authorisation. */
  trusted: boolean;
  /** Loopback mock devices are labelled in the UI and never presented as real hardware. */
  simulated?: boolean;
  notes?: string[];
}

export type ConnectionPhase =
  | 'idle'
  | 'discovering'
  | 'pairing'
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface ConnectionState {
  phase: ConnectionPhase;
  deviceId: string | null;
  /** Which transports are live for the active device. */
  remoteTransport: 'atv-v2' | 'roku' | 'adb' | 'none';
  captureTransport: 'adb-h264' | 'adb-png' | 'none';
  since: number;
  error: AppError | null;
  reconnectAttempt: number;
  nextRetryAt: number | null;
}

export type ErrorCode =
  | 'TV_NOT_FOUND'
  | 'UNREACHABLE'
  | 'PAIRING_REQUIRED'
  | 'PAIRING_REJECTED'
  | 'PAIRING_TIMEOUT'
  | 'CERT_REJECTED'
  | 'REMOTE_UNAVAILABLE'
  | 'ADB_NOT_ENABLED'
  | 'ADB_UNAUTHORIZED'
  | 'ADB_NOT_INSTALLED'
  | 'CAPTURE_UNSUPPORTED'
  | 'CAPTURE_TIMEOUT'
  | 'PROTECTED_CONTENT'
  | 'TV_OVERLOADED'
  | 'NETWORK_BLOCKED'
  | 'NETWORK_LOST'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_COMMAND'
  | 'INTERNAL';

export interface AppError {
  code: ErrorCode;
  message: string;
  /** Actionable next step shown in the UI. */
  hint?: string;
  detail?: string;
  at: number;
}

export type RemoteKey =
  | 'power'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'select'
  | 'back'
  | 'home'
  | 'menu'
  | 'settings'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'playPause'
  | 'rewind'
  | 'fastForward'
  | 'next'
  | 'previous'
  | 'channelUp'
  | 'channelDown'
  | 'input'
  | 'info'
  | 'guide'
  | 'backspace'
  | 'sleep'
  | 'wake';

export interface KeyPressOptions {
  /** Long press start/end, when supported by the active transport. */
  action?: 'tap' | 'down' | 'up';
}

export interface CommandResult {
  ok: boolean;
  /** Round-trip time in milliseconds measured for this command. */
  rttMs?: number;
  transport: 'atv-v2' | 'roku' | 'adb' | 'mock';
  error?: AppError;
  /** Set when the command was delivered but the TV may not act on it (e.g. power over ADB). */
  note?: string;
}

export interface DiscoverOptions {
  /** Milliseconds for the whole scan. */
  timeoutMs?: number;
  /** Include an active TCP sweep of the local /24. */
  activeProbe?: boolean;
  /** Optional extra hosts (manual entry) to probe as part of this scan. */
  hosts?: string[];
}

export interface ScanStatus {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  /** Number of hosts probed in the active sweep. */
  hostsProbed: number;
  hostsTotal: number;
  localAddress: string | null;
  subnet: string | null;
  methods: string[];
  errors: string[];
}

export interface PairingPrompt {
  deviceId: string;
  deviceName: string;
  kind: 'atv' | 'adb';
  /** Six hex characters for ATV, or ADB RSA fingerprint for adb. */
  codeLength: number;
  instructions: string;
  startedAt: number;
  /** ADB only: the public key the TV must show. */
  fingerprint?: string;
}

export interface CaptureMetrics {
  /** Frames delivered to the renderer per second (rolling). */
  fps: number;
  /** Frames captured but dropped because a newer one existed. */
  dropped: number;
  /** Capture phase on the TV in ms. */
  captureMs: number;
  /** Transfer phase ms. */
  transferMs: number;
  /** Decode + paint in the renderer, reported back. */
  renderMs: number;
  /** Estimated end-to-end glass-to-glass, null when it cannot be measured. */
  e2eMs: number | null;
  width: number;
  height: number;
  /** Encoded frame size in bytes. */
  bytes: number;
  /** Measured approximate bitrate in kbit/s. */
  kbps: number;
  transport: 'adb-png' | 'adb-h264' | 'none';
  /** True when the transport is a real continuous video stream. */
  continuous: boolean;
  /** Time the frame was captured on the laptop (ms epoch). */
  updatedAt: number;
}

export interface CaptureStartResult {
  transport: 'adb-png' | 'adb-h264';
  detail: string;
}

export interface CaptureProbeReport {
  adb: 'authorized' | 'unauthorized' | 'unavailable';
  screenshot: {
    supported: boolean;
    captureMs: number;
    transferMs: number;
    width: number;
    height: number;
    bytes: number;
    detail: string;
  };
  continuous: { supported: boolean; detail: string };
  recommendation: 'h264' | 'png' | 'none';
}

export interface CaptureStatus {
  running: boolean;
  transport: 'adb-png' | 'adb-h264' | 'none';
  metrics: CaptureMetrics;
  /** Tokenised loopback URL for the newest PNG frame, or '' if unavailable. */
  frameUrl: string;
}

export interface AppEntry {
  packageName: string;
  label: string;
  thirdParty: boolean;
}

export interface SessionStatus {
  connection: ConnectionState;
  devices: DiscoveredDevice[];
  metrics: CaptureMetrics;
  prompt: PairingPrompt | null;
  scan: ScanStatus;
}

export interface StreamFrameInfo {
  seq: number;
  width: number;
  height: number;
  /** ms epoch when the capture request was sent. */
  requestedAt: number;
  /** ms epoch when the first byte of the image arrived. */
  firstByteAt: number;
  /** ms epoch when the full frame arrived. */
  completedAt: number;
  /** On-device capture duration measured in ms, null if unavailable. */
  deviceCaptureMs: number | null;
  bytes: number;
  /** HTTP url the renderer can fetch the newest frame from. */
  url: string;
}

export interface PerformanceProfile {
  mode: 'lite' | 'balanced' | 'performance' | 'auto';
  captureFps: number;
  maxWidth: number;
  preferContinuous: boolean;
  adaptive: boolean;
}

export interface NetworkQuality {
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPct: number | null;
  linkMbps: number | null;
  /** Wi-Fi signal quality when the OS exposes it (Windows: 0-100). */
  wifiSignal: number | null;
  ssid: string | null;
  /** Loopback only; no external probing. */
  internetNotRequired: true;
}

export interface DiagnosticsSnapshot {
  generatedAt: number;
  app: { version: string; electron: string; chrome: string; node: string; platform: string; arch: string };
  localNetwork: { addresses: string[]; subnet: string | null; interfaces: Array<{ name: string; address: string; mac: string | null }> };
  scan: ScanStatus;
  device: DiscoveredDevice | null;
  capabilities: Capabilities | null;
  connection: ConnectionState;
  capture: CaptureMetrics;
  remote: { transport: string; keyRttMs: number | null; lastError: string | null; commandsSent: number };
  adb: { present: boolean; authorized: boolean; model: string | null; androidVersion: string | null; sdk: number | null; error: string | null };
  network: NetworkQuality;
  checks: DiagnosticCheck[];
  log: LogEntry[];
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail: string;
  hint?: string;
}

export interface LogEntry {
  at: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  accent: 'amber' | 'azure' | 'violet' | 'emerald';
  performanceProfile: PerformanceProfile;
  preferredCapture: 'auto' | 'h264' | 'png';
  scanOnStartup: boolean;
  activeProbeOnStartup: boolean;
  launchAtLogin: boolean;
  minimizeToTray: boolean;
  includeIpsInExports: boolean;
  autoReconnect: boolean;
  confirmPowerOff: boolean;
  keyboard: KeyboardMap;
  shortcuts: { toggleRemote: string; toggleFullscreen: string };
  lastDeviceId: string | null;
  favoriteApps: string[];
}

export interface KeyboardMap {
  up: string;
  down: string;
  left: string;
  right: string;
  select: string;
  back: string;
  home: string;
  menu: string;
  volumeUp: string;
  volumeDown: string;
  mute: string;
  playPause: string;
  power: string;
}

export interface StoredDevice extends DiscoveredDevice {
  savedAt: number;
  /** Pinned TLS certificate fingerprint (SHA-256, hex). */
  certFingerprint?: string;
  adbKeyRegistered?: boolean;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  adbPath: string | null;
  mockServerSupported: boolean;
  userDataPath: string;
  security: {
    /** True when pairing keys can be encrypted at rest by the OS. */
    vaultPersisted: boolean;
    warning: string | null;
  };
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export type EventMap = {
  'scan:status': ScanStatus;
  'devices:changed': DiscoveredDevice[];
  'connection:changed': ConnectionState;
  'pairing:prompt': PairingPrompt | null;
  'frame:meta': StreamFrameInfo;
  'video:chunk': { seq: number; chunk: Uint8Array };
  'video:reset': { reason: string };
  'metrics:changed': CaptureMetrics;
  'diagnostics:changed': DiagnosticsSnapshot;
  'log:entry': LogEntry;
  'toast': { kind: 'info' | 'success' | 'warn' | 'error'; title: string; message?: string };
};

export type Channel =
  | 'app:info'
  | 'settings:get'
  | 'settings:set'
  | 'settings:reset'
  | 'devices:list'
  | 'devices:scan'
  | 'devices:cancelScan'
  | 'devices:addManual'
  | 'devices:forget'
  | 'devices:rename'
  | 'devices:probe'
  | 'connection:connect'
  | 'connection:disconnect'
  | 'connection:status'
  | 'connection:autoConnect'
  | 'pairing:start'
  | 'pairing:submitCode'
  | 'pairing:cancel'
  | 'remote:key'
  | 'remote:tap'
  | 'remote:text'
  | 'remote:app'
  | 'remote:apps'
  | 'capture:start'
  | 'capture:stop'
  | 'capture:status'
  | 'capture:probeMethods'
  | 'capture:parameterSets'
  | 'capture:restartVideo'
  | 'capture:reportRender'
  | 'capture:setPaused'
  | 'performance:apply'
  | 'performance:benchmark'
  | 'diagnostics:snapshot'
  | 'diagnostics:export'
  | 'diagnostics:ping'
  | 'diagnostics:adbShell'
  | 'window:setFullscreen'
  | 'window:minimize'
  | 'window:close'
  | 'shell:openExternal';
