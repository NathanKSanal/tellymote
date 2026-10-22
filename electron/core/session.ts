import net from 'node:net';
import type {
  AppError,
  AppEntry,
  AppInfo,
  AppSettings,
  CaptureMetrics,
  CaptureProbeReport,
  CaptureStartResult,
  CaptureStatus,
  CommandResult,
  ConnectionState,
  DiagnosticCheck,
  DiagnosticsSnapshot,
  DiscoveredDevice,
  DiscoverOptions,
  EventMap,
  NetworkQuality,
  PairingPrompt,
  PerformanceProfile,
  RemoteKey,
  ScanStatus,
  SessionStatus,
  StoredDevice,
} from '../../shared/types';
import { appError, toAppError, type AppError as AppErrorType } from './errors';
import { AppLog } from './log';
import { SettingsStore, PROFILE_PRESETS } from './settings';
import { DeviceRegistry } from './registry/devices';
import { SecretVault } from './security/vault';
import {
  generateAdbIdentity,
  generateClientCertificate,
  readPlatformAdbIdentity,
  type AdbIdentity,
  type ClientCertificate,
} from './security/identity';
import { DiscoveryService } from './discovery/discovery';
import { primarySubnet, readWifiInfo } from './discovery/network';
import { PORT_ADB, PORT_ATV_REMOTE, PORT_ROKU } from './discovery/discovery';
import { AtvRemoteClient } from './remote/atv/client';
import { AtvPairingSession } from './remote/atv/pairing';
import { RokuClient } from './remote/roku/client';
import { ATV_PAIRING_PORT } from './remote/atv/messages';
import { KEY_CODES } from './remote/atv/messages';
import { AdbClient } from './remote/adb/client';
import { shellQuote } from './remote/adb/protocol';
import { CaptureService } from './capture/service';
import { isCompletePng, parsePngSize } from './capture/png';
import type { FrameServer } from './streaming/frameServer';
import { withRemoteSupport } from '../../shared/capabilities';

export interface SessionDeps {
  directory: string;
  vault: SecretVault;
  settings: SettingsStore;
  registry: DeviceRegistry;
  log: AppLog;
  frameServer: FrameServer;
  appInfo: AppInfo;
  emit: <K extends keyof EventMap>(channel: K, payload: EventMap[K]) => void;
}

const KNOWN_APPS: Record<string, string> = {
  'com.netflix.ninja': 'Netflix',
  'com.google.android.youtube.tv': 'YouTube',
  'com.amazon.amazonvideo.livingroom': 'Prime Video',
  'com.disney.disneyplus': 'Disney+',
  'com.hotstar.android.tvapp': 'Hotstar',
  'com.spotify.tv.android': 'Spotify',
  'com.google.android.tvlauncher': 'Android TV Home',
  'com.android.vending': 'Google Play Store',
  'com.xiaomi.tv.patchwall': 'PatchWall',
  'com.mitv.tvhome': 'Mi TV Home',
  'com.xiaomi.mitv.tvplayer': 'Mi TV Player',
  'com.google.android.apps.tv.launcherx': 'Google TV Home',
  'com.google.android.videos': 'Google TV',
  'org.videolan.vlc': 'VLC',
  'com.plexapp.android': 'Plex',
  'com.valvesoftware.steamlink': 'Steam Link',
  'com.nvidia.tegrazone': 'GeForce NOW',
  'com.zattoo.player': 'Zattoo',
  'tv.twitch.android.app': 'Twitch',
  'com.google.android.youtube.tvmusic': 'YouTube Music',
};

const CURATED_SYSTEM_APPS = [
  'com.netflix.ninja',
  'com.google.android.youtube.tv',
  'com.amazon.amazonvideo.livingroom',
  'com.disney.disneyplus',
  'com.spotify.tv.android',
  'com.google.android.videos',
  'com.xiaomi.tv.patchwall',
  'com.mitv.tvhome',
  'com.xiaomi.mitv.tvplayer',
];

const IDLE_STATE: ConnectionState = {
  phase: 'idle',
  deviceId: null,
  remoteTransport: 'none',
  captureTransport: 'none',
  since: Date.now(),
  error: null,
  reconnectAttempt: 0,
  nextRetryAt: null,
};

export class LumaSession {
  readonly discovery: DiscoveryService;
  private devices: DiscoveredDevice[] = [];
  private connection: ConnectionState = { ...IDLE_STATE };
  private activeDeviceId: string | null = null;
  private atv: AtvRemoteClient | null = null;
  private adb: AdbClient | null = null;
  private roku: RokuClient | null = null;
  private pairing: AtvPairingSession | null = null;
  private pairingPrompt: PairingPrompt | null = null;
  private capture: CaptureService;
  private cert: ClientCertificate | null = null;
  private adbIdentity: AdbIdentity | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private rttSamples: number[] = [];
  private lastAdbProps: { model: string; manufacturer: string; version: string; sdk: number | null; serial: string } | null = null;
  private lastCaptureProbe: CaptureProbeReport | null = null;
  private captureDetail = '';
  private diagnosticsCache: { at: number; snapshot: DiagnosticsSnapshot } | null = null;
  private metrics: CaptureMetrics;

  constructor(private readonly deps: SessionDeps) {
    this.metrics = emptyMetrics();
    this.discovery = new DiscoveryService(
      {},
      (status) => {
        this.deps.emit('scan:status', status);
        this.pushDiagnostics();
      },
    );
    this.capture = new CaptureService({
      onTransport: (transport, detail) => {
        this.captureDetail = detail;
        this.connection = { ...this.connection, captureTransport: transport };
        const device = this.activeDevice();
        if (device && transport === 'adb-h264') {
          this.markCapability(device, 'continuousStream', 'verified', 'Live H.264 data is arriving from screenrecord.');
          this.markCapability(device, 'screenCapture', 'verified', 'Live H.264 video is streaming from the TV.');
        }
        this.emitConnection();
        this.deps.emit('toast', { kind: 'info', title: 'Capture transport', message: detail });
        this.pushDiagnostics();
      },
      onMetrics: (metrics) => {
        this.metrics = metrics;
        this.deps.emit('metrics:changed', metrics);
      },
      onError: (error) => {
        this.captureDetail = error.message;
        this.connection = { ...this.connection, captureTransport: 'none' };
        this.emitConnection();
        this.deps.log.error('capture', error.message, { code: error.code, detail: error.detail });
        this.deps.emit('toast', { kind: 'error', title: 'Screen viewing stopped', message: error.message });
        this.pushDiagnostics();
      },
      onVideoChunk: (chunk, seq) => {
        this.deps.emit('video:chunk', { seq, chunk: new Uint8Array(chunk) });
      },
      onVideoRestart: () => {
        this.deps.emit('video:reset', { reason: 'The encoder stream ended; restarting.' });
      },
      onPublish: (frame) => {
        const device = this.activeDevice();
        if (device && device.capabilities.screenCapture.state !== 'verified') {
          this.markCapability(
            device,
            'screenCapture',
            'verified',
            `Live PNG frame ${frame.width}×${frame.height} received from the TV.`,
          );
        }
        this.deps.frameServer.publish(frame);
        this.deps.emit('frame:meta', {
          seq: frame.seq,
          width: frame.width,
          height: frame.height,
          requestedAt: frame.requestedAt,
          firstByteAt: frame.firstByteAt,
          completedAt: frame.completedAt,
          deviceCaptureMs: frame.deviceCaptureMs,
          bytes: frame.png.length,
          url: this.frameUrl,
        });
      },
    });
    this.capture.setAdb(null);
  }

