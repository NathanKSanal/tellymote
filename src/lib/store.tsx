import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AppError,
  AppInfo,
  AppSettings,
  CaptureMetrics,
  ConnectionState,
  DiagnosticsSnapshot,
  DiscoveredDevice,
  DiscoverOptions,
  LogEntry,
  PairingPrompt,
  PerformanceProfile,
  RemoteKey,
  ScanStatus,
  SessionStatus,
  StreamFrameInfo,
} from '@shared/types';
import { api, LumaError, onEvent } from './api';

export interface ToastItem {
  id: number;
  kind: 'info' | 'success' | 'warn' | 'error';
  title: string;
  message?: string;
}

const EMPTY_CONNECTION: ConnectionState = {
  phase: 'idle',
  deviceId: null,
  remoteTransport: 'none',
  captureTransport: 'none',
  since: Date.now(),
  error: null,
  reconnectAttempt: 0,
  nextRetryAt: null,
};

const EMPTY_METRICS: CaptureMetrics = {
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

const EMPTY_SCAN: ScanStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  hostsProbed: 0,
  hostsTotal: 0,
  localAddress: null,
  subnet: null,
  methods: [],
  errors: [],
};

interface AppState {
  ready: boolean;
  bootError: string | null;
  appInfo: AppInfo | null;
  settings: AppSettings | null;
  devices: DiscoveredDevice[];
  connection: ConnectionState;
  metrics: CaptureMetrics;
  prompt: PairingPrompt | null;
  scan: ScanStatus;
  logs: LogEntry[];
  diagnostics: DiagnosticsSnapshot | null;
  toasts: ToastItem[];
  frameMeta: StreamFrameInfo | null;
  frameUrl: string;
}

export interface AppActions {
  scan: (options?: DiscoverOptions) => Promise<void>;
  cancelScan: () => Promise<void>;
  connect: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  pair: (deviceId: string) => Promise<void>;
  submitPairingCode: (code: string) => Promise<void>;
  cancelPairing: () => Promise<void>;
  addManual: (host: string, name?: string) => Promise<DiscoveredDevice | null>;
  forget: (deviceId: string) => Promise<void>;
  rename: (deviceId: string, name: string) => Promise<void>;
  key: (key: RemoteKey, action?: 'tap' | 'down' | 'up') => Promise<void>;
  text: (text: string) => Promise<void>;
  launchApp: (packageName: string) => Promise<void>;
  startCapture: (preference?: 'h264' | 'png') => Promise<void>;
  stopCapture: () => Promise<void>;
  applyProfile: (mode: PerformanceProfile['mode']) => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
  refreshDiagnostics: () => Promise<DiagnosticsSnapshot | null>;
  ping: () => Promise<void>;
  exportDiagnostics: () => Promise<void>;
  toast: (kind: ToastItem['kind'], title: string, message?: string) => void;
  dismissToast: (id: number) => void;
  refresh: () => Promise<void>;
}

interface Store {
  state: AppState;
  actions: AppActions;
}

const StoreContext = createContext<Store | null>(null);

function describeError(err: unknown): { message: string; hint?: string; code?: string } {
  if (err instanceof LumaError) return { message: err.message, hint: err.hint, code: err.code };
  if (err instanceof Error) return { message: err.message };
  return { message: String(err) };
}

