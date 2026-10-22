import { once } from 'node:events';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AtvPairingSession } from '../electron/core/remote/atv/pairing';
import { FrameDecoder, ProtoWriter, decodeMessage, frame, getBytes } from '../electron/core/remote/atv/protobuf';
import { computePairingSecret, generateClientCertificate, type ClientCertificate } from '../electron/core/security/identity';
import { makeCertificate, type TestCertificate } from './helpers/certs';

let clientCert: ClientCertificate;
let serverCert: TestCertificate;
const openServers: tls.Server[] = [];

beforeAll(() => {
  clientCert = generateClientCertificate();
  serverCert = makeCertificate('Mock TV', 'server');
});

afterEach(() => {
  for (const server of openServers.splice(0)) {
    server.close();
    server.closeAllConnections?.();
  }
});

function reply(socket: tls.TLSSocket, field: number, body: (w: ProtoWriter) => void): void {
  const w = new ProtoWriter();
  w.message(field, body);
  socket.write(frame(w.finish()));
}

interface MockPairing {
  port: number;
  received: { request?: Buffer; options?: Buffer; configuration?: Buffer; secret?: Buffer };
  session: tls.Server;
}

/** Minimal TV-side pairing responder: ACK → options → configuration ack → secret ack. */
async function startMockPairing(): Promise<MockPairing> {
  const received: MockPairing['received'] = {};
  const session = tls.createServer(
    { key: serverCert.keyPem, cert: serverCert.certPem, minVersion: 'TLSv1.2' },
    (socket) => {
      const decoder = new FrameDecoder();
      socket.on('error', () => undefined);
      socket.on('data', (chunk) => {
        let frames: Buffer[];
        try {
          frames = decoder.push(chunk);
        } catch {
          return;
        }
        for (const payload of frames) {
          const msg = decodeMessage(payload);
          if (msg.has(10)) {
            received.request = payload;
            reply(socket, 11, (w) => w.string(1, 'Mock TV'));
          } else if (msg.has(20)) {
            received.options = payload;
            reply(socket, 20, (w) => w.uintAlways(1, 1));
          } else if (msg.has(30)) {
            received.configuration = payload;
            reply(socket, 31, (w) => w.uintAlways(1, 1));
          } else if (msg.has(40)) {
            const outer = decodeMessage(payload);
            const secret = getBytes(decodeMessage(getBytes(outer, 40) as Buffer), 1);
            received.secret = secret;
            reply(socket, 41, (w) => w.bytes(1, secret));
          }
        }
      });
    },
  );
  openServers.push(session);
  await new Promise<void>((resolve) => session.listen(0, '127.0.0.1', resolve));
  const port = (session.address() as AddressInfo).port;
  return { port, received, session };
}

async function begin(port: number): Promise<AtvPairingSession> {
  const pairing = new AtvPairingSession('127.0.0.1', clientCert, 'Test Client', port);
  const required = once(pairing, 'code-required');
  await pairing.start();
  await required;
  return pairing;
}

describe('Android TV pairing session', () => {
  it('walks ACK → options → configuration → code and completes with SecretAck', async () => {
    const mock = await startMockPairing();
    const pairing = await begin(mock.port);

    expect(pairing.isAwaitingCode).toBe(true);
    expect(pairing.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

    const base = computePairingSecret(clientCert.certPem, serverCert.der, '00abcd');
    const code = `${base.secret[0].toString(16).padStart(2, '0')}abcd`;
    const paired = once(pairing, 'paired');
    await pairing.submitCode(code);
    const [result] = await paired;

    expect(result.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(mock.received.request?.length).toBeGreaterThan(0);
    expect(mock.received.options?.length).toBeGreaterThan(0);
    expect(mock.received.configuration?.length).toBeGreaterThan(0);
    expect(mock.received.secret).toEqual(base.secret);
    expect(pairing.isAwaitingCode).toBe(false);
  });

  it('refuses an implausible code before sending it to the TV', async () => {
    const mock = await startMockPairing();
    const pairing = await begin(mock.port);

    const base = computePairingSecret(clientCert.certPem, serverCert.der, '00abcd');
    const badPrefix = ((base.secret[0] + 1) % 256).toString(16).padStart(2, '0');
    const error = await pairing.submitCode(`${badPrefix}abcd`).then(
      () => null,
      (err: { code?: string; message?: string }) => err,
    );

    expect(error?.code).toBe('PAIRING_REJECTED');
    expect(error?.message).toMatch(/does not match/);
    expect(mock.received.secret).toBeUndefined();
    pairing.cancel();
  });

  it('validates the code format locally', async () => {
    const mock = await startMockPairing();
    const pairing = await begin(mock.port);

    for (const bad of ['', '12345', '1234567', 'zzzzzz', '12 34 56']) {
      const error = await pairing.submitCode(bad).then(
        () => null,
        (err: { code?: string }) => err,
      );
      expect(error?.code, bad).toBe('INVALID_INPUT');
    }
    pairing.cancel();
  });

  it('cannot submit a code after the session is cancelled', async () => {
    const mock = await startMockPairing();
    const pairing = await begin(mock.port);
    pairing.cancel();
    const error = await pairing.submitCode('00abcd').then(
      () => null,
      (err: { code?: string }) => err,
    );
    expect(error?.code).toBe('PAIRING_TIMEOUT');
  });

  it('fails clearly when the TV rejects the pairing code', async () => {
    const rejecting = tls.createServer(
      { key: serverCert.keyPem, cert: serverCert.certPem, minVersion: 'TLSv1.2' },
      (socket) => {
        const decoder = new FrameDecoder();
        socket.on('error', () => undefined);
        socket.on('data', (chunk) => {
          for (const payload of decoder.push(chunk)) {
            const msg = decodeMessage(payload);
            if (msg.has(10)) reply(socket, 11, (w) => w.string(1, 'Strict TV'));
            else if (msg.has(20)) reply(socket, 20, (w) => w.uintAlways(1, 1));
            else if (msg.has(30)) reply(socket, 31, (w) => w.uintAlways(1, 1));
            else if (msg.has(40)) {
              const w = new ProtoWriter();
              w.uintAlways(1, 2);
              w.uintAlways(2, 402);
              socket.write(frame(w.finish()));
            }
          }
        });
      },
    );
    openServers.push(rejecting);
    await new Promise<void>((resolve) => rejecting.listen(0, '127.0.0.1', resolve));
    const port = (rejecting.address() as AddressInfo).port;

    const pairing = await begin(port);
    const base = computePairingSecret(clientCert.certPem, serverCert.der, '00abcd');
    const code = `${base.secret[0].toString(16).padStart(2, '0')}abcd`;
    const outcome = Promise.race([
      once(pairing, 'paired').then(() => 'paired'),
      once(pairing, 'failure').then(() => 'failed'),
    ]);
    await pairing.submitCode(code);
    expect(await outcome).toBe('failed');
  });
});
