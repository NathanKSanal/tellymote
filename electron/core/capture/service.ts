import type { AppError, CaptureMetrics, PerformanceProfile } from '../../../shared/types';
import { appError } from '../errors';
import type { AdbClient } from '../remote/adb/client';
import { isCompletePng, parsePngSize } from './png';

export type CaptureTransport = 'adb-png' | 'adb-h264';

export interface CaptureOptions {
  profile: PerformanceProfile;
  preferContinuous: boolean;
  bitrateKbps?: number;
}

export interface CaptureEvents {
  onTransport?: (transport: CaptureTransport, detail: string) => void;
  onMetrics?: (metrics: CaptureMetrics) => void;
  onError?: (error: AppError) => void;
  /** Raw H.264 Annex-B chunks for the renderer's WebCodecs decoder. */
  onVideoChunk?: (chunk: Buffer, seq: number) => void;
  onVideoRestart?: () => void;
  onPublish?: (frame: {
    seq: number;
    png: Buffer;
    width: number;
    height: number;
    requestedAt: number;
    firstByteAt: number;
    completedAt: number;
    deviceCaptureMs: number | null;
  }) => void;
}

const EMPTY_METRICS: CaptureMetrics = {
  fps: 0,
  dropped: 0,
  captureMs: 0,
  transferMs: 0,
  renderMs: 0,
  e2eMs: null,
  width: 0,
  height: 0,
  bytes: 0,
  kbps: 0,
  transport: 'none',
  continuous: false,
  updatedAt: 0,
};

/**
 * Screen capture scheduler.
 *
 * PNG path: one `screencap -p` per tick over the persistent ADB connection,
 * newest-frame-only publishing, hard backpressure (never more than one capture
 * in flight) and, in Auto mode, automatic rate adjustment when the TV slows
 * down or recovers. Manual profiles keep their rate.
 *
 * H.264 path: a single `screenrecord` stream decoded by the renderer. It is only
 * used after start codes are actually observed on the wire.
 */
export class CaptureService {
  private adb: AdbClient | null = null;
  private running = false;
  private transport: CaptureTransport | 'none' = 'none';
  private seq = 0;
  private metrics: CaptureMetrics = { ...EMPTY_METRICS };
  private frameTimestamps: number[] = [];
  private byteWindow: Array<{ at: number; bytes: number }> = [];
  private inFlight = false;
  private timer: NodeJS.Timeout | null = null;
  private videoStream: import('../remote/adb/protocol').StreamHandle | null = null;
  private pngStream: import('../remote/adb/protocol').StreamHandle | null = null;
  private h264Failure = '';
  /**
   * The Mi TV's screenrecord emits SPS/PPS/IDR only in its opening burst and
   * never repeats them. A decoder that attaches after that burst (e.g. the Live
   * view mounting a moment later) would never be able to configure. Keeping the
   * latest parameter sets lets any subscriber replay them on demand.
   */
  private videoSps: Buffer | null = null;
  private videoPps: Buffer | null = null;
  private videoIdr: Buffer | null = null;
  private consecutiveFailures = 0;
  private slowFrames = 0;
  private healthyFrames = 0;
  private effectiveFps = 4;
  private autoMode = false;
  private paused = false;
  private emittedMetricsAt = 0;
  private lastBaseMs = 0;

  constructor(private readonly events: CaptureEvents = {}) {}

  setAdb(adb: AdbClient | null): void {
    this.adb = adb;
  }

  get activeTransport(): CaptureTransport | 'none' {
    return this.transport;
  }

  getMetrics(): CaptureMetrics {
    return { ...this.metrics };
  }

