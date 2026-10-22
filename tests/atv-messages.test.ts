import { describe, expect, it } from 'vitest';
import {
  ATV_CLIENT_FEATURES,
  ATV_FEATURE,
  KEY_CODES,
  encodeAppLink,
  encodeImeBatchEdit,
  encodeKeyCodeInject,
  encodeKeyInject,
  encodePingRequest,
  encodePingResponse,
  encodeRemoteConfigure,
  encodeSetActive,
  parseRemoteMessage,
} from '../electron/core/remote/atv/messages';
import { ProtoWriter, decodeMessage, getBytes, getString, getUint } from '../electron/core/remote/atv/protobuf';

describe('RemoteConfigure', () => {
  it('requests the 622 feature mask and identifies this client', () => {
    const outer = decodeMessage(encodeRemoteConfigure('TellyMote', 'TellyMote', '1.0.0'));
    const configure = decodeMessage(getBytes(outer, 1) as Buffer);
    expect(getUint(configure, 1)).toBe(622);
    const info = decodeMessage(getBytes(configure, 2) as Buffer);
    expect(getString(info, 1)).toBe('TellyMote');
    expect(getString(info, 2)).toBe('TellyMote');
    expect(getString(info, 5)).toBe('atvremote');
    expect(getString(info, 6)).toBe('1.0.0');
  });

  it('parses the TV reply, whose code field is a feature bitmask', () => {
    const w = new ProtoWriter();
    w.message(1, (m) => {
      m.uintAlways(1, 604);
      m.message(2, (info) => {
        info.string(1, 'Mi TV 4A');
        info.string(2, 'Xiaomi');
        info.string(6, '2.3.4');
      });
    });
    const parsed = parseRemoteMessage(w.finish());
    expect(parsed.kind).toBe('configured');
    if (parsed.kind !== 'configured') return;
    expect(parsed.info.code).toBe(604);
    expect(parsed.info.model).toBe('Mi TV 4A');
    expect(parsed.info.vendor).toBe('Xiaomi');
    expect(parsed.info.appVersion).toBe('2.3.4');
  });

  it('treats a missing mask as unknown rather than zero', () => {
    const w = new ProtoWriter();
    w.message(1, (m) => m.string(1, 'Legacy box'));
    const parsed = parseRemoteMessage(w.finish());
    expect(parsed.kind).toBe('configured');
    if (parsed.kind !== 'configured') return;
    expect(parsed.info.code).toBeNull();
  });
});

describe('feature negotiation', () => {
  it('encodes SetActive as a bitmask, not a boolean', () => {
    const parsed = decodeMessage(encodeSetActive(622));
    const active = decodeMessage(getBytes(parsed, 2) as Buffer);
    expect(getUint(active, 1)).toBe(622);
  });

  it('keeps a zero mask on the wire when the TV advertises nothing', () => {
    const parsed = decodeMessage(encodeSetActive(0));
    const active = decodeMessage(getBytes(parsed, 2) as Buffer);
    expect(getUint(active, 1)).toBe(0);
  });

  it('exposes the individual feature bits used by callers', () => {
    const requested =
      ATV_FEATURE.KEY |
      ATV_FEATURE.IME |
      ATV_FEATURE.VOICE |
      ATV_FEATURE.POWER |
      ATV_FEATURE.VOLUME |
      ATV_FEATURE.APP_LINK;
    expect(ATV_CLIENT_FEATURES).toBe(requested);
    expect(ATV_CLIENT_FEATURES).toBe(622);
    // The client pings regardless, but does not ask the TV for its PING feature.
    expect(ATV_CLIENT_FEATURES & ATV_FEATURE.PING).toBe(0);
    expect(ATV_CLIENT_FEATURES & ATV_FEATURE.KEY).not.toBe(0);
    expect(ATV_CLIENT_FEATURES & ATV_FEATURE.IME).not.toBe(0);
    expect(ATV_CLIENT_FEATURES & 16).toBe(0);
  });
});

