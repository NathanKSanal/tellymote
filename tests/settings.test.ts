import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBOARD,
  DEFAULT_SETTINGS,
  PROFILE_PRESETS,
  SettingsStore,
  sanitizeSettings,
} from '../electron/core/settings';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-settings-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('settings sanitization', () => {
  it('returns the documented defaults for empty or missing input', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('drops unknown enum values instead of trusting them', () => {
    const result = sanitizeSettings({
      accent: 'red',
      theme: 'neon',
      preferredCapture: 'jpeg',
      performanceProfile: { mode: 'turbo' },
    });
    expect(result.accent).toBe('amber');
    expect(result.theme).toBe('dark');
    expect(result.preferredCapture).toBe('auto');
    expect(result.performanceProfile.mode).toBe('balanced');
    expect(result.performanceProfile.captureFps).toBe(PROFILE_PRESETS.balanced.captureFps);
  });

  it('clamps performance values to ranges the capture pipeline can honour', () => {
    const tooFast = sanitizeSettings({
      performanceProfile: { mode: 'performance', captureFps: 99, maxWidth: 9999, preferContinuous: true, adaptive: false },
    });
    expect(tooFast.performanceProfile.captureFps).toBe(15);
    expect(tooFast.performanceProfile.maxWidth).toBe(3840);
    expect(tooFast.performanceProfile.preferContinuous).toBe(true);
    expect(tooFast.performanceProfile.adaptive).toBe(false);

    const tooSlow = sanitizeSettings({
      performanceProfile: { mode: 'lite', captureFps: -3, maxWidth: 10 },
    });
    expect(tooSlow.performanceProfile.captureFps).toBe(1);
    expect(tooSlow.performanceProfile.maxWidth).toBe(480);

    const fractional = sanitizeSettings({ performanceProfile: { captureFps: 4.7, maxWidth: 1280.4 } });
    expect(fractional.performanceProfile.captureFps).toBe(5);
    expect(fractional.performanceProfile.maxWidth).toBe(1280);
  });

  it('uses the requested mode preset when values are absent', () => {
    const lite = sanitizeSettings({ performanceProfile: { mode: 'lite' } });
    expect(lite.performanceProfile).toMatchObject(PROFILE_PRESETS.lite);
    const auto = sanitizeSettings({ performanceProfile: { mode: 'auto' } });
    expect(auto.performanceProfile.mode).toBe('auto');
    expect(auto.performanceProfile.captureFps).toBe(PROFILE_PRESETS.balanced.captureFps);
  });

  it('keeps valid keyboard bindings and falls back for junk', () => {
    const result = sanitizeSettings({
      keyboard: { up: 'w', select: '  Space  ', back: '', home: 'x'.repeat(41), down: 5 },
    });
    expect(result.keyboard.up).toBe('w');
    expect(result.keyboard.select).toBe('Space');
    expect(result.keyboard.back).toBe(DEFAULT_KEYBOARD.back);
    expect(result.keyboard.home).toBe(DEFAULT_KEYBOARD.home);
    expect(result.keyboard.down).toBe(DEFAULT_KEYBOARD.down);
    expect(Object.keys(result.keyboard)).toHaveLength(Object.keys(DEFAULT_KEYBOARD).length);
  });

  it('sanitizes shortcuts and device identity', () => {
    const result = sanitizeSettings({
      shortcuts: { toggleRemote: 12, toggleFullscreen: 'F11' },
      lastDeviceId: 'x'.repeat(200),
    });
    expect(result.shortcuts.toggleRemote).toBe(DEFAULT_SETTINGS.shortcuts.toggleRemote);
    expect(result.shortcuts.toggleFullscreen).toBe('F11');
    expect(result.lastDeviceId).toBeNull();
    expect(sanitizeSettings({ lastDeviceId: 'host:192.168.0.50' }).lastDeviceId).toBe('host:192.168.0.50');
  });

  it('only accepts package-name-shaped favourite apps', () => {
    const result = sanitizeSettings({
      favoriteApps: ['com.netflix.ninja', 'bad app', '../etc/passwd', 'com.google.android.youtube.tv', 42, ''],
    });
    expect(result.favoriteApps).toEqual(['com.netflix.ninja', 'com.google.android.youtube.tv']);
    const many = sanitizeSettings({ favoriteApps: Array.from({ length: 60 }, (_, i) => `com.example.app${i}`) });
    expect(many.favoriteApps).toHaveLength(40);
  });

  it('coerces wrong primitive types to safe defaults', () => {
    const result = sanitizeSettings({
      scanOnStartup: 'yes',
      activeProbeOnStartup: 1,
      launchAtLogin: null,
      minimizeToTray: 'no',
      includeIpsInExports: 'true',
      autoReconnect: 0,
      confirmPowerOff: 'false',
    });
    expect(result.scanOnStartup).toBe(true);
    expect(result.activeProbeOnStartup).toBe(true);
    expect(result.launchAtLogin).toBe(false);
    expect(result.minimizeToTray).toBe(true);
    expect(result.includeIpsInExports).toBe(false);
    expect(result.autoReconnect).toBe(true);
    expect(result.confirmPowerOff).toBe(true);
  });
});

describe('SettingsStore', () => {
  it('persists updates atomically and reloads them in a new instance', () => {
    const dir = tempDir();
    const store = new SettingsStore(dir);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);

    store.update({ accent: 'violet', minimizeToTray: false });
    const reloaded = new SettingsStore(dir);
    expect(reloaded.get().accent).toBe('violet');
    expect(reloaded.get().minimizeToTray).toBe(false);
    expect(fs.existsSync(path.join(dir, 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'settings.json.tmp'))).toBe(false);
  });

  it('sanitizes partial updates before saving', () => {
    const dir = tempDir();
    const store = new SettingsStore(dir);
    const result = store.update({ performanceProfile: { ...store.get().performanceProfile, captureFps: 1000 } });
    expect(result.performanceProfile.captureFps).toBe(15);
    expect(new SettingsStore(dir).get().performanceProfile.captureFps).toBe(15);
  });

  it('resets to defaults on disk', () => {
    const dir = tempDir();
    const store = new SettingsStore(dir);
    store.update({ accent: 'azure' });
    const reset = store.reset();
    expect(reset).toEqual(DEFAULT_SETTINGS);
    expect(new SettingsStore(dir).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('recovers from corrupt or hostile JSON without throwing', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json', 'utf8');
    expect(new SettingsStore(dir).get()).toEqual(DEFAULT_SETTINGS);

    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ accent: '__proto__', favoriteApps: 'not-an-array', performanceProfile: 7 }),
      'utf8',
    );
    const hostile = new SettingsStore(dir).get();
    expect(hostile.accent).toBe('amber');
    expect(hostile.favoriteApps).toEqual(DEFAULT_SETTINGS.favoriteApps);
    expect(hostile.performanceProfile.mode).toBe('balanced');
  });
});