export function errorOf(err: unknown): AppError | null {
  if (err instanceof LumaError) {
    return { code: err.code, message: err.message, hint: err.hint, detail: err.detail, at: err.at };
  }
  return null;
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    ready: false,
    bootError: null,
    appInfo: null,
    settings: null,
    devices: [],
    connection: EMPTY_CONNECTION,
    metrics: EMPTY_METRICS,
    prompt: null,
    scan: EMPTY_SCAN,
    logs: [],
    diagnostics: null,
    toasts: [],
    frameMeta: null,
    frameUrl: '',
  });

  const toastSeq = useRef(0);
  const recentToasts = useRef<Array<{ key: string; at: number }>>([]);

  const patch = useCallback((partial: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const dismissToast = useCallback((id: number) => {
    setState((prev) => ({ ...prev, toasts: prev.toasts.filter((toast) => toast.id !== id) }));
  }, []);

  const toast = useCallback(
    (kind: ToastItem['kind'], title: string, message?: string) => {
      const key = `${kind}:${title}:${message ?? ''}`;
      const now = Date.now();
      recentToasts.current = recentToasts.current.filter((entry) => now - entry.at < 4000);
      if (recentToasts.current.some((entry) => entry.key === key)) return;
      recentToasts.current.push({ key, at: now });
      const id = ++toastSeq.current;
      setState((prev) => ({ ...prev, toasts: [...prev.toasts.slice(-4), { id, kind, title, message }] }));
      const ttl = kind === 'error' ? 9000 : kind === 'warn' ? 7000 : 4800;
      window.setTimeout(() => {
        setState((prev) => ({ ...prev, toasts: prev.toasts.filter((entry) => entry.id !== id) }));
      }, ttl);
    },
    [],
  );

  const fail = useCallback(
    (err: unknown, title: string) => {
      const described = describeError(err);
      toast('error', title, described.hint ? `${described.message} ${described.hint}` : described.message);
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    const status = await api.status();
    const frame = await api.captureStatus().catch(() => null);
    setState((prev) => ({
      ...prev,
      devices: status.devices.length ? status.devices : prev.devices,
      connection: status.connection,
      metrics: status.metrics,
      prompt: status.prompt,
      scan: status.scan,
      frameUrl: frame?.frameUrl || prev.frameUrl,
    }));
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsubscribers: Array<() => void> = [];

    void (async () => {
      try {
        const [appInfo, settings, status, devices] = await Promise.all([
          api.appInfo(),
          api.getSettings(),
          api.status(),
          api.listDevices(),
        ]);
        if (disposed) return;
        setState((prev) => ({
          ...prev,
          ready: true,
          appInfo,
          settings,
          devices: devices.length ? devices : status.devices,
          connection: status.connection,
          metrics: status.metrics,
          prompt: status.prompt,
          scan: status.scan,
        }));

        unsubscribers.push(
          onEvent('devices:changed', (devices) => patch({ devices })),
          onEvent('connection:changed', (connection) => patch({ connection })),
          onEvent('scan:status', (scan) => patch({ scan })),
          onEvent('pairing:prompt', (prompt) => patch({ prompt })),
          onEvent('metrics:changed', (metrics) => patch({ metrics })),
          onEvent('frame:meta', (frame) => patch({ frameMeta: frame, frameUrl: frame.url })),
          onEvent('log:entry', (entry) => setState((prev) => ({ ...prev, logs: [...prev.logs.slice(-349), entry] }))),
          onEvent('toast', (payload) => toast(payload.kind, payload.title, payload.message)),
          onEvent('video:reset', () => {
            /* handled by the live view */
          }),
        );
      } catch (err) {
        if (disposed) return;
        setState((prev) => ({ ...prev, ready: true, bootError: describeError(err).message }));
      }
    })();

    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [patch, toast]);

  useEffect(() => {
    const accent = state.settings?.accent;
    if (accent) document.documentElement.dataset.accent = accent;
    if (state.settings?.theme) document.documentElement.classList.toggle('dark', state.settings.theme !== 'light');
  }, [state.settings?.accent, state.settings?.theme]);

  const actions = useMemo<AppActions>(() => {
    const scan = async (options: DiscoverOptions = {}) => {
      try {
        const result = await api.scan(options);
        patch({ devices: result.devices, scan: result.status });
      } catch (err) {
        fail(err, 'Scan failed');
        void refresh();
      }
    };

    const connect = async (deviceId: string) => {
      try {
        await api.connect(deviceId);
        await refresh();
      } catch (err) {
        fail(err, 'Could not connect');
        void refresh();
      }
    };

    const startCapture = async (preference?: 'h264' | 'png') => {
      try {
        const result = await api.startCapture(preference);
        toast('info', 'Screen viewing started', result.detail);
        const status = await api.captureStatus();
        patch({ frameUrl: status.frameUrl });
      } catch (err) {
        fail(err, 'Could not start screen viewing');
      }
    };

    return {
      scan,
      cancelScan: async () => {
        try {
          await api.cancelScan();
        } catch (err) {
          fail(err, 'Could not cancel the scan');
        }
      },
      connect,
      disconnect: async () => {
        try {
          const status: SessionStatus = await api.disconnect();
          patch({ connection: status.connection, metrics: status.metrics });
        } catch (err) {
          fail(err, 'Could not disconnect');
        }
      },
      pair: async (deviceId: string) => {
        try {
          await api.startPairing(deviceId);
        } catch (err) {
          fail(err, 'Could not start pairing');
        }
      },
      submitPairingCode: async (code: string) => {
        await api.submitPairingCode(code);
      },
      cancelPairing: async () => {
        try {
          await api.cancelPairing();
          patch({ prompt: null });
        } catch (err) {
          fail(err, 'Could not cancel pairing');
        }
      },
      addManual: async (host: string, name?: string) => {
        try {
          const device = await api.addManual(host, name);
          setState((prev) => ({
            ...prev,
            devices: [...prev.devices.filter((d) => d.host !== device.host && d.id !== device.id), device],
          }));
          toast('success', 'TV added', `${device.name} at ${device.host}`);
          return device;
        } catch (err) {
          fail(err, 'Could not add the TV');
          return null;
        }
      },
      forget: async (deviceId: string) => {
        try {
          await api.forget(deviceId);
          setState((prev) => ({ ...prev, devices: prev.devices.filter((d) => d.id !== deviceId) }));
          toast('info', 'Device forgotten', 'Saved pairing information was removed.');
        } catch (err) {
          fail(err, 'Could not forget the device');
        }
      },
      rename: async (deviceId: string, name: string) => {
        try {
          const updated = await api.rename(deviceId, name);
          if (updated) {
            setState((prev) => ({ ...prev, devices: prev.devices.map((d) => (d.id === deviceId ? updated : d)) }));
          }
        } catch (err) {
          fail(err, 'Could not rename the device');
        }
      },
      key: async (key: RemoteKey, action: 'tap' | 'down' | 'up' = 'tap') => {
        try {
          await api.key(key, action);
        } catch (err) {
          fail(err, 'The TV did not accept that key');
        }
      },
      text: async (text: string) => {
        try {
          const result = await api.text(text);
          toast('success', 'Text sent', result.note);
        } catch (err) {
          fail(err, 'Could not send text');
        }
      },
      launchApp: async (packageName: string) => {
        try {
          await api.launchApp(packageName);
          toast('success', 'App launched', packageName);
        } catch (err) {
          fail(err, 'Could not launch the app');
        }
      },
      startCapture,
      stopCapture: async () => {
        try {
          const metrics = await api.stopCapture();
          patch({ metrics, frameUrl: '' });
        } catch (err) {
          fail(err, 'Could not stop screen viewing');
        }
      },
      applyProfile: async (mode) => {
        try {
          const settings = await api.applyProfile(mode);
          patch({ settings });
          toast('info', 'Performance profile', `Switched to ${mode === 'auto' ? 'automatic' : mode}.`);
        } catch (err) {
          fail(err, 'Could not change the performance profile');
        }
      },
      updateSettings: async (partial) => {
        try {
          const settings = await api.setSettings(partial);
          patch({ settings });
        } catch (err) {
          fail(err, 'Could not save settings');
        }
      },
      resetSettings: async () => {
        try {
          const settings = await api.resetSettings();
          patch({ settings });
          toast('info', 'Settings reset', 'Defaults restored.');
        } catch (err) {
          fail(err, 'Could not reset settings');
        }
      },
      refreshDiagnostics: async () => {
        try {
          const diagnostics = await api.diagnostics();
          patch({ diagnostics });
          return diagnostics;
        } catch (err) {
          fail(err, 'Could not collect diagnostics');
          return null;
        }
      },
      ping: async () => {
        try {
          const quality = await api.ping();
          toast('success', 'TV responded', `Round trip ${quality.rttMs ?? '—'} ms.`);
        } catch (err) {
          fail(err, 'The TV did not respond');
        }
      },
      exportDiagnostics: async () => {
        try {
          const file = await api.exportDiagnostics();
          if (file) toast('success', 'Diagnostics exported', file);
        } catch (err) {
          fail(err, 'Could not export diagnostics');
        }
      },
      toast,
      dismissToast,
      refresh,
    };
  }, [dismissToast, fail, patch, refresh, toast]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useApp(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useApp must be used inside AppStoreProvider');
  return store;
}

export function useActiveDevice(): DiscoveredDevice | null {
  const { state } = useApp();
  return state.devices.find((device) => device.id === state.connection.deviceId) ?? null;
}

/**
 * The device to show in glanceable chrome (title bar, sidebar, dashboard).
 * Falls back to the last-used saved TV so the app does not look empty when the
 * TV is simply off; actions still use the real connection state.
 */
export function useDisplayDevice(): DiscoveredDevice | null {
  const { state } = useApp();
  const active = state.devices.find((device) => device.id === state.connection.deviceId);
  if (active) return active;
  const last = state.devices.find((device) => device.id === state.settings?.lastDeviceId);
  return last ?? state.devices[0] ?? null;
}

/** Samples a live number once a second for an instrument-style sparkline. */
export function useMetricHistory(value: number, size = 36): number[] {
  const [series, setSeries] = useState<number[]>([]);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const id = window.setInterval(() => {
      setSeries((previous) => [...previous.slice(-(size - 1)), latest.current]);
    }, 1000);
    return () => window.clearInterval(id);
  }, [size]);
  return series;
}