describe('key injection', () => {
  it('uses Android KeyEvent codes for every remote key', () => {
    expect(KEY_CODES.power).toBe(26);
    expect(KEY_CODES.up).toBe(19);
    expect(KEY_CODES.down).toBe(20);
    expect(KEY_CODES.left).toBe(21);
    expect(KEY_CODES.right).toBe(22);
    expect(KEY_CODES.select).toBe(23);
    expect(KEY_CODES.back).toBe(4);
    expect(KEY_CODES.home).toBe(3);
    expect(KEY_CODES.menu).toBe(82);
    expect(KEY_CODES.volumeUp).toBe(24);
    expect(KEY_CODES.volumeDown).toBe(25);
    expect(KEY_CODES.mute).toBe(164);
    expect(KEY_CODES.playPause).toBe(85);
    expect(KEY_CODES.channelUp).toBe(166);
    expect(KEY_CODES.channelDown).toBe(167);
    expect(KEY_CODES.backspace).toBe(67);
  });

  it('has a unique code for every key name', () => {
    const codes = Object.values(KEY_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    expect(Object.keys(KEY_CODES)).toHaveLength(26);
  });

  it('encodes short presses with direction 3', () => {
    const outer = decodeMessage(encodeKeyInject('home'));
    const key = decodeMessage(getBytes(outer, 10) as Buffer);
    expect(getUint(key, 1)).toBe(3);
    expect(getUint(key, 2)).toBe(3);
  });

  it('encodes long-press start and end', () => {
    const start = decodeMessage(getBytes(decodeMessage(encodeKeyInject('select', 'startLong')), 10) as Buffer);
    expect(getUint(start, 1)).toBe(23);
    expect(getUint(start, 2)).toBe(1);

    const end = decodeMessage(getBytes(decodeMessage(encodeKeyInject('select', 'endLong')), 10) as Buffer);
    expect(getUint(end, 2)).toBe(2);
  });

  it('keeps raw key-code injection available for unsupported keys', () => {
    const parsed = decodeMessage(getBytes(decodeMessage(encodeKeyCodeInject(999)), 10) as Buffer);
    expect(getUint(parsed, 1)).toBe(999);
    expect(getUint(parsed, 2)).toBe(3);
  });
});

describe('ping and app link', () => {
  it('round-trips a ping request/response sequence number', () => {
    const request = parseRemoteMessage(encodePingRequest(7));
    expect(request).toEqual({ kind: 'ping-request', val1: 7 });

    const response = parseRemoteMessage(encodePingResponse(7));
    expect(response).toEqual({ kind: 'ping-response', val1: 7 });
  });

  it('encodes app links on field 90', () => {
    const outer = decodeMessage(encodeAppLink('https://www.netflix.com/title/81040344'));
    const link = decodeMessage(getBytes(outer, 90) as Buffer);
    expect(getString(link, 1)).toBe('https://www.netflix.com/title/81040344');
  });

  it('encodes IME batch edits with the shape the TV expects', () => {
    const outer = decodeMessage(encodeImeBatchEdit('hello', 3, 2));
    const ime = decodeMessage(getBytes(outer, 21) as Buffer);
    expect(getUint(ime, 1)).toBe(3);
    expect(getUint(ime, 2)).toBe(2);
    const edit = decodeMessage(getBytes(ime, 3) as Buffer);
    expect(getUint(edit, 1)).toBe(1);
    const field = decodeMessage(getBytes(edit, 2) as Buffer);
    expect(getUint(field, 1)).toBe(4);
    expect(getUint(field, 2)).toBe(4);
    expect(getString(field, 3)).toBe('hello');
  });
});

describe('incoming remote messages', () => {
  it('parses volume state including mute', () => {
    const w = new ProtoWriter();
    w.message(50, (m) => {
      m.uintAlways(7, 0); // level 0 must still be encoded
      m.uintAlways(6, 100);
      m.uintAlways(8, 1);
    });
    expect(parseRemoteMessage(w.finish())).toEqual({ kind: 'volume', level: 0, max: 100, muted: true });
  });

  it('parses power state', () => {
    const on = new ProtoWriter();
    on.message(40, (m) => m.uintAlways(1, 1));
    expect(parseRemoteMessage(on.finish())).toEqual({ kind: 'start', started: true });

    const off = new ProtoWriter();
    off.message(40, (m) => m.uintAlways(1, 0));
    expect(parseRemoteMessage(off.finish())).toEqual({ kind: 'start', started: false });
  });

  it('parses the IME app package and counters', () => {
    const w = new ProtoWriter();
    w.message(20, (m) => {
      m.message(1, (app) => {
        app.uintAlways(1, 4);
        app.string(12, 'com.netflix.ninja');
      });
      m.message(2, (field) => field.uintAlways(1, 9));
    });
    const parsed = parseRemoteMessage(w.finish());
    expect(parsed).toEqual({
      kind: 'ime',
      packageName: 'com.netflix.ninja',
      counter: 9,
      fieldCounter: 4,
    });
  });

  it('reports TV-side errors instead of pretending the session is ready', () => {
    const w = new ProtoWriter();
    w.message(3, (m) => {
      m.uintAlways(1, 1);
      m.bytes(2, encodePingResponse(1));
    });
    const parsed = parseRemoteMessage(w.finish());
    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') return;
    expect(parsed.message).toMatch(/TV reported an error/);
  });

  it('surfaces unknown fields for diagnostics', () => {
    const w = new ProtoWriter();
    w.uintAlways(99, 1);
    expect(parseRemoteMessage(w.finish())).toEqual({ kind: 'unknown', fields: [99] });
  });

  it('throws on malformed payloads rather than guessing', () => {
    expect(() => parseRemoteMessage(Buffer.from([0x08]))).toThrow();
  });
});
