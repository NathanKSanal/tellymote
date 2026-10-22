import net from 'node:net';

export interface ProbeTarget {
  host: string;
  ports: number[];
  timeoutMs?: number;
}

export interface ProbeResult {
  host: string;
  open: number[];
}

/** Tests a single TCP port. A successful connect is the only definition of "open". */
export function probePort(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    socket.setNoDelay(true);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

export async function probeHost(host: string, ports: number[], timeoutMs = 400): Promise<ProbeResult> {
  const results = await Promise.all(ports.map(async (port) => ({ port, open: await probePort(host, port, timeoutMs) })));
  return { host, open: results.filter((r) => r.open).map((r) => r.port) };
}

export interface SweepOptions {
  concurrency?: number;
  timeoutMs?: number;
  isCancelled?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Scans the immediate /24 only. Concurrency is bounded so the laptop and the
 * router stay responsive; each probe is a single TCP connect attempt.
 */
export async function sweepSubnet(
  hosts: string[],
  ports: number[],
  options: SweepOptions = {},
): Promise<Map<string, number[]>> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 64, 128));
  const timeoutMs = options.timeoutMs ?? 380;
  const results = new Map<string, number[]>();
  let index = 0;
  let done = 0;

  const worker = async () => {
    while (true) {
      if (options.isCancelled?.()) return;
      const current = index++;
      if (current >= hosts.length) return;
      const host = hosts[current];
      const result = await probeHost(host, ports, timeoutMs);
      if (result.open.length > 0) results.set(host, result.open);
      done += 1;
      options.onProgress?.(done, hosts.length);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
