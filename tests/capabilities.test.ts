import { describe, expect, it } from 'vitest';
import { CAPABILITY_LABELS, cap, unknownCapabilities, withRemoteSupport } from '../shared/capabilities';
import type { Capabilities } from '../shared/types';

const KEYS = Object.keys(unknownCapabilities()) as Array<keyof Capabilities>;

describe('capability baseline', () => {
  it('starts every protocol capability as unknown, never as working', () => {
    const caps = unknownCapabilities();
    expect(KEYS).toHaveLength(18);
    for (const key of KEYS) {
      if (key === 'audioCapture' || key === 'receiverInstall') continue;
      expect(caps[key].state, key).toBe('unknown');
    }
  });

  it('marks capabilities that are structurally impossible as unsupported, with a reason', () => {
    const caps = unknownCapabilities();
    expect(caps.audioCapture.state).toBe('unsupported');
    expect(caps.audioCapture.detail).toBeTruthy();
    expect(caps.receiverInstall.state).toBe('unsupported');
    expect(caps.receiverInstall.detail).toBeTruthy();
  });

  it('labels every capability for the UI', () => {
    for (const key of KEYS) expect(CAPABILITY_LABELS[key], key).toBeTruthy();
  });

  it('creates capability records with a default protocol source', () => {
    expect(cap('conditional', 'reason')).toEqual({ state: 'conditional', detail: 'reason', source: 'protocol' });
    expect(cap('verified', undefined, 'measured').source).toBe('measured');
  });
});

describe('protocol-derived capability updates', () => {
  it('promotes remote capabilities when the Android TV remote service answered', () => {
    const caps = withRemoteSupport(unknownCapabilities(), true, false, false);
    expect(caps.remote.state).toBe('supported');
    expect(caps.remote.detail).toContain('6466');
    expect(caps.volume.state).toBe('supported');
    expect(caps.mute.state).toBe('supported');
    expect(caps.mediaTransport.state).toBe('supported');
    expect(caps.settingsKey.state).toBe('supported');
    expect(caps.channelKeys.state).toBe('supported');
    expect(caps.keyboardText.state).toBe('conditional');
    expect(caps.power.state).toBe('conditional');
    expect(caps.appList.state).toBe('conditional');
    expect(caps.appLaunch.state).toBe('conditional');
    expect(caps.screenCapture.state).toBe('unknown');
    expect(caps.adb.state).toBe('unknown');
  });

  it('marks ADB capture as conditional, not working, before authorization', () => {
    const caps = withRemoteSupport(unknownCapabilities(), false, true, false);
    expect(caps.adb.state).toBe('conditional');
    expect(caps.adb.detail).toMatch(/authorise/);
    expect(caps.screenCapture.state).toBe('conditional');
    expect(caps.screenCapture.detail).toMatch(/authorisation/);
  });

  it('keeps capture conditional when both ATV and ADB answered', () => {
    const caps = withRemoteSupport(unknownCapabilities(), true, true, false);
    expect(caps.remote.state).toBe('supported');
    expect(caps.screenCapture.state).toBe('conditional');
  });

  it('explains that Cast alone cannot control or mirror a TV', () => {
    const caps = withRemoteSupport(unknownCapabilities(), false, false, true);
    expect(caps.remote.state).toBe('unsupported');
    expect(caps.remote.detail).toMatch(/Cast/);
    expect(caps.screenCapture.state).toBe('unsupported');
    expect(caps.screenCapture.detail).toMatch(/Cast/);
  });

  it('marks remote unsupported when no control protocol answered', () => {
    const caps = withRemoteSupport(unknownCapabilities(), false, false, false);
    expect(caps.remote.state).toBe('unsupported');
    expect(caps.remote.detail).toMatch(/No supported control protocol/);
  });

  it('never destroys a verified fact learned from the device', () => {
    const base = unknownCapabilities();
    base.remote = cap('verified', 'Key presses accepted on this TV.', 'measured');
    const caps = withRemoteSupport(base, false, false, false);
    expect(caps.remote).toEqual(base.remote);
  });

  it('does not mutate the input capability set', () => {
    const base = unknownCapabilities();
    const caps = withRemoteSupport(base, true, true, true);
    expect(base.remote.state).toBe('unknown');
    expect(base.screenCapture.state).toBe('unknown');
    expect(caps).not.toBe(base);
  });
});
