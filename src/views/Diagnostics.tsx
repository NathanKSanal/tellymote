import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  Gauge,
  Loader2,
  MinusCircle,
  MonitorPlay,
  Radio,
  RefreshCw,
  ShieldCheck,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  Capabilities,
  CaptureProbeReport,
  DiagnosticCheck,
  DiagnosticsSnapshot,
  LogEntry,
} from '@shared/types';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { cx, formatBitrate, formatBytes, formatClock, formatMs, phaseLabel } from '../lib/format';
import { CapabilityChip, EmptyState, InlineNote, PageHeader, Panel, SectionTitle, Spinner, Stat, StatRow, Toggle } from '../components/ui';

const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  remote: 'Remote control',
  keyboardText: 'Text entry',
  power: 'Power key',
  volume: 'Volume',
  mute: 'Mute',
  mediaTransport: 'Media transport',
  channelKeys: 'Channel keys',
  appLaunch: 'Launch apps',
  appList: 'Installed app list',
  screenCapture: 'Screen capture',
  continuousStream: 'Continuous video',
  audioCapture: 'Audio capture',
  pointerInput: 'Pointer input',
  inputSelection: 'Input selection',
  settingsKey: 'Settings key',
  hardwareEncoding: 'Hardware encoding',
  adb: 'Debugging (ADB)',
  receiverInstall: 'TV-side receiver',
};

const CHECK_TONE: Record<DiagnosticCheck['status'], { icon: typeof CheckCircle2; className: string; label: string }> = {
  pass: { icon: CheckCircle2, className: 'text-ok', label: 'Pass' },
  warn: { icon: AlertTriangle, className: 'text-warn', label: 'Warning' },
  fail: { icon: XCircle, className: 'text-bad', label: 'Fail' },
  skip: { icon: MinusCircle, className: 'text-faint', label: 'Skipped' },
};

type LogLevel = 'all' | LogEntry['level'];

