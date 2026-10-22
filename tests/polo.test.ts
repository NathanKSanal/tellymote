import { describe, expect, it } from 'vitest';
import {
  PAIRING_SERVICE_NAME,
  POLO_STATUS_BAD_CONFIGURATION,
  POLO_STATUS_BAD_SECRET,
  encodeAckSecret,
  encodeConfiguration,
  encodeOptionsInput,
  encodePairingRequest,
  encodeSecret,
  parsePoloMessage,
} from '../electron/core/remote/atv/polo';
import { ProtoWriter, decodeMessage, getBytes, getString, getUint } from '../electron/core/remote/atv/protobuf';

function outer(body: (w: ProtoWriter) => void, status: number): Buffer {
  const w = new ProtoWriter();
  w.uintAlways(1, 2);
  w.uintAlways(2, status);
  body(w);
  return w.finish();
}

describe('polo client messages', () => {
  it('encodes a pairing request for the atvremote service', () => {
    const msg = decodeMessage(encodePairingRequest('TellyMote'));
    expect(getUint(msg, 1)).toBe(2);
    expect(getUint(msg, 2)).toBe(200);
    const request = decodeMessage(getBytes(msg, 10) as Buffer);
    expect(getString(request, 1)).toBe(PAIRING_SERVICE_NAME);
    expect(getString(request, 2)).toBe('TellyMote');
  });

  it('advertises 6-character hexadecimal input', () => {
    const msg = decodeMessage(encodeOptionsInput());
    const options = decodeMessage(getBytes(msg, 20) as Buffer);
    const encoding = decodeMessage(getBytes(options, 1) as Buffer);
    expect(getUint(encoding, 1)).toBe(3); // ENCODING_TYPE_HEXADECIMAL
    expect(getUint(encoding, 2)).toBe(6);
    expect(getUint(options, 3)).toBe(1); // ROLE_TYPE_INPUT
  });

  it('encodes the input configuration', () => {
    const msg = decodeMessage(encodeConfiguration());
    const configuration = decodeMessage(getBytes(msg, 30) as Buffer);
    const encoding = decodeMessage(getBytes(configuration, 1) as Buffer);
    expect(getUint(encoding, 1)).toBe(3);
    expect(getUint(encoding, 2)).toBe(6);
    expect(getUint(configuration, 2)).toBe(1);
  });

  it('encodes the secret and its acknowledgement', () => {
    const secret = Buffer.alloc(32, 7);
    const sent = decodeMessage(getBytes(decodeMessage(encodeSecret(secret)), 40) as Buffer);
    expect(getBytes(sent, 1)).toEqual(secret);

    const ack = decodeMessage(getBytes(decodeMessage(encodeAckSecret(secret)), 41) as Buffer);
    expect(getBytes(ack, 1)).toEqual(secret);
  });
});

describe('polo incoming messages', () => {
  it('parses the pairing request acknowledgement and server name', () => {
    const wire = outer((w) => w.message(11, (m) => m.string(1, 'Xiaomi TV')), 200);
    expect(parsePoloMessage(wire)).toEqual({ kind: 'pairing-request-ack', serverName: 'Xiaomi TV' });
  });

  it('parses options, configuration ack and secret ack', () => {
    expect(parsePoloMessage(outer((w) => w.message(20, (m) => m.uintAlways(1, 1)), 200))).toEqual({ kind: 'options' });
    expect(parsePoloMessage(outer((w) => w.message(31, (m) => m.uintAlways(1, 1)), 200))).toEqual({
      kind: 'configuration-ack',
    });
    expect(parsePoloMessage(outer((w) => w.message(41, (m) => m.bytes(1, Buffer.alloc(32))), 200))).toEqual({
      kind: 'secret-ack',
    });
  });

  it('maps a rejected secret to an actionable message', () => {
    const parsed = parsePoloMessage(outer(() => undefined, POLO_STATUS_BAD_SECRET));
    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') return;
    expect(parsed.status).toBe(402);
    expect(parsed.detail).toMatch(/rejected the pairing code/);
  });

  it('maps a rejected configuration and unknown statuses', () => {
    const badConfig = parsePoloMessage(outer(() => undefined, POLO_STATUS_BAD_CONFIGURATION));
    expect(badConfig.kind).toBe('error');
    if (badConfig.kind === 'error') expect(badConfig.detail).toMatch(/configuration/);

    const other = parsePoloMessage(outer(() => undefined, 500));
    expect(other.kind).toBe('error');
    if (other.kind === 'error') expect(other.detail).toContain('500');
  });

  it('reports unknown messages with their field numbers', () => {
    const wire = outer((w) => w.uintAlways(77, 1), 200);
    const parsed = parsePoloMessage(wire);
    expect(parsed.kind).toBe('unknown');
    if (parsed.kind !== 'unknown') return;
    expect(parsed.detail).toContain('77');
  });

  it('never throws on malformed pairing data', () => {
    const parsed = parsePoloMessage(Buffer.from([0x08]));
    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') return;
    expect(parsed.detail).toMatch(/Malformed pairing message/);
  });
});
