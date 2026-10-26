/**
 * Session-level guards. Everything here runs against in-process stubs: no TV,
 * no socket and no loopback server is contacted.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LumaSession } from '../electron/core/session';
import { AppLog } from '../electron/core/log';
import { SettingsStore } from '../electron/core/settings';
import { DeviceRegistry } from '../electron/core/registry/devices';
import { SecretVault, type SecretCipher } from '../electron/core/security/vault';
import { FrameServer } from '../electron/core/streaming/frameServer';
import type { AppInfo, ConnectionState } from '../shared/types';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-session-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const cipher: SecretCipher = {
  isAvailable: () => false,
  encrypt: (plaintext) => Buffer.from(plaintext, 'utf8'),
  decrypt: (payload) => payload.toString('utf8'),
};

function makeSession(): LumaSession {
  const directory = tempDir();
  const appInfo: AppInfo = {
    version: '0.0.0-test',
    electron: '',
    chrome: '',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    adbPath: null,
    mockServerSupported: false,
    userDataPath: directory,
    security: { vaultPersisted: false, warning: null },
  };
  return new LumaSession({
    directory,
    vault: new SecretVault(directory, cipher),
    settings: new SettingsStore(directory),
    registry: new DeviceRegistry(directory),
    log: new AppLog(),
    frameServer: new FrameServer(),
    appInfo,
    emit: () => undefined,
  });
}

describe('diagnostic shell', () => {
  it('runs an allowed read-only command', async () => {
    const session = makeSession();
    const executed: string[] = [];
    session['adb'] = {
      isOpen: true,
      exec: async (command: string) => {
        executed.push(command);
        return Buffer.from('[ro.build.version.release]: [12]\n');
      },
    } as never;

    const result = await session.adbShell('  getprop ro.build.version.release  ');
    expect(executed).toEqual(['getprop ro.build.version.release']);
    expect(result.output).toContain('ro.build.version.release');
  });

  it('rejects a newline, which would start a second command on the TV', async () => {
    const session = makeSession();
    const executed: string[] = [];
    session['adb'] = {
      isOpen: true,
      exec: async (command: string) => {
        executed.push(command);
        return Buffer.alloc(0);
      },
    } as never;

    await expect(session.adbShell('getprop\nrm -rf /')).rejects.toThrow(/Control characters/);
    await expect(session.adbShell('getprop\rreboot')).rejects.toThrow(/Control characters/);
    await expect(session.adbShell('dumpsys\tbattery')).rejects.toThrow(/Control characters/);
    expect(executed).toEqual([]);
  });

  it('still rejects chaining, redirection and write commands', async () => {
    const session = makeSession();
    session['adb'] = { isOpen: true, exec: async () => Buffer.alloc(0) } as never;

    await expect(session.adbShell('getprop; reboot')).rejects.toThrow(/chaining/i);
    await expect(session.adbShell('getprop | sh')).rejects.toThrow(/chaining/i);
    await expect(session.adbShell('reboot')).rejects.toThrow(/read-only/i);
    await expect(session.adbShell('pm clear com.netflix.ninja')).rejects.toThrow(/read-only/i);
  });

  it('caps the returned text so a huge dump cannot jam IPC', async () => {
    const session = makeSession();
    session['adb'] = { isOpen: true, exec: async () => Buffer.from('x'.repeat(60_000)) } as never;

    const result = await session.adbShell('dumpsys battery');
    expect(result.output).toHaveLength(20_000);
    expect(result.bytes).toBe(60_000);
  });
});

describe('key release on transports without key-up', () => {
  it('sends one press per hold over Roku ECP', async () => {
    const session = makeSession();
    const sent: string[] = [];
    session['roku'] = {
      key: async (key: string) => {
        sent.push(key);
        return { rttMs: 4 };
      },
    } as never;

    const down = await session.sendKey('right', 'down');
    const up = await session.sendKey('right', 'up');
    const tap = await session.sendKey('right', 'tap');

    expect(sent).toEqual(['right', 'right']);
    expect(down.transport).toBe('roku');
    expect(up.rttMs).toBeUndefined();
    expect(up.note).toMatch(/no key-release/i);
  });

  it('sends one keyevent per hold over ADB', async () => {
    const session = makeSession();
    const commands: string[] = [];
    session['adb'] = {
      isOpen: true,
      exec: async (command: string) => {
        commands.push(command);
        return Buffer.alloc(0);
      },
    } as never;

    await session.sendKey('volumeUp', 'down');
    const up = await session.sendKey('volumeUp', 'up');
    await session.sendKey('volumeUp', 'tap');

    expect(commands).toHaveLength(2);
    expect(commands.every((command) => command.startsWith('input keyevent'))).toBe(true);
    expect(up.note).toMatch(/no key-release/i);
  });
});

describe('overlapping connects', () => {
  it('negotiates one connection at a time', async () => {
    const session = makeSession();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session['negotiate'] = (async (deviceId: string): Promise<ConnectionState> => {
      order.push(`start:${deviceId}`);
      await gate;
      order.push(`end:${deviceId}`);
      return session.getStatus().connection;
    }) as never;

    const first = session.connect('tv-a');
    const second = session.connect('tv-b');
    expect(session['connectInFlight']).not.toBeNull();
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(['start:tv-a', 'end:tv-a', 'start:tv-b', 'end:tv-b']);
    expect(session['connectInFlight']).toBeNull();
  });

  it('clears the guard after a failed negotiation', async () => {
    const session = makeSession();
    session['negotiate'] = (async (): Promise<ConnectionState> => {
      throw new Error('no transport');
    }) as never;

    await expect(session.connect('tv-a')).rejects.toThrow('no transport');
    expect(session['connectInFlight']).toBeNull();
  });
});
