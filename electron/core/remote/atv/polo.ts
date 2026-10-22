/**
 * Google TV pairing protocol ("polo") message layer.
 * Source of truth: android.googlesource.com/platform/external/google-tv-pairing-protocol
 * proto/polo.proto, plus the Android TV Remote v2 implementation notes.
 */
import { ProtoWriter, decodeMessage, getBytes, getUint, type ProtoMessage } from './protobuf';

export const POLO_STATUS_OK = 200;
export const POLO_STATUS_ERROR = 400;
export const POLO_STATUS_BAD_CONFIGURATION = 401;
export const POLO_STATUS_BAD_SECRET = 402;

export const PAIRING_SERVICE_NAME = 'atvremote';
export const PAIRING_CODE_LENGTH = 6;

export type PoloIncoming =
  | { kind: 'pairing-request-ack'; serverName?: string }
  | { kind: 'options' }
  | { kind: 'configuration-ack' }
  | { kind: 'secret-ack' }
  | { kind: 'error'; status: number; detail: string }
  | { kind: 'unknown'; detail: string };

function outer(body: (w: ProtoWriter) => void, status = POLO_STATUS_OK): Buffer {
  const w = new ProtoWriter();
  w.uintAlways(1, 2);
  w.uintAlways(2, status);
  body(w);
  return w.finish();
}

export function encodePairingRequest(clientName: string): Buffer {
  return outer((w) => {
    w.message(10, (m) => {
      m.string(1, PAIRING_SERVICE_NAME);
      m.string(2, clientName);
    });
  });
}

/** Client advertises that it can type a 6-symbol hex code. */
export function encodeOptionsInput(): Buffer {
  return outer((w) => {
    w.message(20, (m) => {
      m.message(1, (enc) => {
        enc.uintAlways(1, 3); // ENCODING_TYPE_HEXADECIMAL
        enc.uintAlways(2, PAIRING_CODE_LENGTH);
      });
      m.uintAlways(3, 1); // ROLE_TYPE_INPUT
    });
  });
}

export function encodeConfiguration(): Buffer {
  return outer((w) => {
    w.message(30, (m) => {
      m.message(1, (enc) => {
        enc.uintAlways(1, 3);
        enc.uintAlways(2, PAIRING_CODE_LENGTH);
      });
      m.uintAlways(2, 1); // ROLE_TYPE_INPUT
    });
  });
}

export function encodeSecret(secret: Uint8Array): Buffer {
  return outer((w) => {
    w.message(40, (m) => m.bytes(1, secret));
  });
}

export function encodeAckSecret(secret: Uint8Array): Buffer {
  return outer((w) => {
    w.message(41, (m) => m.bytes(1, secret));
  });
}

export function parsePoloMessage(buf: Buffer): PoloIncoming {
  let msg: ProtoMessage;
  try {
    msg = decodeMessage(buf);
  } catch (err) {
    return { kind: 'error', status: POLO_STATUS_ERROR, detail: `Malformed pairing message: ${(err as Error).message}` };
  }
  const status = getUint(msg, 2) ?? POLO_STATUS_OK;
  if (status !== POLO_STATUS_OK) {
    const detail =
      status === POLO_STATUS_BAD_SECRET
        ? 'The TV rejected the pairing code.'
        : status === POLO_STATUS_BAD_CONFIGURATION
          ? 'The TV rejected the pairing configuration.'
          : `The TV reported pairing status ${status}.`;
    return { kind: 'error', status, detail };
  }
  if (msg.has(11)) {
    const ack = decodeMessage(getBytes(msg, 11) ?? Buffer.alloc(0));
    return { kind: 'pairing-request-ack', serverName: getBytes(ack, 1)?.toString('utf8') };
  }
  if (msg.has(20)) return { kind: 'options' };
  if (msg.has(31)) return { kind: 'configuration-ack' };
  if (msg.has(41)) return { kind: 'secret-ack' };
  return { kind: 'unknown', detail: `Unhandled pairing message (fields: ${[...msg.keys()].join(',')})` };
}
