/**
 * Android TV Remote Service v2 client (TLS, port 6466; pairing uses 6467).
 *
 * The transport is request/response for session setup and fire-and-forget for
 * key presses (the protocol has no per-key acknowledgement). Latency shown in
 * the UI is therefore measured with protocol-level pings and explicitly labelled
 * as remote-service RTT, never as "TV reacted in X ms".
 */
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import type { KeyPressOptions, RemoteKey } from '../../../../shared/types';
import { appError, describeNodeError, isTlsTrustFailure, type AppError } from '../../errors';
import type { ClientCertificate } from '../../security/identity';
import { FrameDecoder, frame, ProtoError } from './protobuf';
import {
  ATV_CLIENT_FEATURES,
  ATV_FEATURE,
  ATV_REMOTE_PORT,
  encodeAppLink,
  encodeImeBatchEdit,
  encodeKeyInject,
  encodePingRequest,
  encodePingResponse,
  encodeRemoteConfigure,
  encodeSetActive,
  parseRemoteMessage,
} from './messages';

export interface AtvDeviceInfo {
  model?: string;
  vendor?: string;
  appVersion?: string;
}

interface PendingPing {
  sentAt: number;
  resolve: (rtt: number) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class AtvRemoteClient extends EventEmitter {
  private socket: tls.TLSSocket | null = null;
  private readonly decoder = new FrameDecoder();
  private readonly pendingPings = new Map<number, PendingPing>();
  private pingSeq = 1;
  private pingTimer: NodeJS.Timeout | null = null;
  private configured = false;
  private closing = false;
  private consecutivePingFailures = 0;
  private lastTapAt = 0;
  private lastTapSignature = '';

  /** Duplicate taps of the same key inside this window are coalesced. */
  readonly keyMinGapMs = 24;
  /** Number of taps dropped by the throttle (surfaced in Diagnostics). */
  suppressed = 0;

  rttMs: number | null = null;
  info: AtvDeviceInfo = {};
  peerFingerprint: string | null = null;
  lastError: string | null = null;
  commandsSent = 0;
  /** Feature bitmask negotiated with the TV. */
  features = 0;
  isOn: boolean | null = null;
  currentApp: string | null = null;
  private imeCounter = 1;
  private imeFieldCounter = 1;

  constructor(
    readonly host: string,
    private readonly certificate: ClientCertificate,
    readonly port = ATV_REMOTE_PORT,
    private readonly pingIntervalMs = 7000,
  ) {
    super();
  }

  get isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed && this.configured);
  }

  /** This TV only answers pings when it advertises the PING feature. */
  get supportsPing(): boolean {
    return (this.features & ATV_FEATURE.PING) !== 0;
  }

  private fail(error: AppError): void {
    this.lastError = error.message;
    this.configured = false;
  }

  connect(timeoutMs = 9000): Promise<AtvDeviceInfo> {
    if (this.socket) this.close();
    return new Promise<AtvDeviceInfo>((resolve, reject) => {
      let settled = false;
      const finish = (err: AppError | null, info?: AtvDeviceInfo) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else if (info) resolve(info);
      };

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
      this.closing = false;

      const timer = setTimeout(() => {
        finish(appError('REMOTE_UNAVAILABLE', 'The TV did not complete the remote session handshake.'));
        this.close();
      }, timeoutMs);

      socket.setNoDelay(true);
      socket.once('secureConnect', () => {
        const peer = socket.getPeerCertificate();
        this.peerFingerprint = peer?.fingerprint256 ?? null;
        socket.write(frame(encodeRemoteConfigure('LumaRemote', 'LumaRemote')));
      });

      socket.on('data', (chunk) => {
        try {
          for (const payload of this.decoder.push(chunk)) this.handleMessage(payload, finish);
        } catch (err) {
          this.lastError = (err as ProtoError).message;
          this.fail(appError('REMOTE_UNAVAILABLE', 'The TV sent a malformed remote message.', this.lastError));
          finish(appError('REMOTE_UNAVAILABLE', 'Malformed remote protocol response.'));
        }
      });

      socket.on('error', (err) => {
        const details = describeNodeError(err);
        this.lastError = details.message;
        const mapped = isTlsTrustFailure(err)
          ? appError('CERT_REJECTED', 'The TV rejected this laptop’s certificate. Pair the device again.', details.message)
          : appError('UNREACHABLE', 'The remote connection failed.', details.message);
        finish(mapped);
        this.fail(mapped);
      });

      socket.once('close', () => {
        this.configured = false;
        this.stopPingLoop();
        for (const [, pending] of this.pendingPings) {
          clearTimeout(pending.timer);
          pending.reject(new Error('connection closed'));
        }
        this.pendingPings.clear();
        if (!this.closing) this.emit('disconnected');
      });
    });
  }

  private handleMessage(
    payload: Buffer,
    finishConnect: (err: AppError | null, info?: AtvDeviceInfo) => void,
  ): void {
    const msg = parseRemoteMessage(payload);
    switch (msg.kind) {
      case 'configured': {
        // The TV's reply carries its supported-feature bitmask, not our
        // configure code. Negotiate the intersection before going active.
        const supported = msg.info.code ?? ATV_CLIENT_FEATURES;
        this.features = supported & ATV_CLIENT_FEATURES;
        if ((this.features & ATV_FEATURE.KEY) === 0) {
          const err = appError('REMOTE_UNAVAILABLE', 'The TV remote service reports that key injection is not supported.');
          finishConnect(err);
          this.close();
          return;
        }
        this.info = { model: msg.info.model, vendor: msg.info.vendor, appVersion: msg.info.appVersion };
        this.socket?.write(frame(encodeSetActive(this.features)));
        this.configured = true;
        this.startPingLoop();
        finishConnect(null, this.info);
        this.emit('ready', { ...this.info, features: this.features });
        if (this.supportsPing) void this.ping().catch(() => undefined);
        return;
      }
      case 'error':
        this.lastError = msg.message;
        if (!this.configured) {
          finishConnect(appError('REMOTE_UNAVAILABLE', msg.message));
          this.close();
        } else {
          // An established session should not be torn down by a rejected
          // optional message (the Mi TV rejects pings it did not advertise).
          this.emit('protocol-error', msg.message);
        }
        return;
      case 'ping-response': {
        const pending = this.pendingPings.get(msg.val1);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingPings.delete(msg.val1);
          const rtt = performance.now() - pending.sentAt;
          this.rttMs = rtt;
          this.consecutivePingFailures = 0;
          pending.resolve(rtt);
          this.emit('rtt', rtt);
        }
        return;
      }
      case 'ping-request':
        this.socket?.write(frame(encodePingResponse(msg.val1)));
        return;
      case 'volume':
        this.emit('volume', { level: msg.level, max: msg.max, muted: msg.muted });
        return;
      case 'start':
        this.isOn = msg.started;
        this.emit('power', msg.started);
        return;
      case 'ime':
        if (msg.packageName) {
          this.currentApp = msg.packageName;
          this.emit('app', msg.packageName);
        }
        if (msg.counter !== null) this.imeCounter = msg.counter;
        if (msg.fieldCounter !== null) this.imeFieldCounter = msg.fieldCounter;
        return;
      default:
        return;
    }
  }

  ping(timeoutMs = 2500): Promise<number> {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('not connected'));
    const seq = this.pingSeq;
    this.pingSeq = this.pingSeq >= 0x7fffffff ? 1 : this.pingSeq + 1;
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPings.delete(seq);
        this.consecutivePingFailures += 1;
        reject(new Error('ping timeout'));
        if (this.consecutivePingFailures >= 3) {
          this.emit('degraded', this.consecutivePingFailures);
        }
      }, timeoutMs);
      timer.unref?.();
      this.pendingPings.set(seq, { sentAt: performance.now(), resolve, reject, timer });
      this.socket?.write(frame(encodePingRequest(seq)));
    });
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    // Only probe RTT when the TV negotiated the PING feature. Some Mi TVs
    // answer an unnegotiated ping with a remote_error that closes the session.
    if (!this.supportsPing) {
      this.rttMs = null;
      return;
    }
    this.pingTimer = setInterval(() => {
      if (!this.configured) return;
      void this.ping().catch(() => undefined);
    }, this.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  private stopPingLoop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Sends a key event. Returns the local write time in ms (not a TV acknowledgement). */
  key(key: RemoteKey, options: KeyPressOptions = {}): number {
    if (!this.isConnected) throw appError('REMOTE_UNAVAILABLE', 'The remote session is not connected.');
    const action = options.action ?? 'tap';
    const now = performance.now();
    // Rapid repeats of the same tap would flood the TV and change nothing: the
    // TV coalesces them anyway. Distinct keys and long-press edges always pass.
    if (action === 'tap') {
      const signature = `${key}`;
      if (signature === this.lastTapSignature && now - this.lastTapAt < this.keyMinGapMs) {
        this.suppressed += 1;
        return 0;
      }
      this.lastTapSignature = signature;
      this.lastTapAt = now;
    }
    const started = performance.now();
    if (action === 'down') {
      this.socket?.write(frame(encodeKeyInject(key, 'startLong')));
    } else if (action === 'up') {
      this.socket?.write(frame(encodeKeyInject(key, 'endLong')));
    } else {
      this.socket?.write(frame(encodeKeyInject(key, 'short')));
    }
    this.commandsSent += 1;
    return performance.now() - started;
  }

  appLink(link: string): void {
    if (!this.isConnected) throw appError('REMOTE_UNAVAILABLE', 'The remote session is not connected.');
    this.socket?.write(frame(encodeAppLink(link)));
    this.commandsSent += 1;
  }

  /** Experimental: text injection over the remote protocol. */
  imeText(text: string): void {
    if (!this.isConnected) throw appError('REMOTE_UNAVAILABLE', 'The remote session is not connected.');
    if ((this.features & ATV_FEATURE.IME) === 0) {
      throw appError('UNSUPPORTED_COMMAND', 'This TV did not advertise text input over the remote service.');
    }
    this.socket?.write(frame(encodeImeBatchEdit(text, this.imeCounter, this.imeFieldCounter)));
    this.commandsSent += 1;
  }

  close(): void {
    this.closing = true;
    this.stopPingLoop();
    this.configured = false;
    this.decoder.reset();
    if (this.socket) {
      this.socket.removeAllListeners('close');
      try {
        this.socket.end();
        this.socket.destroy();
      } catch {
        /* already closed */
      }
      this.socket = null;
    }
  }
}