  // ---------------------------------------------------------------- lifecycle

  async init(): Promise<void> {
    this.devices = this.deps.registry.list().map((device) => ({ ...device, reachable: false, source: 'saved' }));
  }

  get frameUrl(): string {
    const base = this.deps.frameServer.baseUrl;
    const token = this.deps.frameServer.accessToken;
    if (!base || !token) return '';
    return `${base}/frame?token=${token}`;
  }

  get appInfo(): AppInfo {
    return this.deps.appInfo;
  }

  getStatus(): SessionStatus {
    return {
      connection: this.connection,
      devices: this.devices,
      metrics: this.metrics,
      prompt: this.pairingPrompt,
      scan: this.discovery.getStatus(),
    };
  }

  getCaptureStatus(): CaptureStatus {
    return {
      running: this.capture.isRunning(),
      transport: this.connection.captureTransport,
      metrics: this.capture.getMetrics(),
      frameUrl: this.frameUrl,
    };
  }

  private emitConnection(): void {
    this.connection = { ...this.connection, since: this.connection.since || Date.now() };
    this.deps.emit('connection:changed', this.connection);
  }

  private setPhase(phase: ConnectionState['phase'], patch: Partial<ConnectionState> = {}): void {
    this.connection = {
      ...this.connection,
      ...patch,
      phase,
      since: this.connection.phase === phase ? this.connection.since : Date.now(),
    };
    this.emitConnection();
    this.pushDiagnostics();
  }

  async autoConnect(): Promise<ConnectionState | null> {
    const settings = this.deps.settings.get();
    if (!settings.autoReconnect || !settings.lastDeviceId) return null;
    const device = this.devices.find((d) => d.id === settings.lastDeviceId) ?? this.deps.registry.find({ id: settings.lastDeviceId });
    if (!device) return null;
    try {
      return await this.connect(device.id, { autoPair: false, isReconnect: true });
    } catch (err) {
      const mapped = toAppError(err);
      this.deps.log.info('connection', 'Automatic reconnect did not complete.', { code: mapped.code });
      return this.connection;
    }
  }

  // ---------------------------------------------------------------- settings

  getSettings(): AppSettings {
    return this.deps.settings.get();
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    const settings = this.deps.settings.update(partial);
    if (partial.performanceProfile && this.capture.isRunning()) {
      void this.startCapture().catch(() => undefined);
    }
    this.pushDiagnostics();
    return settings;
  }

  resetSettings(): AppSettings {
    const settings = this.deps.settings.reset();
    this.pushDiagnostics();
    return settings;
  }

  // ---------------------------------------------------------------- discovery

  getDevices(): DiscoveredDevice[] {
    return this.devices;
  }

  async scan(options: DiscoverOptions = {}): Promise<{ devices: DiscoveredDevice[]; status: ScanStatus }> {
    const saved = this.deps.registry.list().map((device) => ({ ...device, reachable: false }));
    const outcome = await this.discovery.scan({ ...options, savedDevices: saved });
    const merged = outcome.devices.map((device) => {
      const existing = this.devices.find((d) => d.id === device.id);
      return existing && existing.id === this.connection.deviceId
        ? { ...device, trusted: existing.trusted, reachable: existing.reachable || device.reachable }
        : device;
    });
    // Preserve manually added devices that were not part of this scan.
    for (const device of this.devices) {
      if (device.source === 'manual' && !merged.some((d) => d.id === device.id || d.host === device.host)) {
        merged.push(device);
      }
    }
    this.devices = merged;
    for (const device of merged) {
      if (device.source !== 'mock') this.deps.registry.upsert(device);
    }
    this.deps.emit('devices:changed', this.devices);
    this.pushDiagnostics();
    return { devices: this.devices, status: outcome.status };
  }

  cancelScan(): void {
    this.discovery.cancel();
  }

