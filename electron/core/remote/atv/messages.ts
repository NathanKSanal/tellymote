/**
 * Android TV Remote Service v2 message layer (TLS, port 6466).
 * Proto reference: remotemessage.proto from the Android TV Remote Service,
 * mirrored at github.com/louis49/androidtv-remote and tronikos/androidtvremote2.
 */
import type { RemoteKey } from '../../../../shared/types';
import { ProtoWriter, decodeMessage, getBytes, getString, getUint, type ProtoMessage } from './protobuf';

export const ATV_REMOTE_PORT = 6466;
export const ATV_PAIRING_PORT = 6467;
export const ATV_PROTOCOL_VERSION = 2;
/** PING | KEY | IME | VOICE | POWER | VOLUME | APP_LINK. */
export const ATV_CLIENT_FEATURES = 622;
export const ATV_FEATURE = {
  PING: 1,
  KEY: 2,
  IME: 4,
  VOICE: 8,
  POWER: 32,
  VOLUME: 64,
  APP_LINK: 512,
} as const;
/** Kept for older call sites: the feature mask this client requests. */
export const ATV_CONFIGURE_CODE = ATV_CLIENT_FEATURES;

export const KEY_CODES: Record<RemoteKey, number> = {
  power: 26,
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  select: 23,
  back: 4,
  home: 3,
  menu: 82,
  settings: 176,
  volumeUp: 24,
  volumeDown: 25,
  mute: 164,
  playPause: 85,
  rewind: 89,
  fastForward: 90,
  next: 87,
  previous: 88,
  channelUp: 166,
  channelDown: 167,
  input: 178,
  info: 165,
  guide: 172,
  backspace: 67,
  sleep: 223,
  wake: 224,
};

export const KEYCODE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(KEY_CODES).map(([name, code]) => [code, name]),
);

export type RemoteDirection = 'short' | 'startLong' | 'endLong';
const DIRECTION: Record<RemoteDirection, number> = { startLong: 1, endLong: 2, short: 3 };

export function encodeRemoteConfigure(model: string, vendor: string, appVersion = '1.0.0'): Buffer {
  const w = new ProtoWriter();
  w.message(1, (m) => {
    m.uintAlways(1, ATV_CLIENT_FEATURES);
    m.message(2, (info) => {
      info.string(1, model);
      info.string(2, vendor);
      info.uint(3, 1);
      info.string(4, '1');
      info.string(5, 'atvremote');
      info.string(6, appVersion);
    });
  });
  return w.finish();
}

/** `active` is a feature bitmask, not a boolean. */
export function encodeSetActive(features: number): Buffer {
  const w = new ProtoWriter();
  w.message(2, (m) => m.uintAlways(1, features));
  return w.finish();
}

export function encodeKeyInject(key: RemoteKey, direction: RemoteDirection = 'short'): Buffer {
  const w = new ProtoWriter();
  w.message(10, (m) => {
    m.uintAlways(1, KEY_CODES[key]);
    m.uintAlways(2, DIRECTION[direction]);
  });
  return w.finish();
}

export function encodeKeyCodeInject(keyCode: number, direction: RemoteDirection = 'short'): Buffer {
  const w = new ProtoWriter();
  w.message(10, (m) => {
    m.uintAlways(1, keyCode);
    m.uintAlways(2, DIRECTION[direction]);
  });
  return w.finish();
}

export function encodePingRequest(val1: number, val2 = 0): Buffer {
  const w = new ProtoWriter();
  w.message(8, (m) => {
    m.uintAlways(1, val1);
    m.uint(2, val2);
  });
  return w.finish();
}

export function encodePingResponse(val1: number): Buffer {
  const w = new ProtoWriter();
  w.message(9, (m) => m.uintAlways(1, val1));
  return w.finish();
}

export function encodeAppLink(appLink: string): Buffer {
  const w = new ProtoWriter();
  w.message(90, (m) => m.string(1, appLink));
  return w.finish();
}

