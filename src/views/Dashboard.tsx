import type { ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  Circle,
  CornerDownLeft,
  Home,
  Info,
  Keyboard,
  MonitorPlay,
  Play,
  Plug,
  Power,
  Radio,
  ScanLine,
  ShieldCheck,
  Signal,
  Tv,
  Unplug,
  Volume1,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import type { ViewId } from '../App';
import { useApp, useDisplayDevice, useMetricHistory } from '../lib/store';
import { capabilityLabel, cx, formatBitrate, formatMs, phaseLabel, phaseTone, remoteTransportLabel, shortHost } from '../lib/format';
import { CapabilityChip, EmptyState, InlineNote, PageHeader, Panel, SectionTitle, SignalChain, Sparkline, Spinner, Stat, StatRow } from '../components/ui';

const QUICK_KEYS = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'back', label: 'Back', icon: CornerDownLeft },
  { key: 'select', label: 'OK', icon: Circle },
  { key: 'volumeUp', label: 'Vol +', icon: Volume2 },
  { key: 'volumeDown', label: 'Vol −', icon: Volume1 },
  { key: 'mute', label: 'Mute', icon: VolumeX },
  { key: 'playPause', label: 'Play', icon: Play },
  { key: 'info', label: 'Info', icon: Info },
] as const;

const CAP_KEYS = [
  ['remote', 'Remote'],
  ['volume', 'Volume'],
  ['mediaTransport', 'Media keys'],
  ['keyboardText', 'Text entry'],
  ['screenCapture', 'Screenshots'],
  ['continuousStream', 'Continuous stream'],
  ['appLaunch', 'App launch'],
  ['channelKeys', 'Channel keys'],
] as const;

