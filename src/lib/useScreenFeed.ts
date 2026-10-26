import { useEffect, useRef, useState, type RefObject } from 'react';
import { concatChunks, firstNal, nalTypes } from './annexb';
import { onEvent, api } from './api';

export type FeedStatus = 'idle' | 'waiting' | 'live' | 'paused' | 'error';

export interface FeedState {
  status: FeedStatus;
  error: string | null;
  /** True while the PNG poller is retrying on its own, so the UI can say so. */
  retrying: boolean;
  fps: number;
  lastFrameAt: number;
  frames: number;
}

interface FeedOptions {
  active: boolean;
  transport: 'adb-png' | 'adb-h264' | 'none';
  frameUrl: string;
  paused: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onReport: (renderMs: number, dropped: number, stats: { width?: number; height?: number; fps?: number }) => void;
}

const INITIAL: FeedState = { status: 'idle', error: null, retrying: false, fps: 0, lastFrameAt: 0, frames: 0 };

/**
 * Renderer-side screen feed.
 *
 * PNG: long-polls the loopback frame server, so a slow decode can never queue
 * stale frames. H.264: consumes Annex-B chunks from the ADB screenrecord stream
 * and decodes them with WebCodecs; dropped chunks are counted, never hidden.
 *
 * There is deliberately no synthetic frame anywhere in this file.
 */
