/**
 * Interactive pairing with the Android TV Remote Service (pairing port 6467).
 *
 * Flow (Google TV pairing protocol):
 *   client → PairingRequest(service=atvremote, client_name)
 *   TV     → PairingRequestAck → client sends Options(input, hex, 6)
 *   TV     → Options            → client sends Configuration(hex, 6, input)
 *   TV     → ConfigurationAck   → TV shows a 6-character hex code
 *   client → Secret(sha256(...))→ TV     → SecretAck
 */
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { appError, describeNodeError, isTlsTrustFailure, type AppError } from '../../errors';
import type { ClientCertificate } from '../../security/identity';
import { computePairingSecret } from '../../security/identity';
import { FrameDecoder, frame, ProtoError } from './protobuf';
import {
  encodeConfiguration,
  encodeOptionsInput,
  encodePairingRequest,
  encodeSecret,
  parsePoloMessage,
} from './polo';
import { ATV_PAIRING_PORT } from './messages';

type PairingStage = 'connecting' | 'requesting' | 'configuring' | 'awaiting-code' | 'verifying' | 'done' | 'failed';

export class AtvPairingSession extends EventEmitter {
  private socket: tls.TLSSocket | null = null;
  private readonly decoder = new FrameDecoder();
  private stage: PairingStage = 'connecting';
  private serverCertDer: Buffer | null = null;
  private serverFingerprint: string | null = null;
  private serverName: string | undefined;
  private readonly startedAt = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private finished = false;

  constructor(
    private readonly host: string,
    private readonly certificate: ClientCertificate,
    private readonly clientName = 'LumaRemote',
    private readonly port = ATV_PAIRING_PORT,
  ) {
    super();
  }

  /**
   * Opens the pairing connection and waits until the TV displays a code.
   * Resolves only after ConfigurationAck, so the UI can show the code field at
   * exactly the right moment.
   */
  async start(): Promise<void> {
    if (this.socket) throw new Error('Pairing session already started');
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = tls.connect({
        host: this.host,
        port: this.port,
        cert: this.certificate.certPem,
        key: this.certificate.keyPem,
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
        minVersion: 'TLSv1.2',
        timeout: 7000,
      });
      this.socket = socket;

      const failStart = (err: AppError) => {
        if (settled) return;
        settled = true;
        this.finish();
        reject(err);
      };

      socket.once('secureConnect', () => {
        const peer = socket.getPeerCertificate();
        if (!peer?.raw) {
          failStart(appError('CERT_REJECTED', 'The TV did not present a pairing certificate.'));
          return;
        }
        this.serverCertDer = Buffer.from(peer.raw);
        this.serverFingerprint = peer.fingerprint256 ?? null;
        socket.setTimeout(0);
        this.stage = 'requesting';
        this.write(encodePairingRequest(this.clientName));
        this.armTimer(15000, 'start');
      });

      socket.on('error', (err) => {
        const details = describeNodeError(err);
        const mapped = isTlsTrustFailure(err)
          ? appError('CERT_REJECTED', 'The TV refused the pairing connection.', details.message)
          : appError('UNREACHABLE', 'Could not open the pairing connection.', details.message);
        if (!settled) failStart(mapped);
        else this.fail(mapped);
      });

      socket.on('data', (chunk) => this.onData(chunk));

      socket.once('close', () => {
        if (!this.finished) {
          this.fail(
            this.stage === 'awaiting-code'
              ? appError('PAIRING_TIMEOUT', 'The pairing window closed before a code was entered.')
              : appError('PAIRING_TIMEOUT', 'The TV closed the pairing connection.'),
          );
        }
      });

      this.once('code-required', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      this.once('failure', (err: AppError) => {
        if (!settled) failStart(err);
      });
    });
  }

  get isAwaitingCode(): boolean {
    return this.stage === 'awaiting-code' && !this.finished;
  }

  get fingerprint(): string | null {
    return this.serverFingerprint;
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  async submitCode(code: string): Promise<void> {
    if (!this.socket || this.stage !== 'awaiting-code' || this.finished) {
      throw appError('PAIRING_TIMEOUT', 'There is no active pairing request. Start pairing again.');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(code)) {
      throw appError('INVALID_INPUT', 'Enter the 6-character code shown on the TV (0-9, A-F).');
    }
    if (!this.serverCertDer) {
      throw appError('INTERNAL', 'Missing the TV certificate for this pairing session.');
    }
    const { secret, codePlausible } = computePairingSecret(this.certificate.certPem, this.serverCertDer, code);
    if (!codePlausible) {
      throw appError(
        'PAIRING_REJECTED',
        'That code does not match this pairing request.',
        'The first two characters are a checksum of the code shown on the TV. Re-read the code.',
      );
    }
    this.stage = 'verifying';
    this.write(encodeSecret(secret));
    this.armTimer(15000, 'verify');
  }

  cancel(): void {
    this.finish();
    this.emit('closed');
  }

  private onData(chunk: Buffer): void {
    let frames: Buffer[];
    try {
      frames = this.decoder.push(chunk);
    } catch (err) {
      this.fail(appError('INTERNAL', 'The TV sent a malformed pairing message.', (err as ProtoError).message));
      return;
    }
    for (const payload of frames) {
      const msg = parsePoloMessage(payload);
      if (msg.kind === 'error') {
        this.fail(appError('PAIRING_REJECTED', msg.detail));
        return;
      }
      if (msg.kind === 'pairing-request-ack' && this.stage === 'requesting') {
        this.serverName = msg.serverName;
        this.write(encodeOptionsInput());
        this.stage = 'configuring';
        return;
      }
      if (msg.kind === 'options' && this.stage === 'configuring') {
        this.write(encodeConfiguration());
        return;
      }
      if (msg.kind === 'configuration-ack' && this.stage === 'configuring') {
        this.stage = 'awaiting-code';
        this.clearTimer();
        this.armTimer(90000, 'code');
        this.emit('code-required', { serverName: this.serverName });
        return;
      }
      if (msg.kind === 'secret-ack' && this.stage === 'verifying') {
        this.finished = true;
        this.stage = 'done';
        this.clearTimer();
        this.socket?.end();
        this.emit('paired', { fingerprint: this.serverFingerprint ?? '' });
        return;
      }
      this.fail(appError('INTERNAL', `Unexpected pairing message: ${msg.kind}`));
      return;
    }
  }

  private armTimer(ms: number, stage: 'start' | 'code' | 'verify'): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      if (stage === 'start') this.fail(appError('PAIRING_TIMEOUT', 'The TV did not start pairing.'));
      else if (stage === 'code') this.fail(appError('PAIRING_TIMEOUT', 'The pairing code expired. Start again.'));
      else this.fail(appError('PAIRING_TIMEOUT', 'The TV did not confirm the pairing code.'));
    }, ms);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private write(payload: Buffer): void {
    this.socket?.write(frame(payload));
  }

  private fail(err: AppError): void {
    if (this.finished) return;
    this.finished = true;
    this.stage = 'failed';
    this.finish();
    this.emit('failure', err);
  }

  private finish(): void {
    this.clearTimer();
    if (this.socket) {
      this.socket.removeAllListeners('data');
      this.socket.removeAllListeners('error');
      try {
        this.socket.destroy();
      } catch {
        /* already closed */
      }
      this.socket = null;
    }
  }
}