export function Dashboard({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { state, actions } = useApp();
  const device = useDisplayDevice();
  const phase = state.connection.phase;
  const connected = phase === 'connected' || phase === 'degraded';
  const remoteReady = state.connection.remoteTransport !== 'none';
  const captureActive = state.connection.captureTransport !== 'none';
  const metrics = state.metrics;
  const kbpsHistory = useMetricHistory(metrics.kbps);
  const tone = phaseTone(phase);
  const dialTone = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-faint';

  return (
    <div>
      <PageHeader
        eyebrow="Local control"
        title="Dashboard"
        description="One display, one laptop, no cloud. Everything here runs over your own network."
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => void actions.scan({ activeProbe: true, timeoutMs: 4200 })}
              disabled={state.scan.running}
            >
              <ScanLine size={14} className={state.scan.running ? 'animate-pulse' : ''} />
              {state.scan.running ? 'Scanning…' : 'Scan network'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onNavigate(captureActive ? 'live' : 'devices')}>
              <MonitorPlay size={14} />
              {captureActive ? 'Open live screen' : device ? 'Choose display' : 'Find your TV'}
            </button>
          </>
        }
      />

      <Panel>
        <div className="grid gap-6 p-5 lg:grid-cols-[1.5fr_1fr] lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cx('chip', tone === 'ok' ? 'chip-ok' : tone === 'bad' ? 'chip-bad' : tone === 'warn' ? 'chip-warn' : '')}>
                <span className={cx('dot', dialTone)} />
                {phaseLabel(phase)}
              </span>
              {device?.trusted && (
                <span className="chip">
                  <ShieldCheck size={10} /> Paired
                </span>
              )}
              {device?.simulated && <span className="chip chip-warn">Simulated device</span>}
            </div>

            <h2 className="mt-3 truncate text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {device?.name ?? 'No display yet'}
            </h2>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted">
              {device ? (
                <>
                  <span className="mono">{shortHost(device.host)}</span>
                  <span className="text-[var(--line)]">/</span>
                  <span>{[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Android TV'}</span>
                  {device.firmware && (
                    <>
                      <span className="text-[var(--line)]">/</span>
                      <span className="truncate">{device.firmware}</span>
                    </>
                  )}
                </>
              ) : (
                <span>Scan the network or add the TV by IP address to begin.</span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {device && !connected && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void actions.connect(device.id)}
                  disabled={phase === 'connecting' || phase === 'pairing'}
                >
                  {phase === 'connecting' || phase === 'pairing' ? <Spinner /> : <Plug size={14} />}
                  {phase === 'connecting' ? 'Connecting…' : phase === 'pairing' ? 'Pairing…' : 'Connect'}
                </button>
              )}
              {connected && (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => onNavigate('live')}>
                    <MonitorPlay size={14} /> Live screen
                  </button>
                  <button type="button" className="btn" onClick={() => onNavigate('remote')}>
                    <Radio size={14} /> Open remote
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => void actions.disconnect()}>
                    <Unplug size={14} /> Disconnect
                  </button>
                </>
              )}
              {!device && (
                <button type="button" className="btn" onClick={() => onNavigate('devices')}>
                  <ScanLine size={14} /> Add a TV
                </button>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-3">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="eyebrow">Signal chain</span>
              <span className={cx('dot', dialTone)} aria-hidden />
            </div>
            <SignalChain
              active={captureActive}
              nodes={[
                {
                  label: 'Remote',
                  value:
                    state.connection.remoteTransport === 'none'
                      ? 'Offline'
                      : remoteTransportLabel(state.connection.remoteTransport),
                  tone: state.connection.remoteTransport === 'none' ? 'idle' : state.connection.remoteTransport === 'adb' ? 'warn' : 'ok',
                },
                {
                  label: 'Screen',
                  value:
                    state.connection.captureTransport === 'adb-h264'
                      ? 'H.264'
                      : state.connection.captureTransport === 'adb-png'
                        ? 'PNG'
                        : 'Idle',
                  tone: state.connection.captureTransport === 'none' ? 'idle' : state.connection.captureTransport === 'adb-png' ? 'warn' : 'ok',
                },
                {
                  label: 'Output',
                  value: metrics.width ? `${metrics.width}×${metrics.height}` : '—',
                  tone: metrics.width ? 'ok' : 'idle',
                },
              ]}
            />
            {captureActive && (
              <div className="mt-3">
                <div className="flex items-baseline justify-between">
                  <span className="eyebrow">Throughput</span>
                  <span className="mono text-[10.5px] text-muted">{formatBitrate(metrics.kbps)}</span>
                </div>
                <Sparkline
                  values={kbpsHistory}
                  tone={state.connection.captureTransport === 'adb-png' ? 'warn' : 'accent'}
                  className="mt-1.5 h-7 w-full"
                />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[var(--line)]">
          <StatRow>
            <Stat
              label="Remote link"
              value={
                state.connection.remoteTransport === 'atv-v2'
                  ? 'Native'
                  : state.connection.remoteTransport === 'roku'
                    ? 'Roku'
                    : state.connection.remoteTransport === 'adb'
                      ? 'ADB'
                      : '—'
              }
              sub={
                state.connection.remoteTransport === 'atv-v2'
                  ? 'Authenticated TLS'
                  : state.connection.remoteTransport === 'roku'
                    ? 'HTTP ECP, no auth'
                    : state.connection.remoteTransport === 'adb'
                      ? 'Fallback key events'
                      : 'Not connected'
              }
              tone={
                state.connection.remoteTransport === 'atv-v2' || state.connection.remoteTransport === 'roku'
                  ? 'ok'
                  : state.connection.remoteTransport === 'adb'
                    ? 'warn'
                    : undefined
              }
            />
            <Stat
              label="Screen feed"
              value={captureActive ? (state.connection.captureTransport === 'adb-png' ? 'Screens' : 'Video') : '—'}
              sub={
                captureActive
                  ? state.connection.captureTransport === 'adb-h264'
                    ? 'Continuous H.264'
                    : 'Screenshot polling'
                  : 'Needs debugging'
              }
              tone={state.connection.captureTransport === 'adb-png' ? 'warn' : captureActive ? 'ok' : undefined}
            />
            <Stat label="Capture rate" value={metrics.fps ? `${metrics.fps} fps` : '—'} sub={metrics.width ? `${metrics.width} × ${metrics.height}` : 'No frames yet'} />
            <Stat
              label="End to end"
              value={metrics.e2eMs === null ? '—' : formatMs(metrics.e2eMs)}
              sub={metrics.continuous ? 'Not measurable for video' : 'Estimated: capture + transfer + paint'}
              tone={metrics.e2eMs !== null && metrics.e2eMs < 250 ? 'ok' : undefined}
            />
          </StatRow>
        </div>
      </Panel>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          <Panel className="p-5">
            <SectionTitle
              eyebrow="Live view"
              title={captureActive ? 'Screen feed is running' : 'Watch the TV here'}
              description={
                captureActive
                  ? 'Frames stay on this machine. The loopback server only binds 127.0.0.1 and requires a per-run token.'
                  : 'Screen viewing is separate from control: it requires an authorised debugging connection on the TV.'
              }
              actions={
                <button type="button" className="btn btn-ghost" onClick={() => onNavigate('live')}>
                  Open <ArrowRight size={13} />
                </button>
              }
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="panel-quiet p-3">
                <div className="eyebrow">Transport</div>
                <div className="mt-1.5 text-[13px] font-semibold text-ink">
                  {state.connection.captureTransport === 'adb-h264'
                    ? 'H.264 stream'
                    : state.connection.captureTransport === 'adb-png'
                      ? 'Screenshot feed'
                      : 'Idle'}
                </div>
                <div className="mt-1 text-[10.5px] text-faint">
                  {state.connection.captureTransport === 'adb-h264' ? 'Continuous video' : state.connection.captureTransport === 'adb-png' ? 'Not continuous video' : 'No capture'}
                </div>
              </div>
              <div className="panel-quiet p-3">
                <div className="eyebrow">Bitrate</div>
                <div className="mono mt-1.5 text-[13px] font-semibold text-ink">{formatBitrate(metrics.kbps)}</div>
                <div className="mt-1 text-[10.5px] text-faint">Measured over 3 s</div>
              </div>
              <div className="panel-quiet p-3">
                <div className="eyebrow">Render</div>
                <div className="mono mt-1.5 text-[13px] font-semibold text-ink">{formatMs(metrics.renderMs)}</div>
                <div className="mt-1 text-[10.5px] text-faint">Decode + paint</div>
              </div>
            </div>
            {!captureActive && device && (
              <div className="mt-4">
                <InlineNote
                  tone={device.capabilities.adb.state === 'verified' ? 'info' : 'warn'}
                  title={device.capabilities.adb.state === 'verified' ? 'Ready to view' : 'Screen viewing needs debugging'}
                >
                  {device.capabilities.adb.state === 'verified'
                    ? 'Start the feed from Live screen. TellyMote will prefer a real H.264 stream and fall back to screenshots.'
                    : `${device.capabilities.adb.detail ?? 'ADB is not authorised.'} Enable Developer options → USB debugging on the TV, then reconnect and accept the prompt.`}
                </InlineNote>
              </div>
            )}
          </Panel>

          <Panel className="p-5">
            <SectionTitle
              eyebrow="Quick controls"
              title="The essentials, one click away"
              description="These keys use the active remote transport. Long-press navigation is available on the full remote."
              actions={
                <button type="button" className="btn btn-ghost" onClick={() => onNavigate('remote')}>
                  Full remote <ArrowRight size={13} />
                </button>
              }
            />
            <div className="mt-4 grid grid-cols-4 gap-2">
              {QUICK_KEYS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="group flex h-[62px] flex-col items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-muted transition-colors hover:border-[var(--line)] hover:bg-[#1c2028] hover:text-ink disabled:opacity-35"
                    disabled={!remoteReady}
                    onClick={() => void actions.key(item.key)}
                  >
                    <Icon size={16} />
                    <span className="text-[10px] font-medium">{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3.5 flex items-center gap-1.5 text-[10.5px] text-faint">
              <Keyboard size={12} />
              Arrow keys, Enter and Backspace work on the Remote page.
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="p-5">
            <SectionTitle eyebrow="Capabilities" title="What this TV has proven" description="Measured facts only. Anything untested stays visibly unknown." />
            <div className="mt-4 space-y-2.5">
              {device ? (
                CAP_KEYS.map(([key, label]) => {
                  const capability = device.capabilities[key];
                  return (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-[12px] text-muted">{label}</span>
                      <CapabilityChip capability={capability} />
                    </div>
                  );
                })
              ) : (
                <div className="py-6 text-center text-[12px] text-faint">Connect a TV to evaluate its capabilities.</div>
              )}
            </div>
            {device && (
              <button type="button" className="btn btn-ghost mt-4 w-full justify-between" onClick={() => onNavigate('diagnostics')}>
                Full compatibility report <ArrowRight size={13} />
              </button>
            )}
          </Panel>

          <Panel className="p-5">
            <SectionTitle eyebrow="Setup" title="Three things to verify" />
            <div className="mt-4 space-y-3">
              <ChecklistRow
                done={Boolean(device)}
                title="TV on the same network"
                detail={device ? `${device.name} at ${shortHost(device.host)}` : 'Scan or add the TV by IP.'}
                icon={<Wifi size={14} />}
              />
              <ChecklistRow
                done={state.connection.remoteTransport !== 'none'}
                title="Remote service paired"
                detail={state.connection.remoteTransport !== 'none' ? 'Authenticated session established.' : 'Pair once and confirm the code on the TV.'}
                icon={<ShieldCheck size={14} />}
              />
              <ChecklistRow
                done={captureActive}
                title="Screen viewing authorised"
                detail={captureActive ? 'ADB capture is running.' : 'Needs USB debugging enabled on the TV.'}
                icon={<MonitorPlay size={14} />}
              />
            </div>
            <button type="button" className="btn mt-4 w-full" onClick={() => onNavigate('diagnostics')}>
              <Activity size={14} /> Run diagnostics
            </button>
          </Panel>
        </div>
      </div>

      {!device && (
        <Panel className="mt-5">
          <EmptyState
            icon={<Tv size={22} />}
            title="No display selected"
            body="TellyMote looks for Android TV devices with mDNS, SSDP and a direct port probe. You can also enter the TV's IP address."
            action={
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary" onClick={() => onNavigate('devices')}>
                  <ScanLine size={14} /> Find a display
                </button>
              </div>
            }
          />
        </Panel>
      )}

      {device && !connected && state.connection.error && (
        <div className="mt-5">
          <InlineNote tone="error" title={state.connection.error.message}>
            {state.connection.error.hint ?? state.connection.error.detail ?? 'Review diagnostics for the failing stage.'}
          </InlineNote>
        </div>
      )}
    </div>
  );
}

function ChecklistRow({ done, title, detail, icon }: { done: boolean; title: string; detail: string; icon: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={cx(
          'mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full border',
          done ? 'border-ok/30 bg-ok/10 text-ok' : 'border-[var(--line)] bg-[var(--surface-2)] text-faint',
        )}
      >
        {done ? <Check size={12} /> : icon}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-ink/90">{title}</div>
        <div className="mt-0.5 text-[10.5px] leading-relaxed text-faint">{detail}</div>
      </div>
    </div>
  );
}