export function useScreenFeed(options: FeedOptions): FeedState {
  const { active, transport, frameUrl, paused, canvasRef, onReport } = options;
  const [feed, setFeed] = useState<FeedState>(INITIAL);
  const reportRef = useRef(onReport);
  reportRef.current = onReport;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  /** Set when the reference chain broke, so decoding waits for a keyframe. */
  const needsKeyframeRef = useRef(false);

  useEffect(() => {
    if (!active || transport === 'none') {
      setFeed(INITIAL);
      return;
    }
    let cancelled = false;
    let frameCount = 0;
    let dropped = 0;
    let lastSeq = 0;
    let frameTimes: number[] = [];
    let lastReport = 0;
    let renderAccum = 0;
    let renderSamples = 0;
    let lastFrameAt = 0;

    const publish = (force = false) => {
      const now = performance.now();
      if (!force && now - lastReport < 600) return;
      lastReport = now;
      const span = frameTimes.length > 1 ? frameTimes[frameTimes.length - 1] - frameTimes[0] : 0;
      const fps = span > 0 ? ((frameTimes.length - 1) * 1000) / span : 0;
      const renderMs = renderSamples ? renderAccum / renderSamples : 0;
      reportRef.current(renderMs, dropped, { fps });
      renderAccum = 0;
      renderSamples = 0;
      if (cancelled) return;
      setFeed((prev) => ({
        ...prev,
        status: 'live',
        error: null,
        retrying: false,
        fps: Math.round(fps * 10) / 10,
        lastFrameAt,
        frames: frameCount,
      }));
    };

    const noteFrame = (at: number, seqGap: number) => {
      frameCount += 1;
      if (seqGap > 0) dropped += seqGap;
      lastFrameAt = Date.now();
      frameTimes.push(at);
      if (frameTimes.length > 40) frameTimes = frameTimes.slice(-40);
    };

    // ------------------------------------------------------------- PNG feed
    if (transport === 'adb-png') {
      setFeed({ ...INITIAL, status: 'waiting' });
      if (!frameUrl) {
        setFeed({ ...INITIAL, status: 'waiting', error: 'Waiting for the first captured frame…' });
        return () => {
          cancelled = true;
        };
      }
      const controller = new AbortController();
      const canvas = canvasRef.current;

      const loop = async () => {
        let failures = 0;
        while (!cancelled) {
          if (pausedRef.current) {
            await sleep(220);
            continue;
          }
          try {
            const url = `${frameUrl}${frameUrl.includes('?') ? '&' : '?'}seq=${lastSeq}`;
            const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
            if (cancelled) return;
            // 204 = the long poll elapsed with no newer frame; 429 = too many
            // waiters. Neither is a fault, so both reset the failure counter.
            if (response.status === 204 || response.status === 429) {
              failures = 0;
              continue;
            }
            if (!response.ok) throw new Error(`Frame server returned ${response.status}`);
            const seq = Number.parseInt(response.headers.get('x-luma-seq') ?? '0', 10);
            const blob = await response.blob();
            const started = performance.now();
            const bitmap = await createImageBitmap(blob);
            const target = canvasRef.current ?? canvas;
            if (target) {
              if (target.width !== bitmap.width || target.height !== bitmap.height) {
                target.width = bitmap.width;
                target.height = bitmap.height;
              }
              const context = target.getContext('2d', { alpha: false, desynchronized: true });
              context?.drawImage(bitmap, 0, 0);
            }
            bitmap.close();
            const renderMs = performance.now() - started;
            renderAccum += renderMs;
            renderSamples += 1;
            noteFrame(performance.now(), seq > 0 ? Math.max(0, seq - lastSeq - 1) : 0);
            if (seq) lastSeq = seq;
            failures = 0;
            publish();
          } catch (err) {
            if (cancelled || controller.signal.aborted) return;
            failures += 1;
            const message = err instanceof Error ? err.message : 'The frame server stopped responding.';
            // Keep polling. A capture restart or one stalled screencap used to
            // end the feed for good after six failures; now it says so and
            // recovers on the next frame the TV answers with.
            if (failures > 3) {
              setFeed((prev) => ({ ...prev, status: 'error', error: message, retrying: true }));
            }
            await sleep(Math.min(3000, 200 * 2 ** Math.min(failures, 4)));
          }
        }
      };

      void loop();
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    // ------------------------------------------------------------ H.264 feed
    if (transport !== 'adb-h264') return;

    setFeed({ ...INITIAL, status: 'waiting' });
    const canvas = canvasRef.current;
    let decoder: VideoDecoder | null = null;
    let configured = false;
    let codec = 'avc1.42E01E';
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let timestamp = Math.round(performance.now() * 1000);
    let waitingTimer: number | null = null;
    let restartTimer: number | null = null;
    const arrival = new Map<number, number>();

    const clearWaiting = () => {
      if (waitingTimer !== null) {
        window.clearTimeout(waitingTimer);
        waitingTimer = null;
      }
    };

    /** A stalled start must be reported, not left spinning as "waiting" forever. */
    const armWaiting = (ms: number) => {
      clearWaiting();
      waitingTimer = window.setTimeout(() => {
        waitingTimer = null;
        if (cancelled || configured) return;
        setFeed((prev) => ({
          ...prev,
          status: 'error',
          error: 'The TV is sending video without codec headers. Switch to the screenshot feed.',
        }));
      }, ms);
    };

    /** Asks the TV for one fresh SPS/PPS + keyframe burst. */
    const requestRestart = (ms: number) => {
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(() => {
        restartTimer = null;
        if (cancelled || configured) return;
        void api.restartVideo().catch(() => undefined);
      }, ms);
    };

    armWaiting(5000);
    const configure = (sps: Uint8Array) => {
      try {
        const profile = sps[1] ?? 0x42;
        const constraints = sps[2] ?? 0xe0;
        const level = sps[3] ?? 0x1e;
        codec = `avc1.${hex(profile)}${hex(constraints)}${hex(level)}`;
        decoder = new VideoDecoder({
          output: (frame) => {
            // Time only the paint work. Measuring from chunk submission would
            // fold decoder queue wait into "render" and report seconds when the
            // TV is simply sending frames slowly.
            if (!pausedRef.current && !cancelled) {
              const startedAt = performance.now();
              const target = canvasRef.current ?? canvas;
              if (target) {
                if (target.width !== frame.displayWidth || target.height !== frame.displayHeight) {
                  target.width = frame.displayWidth;
                  target.height = frame.displayHeight;
                }
                const context = target.getContext('2d', { alpha: false, desynchronized: true });
                context?.drawImage(frame as unknown as CanvasImageSource, 0, 0, frame.displayWidth, frame.displayHeight);
              }
              const renderMs = performance.now() - startedAt;
              arrival.delete(frame.timestamp);
              renderAccum += renderMs;
              renderSamples += 1;
              noteFrame(performance.now(), 0);
              publish();
            } else {
              arrival.delete(frame.timestamp);
              dropped += 1;
            }
            frame.close();
          },
          error: (err) => {
            if (cancelled) return;
            setFeed((prev) => ({
              ...prev,
              status: 'error',
              error: `Video decode failed: ${err.message}`,
            }));
          },
        });
        decoder.configure({ codec, optimizeForLatency: true });
        configured = true;
        clearWaiting();
      } catch (err) {
        setFeed((prev) => ({
          ...prev,
          status: 'error',
          error: `This build cannot decode the TV stream: ${err instanceof Error ? err.message : String(err)}`,
        }));
      }
    };

    const feedChunk = (chunk: Uint8Array) => {
      if (!decoder || !configured) {
        pending.push(chunk);
        pendingBytes += chunk.length;
        const types = nalTypes(chunk);
        if (types.includes(7) && types.includes(8)) {
          const sps = firstNal(pending, 7);
          if (sps) {
            configure(sps);
            if (!configured) return;
            const merged = concatChunks(pending);
            pending = [];
            pendingBytes = 0;
            if (decoder?.state === 'configured') {
              const hasIdr = nalTypes(merged).includes(5);
              // Entering mid-GOP would paint reference frames that were never
              // decoded, so wait for the next keyframe instead.
              if (needsKeyframeRef.current && !hasIdr) return;
              needsKeyframeRef.current = false;
              const ts = timestamp;
              timestamp += 16_000;
              arrival.set(ts, performance.now());
              try {
                decoder.decode(new EncodedVideoChunk({ type: hasIdr ? 'key' : 'delta', timestamp: ts, data: merged }));
              } catch (err) {
                setFeed((prev) => ({ ...prev, status: 'error', error: (err as Error).message }));
              }
            }
          }
        } else if (pendingBytes > 6_000_000 || pending.length > 400) {
          pending = [];
          pendingBytes = 0;
        }
        return;
      }
      if (decoder.state !== 'configured') return;
      const hasIdr = nalTypes(chunk).includes(5);
      const backlog = decoder.decodeQueueSize;
      if (backlog > 10 && !hasIdr) {
        dropped += 1;
        // The reference chain is broken from here on; re-enter on a keyframe.
        needsKeyframeRef.current = true;
        publish();
        return;
      }
      if (needsKeyframeRef.current) {
        if (!hasIdr) {
          dropped += 1;
          return;
        }
        needsKeyframeRef.current = false;
      }
      const ts = timestamp;
      timestamp += 16_000;
      arrival.set(ts, performance.now());
      if (arrival.size > 120) {
        const oldest = arrival.keys().next().value;
        if (typeof oldest === 'number') arrival.delete(oldest);
      }
      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: hasIdr ? 'key' : 'delta',
            timestamp: ts,
            data: chunk,
          }),
        );
      } catch (err) {
        dropped += 1;
        needsKeyframeRef.current = true;
        setFeed((prev) => ({ ...prev, status: 'error', error: `Chunk rejected: ${(err as Error).message}` }));
      }
    };

    // Pausing freezes the picture, not the stream: the TV keeps encoding, so the
    // chunks are still decoded (and simply not painted). Dropping them instead
    // would break the reference chain and smear the picture after resume.
    const unsubscribe = onEvent('video:chunk', ({ chunk }) => {
      if (cancelled) return;
      feedChunk(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    });

    // A restart re-emits SPS/PPS and a keyframe. Drop everything buffered from
    // the old stream so those stale P-frames cannot poison the new decode.
    const unsubscribeReset = onEvent('video:reset', () => {
      pending = [];
      pendingBytes = 0;
      arrival.clear();
      needsKeyframeRef.current = false;
      if (decoder && decoder.state !== 'closed') {
        try {
          decoder.close();
        } catch {
          /* already closed */
        }
      }
      decoder = null;
      configured = false;
      setFeed((prev) => ({ ...prev, status: 'waiting', error: null, retrying: false }));
      // The restarted encoder sends its headers on open, but if this view never
      // sees them it would sit on "waiting" forever: re-arm both watchdogs.
      armWaiting(5000);
      requestRestart(1500);
    });

    // This TV sends parameter sets and a keyframe only when screenrecord opens
    // its stream. If this view attached mid-stream it would otherwise wait
    // forever, so ask the main process for a fresh burst once.
    requestRestart(1200);

    return () => {
      cancelled = true;
      clearWaiting();
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      restartTimer = null;
      needsKeyframeRef.current = false;
      unsubscribe();
      unsubscribeReset();
      try {
        if (decoder && decoder.state !== 'closed') decoder.close();
      } catch {
        /* already closed */
      }
      decoder = null;
      arrival.clear();
    };
  }, [active, transport, frameUrl, canvasRef]);

  // If frames were lost while paused, the resume has to enter on a keyframe.
  // Give the encoder a moment to produce one, then ask the TV for a fresh burst
  // instead of leaving a frozen picture on screen.
  useEffect(() => {
    if (paused || !active || transport !== 'adb-h264' || !needsKeyframeRef.current) return;
    const id = window.setTimeout(() => {
      if (needsKeyframeRef.current) void api.restartVideo().catch(() => undefined);
    }, 2500);
    return () => window.clearTimeout(id);
  }, [paused, active, transport]);

  return feed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hex(value: number): string {
  return value.toString(16).padStart(2, '0');
}
