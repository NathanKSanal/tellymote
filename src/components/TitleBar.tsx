import { MonitorPlay, ShieldCheck, Tv } from 'lucide-react';
import { useApp, useDisplayDevice } from '../lib/store';
import { cx, phaseLabel, phaseTone, remoteTransportLabel } from '../lib/format';

const TONE_CLASS: Record<string, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  idle: 'text-faint',
};

export function TitleBar() {
  const { state } = useApp();
  const device = useDisplayDevice();
  const tone = phaseTone(state.connection.phase);
  const connected = state.connection.phase === 'connected' || state.connection.phase === 'degraded';

  return (
    <header
      className="drag-region relative z-30 flex h-11 flex-none items-center border-b border-[var(--line)] bg-[var(--bg)] pr-[148px]"
      style={connected ? { boxShadow: 'inset 0 -1px 0 var(--accent-line)' } : undefined}
    >
      <div className="flex w-[212px] flex-none items-center gap-2 px-4">
        <div className="grid h-[22px] w-[22px] place-items-center rounded-[5px] bg-[var(--accent)] text-[var(--accent-ink)]">
          <Tv size={12} strokeWidth={2.4} />
        </div>
        <span className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">LumaRemote</span>
        <span className="mono text-[10px] text-faint">{state.appInfo?.version ? `v${state.appInfo.version}` : ''}</span>
      </div>

      <div className="h-4 w-px bg-[var(--line)]" />

      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-4">
        <span className={cx('status-orb', TONE_CLASS[tone])} />
        <span className="truncate text-[12px] text-ink/90">{device?.name ?? 'No display selected'}</span>
        <span className="text-[11px] text-faint">{phaseLabel(state.connection.phase)}</span>
        {state.connection.remoteTransport !== 'none' && (
          <span className="chip hidden sm:inline-flex">
            {remoteTransportLabel(state.connection.remoteTransport)}
          </span>
        )}
        {state.connection.captureTransport !== 'none' && (
          <span className="chip chip-accent hidden md:inline-flex">
            <MonitorPlay size={10} />
            {state.connection.captureTransport === 'adb-h264' ? 'Video' : 'Screens'}
          </span>
        )}
      </div>

      <div className="no-drag flex items-center gap-1.5 pr-4 text-[10.5px] text-faint">
        <ShieldCheck size={11} className="text-ok/80" />
        <span className="hidden lg:inline">Local only</span>
      </div>
    </header>
  );
}