export function Diagnostics() {
  const { state, actions } = useApp();
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [benchmark, setBenchmark] = useState<CaptureProbeReport | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);
  const [logLevel, setLogLevel] = useState<LogLevel>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await api.diagnostics();
      setSnapshot(fresh);
    } catch (err) {
      actions.toast('error', 'Could not collect diagnostics', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [actions]);

  useEffect(() => {
    void load();
  }, [load]);

  const snap = snapshot ?? state.diagnostics;
  const device = snap?.device ?? state.devices.find((item) => item.id === state.connection.deviceId) ?? null;

  const logs = useMemo(() => {
    const merged = new Map<string, LogEntry>();
    for (const entry of [...(snap?.log ?? []), ...state.logs]) {
      merged.set(`${entry.at}:${entry.scope}:${entry.message}`, entry);
    }
    let list = [...merged.values()].sort((a, b) => a.at - b.at).slice(-400);
    if (logLevel !== 'all') list = list.filter((entry) => entry.level === logLevel);
    return list;
  }, [logLevel, snap?.log, state.logs]);

  useEffect(() => {
    if (!autoScroll) return;
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [autoScroll, logs]);

  const runPing = async () => {
    await actions.ping();
    await load();
  };

  const runBenchmark = async () => {
    if (benchmarking) return;
    setBenchmarking(true);
    try {
      const report = await api.benchmark();
      setBenchmark(report);
      actions.toast(
        report.recommendation === 'none' ? 'warn' : 'success',
        'Capture benchmark finished',
        report.recommendation === 'h264'
          ? 'Continuous video is available on this TV.'
          : report.recommendation === 'png'
            ? 'Screenshots are available; continuous video is not.'
            : 'Neither capture method answered.',
      );
    } catch (err) {
      actions.toast('error', 'Benchmark failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBenchmarking(false);
    }
  };

  const counts = useMemo(() => {
    const base = { pass: 0, warn: 0, fail: 0, skip: 0 };
    for (const check of snap?.checks ?? []) base[check.status] += 1;
    return base;
  }, [snap?.checks]);

  const capabilityEntries = useMemo(
    () => (snap?.capabilities ? (Object.entries(snap.capabilities) as Array<[keyof Capabilities, Capabilities[keyof Capabilities]]>) : []),
    [snap?.capabilities],
  );

  return (
    <div>
      <PageHeader
        eyebrow="System"
        title="Diagnostics"
        description="Measured facts about this laptop, the network and the TV. Values that cannot be measured on this platform are labelled unavailable rather than guessed."
        actions={
          <>
            <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
              {loading ? <Spinner /> : <RefreshCw size={14} />} Refresh
            </button>
            <button type="button" className="btn" onClick={() => void actions.ping()} disabled={!device}>
              <Zap size={14} /> Ping TV
            </button>
            <button type="button" className="btn" onClick={() => void runBenchmark()} disabled={!snap?.adb.authorized || benchmarking}>
              {benchmarking ? <Spinner /> : <Gauge size={14} />} Benchmark capture
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void actions.exportDiagnostics()}>
              <Download size={14} /> Export report
            </button>
          </>
        }
      />

      {!snap ? (
        <Panel>
          <EmptyState
            icon={<Activity size={22} />}
            title={loading ? 'Collecting diagnostics' : 'No diagnostics yet'}
            body={loading ? 'Reading local interfaces, capture state and the TV session.' : 'Refresh to collect a snapshot. Exporting redacts IP addresses unless you opt in.'}
            action={
              <button type="button" className="btn btn-primary" onClick={() => void load()}>
                <RefreshCw size={14} /> Collect now
              </button>
            }
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          <Panel className="overflow-hidden">
            <StatRow>
              <Stat
                label="Connection"
                value={phaseLabel(snap.connection.phase)}
                sub={snap.connection.remoteTransport === 'atv-v2' ? 'Android TV remote v2' : snap.connection.remoteTransport === 'roku' ? 'Roku ECP' : snap.connection.remoteTransport === 'adb' ? 'ADB key fallback' : 'No remote transport'}
                tone={snap.connection.phase === 'connected' ? 'ok' : snap.connection.phase === 'error' ? 'bad' : 'warn'}
              />
              <Stat
                label="Key round trip"
                value={formatMs(snap.remote.keyRttMs)}
                sub={`${snap.remote.commandsSent} command${snap.remote.commandsSent === 1 ? '' : 's'} sent`}
              />
              <Stat
                label="Debugging"
                value={snap.adb.authorized ? 'Authorised' : snap.adb.present ? 'Unauthorised' : 'Absent'}
                sub={snap.adb.model ?? 'No model reported'}
                tone={snap.adb.authorized ? 'ok' : snap.adb.present ? 'warn' : 'bad'}
              />
              <Stat
                label="Capture"
                value={snap.capture.transport === 'adb-h264' ? 'Continuous' : snap.capture.transport === 'adb-png' ? 'Screenshots' : 'Idle'}
                sub={snap.capture.transport === 'none' ? 'No feed running' : `${snap.capture.fps} fps · ${formatBitrate(snap.capture.kbps)}`}
                tone={snap.capture.transport === 'adb-h264' ? 'ok' : snap.capture.transport === 'adb-png' ? 'warn' : undefined}
              />
            </StatRow>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Panel className="p-5">
              <SectionTitle
                eyebrow="Preflight"
                title="Checks"
                description="What the app could confirm, what it could not, and what to do about a failure."
                actions={
                  <span className="chip mono">
                    {counts.pass} pass · {counts.warn} warn · {counts.fail} fail
                  </span>
                }
              />
              <div className="mt-4 divide-y divide-[var(--line-soft)]">
                {snap.checks.length === 0 && <div className="py-6 text-center text-[11.5px] text-faint">No checks were produced for this snapshot.</div>}
                {snap.checks.map((check) => {
                  const tone = CHECK_TONE[check.status];
                  const Icon = tone.icon;
                  return (
                    <div key={check.id} className="flex gap-3 py-3">
                      <Icon size={15} className={cx('mt-0.5 flex-none', tone.className)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[12px] font-medium text-ink/90">{check.label}</span>
                          <span className="mono text-[9px] uppercase tracking-[0.12em] text-faint">{check.id}</span>
                        </div>
                        <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{check.detail}</div>
                        {check.hint && <div className="mt-1 text-[10.5px] leading-relaxed text-faint">{check.hint}</div>}
                      </div>
                      <span className={cx('mono flex-none text-[9.5px] uppercase tracking-[0.08em]', tone.className)}>{tone.label}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel className="p-5">
                <SectionTitle eyebrow="Network" title="What is measurable" description="Round trip is measured against the TV itself. Nothing is probed on the internet." />
                <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3">
                  <NetworkValue label="Round trip" value={formatMs(snap.network.rttMs)} />
                  <NetworkValue label="Jitter" value={formatMs(snap.network.jitterMs)} />
                  <NetworkValue label="Packet loss" value={snap.network.packetLossPct === null ? 'Not measured' : `${snap.network.packetLossPct}%`} faint={snap.network.packetLossPct === null} />
                  <NetworkValue label="Link rate" value={snap.network.linkMbps === null ? 'Not exposed' : `${snap.network.linkMbps} Mbps`} faint={snap.network.linkMbps === null} />
                  <NetworkValue label="Wi-Fi signal" value={snap.network.wifiSignal === null ? 'Not exposed' : `${snap.network.wifiSignal}%`} faint={snap.network.wifiSignal === null} />
                  <NetworkValue label="SSID" value={snap.network.ssid ?? 'Not exposed'} faint={!snap.network.ssid} />
                </div>
                <div className="mt-4 flex items-start gap-2 text-[10.5px] leading-relaxed text-faint">
                  <Wifi size={12} className="mt-0.5 flex-none" />
                  Windows does not expose per-socket Wi-Fi signal or loss to a desktop app without extra drivers. TellyMote leaves these blank instead of inventing numbers.
                </div>
              </Panel>

              <Panel className="p-5">
                <SectionTitle eyebrow="Remote" title="Transport & errors" />
                <div className="mt-2 divide-y divide-[var(--line-soft)]">
                  <Row label="Transport" value={snap.remote.transport} mono />
                  <Row label="Last key RTT" value={formatMs(snap.remote.keyRttMs)} mono />
                  <Row label="Commands sent" value={String(snap.remote.commandsSent)} mono />
                  <Row label="Last error" value={snap.remote.lastError ?? 'None'} />
                </div>
                {snap.remote.lastError && (
                  <div className="mt-3">
                    <InlineNote tone="warn" title="The TV rejected or missed a command">
                      {snap.remote.lastError}
                    </InlineNote>
                  </div>
                )}
              </Panel>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Panel className="p-5">
              <SectionTitle
                eyebrow="Capabilities"
                title="Established, conditional, unsupported"
                description="A capability is only called verified after the TV answered a real command for it. Protocol support without on-device confirmation stays conditional."
              />
              <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
                {capabilityEntries.map(([key, capability]) => (
                  <div key={key} className="flex items-start justify-between gap-3 border-b border-[var(--line-soft)] py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[11.5px] font-medium text-ink/90">{CAPABILITY_LABELS[key]}</div>
                      <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-faint">{capability.detail ?? 'No measurement yet.'}</div>
                    </div>
                    <CapabilityChip capability={capability} />
                  </div>
                ))}
                {capabilityEntries.length === 0 && <div className="py-4 text-[11.5px] text-faint">No capabilities recorded for this device.</div>}
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel className="p-5">
                <SectionTitle eyebrow="Debugging" title="ADB facts" description="Read from the TV over the ADB handshake. No adb.exe is bundled." />
                <div className="mt-2 divide-y divide-[var(--line-soft)]">
                  <Row label="Host present" value={snap.adb.present ? 'Reachable' : 'Absent'} />
                  <Row label="Authorised" value={snap.adb.authorized ? 'Yes' : 'No'} />
                  <Row label="Model" value={snap.adb.model ?? '—'} />
                  <Row label="Android" value={snap.adb.androidVersion ? `${snap.adb.androidVersion} (SDK ${snap.adb.sdk ?? '?'})` : '—'} />
                </div>
                {snap.adb.error && (
                  <div className="mt-3">
                    <InlineNote tone="warn">{snap.adb.error}</InlineNote>
                  </div>
                )}
              </Panel>

              <Panel className="p-5">
                <SectionTitle eyebrow="Session" title="Connection state" />
                <div className="mt-2 divide-y divide-[var(--line-soft)]">
                  <Row label="Phase" value={phaseLabel(snap.connection.phase)} />
                  <Row label="Device" value={device ? `${device.name} · ${device.host}` : 'No device'} />
                  <Row label="Remote transport" value={snap.connection.remoteTransport} mono />
                  <Row label="Capture transport" value={snap.connection.captureTransport} mono />
                  <Row label="Reconnect attempt" value={String(snap.connection.reconnectAttempt)} mono />
                  <Row label="Since" value={formatClock(snap.connection.since)} mono />
                </div>
                {snap.connection.error && (
                  <div className="mt-3">
                    <InlineNote tone="error" title={snap.connection.error.code}>
                      {snap.connection.error.message}
                      {snap.connection.error.hint ? ` ${snap.connection.error.hint}` : ''}
                    </InlineNote>
                  </div>
                )}
              </Panel>
            </div>
          </div>

          {benchmark && (
            <Panel className="p-5">
              <SectionTitle
                eyebrow="Benchmark"
                title="Capture methods, measured now"
                description="The screenshot test runs a real screencap on the TV. The video test checks whether a screenrecord stream produces H.264 start codes."
                actions={
                  <span className={cx('chip', benchmark.recommendation === 'h264' ? 'chip-ok' : benchmark.recommendation === 'png' ? 'chip-warn' : 'chip-bad')}>
                    {benchmark.recommendation === 'h264' ? 'Continuous video recommended' : benchmark.recommendation === 'png' ? 'Screenshots only' : 'No method available'}
                  </span>
                }
              />
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-ink">Screenshot</span>
                    <span className={cx('chip', benchmark.screenshot.supported ? 'chip-ok' : 'chip-bad')}>{benchmark.screenshot.supported ? 'Available' : 'Unavailable'}</span>
                  </div>
                  <div className="mono mt-2 text-[10.5px] leading-relaxed text-faint">
                    {benchmark.screenshot.width}×{benchmark.screenshot.height} · {formatBytes(benchmark.screenshot.bytes)} · capture {formatMs(benchmark.screenshot.captureMs)} · transfer {formatMs(benchmark.screenshot.transferMs)}
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed text-muted">{benchmark.screenshot.detail}</div>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-ink">Continuous H.264</span>
                    <span className={cx('chip', benchmark.continuous.supported ? 'chip-ok' : 'chip-warn')}>{benchmark.continuous.supported ? 'Available' : 'Unavailable'}</span>
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed text-muted">{benchmark.continuous.detail}</div>
                  <div className="mt-2 text-[10px] leading-relaxed text-faint">A supported stream is still decoded on this laptop. End-to-end latency is not measurable, so it is never given a fabricated number.</div>
                </div>
              </div>
            </Panel>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Panel className="p-5">
              <SectionTitle
                eyebrow="Log"
                title="Session log"
                description="Local only. Export redacts addresses and pairing material by default."
                actions={
                  <div className="flex items-center gap-2">
                    <Toggle checked={autoScroll} onChange={setAutoScroll} label="Follow new log lines" />
                    <span className="text-[10px] text-faint">Follow</span>
                  </div>
                }
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="seg" role="group" aria-label="Log level filter">
                  {(['all', 'debug', 'info', 'warn', 'error'] as const).map((level) => (
                    <button key={level} type="button" data-active={logLevel === level} onClick={() => setLogLevel(level)}>
                      {level === 'all' ? 'All' : level[0].toUpperCase() + level.slice(1)}
                    </button>
                  ))}
                </div>
                <span className="mono text-[10px] text-faint">{logs.length} entries</span>
              </div>
              <div ref={logRef} className="scroll-area mt-3 h-[340px] overflow-y-auto rounded-lg border border-[var(--line-soft)] bg-black/35 p-3">
                {logs.length === 0 ? (
                  <div className="grid h-full place-items-center text-[11px] text-faint">No log entries at this level.</div>
                ) : (
                  logs.map((entry, index) => (
                    <div key={`${entry.at}-${index}`} className="log-line flex gap-2.5">
                      <span className="flex-none text-faint">{formatClock(entry.at)}</span>
                      <span
                        className={cx(
                          'w-[42px] flex-none uppercase',
                          entry.level === 'error' ? 'text-bad' : entry.level === 'warn' ? 'text-warn' : entry.level === 'debug' ? 'text-faint' : 'text-accent/80',
                        )}
                      >
                        {entry.level}
                      </span>
                      <span className="w-[86px] flex-none truncate text-faint">{entry.scope}</span>
                      <span className="min-w-0 flex-1 break-words text-ink/70">{entry.message}</span>
                    </div>
                  ))
                )}
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel className="p-5">
                <SectionTitle eyebrow="This laptop" title="Runtime" />
                <div className="mt-2 divide-y divide-[var(--line-soft)]">
                  <Row label="TellyMote" value={snap.app.version} mono />
                  <Row label="Electron" value={snap.app.electron} mono />
                  <Row label="Chromium" value={snap.app.chrome} mono />
                  <Row label="Node" value={snap.app.node} mono />
                  <Row label="Platform" value={`${snap.app.platform} · ${snap.app.arch}`} mono />
                </div>
              </Panel>

              <Panel className="p-5">
                <SectionTitle eyebrow="Local network" title="Interfaces" />
                <div className="mt-2 divide-y divide-[var(--line-soft)]">
                  <Row label="Subnet" value={snap.localNetwork.subnet ?? 'Unknown'} mono />
                  <Row label="Addresses" value={snap.localNetwork.addresses.join(', ') || 'None'} mono />
                  <Row label="Interfaces" value={`${snap.localNetwork.interfaces.length} visible`} />
                </div>
                <div className="mt-3 space-y-1">
                  {snap.localNetwork.interfaces.slice(0, 5).map((iface) => (
                    <div key={`${iface.name}-${iface.address}`} className="flex items-center justify-between gap-3 text-[10px]">
                      <span className="truncate text-faint">{iface.name}</span>
                      <span className="mono flex-none text-ink/70">{iface.address}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="p-5">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck size={14} className="mt-0.5 flex-none text-ok/80" />
                  <div className="text-[10.5px] leading-relaxed text-muted">
                    This report is generated on this laptop. Exporting never uploads anything; the JSON file is written wherever you choose. IP addresses are
                    {' '}
                    {state.settings?.includeIpsInExports ? 'included because you enabled that in Settings.' : 'redacted by default.'}
                  </div>
                </div>
              </Panel>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-[10px] text-faint">
            <span className="inline-flex items-center gap-1.5">
              <Clock size={11} /> Snapshot {formatClock(snap.generatedAt)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Radio size={11} /> {snap.remote.transport === 'none' ? 'No remote transport' : snap.remote.transport}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MonitorPlay size={11} /> {snap.capture.transport === 'none' ? 'No capture transport' : snap.capture.transport}
            </span>
            {snap.capture.transport !== 'none' && (
              <span className="inline-flex items-center gap-1.5">
                <Cpu size={11} /> {snap.capture.width}×{snap.capture.height} · {snap.capture.fps} fps
              </span>
            )}
            {loading && (
              <span className="inline-flex items-center gap-1.5 text-accent/80">
                <Loader2 size={11} className="animate-spin" /> Refreshing
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NetworkValue({ label, value, faint }: { label: string; value: string; faint?: boolean }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className={cx('mono mt-1 truncate text-[12px]', faint ? 'text-faint' : 'text-ink/85')}>{value}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="flex-none text-[11px] text-faint">{label}</span>
      <span className={cx('truncate text-right text-[11px] text-ink/85', mono && 'mono')}>{value}</span>
    </div>
  );
}
