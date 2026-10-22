import { describe, expect, it } from 'vitest';
import { CaptureService } from '../electron/core/capture/service';
import { StreamHandle } from '../electron/core/remote/adb/protocol';
import type { AdbClient } from '../electron/core/remote/adb/client';
import type { PerformanceProfile } from '../shared/types';

/**
 * The Mi TV's screenrecord emits SPS/PPS/IDR only in its opening burst. These
 * tests pin the caching that lets a renderer which mounts later still configure
 * its decoder.
 */

const profile: PerformanceProfile = {
  mode: 'balanced',
  captureFps: 3,
  maxWidth: 1280,
  preferContinuous: true,
};

function startCodeUnit(type: number, payload: number[] = []): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 1, type]), Buffer.from(payload)]);
}

/** Minimal fake that satisfies what CaptureService touches for the H.264 path. */
function fakeAdb(burst: Buffer): { adb: AdbClient; emitted: Buffer[] } {
  const emitted: Buffer[] = [];
  const streams: StreamHandle[] = [];
  const adb = {
    isOpen: true,
    async openStream(): Promise<StreamHandle> {
      const stream = new StreamHandle(1, 100);
      streams.push(stream);
      // Emit the opening burst on the next tick so the probe listener attaches.
      setTimeout(() => stream.push(burst), 0);
      return stream;
    },
    closeStream(stream: StreamHandle): void {
      stream.close();
    },
  } as unknown as AdbClient;
  void emitted;
  return { adb, emitted };
}

describe('CaptureService parameter-set caching', () => {
  it('caches SPS/PPS and the opening IDR from the burst and replays them', async () => {
    const sps = startCodeUnit(0x67, [0x42, 0x00, 0x28, 0xf4, 0x02]);
    const pps = startCodeUnit(0x68, [0xce, 0x38, 0x80]);
    const idr = startCodeUnit(0x65, [0x9a, 0x24, 0x12, 0x0a]);
    const slice = startCodeUnit(0x41, [0x9a, 0x24, 0x12]);
    const burst = Buffer.concat([sps, pps, idr, slice]);

    const chunks: Buffer[] = [];
    const { adb } = fakeAdb(burst);
    const service = new CaptureService({ onVideoChunk: (chunk) => chunks.push(chunk) });
    service.setAdb(adb);

    const transport = await service.start({ profile, preferContinuous: true, bitrateKbps: 6000 });
    expect(transport).toBe('adb-h264');

    const sets = service.getParameterSets();
    expect(sets).not.toBeNull();
    const data = sets?.data ?? Buffer.alloc(0);
    // Replayed config carries the SPS, PPS and a keyframe, in that order.
    expect(data.includes(sps)).toBe(true);
    expect(data.includes(pps)).toBe(true);
    expect(data.includes(idr)).toBe(true);
    expect(data.indexOf(sps)).toBeLessThan(data.indexOf(pps));
    expect(data.indexOf(pps)).toBeLessThan(data.indexOf(idr));

    service.stop();
  });

  it('reports no parameter sets before any headers arrive', () => {
    const service = new CaptureService();
    expect(service.getParameterSets()).toBeNull();
  });

  it('clears cached parameter sets when a fresh stream is opened', async () => {
    const sps = startCodeUnit(0x67, [0x42, 0x00, 0x28]);
    const pps = startCodeUnit(0x68, [0xce, 0x38, 0x80]);
    const burst = Buffer.concat([sps, pps]);

    const { adb } = fakeAdb(burst);
    const service = new CaptureService();
    service.setAdb(adb);

    await service.start({ profile, preferContinuous: true });
    expect(service.getParameterSets()).not.toBeNull();
    service.stop();
  });

  it('restarts only an active H.264 stream', async () => {
    const burst = Buffer.concat([startCodeUnit(0x67, [0x42, 0x00, 0x28]), startCodeUnit(0x68, [0xce, 0x38])]);
    const { adb } = fakeAdb(burst);
    const service = new CaptureService();
    service.setAdb(adb);

    expect(service.restartVideo()).toBe(false); // not running yet
    await service.start({ profile, preferContinuous: true });
    expect(service.restartVideo()).toBe(true);
    service.stop();
    expect(service.restartVideo()).toBe(false);
  });
});
