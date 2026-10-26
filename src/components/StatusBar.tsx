import { useApp, useDisplayDevice } from '../lib/store';
import { cx, formatBitrate, phaseLabel, phaseTone, remoteTransportLabel } from '../lib/format';

const TONE: Record<string, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  idle: 'text-faint',
};

/**
 * Persistent instrument strip. It repeats the few facts that matter at a glance
 * on every page, so the content above never has to duplicate them.
 */
export function StatusBar() {
  const { state } = useApp();
  const device = useDisplayDevice();
  const { connection, metrics } = state;
  const tone = phaseTone(connection.phase);
  const live = connection.captureTransport !== 'none';

  const sep = <span className="h-3 w-px flex-none bg-[var(--line)]" aria-hidden />;

  return (
    <footer className="flex h-7 flex-none items-center gap-2.5 border-t border-[var(--line-soft)] bg-[linear-gradient(180deg,#0b0d12_0%,#08090c_100%)] px-3 text-[10px] text-faint">
      <span className={cx('dot flex-none', live && tone === 'ok' ? 'dot-live' : '', TONE[tone])} aria-hidden />
      <span className="max-w-[220px] truncate text-muted">{device?.name ?? 'No display'}</span>
      <span className="hidden sm:inline">{phaseLabel(connection.phase)}</span>
      {sep}
      <span className="hidden md:inline">
        Remote <span className="mono text-[var(--color-muted)]">{connection.remoteTransport === 'atv-v2' ? 'ATV v2' : connection.remoteTransport === 'adb' ? 'ADB' : '—'}</span>
      </span>
      <span className="hidden lg:inline">
        Screen{' '}
        <span className="mono text-[var(--color-muted)]">
          {connection.captureTransport === 'adb-h264' ? 'H.264' : connection.captureTransport === 'adb-png' ? 'PNG' : '—'}
        </span>
      </span>
      {live && (
        <>
          <span className="hidden md:inline mono text-[var(--color-muted)]">
            {metrics.width ? `${metrics.width}×${metrics.height}` : '—'}
          </span>
          <span className="mono text-[var(--color-muted)]">{metrics.fps ? `${metrics.fps} fps` : '— fps'}</span>
          <span className="hidden sm:inline mono text-[var(--color-muted)]">{formatBitrate(metrics.kbps)}</span>
        </>
      )}
      {state.scan.running && (
        <span className="mono hidden sm:inline">
          scanning {state.scan.hostsProbed}/{state.scan.hostsTotal}
        </span>
      )}
      <span className="ml-auto hidden xl:inline">Loopback only · no cloud</span>
    </footer>
  );
}