/**
 * Text injection over the remote protocol. This is the batch-edit message the
 * TV expects after it has shown a keyboard (RemoteImeKeyInject). Firmware still
 * varies, so the UI only offers it as experimental; ADB text entry is the
 * verified path.
 */
export function encodeImeBatchEdit(text: string, imeCounter = 1, fieldCounter = 1): Buffer {
  const w = new ProtoWriter();
  w.message(21, (m) => {
    m.uintAlways(1, imeCounter);
    m.uintAlways(2, fieldCounter);
    m.message(3, (edit) => {
      edit.uintAlways(1, 1); // insert
      edit.message(2, (field) => {
        field.uintAlways(1, Math.max(0, text.length - 1));
        field.uintAlways(2, Math.max(0, text.length - 1));
        field.string(3, text);
      });
    });
  });
  return w.finish();
}

export interface RemoteConfigured {
  code: number | null;
  model?: string;
  vendor?: string;
  appVersion?: string;
}

export type ParsedRemote =
  | { kind: 'configured'; info: RemoteConfigured }
  | { kind: 'ping-response'; val1: number }
  | { kind: 'ping-request'; val1: number }
  | { kind: 'error'; message: string }
  | { kind: 'volume'; level: number; max: number; muted: boolean }
  | { kind: 'start'; started: boolean }
  | { kind: 'ime'; packageName: string | null; counter: number | null; fieldCounter: number | null }
  | { kind: 'unknown'; fields: number[] };

function parseConfigured(msg: ProtoMessage): RemoteConfigured {
  const code = getUint(msg, 1) ?? null;
  const infoBytes = getBytes(msg, 2);
  if (!infoBytes) return { code };
  const info = decodeMessage(infoBytes);
  return {
    code,
    model: getString(info, 1),
    vendor: getString(info, 2),
    appVersion: getString(info, 6),
  };
}

export function parseRemoteMessage(buf: Buffer): ParsedRemote {
  const msg = decodeMessage(buf);
  if (msg.has(1)) return { kind: 'configured', info: parseConfigured(decodeMessage(getBytes(msg, 1) ?? Buffer.alloc(0))) };
  if (msg.has(3)) {
    const err = decodeMessage(getBytes(msg, 3) ?? Buffer.alloc(0));
    const inner = getBytes(err, 2);
    let detail = 'The TV rejected the remote session.';
    if (inner) {
      const parsed = parseRemoteMessage(inner);
      detail = `The TV reported an error (${parsed.kind}).`;
    }
    return { kind: 'error', message: detail };
  }
  if (msg.has(9)) {
    return { kind: 'ping-response', val1: getUint(decodeMessage(getBytes(msg, 9) ?? Buffer.alloc(0)), 1) ?? 0 };
  }
  if (msg.has(8)) {
    return { kind: 'ping-request', val1: getUint(decodeMessage(getBytes(msg, 8) ?? Buffer.alloc(0)), 1) ?? 0 };
  }
  if (msg.has(50)) {
    const vol = decodeMessage(getBytes(msg, 50) ?? Buffer.alloc(0));
    return {
      kind: 'volume',
      level: getUint(vol, 7) ?? 0,
      max: getUint(vol, 6) ?? 100,
      muted: (getUint(vol, 8) ?? 0) === 1,
    };
  }
  if (msg.has(40)) {
    return { kind: 'start', started: (getUint(decodeMessage(getBytes(msg, 40) ?? Buffer.alloc(0)), 1) ?? 0) === 1 };
  }
  if (msg.has(20)) {
    const ime = decodeMessage(getBytes(msg, 20) ?? Buffer.alloc(0));
    const app = decodeMessage(getBytes(ime, 1) ?? Buffer.alloc(0));
    const field = decodeMessage(getBytes(ime, 2) ?? Buffer.alloc(0));
    return {
      kind: 'ime',
      packageName: getString(app, 12) ?? null,
      counter: getUint(field, 1) ?? null,
      fieldCounter: getUint(app, 1) ?? null,
    };
  }
  return { kind: 'unknown', fields: [...msg.keys()] };
}