  async addManual(hostInput: string, name?: string): Promise<DiscoveredDevice> {
    const host = hostInput.trim();
    if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host)) {
      throw appError('INVALID_INPUT', 'Enter an IPv4 address such as 192.168.0.42, or a hostname.');
    }
    const resolved = net.isIPv4(host) ? host : await this.resolveHost(host);
    if (!resolved) throw appError('TV_NOT_FOUND', `Could not resolve ${host} on this network.`);
    const { probeHost } = await import('./discovery/probe');
    const probe = await probeHost(resolved, [PORT_ATV_REMOTE, ATV_PAIRING_PORT, PORT_ADB, PORT_ROKU], 900);
    const protocols: DiscoveredDevice['protocols'] = [];
    if (probe.open.includes(PORT_ATV_REMOTE) || probe.open.includes(ATV_PAIRING_PORT)) protocols.push('atv-remote-v2');
    if (probe.open.includes(PORT_ADB)) protocols.push('adb');
    if (probe.open.includes(PORT_ROKU)) protocols.push('roku-ecp');
    const device: DiscoveredDevice = {
      id: `host:${resolved}`,
      name: name?.trim() || `TV at ${resolved}`,
      host: resolved,
      addresses: [resolved],
      protocols,
      capabilities: withRemoteSupport(
        (await import('../../shared/capabilities')).unknownCapabilities(),
        probe.open.includes(PORT_ATV_REMOTE) || probe.open.includes(ATV_PAIRING_PORT),
        probe.open.includes(PORT_ADB),
        false,
        probe.open.includes(PORT_ROKU),
      ),
      source: 'manual',
      lastSeen: Date.now(),
      reachable: probe.open.length > 0,
      trusted: false,
      notes: probe.open.length === 0 ? ['No supported control port answered at this address.'] : undefined,
    };
    const existing = this.devices.find((d) => d.host === resolved);
    if (existing) device.id = existing.id;
    this.devices = [...this.devices.filter((d) => d.host !== resolved && d.id !== device.id), device];
    this.deps.registry.upsert(device);
    this.deps.emit('devices:changed', this.devices);
    return device;
  }

  private async resolveHost(host: string): Promise<string | null> {
    try {
      const dns = await import('node:dns/promises');
      const result = await dns.lookup(host, { family: 4 });
      return result.address;
    } catch {
      return null;
    }
  }

  forget(deviceId: string): void {
    if (this.connection.deviceId === deviceId) this.disconnect();
    this.deps.registry.remove(deviceId);
    this.deps.vault.delete(`pin:${deviceId}`);
    this.devices = this.devices.filter((d) => d.id !== deviceId);
    this.deps.emit('devices:changed', this.devices);
    this.deps.emit('toast', { kind: 'info', title: 'Device forgotten', message: 'Saved pairing information was removed.' });
    this.pushDiagnostics();
  }

  rename(deviceId: string, name: string): DiscoveredDevice | null {
    const stored = this.deps.registry.rename(deviceId, name);
    if (!stored) return null;
    this.devices = this.devices.map((device) => (device.id === deviceId ? { ...device, name: stored.name } : device));
    this.deps.emit('devices:changed', this.devices);
    return this.devices.find((d) => d.id === deviceId) ?? null;
  }

  // ---------------------------------------------------------------- identity

  private ensureCertificate(): ClientCertificate {
    if (this.cert) return this.cert;
    const stored = this.deps.vault.getJson<ClientCertificate>('atv-client-cert');
    if (stored?.certPem && stored.keyPem) {
      this.cert = stored;
      return stored;
    }
    const created = generateClientCertificate();
    this.deps.vault.setJson('atv-client-cert', created);
    this.deps.log.info('security', 'Generated a new pairing certificate.', { fingerprint: created.fingerprint.slice(0, 16) });
    this.cert = created;
    return created;
  }

  private ensureAdbIdentity(): AdbIdentity {
    if (this.adbIdentity) return this.adbIdentity;

    // Prefer the standard Android key. The TV authorises it once and then
    // reuses that trust for every tool, so TellyMote stops triggering a new
    // "Allow USB debugging?" dialog on each connection.
    const platform = readPlatformAdbIdentity();
    if (platform) {
      const stored = this.deps.vault.getJson<AdbIdentity>('adb-identity');
      if (!stored || stored.publicKeyBlob !== platform.publicKeyBlob) {
        this.deps.vault.setJson('adb-identity', platform);
        this.deps.log.info('security', 'Using the existing Android ADB key from the user profile.');
      }
      this.adbIdentity = platform;
      return platform;
    }

    const stored = this.deps.vault.getJson<AdbIdentity>('adb-identity');
    if (stored?.privateKeyPem && stored.publicKey) {
      this.adbIdentity = stored;
      return stored;
    }
    const created = generateAdbIdentity();
    this.deps.vault.setJson('adb-identity', created);
    this.deps.log.info('security', 'Generated a new ADB key.');
    this.adbIdentity = created;
    return created;
  }

  // ---------------------------------------------------------------- connect

  private findDevice(deviceId: string): DiscoveredDevice {
    const device = this.devices.find((d) => d.id === deviceId) ?? this.deps.registry.find({ id: deviceId });
    if (!device) throw appError('TV_NOT_FOUND', 'That device is no longer in the device list. Scan again.');
    return device;
  }

  async connect(deviceId: string, options: { isReconnect?: boolean; autoPair?: boolean } = {}): Promise<ConnectionState> {
    const device = this.findDevice(deviceId);
    this.clearReconnectTimer();
    await this.closeTransports();
    this.activeDeviceId = device.id;
    this.intentionalClose = false;
    this.rttSamples = [];
    this.setPhase('connecting', {
      deviceId: device.id,
      remoteTransport: 'none',
      captureTransport: 'none',
      error: null,
      reconnectAttempt: this.reconnectAttempt,
    });

    const atvOutcome = await this.tryRemote(device, options.autoPair !== false);
    if (atvOutcome === 'pairing') return this.connection;

    let adbOk = false;
    if (device.protocols.includes('adb') || (atvOutcome === 'unavailable' && !device.protocols.includes('roku-ecp'))) {
      adbOk = await this.tryAdb(device);
    }

    let rokuOk = false;
    if (atvOutcome !== 'connected' && !adbOk && device.protocols.includes('roku-ecp')) {
      rokuOk = await this.tryRoku(device);
    }

    if (atvOutcome !== 'connected' && !adbOk && !rokuOk) {
      const error = this.connection.error ?? appError('REMOTE_UNAVAILABLE', 'No supported control protocol accepted the connection.');
      this.setPhase('error', { error });
      throw error;
    }

    await this.afterTransportsReady(device, adbOk);
    return this.connection;
  }

  private async tryRemote(device: DiscoveredDevice, autoPair: boolean): Promise<'connected' | 'pairing' | 'unavailable'> {
    if (!device.reachable && !device.protocols.includes('atv-remote-v2') && !device.simulated) {
      // Still attempt: discovery may have missed the port while the TV was waking.
    }
    const cert = this.ensureCertificate();
    const client = new AtvRemoteClient(device.host, cert);
    try {
      const info = await client.connect();
      const pinned = this.deps.vault.get(`pin:${device.id}`);
      if (pinned && client.peerFingerprint && pinned !== client.peerFingerprint) {
        client.close();
        throw appError(
          'CERT_REJECTED',
          'The TV presented a different security certificate than the one saved.',
          `Expected ${pinned.slice(0, 17)}…, received ${client.peerFingerprint.slice(0, 17)}….`,
          'If you reset or updated the TV, forget this device and pair again.',
        );
      }
      if (!pinned && client.peerFingerprint) this.deps.vault.set(`pin:${device.id}`, client.peerFingerprint);
      this.atv = client;
      this.attachRemoteEvents(client, device);
      if (info.model) this.updateDeviceModel(device, info.model, info.vendor);
      const features = client.features.toString(16).padStart(3, '0');
      this.markCapability(device, 'remote', 'verified', `Remote service session active (feature mask 0x${features}).`);
      this.markCapability(device, 'volume', 'verified', 'Volume keys are part of the negotiated feature set.');
      this.markCapability(device, 'mediaTransport', 'verified', 'Media key codes are part of the negotiated feature set.');
      this.connection = { ...this.connection, remoteTransport: 'atv-v2' };
      this.deps.log.info('remote', 'Android TV remote session established.', { model: info.model ?? 'unknown' });
      return 'connected';
    } catch (err) {
      client.close();
      const mapped = toAppError(err);
      if (mapped.code === 'CERT_REJECTED') {
        if (!autoPair) {
          this.setPhase('pairing', { error: appError('PAIRING_REQUIRED', 'This laptop is not paired with the TV.') });
          return 'pairing';
        }
        await this.beginPairing(device);
        return 'pairing';
      }
      this.deps.log.warn('remote', 'Android TV remote service unavailable.', { code: mapped.code, detail: mapped.detail });
      this.connection = { ...this.connection, error: mapped };
      return 'unavailable';
    }
  }

  private attachRemoteEvents(client: AtvRemoteClient, device: DiscoveredDevice): void {
    client.on('rtt', (rtt: number) => {
      this.rttSamples.push(rtt);
      if (this.rttSamples.length > 6) this.rttSamples.shift();
      this.pushDiagnostics();
    });
    client.on('degraded', (failures: number) => {
      this.deps.log.warn('remote', `Remote service missed ${failures} pings.`);
      if (this.connection.phase === 'connected') this.setPhase('degraded');
      this.pushDiagnostics();
    });
    client.on('protocol-error', (message: string) => {
      // Informational: the TV declined an optional message but the session is
      // still alive. Never treat this as a disconnect.
      this.deps.log.warn('remote', `The TV rejected an optional remote message: ${message}`);
      this.pushDiagnostics();
    });
    client.on('disconnected', () => {
      if (this.intentionalClose) return;
      this.deps.log.warn('remote', 'Remote service connection closed.');
      this.setPhase('disconnected', { remoteTransport: 'none', error: appError('NETWORK_LOST', 'The TV closed the remote connection.') });
      this.scheduleReconnect(device);
    });
  }

  private async tryAdb(device: DiscoveredDevice): Promise<boolean> {
    try {
      const adb = await this.connectAdb(device);
      return Boolean(adb);
    } catch (err) {
      const mapped = toAppError(err);
      this.deps.log.warn('adb', 'ADB connection failed.', { code: mapped.code, detail: mapped.detail });
      if (this.connection.phase === 'connecting') this.connection = { ...this.connection, error: mapped };
      this.markCapability(device, 'adb', 'conditional', mapped.message);
      return false;
    }
  }

  private async tryRoku(device: DiscoveredDevice): Promise<boolean> {
    try {
      const client = new RokuClient(device.host);
      const info = await client.deviceInfo();
      const apps = await client.apps();
      this.roku = client;
      if (info.model) this.updateDeviceModel(device, info.model, 'Roku');
      this.markCapability(device, 'remote', 'verified', `Roku ECP session active${info.name ? ` (${info.name})` : ''}.`);
      this.markCapability(device, 'appList', 'verified', `Roku returned ${apps.length} app(s).`);
      this.markCapability(device, 'appLaunch', 'conditional', 'Roku /launch endpoint is available for listed apps.');
      this.markCapability(device, 'screenCapture', 'unsupported', 'Roku ECP exposes no screen capture.');
      this.connection = { ...this.connection, remoteTransport: 'roku', error: null };
      this.deps.log.info('remote', 'Roku ECP session established.', { model: info.model ?? 'unknown', apps: apps.length });
      return true;
    } catch (err) {
      this.deps.log.warn('remote', 'Roku ECP unavailable.', { detail: (err as Error).message });
      return false;
    }
  }

  private async connectAdb(device: DiscoveredDevice): Promise<AdbClient | null> {
    const identity = this.ensureAdbIdentity();
    this.deps.log.info('adb', 'Connecting to the TV debugging service.', { host: device.host });
    const adb = await AdbClient.connect(device.host, identity, {
      timeoutMs: 5200,
      authTimeoutMs: 120_000,
      onAuthorizing: (fingerprint) => {
        this.pairingPrompt = {
          deviceId: device.id,
          deviceName: device.name,
          kind: 'adb',
          codeLength: 0,
          instructions: 'A debugging prompt is showing on the TV. Select “Allow” (and tick “Always allow”).',
          startedAt: Date.now(),
          fingerprint,
        };
        this.deps.emit('pairing:prompt', this.pairingPrompt);
      },
    });
    this.adb = adb;
    this.capture.setAdb(adb);
    this.pairingPrompt = null;
    this.deps.emit('pairing:prompt', null);
    device.protocols = [...new Set([...device.protocols, 'adb' as const])];
    this.markCapability(device, 'adb', 'verified', 'ADB connection authorised.');
    this.connection = { ...this.connection, remoteTransport: this.connection.remoteTransport === 'none' ? 'adb' : this.connection.remoteTransport };
    try {
      const props = await adb.readProperties();
      this.lastAdbProps = {
        model: props.model,
        manufacturer: props.manufacturer,
        version: props.androidVersion,
        sdk: props.sdk,
        serial: props.serial,
      };
      this.updateDeviceModel(device, props.model, props.manufacturer);
      device.firmware = props.build || device.firmware;
      device.serial = props.serial || device.serial;
      this.deps.log.info('adb', 'ADB device properties read.', {
        model: props.model,
        android: props.androidVersion,
        sdk: props.sdk,
        resolution: props.displayResolution ?? 'unknown',
      });
    } catch (err) {
      this.deps.log.warn('adb', 'Could not read device properties.', { detail: (err as Error).message });
    }
    return adb;
  }

  private updateDeviceModel(device: DiscoveredDevice, model: string, manufacturer?: string): void {
    const patch: Partial<DiscoveredDevice> = {};
    if (model && (!device.model || device.model === 'Android TV')) patch.model = model;
    if (manufacturer && !device.manufacturer) patch.manufacturer = manufacturer;
    if (Object.keys(patch).length === 0) return;
    Object.assign(device, patch);
    this.devices = this.devices.map((d) => (d.id === device.id ? { ...d, ...patch } : d));
    this.deps.registry.upsert({ ...device, ...patch });
    this.deps.emit('devices:changed', this.devices);
  }

  private async afterTransportsReady(device: DiscoveredDevice, adbOk: boolean): Promise<void> {
    this.reconnectAttempt = 0;
    if (adbOk) {
      // ADB is a working remote fallback, so the native-remote failure is a
      // note rather than an error state.
      if (this.connection.remoteTransport === 'adb' && this.connection.error) {
        this.connection = { ...this.connection, error: null };
      }
      // Do not run a blocking screencap before the user sees anything. On
      // slow TVs that single probe can take 13+ s and wedge adbd. Start the
      // live path directly; the first real frame proves capture works.
      this.markCapability(device, 'screenCapture', 'conditional', 'ADB is authorised; waiting for the first live frame.');
      try {
        const result = await this.startCapture();
        this.deps.log.info('capture', 'Capture started.', { transport: result.transport });
      } catch (err) {
        const mapped = toAppError(err);
        this.deps.log.warn('capture', 'Capture could not start.', { code: mapped.code, detail: mapped.detail });
        this.connection = { ...this.connection, error: mapped };
      }
    }
    const deviceWithTrust = this.devices.find((d) => d.id === device.id) ?? device;
    deviceWithTrust.trusted = true;
    this.deps.registry.upsert({ ...deviceWithTrust, trusted: true });
    this.devices = this.devices.map((d) => (d.id === device.id ? { ...d, trusted: true } : d));
    this.deps.emit('devices:changed', this.devices);
    this.deps.settings.update({ lastDeviceId: device.id });
    this.setPhase(this.connection.error ? 'degraded' : 'connected', { error: this.connection.error ?? null, reconnectAttempt: 0, nextRetryAt: null });
  }

  // ---------------------------------------------------------------- pairing

  async beginPairing(device: DiscoveredDevice): Promise<void> {
    const cert = this.ensureCertificate();
    this.pairing?.cancel();
    const session = new AtvPairingSession(device.host, cert, 'TellyMote', ATV_PAIRING_PORT);
    this.pairing = session;
    this.setPhase('pairing');
    this.deps.log.info('pairing', 'Pairing request sent to the TV.', { host: device.host });

    session.once('code-required', () => {
      this.pairingPrompt = {
        deviceId: device.id,
        deviceName: device.name,
        kind: 'atv',
        codeLength: 6,
        instructions: 'Enter the 6-character code shown on the TV. It uses digits and letters A–F.',
        startedAt: Date.now(),
      };
      this.deps.emit('pairing:prompt', this.pairingPrompt);
    });
    session.once('paired', ({ fingerprint }: { fingerprint: string }) => {
      if (fingerprint) this.deps.vault.set(`pin:${device.id}`, fingerprint);
      this.deps.registry.patch(device.id, { trusted: true, certFingerprint: fingerprint || undefined });
      this.pairingPrompt = null;
      this.deps.emit('pairing:prompt', null);
      this.pairing = null;
      this.deps.log.info('pairing', 'Pairing completed.');
      this.deps.emit('toast', { kind: 'success', title: 'TV paired', message: 'Connecting to the remote service…' });
      void this.connect(device.id, { autoPair: false }).catch((err: unknown) => {
        const mapped = toAppError(err);
        this.setPhase('error', { error: mapped });
      });
    });
    session.once('failure', (err: AppError) => {
      this.pairingPrompt = null;
      this.deps.emit('pairing:prompt', null);
      this.pairing = null;
      this.deps.log.error('pairing', 'Pairing failed.', { code: err.code, detail: err.detail });
      this.setPhase('error', { error: err });
    });
    session.once('closed', () => {
      if (this.pairing === session) this.pairing = null;
    });
    try {
      await session.start();
    } catch (err) {
      const mapped = toAppError(err);
      this.pairingPrompt = null;
      this.deps.emit('pairing:prompt', null);
      this.pairing = null;
      this.setPhase('error', { error: mapped });
      throw mapped;
    }
  }

  async startPairing(deviceId: string): Promise<void> {
    const device = this.findDevice(deviceId);
    if (this.adb) {
      // Paired for control already; nothing to do unless the user explicitly re-pairs.
    }
    await this.closeTransports();
    this.activeDeviceId = device.id;
    await this.beginPairing(device);
  }

  async submitPairingCode(code: string): Promise<void> {
    const session = this.pairing;
    if (!session) throw appError('PAIRING_TIMEOUT', 'There is no active pairing request.');
    const paired = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(appError('PAIRING_TIMEOUT', 'The TV did not confirm the pairing code.')), 16000);
      session.once('paired', () => {
        clearTimeout(timer);
        resolve();
      });
      session.once('failure', (err: AppError) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    await session.submitCode(code.trim().toLowerCase());
    await paired;
  }

  cancelPairing(): void {
    this.pairing?.cancel();
    this.pairing = null;
    this.pairingPrompt = null;
    this.deps.emit('pairing:prompt', null);
    if (this.connection.phase === 'pairing') this.setPhase('disconnected');
  }

  // ---------------------------------------------------------------- disconnect

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    await this.closeTransports();
    this.activeDeviceId = null;
    this.reconnectAttempt = 0;
    this.setPhase('disconnected', {
      deviceId: null,
      remoteTransport: 'none',
      captureTransport: 'none',
      error: null,
      reconnectAttempt: 0,
      nextRetryAt: null,
    });
  }

  private async closeTransports(): Promise<void> {
    this.capture.stop();
    this.pairing?.cancel();
    this.pairing = null;
    this.pairingPrompt = null;
    this.deps.emit('pairing:prompt', null);
    if (this.atv) {
      this.atv.close();
      this.atv = null;
    }
    if (this.adb) {
      this.adb.close();
      this.adb = null;
      this.capture.setAdb(null);
    }
    this.roku = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(device: DiscoveredDevice): void {
    if (!this.deps.settings.get().autoReconnect) return;
    if (this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > 6) {
      this.setPhase('error', {
        error: appError('UNREACHABLE', 'Reconnection attempts were exhausted.', 'Check the TV power and network, then reconnect manually.'),
        reconnectAttempt: this.reconnectAttempt,
        nextRetryAt: null,
      });
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** (this.reconnectAttempt - 1));
    this.setPhase('reconnecting', { reconnectAttempt: this.reconnectAttempt, nextRetryAt: Date.now() + delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.deps.log.info('connection', `Reconnect attempt ${this.reconnectAttempt}…`);
      void this.connect(device.id, { isReconnect: true }).catch((err: unknown) => {
        const mapped = toAppError(err);
        this.deps.log.warn('connection', 'Reconnect failed.', { code: mapped.code });
        this.scheduleReconnect(device);
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  // ---------------------------------------------------------------- remote

  async sendKey(key: RemoteKey, action: 'tap' | 'down' | 'up' = 'tap'): Promise<CommandResult> {
    if (!Object.prototype.hasOwnProperty.call(KEY_CODES, key)) {
      throw appError('INVALID_INPUT', 'Unknown remote key.');
    }
    if (this.atv?.isConnected) {
      const started = performance.now();
      const suppressedBefore = this.atv.suppressed;
      this.atv.key(key, { action });
      const sendMs = performance.now() - started;
      const coalesced = this.atv.suppressed > suppressedBefore;
      return {
        ok: true,
        rttMs: this.atv.rttMs ?? undefined,
        transport: 'atv-v2',
        note: coalesced
          ? 'Repeated press coalesced with the previous one.'
          : sendMs > 30
            ? 'Delivered slowly — the TV or network is busy.'
            : undefined,
      };
    }
    if (this.roku) {
      const result = await this.roku.key(key);
      return { ok: true, rttMs: result.rttMs, transport: 'roku', note: result.note };
    }
    if (this.adb?.isOpen) {
      const code = KEY_CODES[key];
      const started = performance.now();
      await this.adb.exec(`input keyevent ${code}`, 5000);
      return { ok: true, rttMs: Math.round(performance.now() - started), transport: 'adb' };
    }
    throw appError('REMOTE_UNAVAILABLE', 'No remote transport is connected.');
  }

  async sendText(text: string): Promise<CommandResult> {
    if (!text) throw appError('INVALID_INPUT', 'Nothing to type.');
    if (text.length > 500) throw appError('INVALID_INPUT', 'Text is limited to 500 characters per send.');
    if (!this.adb?.isOpen && this.roku) {
      const started = performance.now();
      const result = await this.roku.text(text);
      return {
        ok: true,
        rttMs: Math.round(performance.now() - started),
        transport: 'roku',
        note: result.dropped > 0 ? `${result.dropped} character(s) could not be typed: Roku ECP input is ASCII-only.` : undefined,
      };
    }
    if (!this.adb?.isOpen) {
      throw appError(
        'UNSUPPORTED_COMMAND',
        'Text entry needs an authorised debugging connection.',
        'The Android TV remote protocol cannot reliably inject text without the TV keyboard session.',
        'Enable debugging on the TV, then use Diagnostics to test capture.',
      );
    }
    const ascii = text.replace(/[^\x20-\x7E]/g, '');
    const dropped = text.length - ascii.length;
    const escaped = ascii.replace(/ /g, '%s');
    const started = performance.now();
    await this.adb.exec(`input text ${shellQuote(escaped)}`, 8000);
    return {
      ok: true,
      rttMs: Math.round(performance.now() - started),
      transport: 'adb',
      note: dropped > 0 ? `${dropped} character(s) could not be typed: ADB text entry is ASCII-only.` : undefined,
    };
  }

  async listApps(): Promise<AppEntry[]> {
    if (!this.adb?.isOpen && this.roku) return this.roku.apps();
    if (!this.adb?.isOpen) throw appError('UNSUPPORTED_COMMAND', 'The app list needs an authorised debugging connection.');
    const raw = await this.adb.execText('pm list packages', 12000);
    const installed = new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.replace(/^package:/, '').trim())
        .filter(Boolean),
    );
    const apps = [...installed]
      .filter((pkg) => KNOWN_APPS[pkg] || CURATED_SYSTEM_APPS.includes(pkg) || !pkg.startsWith('com.android.'))
      .map((pkg) => ({
        packageName: pkg,
        label: KNOWN_APPS[pkg] ?? pkg.split('.').slice(-1)[0],
        thirdParty: !pkg.startsWith('com.android.') && !pkg.startsWith('com.google.android.tv'),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return apps.slice(0, 120);
  }

  async launchApp(packageName: string): Promise<CommandResult> {
    if (!/^[a-zA-Z0-9._-]{1,160}$/.test(packageName)) throw appError('INVALID_INPUT', 'Invalid application package name.');
    if (!this.adb?.isOpen && this.roku) {
      const started = performance.now();
      await this.roku.launch(packageName);
      return { ok: true, rttMs: Math.round(performance.now() - started), transport: 'roku' };
    }
    if (!this.adb?.isOpen) {
      throw appError('UNSUPPORTED_COMMAND', 'Launching by package needs debugging enabled. Try a favourite deep link instead.');
    }
    const started = performance.now();
    const output = await this.adb.execText(
      `monkey -p ${shellQuote(packageName)} -c android.intent.category.LEANBACK_LAUNCHER 1`,
      9000,
    );
    if (/No activities found|monkey aborted|Error:/i.test(output)) {
      const fallback = await this.adb.execText(`monkey -p ${shellQuote(packageName)} 1`, 9000);
      if (/No activities found|monkey aborted|Error:/i.test(fallback)) {
        throw appError('UNSUPPORTED_COMMAND', 'The TV could not launch that application.', fallback.slice(0, 200));
      }
    }
    return { ok: true, rttMs: Math.round(performance.now() - started), transport: 'adb' };
  }

  // ---------------------------------------------------------------- capture

  async startCapture(preference?: 'auto' | 'h264' | 'png'): Promise<CaptureStartResult> {
    const device = this.activeDevice();
    if (!device) throw appError('UNREACHABLE', 'Connect to a TV first.');
    if (!this.adb?.isOpen) {
      throw appError(
        'ADB_UNAUTHORIZED',
        'Screen viewing needs an authorised debugging connection.',
        undefined,
        'Enable Developer options → USB debugging on the TV, then connect again.',
      );
    }
    const settings = this.deps.settings.get();
    const profile = settings.performanceProfile;
    const selected = preference && preference !== 'auto' ? preference : settings.preferredCapture;
    // "Auto" means best available, not "follow the profile's low-bandwidth
    // preference". The service probes H.264 first and falls back cleanly, so
    // a TV with working screenrecord never starts on 13-second screenshots.
    const preferContinuous = selected === 'png' ? false : true;
    const transport = await this.capture.start({
      profile,
      preferContinuous,
      bitrateKbps: profile.mode === 'lite' ? 2500 : profile.mode === 'balanced' ? 5000 : 9000,
    });
    this.connection = { ...this.connection, captureTransport: transport };
    this.emitConnection();
    this.pushDiagnostics();
    return { transport, detail: this.captureDetail || (transport === 'adb-h264' ? 'Continuous stream' : 'Screenshot feed') };
  }

  stopCapture(): void {
    this.capture.stop();
    this.connection = { ...this.connection, captureTransport: 'none' };
    this.emitConnection();
    this.pushDiagnostics();
  }

  async probeCaptureMethods(): Promise<CaptureProbeReport> {
    const device = this.activeDevice();
    if (!device) throw appError('UNREACHABLE', 'Connect to a TV first.');
    let adb = this.adb;
    if (!adb?.isOpen) {
      try {
        adb = await this.connectAdb(device);
      } catch (err) {
        const mapped = toAppError(err);
        const report: CaptureProbeReport = {
          adb: 'unavailable',
          screenshot: { supported: false, captureMs: 0, transferMs: 0, width: 0, height: 0, bytes: 0, detail: mapped.message },
          continuous: { supported: false, detail: 'ADB is required for software capture.' },
          recommendation: 'none',
        };
        this.lastCaptureProbe = report;
        return report;
      }
    }
    let screenshot: CaptureProbeReport['screenshot'];
    try {
      const bench = await this.capture.benchmark();
      const total = bench.captureMs + bench.transferMs;
      screenshot = {
        supported: bench.width > 0,
        captureMs: bench.captureMs,
        transferMs: bench.transferMs,
        width: bench.width,
        height: bench.height,
        bytes: bench.bytes,
        detail: `PNG round-trip ${total} ms at ${bench.width}×${bench.height} (${Math.round(bench.bytes / 1024)} KB).`,
      };
      if (bench.width > 0) {
        this.markCapability(device, 'screenCapture', 'verified', `Measured ${total} ms for a full PNG screenshot.`);
      }
    } catch (err) {
      screenshot = {
        supported: false,
        captureMs: 0,
        transferMs: 0,
        width: 0,
        height: 0,
        bytes: 0,
        detail: (err as Error).message,
      };
    }
    const continuous = await this.probeScreenRecord(adb!);
    this.markCapability(
      device,
      'continuousStream',
      continuous.supported ? 'verified' : 'unsupported',
      continuous.detail,
    );
    const recommendation = continuous.supported ? 'h264' : screenshot.supported ? 'png' : 'none';
    const report: CaptureProbeReport = {
      adb: 'authorized',
      screenshot,
      continuous,
      recommendation,
    };
    this.lastCaptureProbe = report;
    this.deps.log.info('capture', 'Capture methods probed.', {
      screenshot: screenshot.supported,
      continuous: continuous.supported,
      recommendation,
    });
    this.pushDiagnostics();
    return report;
  }

  private async probeScreenRecord(adb: AdbClient): Promise<{ supported: boolean; detail: string }> {
    let stream;
    try {
      stream = await adb.openStream('shell:screenrecord --output-format=h264 --time-limit 2 --bit-rate 3000000 -', 8000);
    } catch (err) {
      return { supported: false, detail: `screenrecord could not start: ${(err as Error).message}` };
    }
    let bytes = 0;
    let sawStartCode = false;
    let buffer = Buffer.alloc(0);
    const supported = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (!sawStartCode) {
          buffer = Buffer.concat([buffer, chunk]);
          sawStartCode = buffer.includes(Buffer.from([0, 0, 0, 1])) || buffer.includes(Buffer.from([0, 0, 1]));
          if (sawStartCode) {
            clearTimeout(timer);
            resolve(true);
          }
        }
      });
      stream.once('close', () => {
        clearTimeout(timer);
        resolve(sawStartCode);
      });
    });
    try {
      adb.closeStream(stream);
    } catch {
      /* already closed */
    }
    return {
      supported,
      detail: supported
        ? `H.264 start codes observed (${bytes} bytes in the probe window).`
        : 'screenrecord produced no H.264 data. This firmware likely blocks it; screenshots will be used.',
    };
  }

  reportRender(renderMs: number, dropped: number, stats?: { width?: number; height?: number; fps?: number }): void {
    this.capture.noteRender(renderMs, dropped, stats);
  }

  setCapturePaused(paused: boolean): void {
    this.capture.setPaused(paused);
  }

  getCaptureMetrics(): CaptureMetrics {
    return this.capture.getMetrics();
  }

  applyProfile(mode: PerformanceProfile['mode']): AppSettings {
    if (mode === 'auto') {
      return this.updateSettings({ performanceProfile: { ...this.deps.settings.get().performanceProfile, mode: 'auto' } });
    }
    return this.updateSettings({ performanceProfile: { ...PROFILE_PRESETS[mode] } });
  }

  async benchmark(): Promise<CaptureProbeReport> {
    return this.probeCaptureMethods();
  }

  private activeDevice(): DiscoveredDevice | null {
    return this.devices.find((d) => d.id === this.connection.deviceId) ?? null;
  }

  private markCapability(
    device: DiscoveredDevice,
    key: keyof DiscoveredDevice['capabilities'],
    state: DiscoveredDevice['capabilities'][keyof DiscoveredDevice['capabilities']]['state'],
    detail: string,
  ): void {
    const capabilities = structuredClone(device.capabilities);
    capabilities[key] = { state, detail, source: 'measured' };
    device.capabilities = capabilities;
    this.devices = this.devices.map((d) => (d.id === device.id ? { ...d, capabilities } : d));
    this.deps.registry.upsert({ ...device, capabilities });
    this.deps.emit('devices:changed', this.devices);
  }

  // ---------------------------------------------------------------- diagnostics

  async ping(): Promise<NetworkQuality> {
    if (this.atv?.isConnected && this.atv.supportsPing) {
      const rtt = await this.atv.ping();
      return this.networkQuality(rtt);
    }
    // The TV does not advertise PING, so measure the LAN with a TCP connect
    // probe instead of sending a message the TV will reject.
    const device = this.activeDevice();
    if (!device) throw appError('UNREACHABLE', 'Connect to a TV first.');
    const started = performance.now();
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: device.host, port: PORT_ATV_REMOTE });
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 2000);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    if (!ok) throw appError('UNREACHABLE', 'The TV did not answer a TCP probe.');
    return this.networkQuality(performance.now() - started);
  }

  /**
   * Runs one read-only ADB diagnostic command and returns its text output.
   * Deliberately limited to inspection commands: this is a troubleshooting
   * aid, not a general shell. Any metacharacter that could chain commands or
   * redirect output is rejected, so it cannot mutate the TV.
   */
  async adbShell(command: string): Promise<{ output: string; bytes: number }> {
    if (!this.adb?.isOpen) {
      throw appError('ADB_UNAUTHORIZED', 'Connect to the TV with debugging enabled first.');
    }
    const trimmed = command.trim();
    if (!trimmed) throw appError('INTERNAL', 'Enter an ADB shell command.');
    if (trimmed.length > 500) throw appError('INTERNAL', 'That command is too long.');
    if (/[;&|><`$]/.test(trimmed)) {
      throw appError('INTERNAL', 'Command chaining and redirection are not allowed.');
    }
    const readOnly =
      /^(getprop|dumpsys|wm\s+(size|density)|screenrecord\s+--help|settings\s+get|pm\s+list|cmd\s+package\s+list)\b/;
    if (!readOnly.test(trimmed)) {
      throw appError('INTERNAL', 'Only read-only inspection commands are allowed here.');
    }
    const buf = await this.adb.exec(trimmed, 12000);
    // Cap the returned text so a giant dump cannot jam the IPC channel.
    const output = buf.toString('utf8').slice(0, 20000);
    return { output, bytes: buf.length };
  }

  /**
   * Cached SPS/PPS (+ opening IDR) for the live H.264 stream, base64-encoded for
   * IPC. The TV only sends them in screenrecord's opening burst, so a renderer
   * that mounts later replays these to configure and start its decoder.
   */
  getCaptureParameterSets(): { data: string; bytes: number } | null {
    const sets = this.capture.getParameterSets();
    if (!sets) return null;
    return { data: sets.data.toString('base64'), bytes: sets.bytes };
  }

  /** Reopens the H.264 stream so the TV re-sends SPS/PPS and a keyframe. */
  restartVideo(): boolean {
    return this.capture.restartVideo();
  }

  /**
   * Sends a touch tap at TV screen coordinates. Used by the live view's
   * click-to-tap mode; Android TV apps that accept touch will react, while
   * D-pad-first launchers will ignore it (the UI says so).
   */
  async sendTap(x: number, y: number): Promise<CommandResult> {
    if (!this.adb?.isOpen) {
      throw appError('ADB_UNAUTHORIZED', 'Touch input needs an authorised debugging connection.');
    }
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || xi < 0 || yi < 0 || xi > 10000 || yi > 10000) {
      throw appError('INTERNAL', 'Invalid tap coordinates.');
    }
    const started = performance.now();
    await this.adb.exec(`input tap ${xi} ${yi}`, 5000);
    return { ok: true, rttMs: Math.round(performance.now() - started), transport: 'adb' };
  }

  private networkQuality(rtt: number): NetworkQuality {
    const jitter =
      this.rttSamples.length > 1
        ? Math.round(
            this.rttSamples.slice(1).reduce((sum, value, index) => sum + Math.abs(value - this.rttSamples[index]), 0) /
              (this.rttSamples.length - 1),
          )
        : null;
    return {
      rttMs: Math.round(rtt * 10) / 10,
      jitterMs: jitter,
      packetLossPct: null,
      linkMbps: null,
      wifiSignal: null,
      ssid: null,
      internetNotRequired: true,
    };
  }

  async diagnostics(): Promise<DiagnosticsSnapshot> {
    if (this.diagnosticsCache && Date.now() - this.diagnosticsCache.at < 800) return this.diagnosticsCache.snapshot;
    const device = this.activeDevice();
    const wifi = await readWifiInfo();
    const subnet = primarySubnet();
    const rtt = this.atv?.rttMs ?? null;
    const adb = this.adb;
    const checks: DiagnosticCheck[] = [];
    checks.push({
      id: 'lan',
      label: 'Local network',
      status: subnet ? 'pass' : 'fail',
      detail: subnet ? `${subnet.address} on ${subnet.subnet} (${subnet.interfaceName}).` : 'No private IPv4 interface was found.',
      hint: subnet ? undefined : 'Connect the laptop to the same Wi-Fi or LAN as the TV.',
    });
    checks.push({
      id: 'device',
      label: 'TV reachability',
      status: device ? (device.reachable || this.connection.phase === 'connected' ? 'pass' : 'warn') : 'skip',
      detail: device
        ? `${device.name} at ${device.host}${device.reachable ? '' : ' — not answering right now'}.`
        : 'No device selected.',
      hint: device ? undefined : 'Scan or add the TV by IP address.',
    });
    checks.push({
      id: 'remote',
      label: 'Remote service',
      status: this.connection.remoteTransport === 'atv-v2' ? 'pass' : this.connection.remoteTransport === 'adb' ? 'warn' : 'fail',
      detail:
        this.connection.remoteTransport === 'atv-v2'
          ? `Android TV Remote v2 connected${rtt ? `, RTT ${Math.round(rtt)} ms` : ''}.`
          : this.connection.remoteTransport === 'adb'
            ? 'Using ADB key events (slower than the native remote service).'
            : 'Not connected.',
      hint: this.connection.remoteTransport === 'none' ? 'Pair the TV, or enable network remote in the TV settings.' : undefined,
    });
    checks.push({
      id: 'adb',
      label: 'Debugging (ADB)',
      status: adb?.isOpen ? 'pass' : 'warn',
      detail: adb?.isOpen
        ? `Authorised${this.lastAdbProps ? ` — Android ${this.lastAdbProps.version} (SDK ${this.lastAdbProps.sdk ?? '?'})` : ''}.`
        : 'No authorised debugging connection.',
      hint: adb?.isOpen ? undefined : 'Needed for live screen viewing. See Setup → Enable screen viewing.',
    });
    const captureState = device?.capabilities.screenCapture.state ?? 'unknown';
    checks.push({
      id: 'capture',
      label: 'Screen capture',
      status: captureState === 'verified' ? 'pass' : captureState === 'unsupported' ? 'fail' : 'warn',
      detail:
        captureState === 'verified'
          ? this.captureDetail || 'Screencap verified on this TV.'
          : device?.capabilities.screenCapture.detail ?? 'Not tested yet.',
      hint: captureState === 'verified' ? undefined : 'Open Diagnostics and choose “Benchmark capture”.',
    });
    checks.push({
      id: 'latency',
      label: 'Remote latency',
      status: rtt === null ? 'skip' : rtt < 40 ? 'pass' : rtt < 90 ? 'warn' : 'fail',
      detail: rtt === null ? 'No protocol ping has completed yet.' : `${Math.round(rtt)} ms remote-service RTT${wifi.signal ? `, Wi-Fi ${wifi.signal}%` : ''}.`,
      hint: rtt && rtt >= 90 ? 'Move closer to the access point or use 5 GHz.' : undefined,
    });
    if (device?.capabilities.audioCapture.state === 'unsupported') {
      checks.push({
        id: 'audio',
        label: 'TV audio',
        status: 'skip',
        detail: 'The local protocols expose no display audio; TellyMote does not claim audio support.',
      });
    }
    const snapshot: DiagnosticsSnapshot = {
      generatedAt: Date.now(),
      app: this.deps.appInfo,
      localNetwork: {
        addresses: (await import('./discovery/network')).listLocalInterfaces().map((i) => i.address),
        subnet: subnet?.subnet ?? null,
        interfaces: (await import('./discovery/network')).listLocalInterfaces().map((i) => ({
          name: i.name,
          address: i.address,
          mac: i.mac,
        })),
      },
      scan: this.discovery.getStatus(),
      device: device ?? null,
      capabilities: device?.capabilities ?? null,
      connection: this.connection,
      capture: this.capture.getMetrics(),
      remote: {
        transport: this.connection.remoteTransport,
        keyRttMs: rtt === null ? null : Math.round(rtt),
        lastError: this.atv?.lastError ?? this.connection.error?.message ?? null,
        commandsSent: this.atv?.commandsSent ?? 0,
      },
      adb: {
        present: Boolean(adb?.isOpen),
        authorized: Boolean(adb?.isOpen),
        model: this.lastAdbProps?.model ?? null,
        androidVersion: this.lastAdbProps?.version ?? null,
        sdk: this.lastAdbProps?.sdk ?? null,
        error: this.connection.error?.code === 'ADB_UNAUTHORIZED' ? this.connection.error.message : null,
      },
      network: {
        ...this.networkQuality(rtt ?? 0),
        rttMs: rtt === null ? null : Math.round(rtt * 10) / 10,
        wifiSignal: wifi.signal,
        ssid: wifi.ssid,
        linkMbps: wifi.linkMbps,
      },
      checks,
      log: this.deps.log.recent(120),
    };
    this.diagnosticsCache = { at: Date.now(), snapshot };
    return snapshot;
  }

  buildExport(includeIps: boolean): { filename: string; content: string } {
    const snapshot = this.diagnosticsCache?.snapshot;
    const log = this.deps.log.redact(includeIps);
    const redactedSnapshot = snapshot
      ? {
          ...snapshot,
          device: snapshot.device ? { ...snapshot.device, host: includeIps ? snapshot.device.host : '«ip»' } : null,
          localNetwork: {
            ...snapshot.localNetwork,
            addresses: includeIps ? snapshot.localNetwork.addresses : snapshot.localNetwork.addresses.map(() => '«ip»'),
            interfaces: snapshot.localNetwork.interfaces.map((i) => ({ ...i, address: includeIps ? i.address : '«ip»', mac: includeIps ? i.mac : '«mac»' })),
          },
          network: { ...snapshot.network, ssid: includeIps ? snapshot.network.ssid : snapshot.network.ssid ? '«ssid»' : null },
        }
      : null;
    const payload = {
      product: 'TellyMote',
      exportedAt: new Date().toISOString(),
      note: 'Secrets, pairing codes and keys are never included. IP addresses are redacted unless enabled in Settings.',
      diagnostics: redactedSnapshot,
      log,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return { filename: `tellymote-diagnostics-${stamp}.json`, content: JSON.stringify(payload, null, 2) };
  }

  private pushDiagnostics(): void {
    this.diagnosticsCache = null;
  }

  currentError(): AppErrorType | null {
    return this.connection.error;
  }
}

function emptyMetrics(): CaptureMetrics {
  return {
    fps: 0,
    dropped: 0,
    captureMs: 0,
    transferMs: 0,
    renderMs: 0,
    e2eMs: null,
    width: 0,
    height: 0,
    bytes: 0,
    kbps: 0,
    transport: 'none',
    continuous: false,
    updatedAt: 0,
  };
}

export type { StoredDevice };
