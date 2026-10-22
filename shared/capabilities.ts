import type { Capability, Capabilities, CapabilityState } from './types';

export function cap(
  state: CapabilityState,
  detail?: string,
  source: Capability['source'] = 'protocol',
): Capability {
  return { state, detail, source };
}

/** Every capability starts unknown; nothing is assumed from a model name. */
export function unknownCapabilities(): Capabilities {
  return {
    remote: cap('unknown'),
    keyboardText: cap('unknown'),
    power: cap('unknown'),
    volume: cap('unknown'),
    mute: cap('unknown'),
    mediaTransport: cap('unknown'),
    channelKeys: cap('unknown'),
    appLaunch: cap('unknown'),
    appList: cap('unknown'),
    screenCapture: cap('unknown'),
    continuousStream: cap('unknown'),
    audioCapture: cap('unsupported', 'The Android TV remote protocol carries no display audio.'),
    pointerInput: cap('unknown'),
    inputSelection: cap('unknown'),
    settingsKey: cap('unknown'),
    hardwareEncoding: cap('unknown'),
    adb: cap('unknown'),
    receiverInstall: cap('unsupported', 'LumaRemote does not install unverified TV-side software.'),
  };
}

export function withRemoteSupport(base: Capabilities, atvOpen: boolean, adbOpen: boolean, castOpen: boolean, rokuOpen = false): Capabilities {
  const next: Capabilities = structuredClone(base);
  if (atvOpen) {
    next.remote = cap('supported', 'Android TV Remote Service v2 answered on TCP 6466 (pairing on 6467).', 'protocol');
    next.keyboardText = cap('conditional', 'Text entry uses ADB or the experimental IME channel.', 'protocol');
    next.power = cap('conditional', 'Sends KEYCODE_POWER. Some TVs only sleep instead of powering off.', 'protocol');
    next.volume = cap('supported', 'Volume keys over the remote service.', 'protocol');
    next.mute = cap('supported', 'Mute key over the remote service.', 'protocol');
    next.mediaTransport = cap('supported', 'Play/pause, rewind and fast-forward key codes.', 'protocol');
    next.channelKeys = cap('supported', 'Channel up/down key codes; effectiveness depends on the active app.', 'protocol');
    next.appLaunch = cap('conditional', 'Requires ADB, or a known deep link for the app.', 'protocol');
    next.appList = cap('conditional', 'Requires ADB authorisation.', 'protocol');
    next.inputSelection = cap('conditional', 'Sends KEYCODE_TV_INPUT where the firmware maps it.', 'protocol');
    next.settingsKey = cap('supported', 'Settings key code.', 'protocol');
    next.screenCapture = cap('unknown', 'Screen capture needs an authorised debugging connection.');
  }
  if (adbOpen) {
    next.adb = cap('conditional', 'ADB is listening on TCP 5555; the TV must authorise this laptop.', 'protocol');
    next.screenCapture = cap('conditional', 'ADB screencap becomes available after authorisation.', 'protocol');
    next.appList = cap('conditional', 'Requires ADB authorisation.', 'protocol');
    next.keyboardText = cap('conditional', 'ADB input text supports ASCII; IME injection is experimental.', 'protocol');
  }
  if (rokuOpen) {
    next.remote = cap('supported', 'Roku ECP answered on TCP 8060.', 'protocol');
    next.keyboardText = cap('conditional', 'Roku accepts literal keys (Lit_) over ECP; ASCII only.', 'protocol');
    next.power = cap('supported', 'Power key over ECP.', 'protocol');
    next.volume = cap('supported', 'Volume keys over ECP.', 'protocol');
    next.mute = cap('supported', 'Mute key over ECP.', 'protocol');
    next.mediaTransport = cap('supported', 'Play, rewind and fast-forward over ECP.', 'protocol');
    next.channelKeys = cap('unsupported', 'Roku ECP has no channel up/down keys.');
    next.appLaunch = cap('supported', 'Roku /launch endpoint.', 'protocol');
    next.appList = cap('supported', 'Roku /query/apps endpoint.', 'protocol');
    next.inputSelection = cap('unsupported', 'Roku ECP has no input selection endpoint.');
    next.settingsKey = cap('supported', 'Settings key over ECP.', 'protocol');
    next.screenCapture = cap('unsupported', 'Roku ECP exposes no screen capture.');
    next.audioCapture = cap('unsupported', 'Roku ECP carries no display audio.');
  }
  if (!atvOpen && !rokuOpen && castOpen) {
    next.remote = cap(
      'unsupported',
      'Only Google Cast was found. Casting cannot control or mirror the TV display.',
      'protocol',
    );
    next.screenCapture = cap('unsupported', 'Cast receivers do not expose the TV display.', 'protocol');
  }
  if (!atvOpen && !adbOpen && next.remote.state === 'unknown') {
    next.remote = cap('unsupported', 'No supported control protocol answered.', 'protocol');
  }
  return next;
}

export const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  remote: 'Remote control',
  keyboardText: 'Keyboard text',
  power: 'Power key',
  volume: 'Volume',
  mute: 'Mute',
  mediaTransport: 'Playback',
  channelKeys: 'Channel keys',
  appLaunch: 'App launch',
  appList: 'App list',
  screenCapture: 'Screen capture',
  continuousStream: 'Live video',
  audioCapture: 'Audio capture',
  pointerInput: 'Pointer input',
  inputSelection: 'Input source',
  settingsKey: 'Settings key',
  hardwareEncoding: 'HW encode',
  adb: 'ADB',
  receiverInstall: 'TV receiver',
};
