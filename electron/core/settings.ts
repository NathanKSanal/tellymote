import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, KeyboardMap, PerformanceProfile } from '../../shared/types';

export const DEFAULT_KEYBOARD: KeyboardMap = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  select: 'Enter',
  back: 'Escape',
  home: 'Home',
  menu: 'm',
  volumeUp: 'PageUp',
  volumeDown: 'PageDown',
  mute: 'F8',
  playPause: 'Space',
  power: 'F12',
};

export const PROFILE_PRESETS: Record<'lite' | 'balanced' | 'performance', PerformanceProfile> = {
  lite: { mode: 'lite', captureFps: 1, maxWidth: 960, preferContinuous: false, adaptive: true },
  balanced: { mode: 'balanced', captureFps: 3, maxWidth: 1280, preferContinuous: false, adaptive: true },
  performance: { mode: 'performance', captureFps: 6, maxWidth: 1920, preferContinuous: true, adaptive: true },
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accent: 'amber',
  performanceProfile: { ...PROFILE_PRESETS.balanced },
  preferredCapture: 'auto',
  scanOnStartup: true,
  activeProbeOnStartup: true,
  launchAtLogin: false,
  minimizeToTray: true,
  includeIpsInExports: false,
  autoReconnect: true,
  confirmPowerOff: true,
  keyboard: { ...DEFAULT_KEYBOARD },
  shortcuts: { toggleRemote: 'Control+Shift+R', toggleFullscreen: 'F11' },
  lastDeviceId: null,
  favoriteApps: ['com.netflix.ninja', 'com.google.android.youtube.tv', 'com.amazon.amazonvideo.livingroom'],
};

const THEMES = new Set(['dark', 'light', 'system']);
const ACCENTS = new Set(['amber', 'azure', 'violet', 'emerald']);
const MODES = new Set(['lite', 'balanced', 'performance', 'auto']);

function asString(value: unknown, fallback: string, allowed?: Set<string>): string {
  if (typeof value === 'string' && (!allowed || allowed.has(value))) return value;
  return fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(max, Math.max(min, value));
  return fallback;
}

function sanitizeProfile(value: unknown): PerformanceProfile {
  const input = (value ?? {}) as Partial<PerformanceProfile>;
  const mode = asString(input.mode, 'balanced', MODES) as PerformanceProfile['mode'];
  const preset = mode === 'auto' ? PROFILE_PRESETS.balanced : PROFILE_PRESETS[mode] ?? PROFILE_PRESETS.balanced;
  return {
    mode,
    captureFps: Math.round(asNumber(input.captureFps, preset.captureFps, 1, 15)),
    maxWidth: Math.round(asNumber(input.maxWidth, preset.maxWidth, 480, 3840)),
    preferContinuous: asBool(input.preferContinuous, preset.preferContinuous),
    adaptive: asBool(input.adaptive, true),
  };
}

function sanitizeKeyboard(value: unknown): KeyboardMap {
  const input = (value ?? {}) as Partial<KeyboardMap>;
  const out = { ...DEFAULT_KEYBOARD };
  for (const key of Object.keys(DEFAULT_KEYBOARD) as Array<keyof KeyboardMap>) {
    const candidate = input[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0 && candidate.length <= 40) {
      out[key] = candidate.trim();
    }
  }
  return out;
}

export function sanitizeSettings(input: unknown): AppSettings {
  const raw = (input ?? {}) as Partial<AppSettings> & Record<string, unknown>;
  const shortcuts = (raw.shortcuts ?? {}) as Record<string, unknown>;
  return {
    theme: asString(raw.theme, DEFAULT_SETTINGS.theme, THEMES) as AppSettings['theme'],
    accent: asString(raw.accent, DEFAULT_SETTINGS.accent, ACCENTS) as AppSettings['accent'],
    performanceProfile: sanitizeProfile(raw.performanceProfile),
    preferredCapture: asString(raw.preferredCapture, 'auto', new Set(['auto', 'h264', 'png'])) as AppSettings['preferredCapture'],
    scanOnStartup: asBool(raw.scanOnStartup, DEFAULT_SETTINGS.scanOnStartup),
    activeProbeOnStartup: asBool(raw.activeProbeOnStartup, DEFAULT_SETTINGS.activeProbeOnStartup),
    launchAtLogin: asBool(raw.launchAtLogin, DEFAULT_SETTINGS.launchAtLogin),
    minimizeToTray: asBool(raw.minimizeToTray, DEFAULT_SETTINGS.minimizeToTray),
    includeIpsInExports: asBool(raw.includeIpsInExports, false),
    autoReconnect: asBool(raw.autoReconnect, true),
    confirmPowerOff: asBool(raw.confirmPowerOff, true),
    keyboard: sanitizeKeyboard(raw.keyboard),
    shortcuts: {
      toggleRemote: asString(shortcuts.toggleRemote, DEFAULT_SETTINGS.shortcuts.toggleRemote),
      toggleFullscreen: asString(shortcuts.toggleFullscreen, DEFAULT_SETTINGS.shortcuts.toggleFullscreen),
    },
    lastDeviceId: typeof raw.lastDeviceId === 'string' && raw.lastDeviceId.length < 200 ? raw.lastDeviceId : null,
    favoriteApps: Array.isArray(raw.favoriteApps)
      ? raw.favoriteApps.filter((v): v is string => typeof v === 'string' && /^[a-zA-Z0-9._]+$/.test(v)).slice(0, 40)
      : [...DEFAULT_SETTINGS.favoriteApps],
  };
}

export class SettingsStore {
  private settings: AppSettings;
  private readonly file: string;

  constructor(private readonly directory: string) {
    this.file = path.join(directory, 'settings.json');
    this.settings = this.load();
  }

  private load(): AppSettings {
    try {
      if (!fs.existsSync(this.file)) return sanitizeSettings({});
      return sanitizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return sanitizeSettings({});
    }
  }

  get(): AppSettings {
    return structuredClone(this.settings);
  }

  update(partial: Partial<AppSettings>): AppSettings {
    this.settings = sanitizeSettings({ ...this.settings, ...partial });
    this.save();
    return this.get();
  }

  reset(): AppSettings {
    this.settings = sanitizeSettings({});
    this.save();
    return this.get();
  }

  private save(): void {
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch {
      // Preferences failing to persist must not break the session.
    }
  }
}