  isRunning(): boolean {
    return this.running;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused && this.transport === 'adb-png') this.clearTimer();
    if (!paused && this.running && this.transport === 'adb-png' && !this.inFlight) this.scheduleNext(0);
  }

  /** Renderer-reported decode+paint time (honest, measured on the laptop). */
  noteRender(renderMs: number, dropped: number, stats?: { width?: number; height?: number; fps?: number }): void {
    const safeRender = Math.min(60_000, Math.max(0, Number(renderMs) || 0));
    this.metrics.renderMs = Math.round(safeRender);
    this.metrics.dropped = Math.round(Math.min(1_000_000, Math.max(0, Number(dropped) || 0)));
    if (stats?.width && stats.height) {
      this.metrics.width = Math.round(Math.min(16_384, Math.max(0, stats.width)));
      this.metrics.height = Math.round(Math.min(16_384, Math.max(0, stats.height)));
    }
    if (stats?.fps !== undefined && this.metrics.continuous) {
      this.metrics.fps = Math.round(Math.min(240, Math.max(0, stats.fps)) * 10) / 10;
    }
    // A continuous stream has no measurable glass-to-glass timestamp; only the
    // screenshot path can honestly report capture + transfer + paint.
    this.metrics.e2eMs = this.metrics.continuous ? null : Math.round((this.lastBaseMs || 0) + safeRender);
    this.emitMetrics(true);
  }

  async start(options: CaptureOptions): Promise<CaptureTransport> {
    const adb = this.adb;
    if (!adb || !adb.isOpen) throw appError('ADB_UNAUTHORIZED', 'Screen viewing needs an authorised debugging connection.');
    // Restarting capture must not leave the previous transport's timer or
    // stream alive next to the new one.
    if (this.running) this.stop();
    this.running = true;
    this.autoMode = options.profile.mode === 'auto';
    this.effectiveFps = Math.max(1, Math.min(options.profile.captureFps, 15));
    this.metrics = { ...EMPTY_METRICS };
    this.frameTimestamps = [];
    this.byteWindow = [];
    this.consecutiveFailures = 0;
    this.h264Failure = '';

    if (options.preferContinuous) {
      const ok = await this.tryH264(options);
      if (ok) {
        this.transport = 'adb-h264';
        this.metrics.transport = 'adb-h264';
        this.metrics.continuous = true;
        this.events.onTransport?.('adb-h264', 'Continuous H.264 from screenrecord, decoded with WebCodecs.');
        this.emitMetrics(true);
        return 'adb-h264';
      }
      if (!this.running) throw appError('CAPTURE_UNSUPPORTED', 'Screen recording is not available on this TV.');
    }

    this.transport = 'adb-png';
    this.metrics.transport = 'adb-png';
    this.metrics.continuous = false;
    const why = this.h264Failure ? ` — H.264 unavailable: ${this.h264Failure}` : '';
    this.events.onTransport?.(
      'adb-png',
      `Screenshot feed via ADB screencap — not a continuous video stream${why}.`,
    );
    this.scheduleNext(0);
    return 'adb-png';
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    if (this.pngStream) {
      try {
        this.adb?.closeStream(this.pngStream);
      } catch {
        /* already closed */
      }
      this.pngStream = null;
    }
    if (this.videoStream) {
      try {
        this.adb?.closeStream(this.videoStream);
      } catch {
        /* already closed */
      }
      this.videoStream = null;
    }
    this.transport = 'none';
    this.metrics.transport = 'none';
    this.metrics.continuous = false;
    this.metrics.fps = 0;
    this.emitMetrics(true);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs?: number): void {
    if (!this.running) return;
    this.clearTimer();
    const interval = Math.round(1000 / Math.max(1, this.effectiveFps));
    this.timer = setTimeout(() => void this.captureOnce(), delayMs ?? interval);
    this.timer.unref?.();
  }

  private async captureOnce(): Promise<void> {
    if (!this.running || this.paused) return;
    if (this.inFlight) {
      this.scheduleNext();
      return;
    }
    const adb = this.adb;
    if (!adb || !adb.isOpen) {
      this.fail(appError('ADB_UNAUTHORIZED', 'The debugging connection closed during capture.'));
      return;
    }
    this.inFlight = true;
    const requestedAt = Date.now();
    let firstByteAt = 0;
    let bytes = 0;
    try {
      // This Mi TV needs ~13 s for a full 1080p screencap. Six seconds only
      // ever produced a truncated PNG, which decodes as a frozen/blank frame.
      const stream = await adb.openStream('shell:screencap -p', 8000);
      this.pngStream = stream;
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (err: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(guard);
          if (err) {
            try {
              adb.closeStream(stream);
            } catch {
              /* already closed */
            }
            reject(err);
          } else {
            resolve();
          }
        };
        const guard = setTimeout(() => finish(new Error('screencap timed out')), 20_000);
        stream.on('data', (chunk: Buffer) => {
          if (!firstByteAt) firstByteAt = Date.now();
          bytes += chunk.length;
          chunks.push(chunk);
        });
        stream.once('close', () => finish(null));
        stream.once('error', (err: Error) => finish(err));
      });
      this.pngStream = null;
      if (!this.running) return;
      const completedAt = Date.now();
      const png = Buffer.concat(chunks);
      if (!isCompletePng(png)) {
        throw new Error('TV returned an incomplete PNG');
      }
      const size = parsePngSize(png);
      this.seq += 1;
      const captureMs = firstByteAt ? firstByteAt - requestedAt : completedAt - requestedAt;
      const transferMs = firstByteAt ? completedAt - firstByteAt : 0;
      this.events.onPublish?.({
        seq: this.seq,
        png,
        width: size.width,
        height: size.height,
        requestedAt,
        firstByteAt,
        completedAt,
        deviceCaptureMs: null,
      });
      this.recordFrame({
        captureMs,
        transferMs,
        bytes,
        width: size.width,
        height: size.height,
        continuous: false,
        completedAt,
      });
      this.consecutiveFailures = 0;
      const elapsed = completedAt - requestedAt;
      if (this.autoMode) {
        // Auto only: step down on sustained slow frames, recover when healthy.
        // A manually selected profile is never altered.
        if (elapsed > 1200) {
          this.slowFrames += 1;
          this.healthyFrames = 0;
          if (this.slowFrames >= 4 && this.effectiveFps > 1) {
            this.effectiveFps = Math.max(1, Math.floor(this.effectiveFps * 0.7));
            this.slowFrames = 0;
          }
        } else {
          this.slowFrames = Math.max(0, this.slowFrames - 1);
          this.healthyFrames += 1;
          if (this.healthyFrames >= 12 && this.effectiveFps < 6) {
            this.effectiveFps = Math.min(6, this.effectiveFps + 1);
            this.healthyFrames = 0;
          }
        }
      }
    } catch (err) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= 3) {
        this.fail(
          appError(
            'CAPTURE_TIMEOUT',
            'Screen capture failed repeatedly.',
            err instanceof Error ? err.message : String(err),
            'Check that the TV is still awake and debugging authorisation is still valid.',
          ),
        );
        return;
      }
    } finally {
      this.inFlight = false;
      if (this.running && !this.paused) this.scheduleNext();
    }
  }

  private recordFrame(input: {
    captureMs: number;
    transferMs: number;
    bytes: number;
    width: number;
    height: number;
    continuous: boolean;
    completedAt: number;
  }): void {
    this.frameTimestamps.push(input.completedAt);
    if (this.frameTimestamps.length > 20) this.frameTimestamps.shift();
    const span = this.frameTimestamps.length > 1 ? this.frameTimestamps[this.frameTimestamps.length - 1] - this.frameTimestamps[0] : 0;
    const fps = span > 0 ? ((this.frameTimestamps.length - 1) * 1000) / span : 0;
    this.byteWindow.push({ at: input.completedAt, bytes: input.bytes });
    const cutoff = input.completedAt - 3000;
    this.byteWindow = this.byteWindow.filter((entry) => entry.at >= cutoff);
    const windowBytes = this.byteWindow.reduce((sum, entry) => sum + entry.bytes, 0);
    const windowSpan = Math.max(1, input.completedAt - (this.byteWindow[0]?.at ?? input.completedAt));
    this.lastBaseMs = input.captureMs + input.transferMs;
    this.metrics = {
      ...this.metrics,
      fps: Math.round(fps * 10) / 10,
      captureMs: Math.round(input.captureMs),
      transferMs: Math.round(input.transferMs),
      renderMs: this.metrics.renderMs,
      e2eMs: Math.round(this.lastBaseMs + (this.metrics.renderMs || 0)),
      width: input.width,
      height: input.height,
      bytes: input.bytes,
      kbps: Math.round((windowBytes * 8) / windowSpan),
      continuous: input.continuous,
      transport: this.transport === 'none' ? 'none' : this.transport,
      updatedAt: input.completedAt,
    };
    this.emitMetrics();
  }

  private emitMetrics(force = false): void {
    const now = Date.now();
    if (!force && now - this.emittedMetricsAt < 350) return;
    this.emittedMetricsAt = now;
    this.events.onMetrics?.({ ...this.metrics });
  }

  private fail(error: AppError): void {
    this.running = false;
    this.clearTimer();
    this.transport = 'none';
    this.metrics = { ...this.metrics, fps: 0, transport: 'none', continuous: false };
    this.emitMetrics(true);
    this.events.onError?.(error);
  }

  private async tryH264(options: CaptureOptions): Promise<boolean> {
    const adb = this.adb;
    if (!adb) return false;
    const bitrate = Math.max(2_000_000, Math.min((options.bitrateKbps ?? 6000) * 1000, 20_000_000));
    const args = `screenrecord --output-format=h264 --time-limit 180 --bit-rate ${bitrate} -`;
    let stream: import('../remote/adb/protocol').StreamHandle;
    try {
      stream = await adb.openStream(`shell:${args}`, 8000);
    } catch (err) {
      this.h264Failure = `could not open screenrecord (${(err as Error).message})`;
      return false;
    }
    this.videoStream = stream;
    this.resetParameterSets();
    let sawStartCode = false;
    let buffer = Buffer.alloc(0);

    const probeResult = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 6000);
      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!sawStartCode) {
          sawStartCode = buffer.includes(Buffer.from([0, 0, 0, 1])) || buffer.includes(Buffer.from([0, 0, 1]));
          if (sawStartCode) {
            clearTimeout(timer);
            cleanup();
            resolve(true);
          }
        }
      };
      const onClose = () => {
        clearTimeout(timer);
        cleanup();
        resolve(false);
      };
      const cleanup = () => {
        stream.removeListener('data', onData);
        stream.removeListener('close', onClose);
      };
      stream.on('data', onData);
      stream.once('close', onClose);
    });

    if (!probeResult) {
      if (!this.h264Failure) {
        this.h264Failure = 'screenrecord produced no H.264 data within 6 s';
      }
      try {
        adb.closeStream(stream);
      } catch {
        /* noop */
      }
      this.videoStream = null;
      return false;
    }
    this.h264Failure = '';

    // Stream is live: attach the forwarding listener before flushing the probe buffer.
    stream.on('data', (chunk: Buffer) => {
      if (!this.running) return;
      this.forwardVideoChunk(chunk);
    });
    if (buffer.length) this.forwardVideoChunk(buffer);    stream.once('close', () => {
      if (!this.running) return;
      this.videoStream = null;
      this.events.onVideoRestart?.();
      void this.restartH264(options);
    });
    const now = Date.now();
    this.metrics = {
      ...this.metrics,
      transport: 'adb-h264',
      continuous: true,
      updatedAt: now,
      captureMs: 0,
      transferMs: 0,
      e2eMs: null,
    };
    return true;
  }

  private videoSeq = 0;

  private forwardVideoChunk(chunk: Buffer): void {
    this.captureParameterSets(chunk);
    this.videoSeq += 1;
    this.events.onVideoChunk?.(chunk, this.videoSeq);
    const now = Date.now();
    this.byteWindow.push({ at: now, bytes: chunk.length });
    const cutoff = now - 3000;
    this.byteWindow = this.byteWindow.filter((entry) => entry.at >= cutoff);
    const windowBytes = this.byteWindow.reduce((sum, entry) => sum + entry.bytes, 0);
    const span = Math.max(1, now - (this.byteWindow[0]?.at ?? now));
    this.metrics = {
      ...this.metrics,
      kbps: Math.round((windowBytes * 8) / span),
      bytes: chunk.length,
      updatedAt: now,
      transport: 'adb-h264',
      continuous: true,
    };
    this.emitMetrics();
  }

  /** Records the newest SPS/PPS Annex-B units seen on the wire. */
  private captureParameterSets(chunk: Buffer): void {
    for (const unit of splitAnnexB(chunk)) {
      const type = unit[0] & 0x1f;
      if (type === 7) this.videoSps = unit;
      else if (type === 8) this.videoPps = unit;
      else if (type === 5 && !this.videoIdr) this.videoIdr = unit;
    }
  }

  /**
   * Latest SPS/PPS (plus the opening IDR, when one has been seen) as an
   * Annex-B chunk, or null if the stream has not produced headers yet.
   * Renderers replay this to configure a decoder that attached after
   * screenrecord's opening burst — which on this Mi TV is the only time the
   * parameter sets and keyframe are ever sent.
   */
  getParameterSets(): { data: Buffer; bytes: number } | null {
    if (!this.videoSps || !this.videoPps) return null;
    const parts = [withStartCode(this.videoSps), withStartCode(this.videoPps)];
    if (this.videoIdr) parts.push(withStartCode(this.videoIdr));
    const data = Buffer.concat(parts);
    return { data, bytes: data.length };
  }

  /** Clears cached parameter sets. Called whenever a fresh stream is opened. */
  private resetParameterSets(): void {
    this.videoSps = null;
    this.videoPps = null;
    this.videoIdr = null;
  }

  /**
   * Forces a fresh screenrecord stream. The Mi TV emits SPS/PPS/IDR only in the
   * opening burst of a stream, so a decoder that attaches mid-stream cannot
   * configure or find a keyframe without this. The close handler restarts the
   * stream and emits `video:reset` for the renderer.
   */
  restartVideo(): boolean {
    if (!this.running || this.transport !== 'adb-h264') return false;
    const stream = this.videoStream;
    if (!stream) return false;
    this.videoStream = null;
    try {
      this.adb?.closeStream(stream);
    } catch {
      /* already closed */
    }
    return true;
  }

  private async restartH264(options: CaptureOptions): Promise<void> {
    if (!this.running) return;
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (!this.running) return;
    const ok = await this.tryH264(options);
    if (!ok) {
      this.transport = 'adb-png';
      this.metrics.transport = 'adb-png';
      this.metrics.continuous = false;
      this.events.onTransport?.('adb-png', 'Falling back to screenshots because the video stream ended.');
      this.scheduleNext(0);
    }
  }

  async benchmark(): Promise<{ captureMs: number; transferMs: number; width: number; height: number; bytes: number; samples: number }> {
    const adb = this.adb;
    if (!adb || !adb.isOpen) throw appError('ADB_UNAUTHORIZED', 'Connect with debugging enabled to benchmark capture.');
    // One honest end-to-end grab. Three samples against this TV took ~40 s and
    // a 12 s timeout returned a truncated PNG that still looked "valid".
    const started = Date.now();
    const png = await adb.exec('screencap -p', 25_000);
    const transferMs = Date.now() - started;
    if (!isCompletePng(png)) {
      throw appError(
        'CAPTURE_TIMEOUT',
        'The TV returned an incomplete screenshot.',
        `Received ${png.length} bytes before the capture window ended.`,
        'Keep the TV awake and try again; if it persists, reboot the TV.',
      );
    }
    const info = parsePngSize(png);
    if (!info.valid) throw appError('CAPTURE_UNSUPPORTED', 'The TV returned data that is not a PNG frame.');
    // The device-side split is not measured here; the number that matters is
    // the full round-trip. It is reported as transfer time and labelled so.
    return {
      captureMs: 0,
      transferMs,
      width: info.width,
      height: info.height,
      bytes: png.length,
      samples: 1,
    };
  }
}

/**
 * Splits an Annex-B buffer into NAL units without their start codes. Handles
 * both 3-byte and 4-byte start codes and ignores trailing bytes that are part
 * of a NAL continued in the next ADB packet.
 */
function splitAnnexB(buf: Buffer): Buffer[] {
  const units: Buffer[] = [];
  const starts: number[] = [];
  for (let i = 0; i + 2 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      starts.push(i);
      i += 2;
    } else if (i + 3 < buf.length && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1) {
      starts.push(i + 1);
      i += 3;
    }
  }
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s] + 3;
    const to = s + 1 < starts.length ? starts[s + 1] : buf.length;
    if (to > from) units.push(buf.subarray(from, to));
  }
  return units;
}

function withStartCode(unit: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 1]), unit]);
}
