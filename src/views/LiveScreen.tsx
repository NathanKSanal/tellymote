import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Camera,
  Circle,
  CornerDownLeft,
  Download,
  Gauge,
  Home,
  Loader2,
  Maximize2,
  Minimize2,
  MonitorPlay,
  MousePointerClick,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Timer,
  Tv,
  Video,
  Volume1,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import type { CaptureProbeReport, RemoteKey } from '@shared/types';
import type { ViewId } from '../App';
import { useActiveDevice, useApp, useMetricHistory } from '../lib/store';
import { api } from '../lib/api';
import { cx, formatBitrate, formatBytes, formatMs, shortHost } from '../lib/format';
import { useScreenFeed } from '../lib/useScreenFeed';
import { EmptyState, InlineNote, PageHeader, Panel, SectionTitle, Sparkline, Spinner, Stat } from '../components/ui';

type Preference = 'auto' | 'h264' | 'png';

const LIVE_KEYS: Array<{ key: RemoteKey; label: string; icon: typeof Home }> = [
  { key: 'back', label: 'Back', icon: CornerDownLeft },
  { key: 'home', label: 'Home', icon: Home },
  { key: 'select', label: 'OK', icon: Circle },
  { key: 'volumeDown', label: 'Vol −', icon: Volume1 },
  { key: 'volumeUp', label: 'Vol +', icon: Volume2 },
  { key: 'mute', label: 'Mute', icon: VolumeX },
];

export function LiveScreen({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { state, actions } = useApp();
  const device = useActiveDevice();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [preference, setPreference] = useState<Preference>('auto');
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<CaptureProbeReport | null>(null);
  const [probing, setProbing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [tapMode, setTapMode] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const rippleId = useRef(0);
  const transport = state.connection.captureTransport;
  const active = transport !== 'none';
  const kbpsHistory = useMetricHistory(state.metrics.kbps);

  const feed = useScreenFeed({
    active,
    transport,
    frameUrl: state.frameUrl,
    paused,
    canvasRef,
    onReport: (renderMs, dropped, stats) => {
      void api.reportRender(renderMs, dropped, stats).catch(() => undefined);
    },
  });

  useEffect(() => {
    void api
      .captureStatus()
      .then((status) => {
        if (status.running && status.transport !== 'none') setPaused(false);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (transport === 'none') setPaused(false);
  }, [transport]);

  const toggleCapture = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (active) {
        await actions.stopCapture();
        setPaused(false);
      } else {
        await actions.startCapture(preference === 'auto' ? undefined : preference);
      }
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    const next = !paused;
    setPaused(next);
    await api.setCapturePaused(next).catch(() => undefined);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      /* fullscreen can be refused by the window manager */
    }
  };

  /** Maps a click on the letterboxed canvas to real TV coordinates. */
  const sendTapAt = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!tapMode || !active) return;
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width || !canvas.height) return;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const shownWidth = canvas.width * scale;
    const shownHeight = canvas.height * scale;
    const originX = rect.left + (rect.width - shownWidth) / 2;
    const originY = rect.top + (rect.height - shownHeight) / 2;
    const x = (event.clientX - originX) / scale;
    const y = (event.clientY - originY) / scale;
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return;
    const ripple = { id: ++rippleId.current, x: event.clientX - rect.left, y: event.clientY - rect.top };
    setRipples((current) => [...current.slice(-4), ripple]);
    window.setTimeout(() => {
      setRipples((current) => current.filter((item) => item.id !== ripple.id));
    }, 460);
    void api.tap(x, y).catch((err) => {
      actions.toast('error', 'Tap was not sent', err instanceof Error ? err.message : String(err));
    });
  };

  const saveFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lumaremote-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  };

  const runProbe = async () => {
    if (probing) return;
    setProbing(true);
    try {
      const report = await api.probeCaptureMethods();
      setProbe(report);
      actions.toast(
        report.recommendation === 'none' ? 'warn' : 'success',
        'Capture methods tested',
        report.recommendation === 'h264'
          ? 'Continuous H.264 is available.'
          : report.recommendation === 'png'
            ? 'Screenshots are available; video is not.'
            : 'No capture method succeeded.',
      );
    } catch (err) {
      actions.toast('error', 'Capture probe failed', err instanceof Error ? err.message : String(err));
    } finally {
      setProbing(false);
    }
  };

  if (!device) {
    return (
      <div>
        <PageHeader eyebrow="Live screen" title="Watch the actual display" description="A local screen feed, never a mock-up. Choose a display first." />
        <Panel>
          <EmptyState
            icon={<Tv size={22} />}
            title="No display connected"
            body="Screen viewing needs a selected TV with an authorised debugging connection. Remote control works independently."
            action={
              <button type="button" className="btn btn-primary" onClick={() => onNavigate('devices')}>
                <MonitorPlay size={14} /> Choose a display
              </button>
            }
          />
        </Panel>
      </div>
    );
  }

  const adbAuthorised = device.capabilities.adb.state === 'verified';
  const remoteReady = state.connection.remoteTransport !== 'none';
  const rokuOnly = device.protocols.includes('roku-ecp') && !device.protocols.includes('adb') && !device.protocols.includes('atv-remote-v2');
  const isPng = transport === 'adb-png';
  const isVideo = transport === 'adb-h264';
  const statusText = feed.status === 'error' ? 'Feed problem' : feed.status === 'waiting' ? 'Waiting for frames' : active ? (paused ? 'Paused' : 'Receiving') : 'Idle';

  return (
    <div>
      <PageHeader
        eyebrow="Live screen"
        title={device.name}
        description={`${shortHost(device.host)} · ${[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Android TV'}`}
        actions={
          <>
            <div className="seg" role="group" aria-label="Capture transport preference">
              {(
                [
                  ['auto', 'Auto'],
                  ['h264', 'Video'],
                  ['png', 'Screenshots'],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" data-active={preference === value} onClick={() => setPreference(value)}>
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={cx('btn', tapMode && 'btn-primary')}
              onClick={() => setTapMode((value) => !value)}
              aria-pressed={tapMode}
              disabled={!active}
              title="Click on the video to send a touch tap at that point"
            >
              <MousePointerClick size={14} /> Click to tap
            </button>
            <button type="button" className="btn" onClick={() => void runProbe()} disabled={probing}>
              {probing ? <Spinner /> : <Activity size={14} />} Test methods
            </button>
            <button type="button" className={cx('btn', active ? 'btn-danger' : 'btn-primary')} onClick={() => void toggleCapture()} disabled={busy}>
              {busy ? <Spinner /> : active ? <Pause size={14} /> : <Play size={14} />}
              {active ? 'Stop viewing' : 'Start viewing'}
            </button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_312px]">
        <div className="min-w-0">
          <div ref={stageRef} className="viewport aspect-video w-full bg-black">
            <canvas
              ref={canvasRef}
              className={cx('h-full w-full object-contain', !active && 'hidden', tapMode && active && 'cursor-none')}
              aria-label="Live screen from the TV"
              onClick={sendTapAt}
              onMouseMove={(event) => {
                if (!tapMode || !active) return;
                const rect = event.currentTarget.getBoundingClientRect();
                setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
              }}
              onMouseLeave={() => setCursor(null)}
              onContextMenu={(event) => {
                if (!active) return;
                event.preventDefault();
                void actions.key('back');
              }}
            />

            {active && tapMode && cursor && (
              <span className="cursor-ring" style={{ left: cursor.x, top: cursor.y }} aria-hidden />
            )}
            {active &&
              ripples.map((ripple) => (
                <span key={ripple.id} className="tap-ripple" style={{ left: ripple.x, top: ripple.y }} aria-hidden />
              ))}

            {active && (
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cx('chip', isVideo ? 'chip-ok' : 'chip-warn')}>
                      <span className={cx('status-orb', isVideo ? 'text-ok' : 'text-warn')} />
                      {isVideo ? 'Continuous H.264' : 'Screenshot feed'}
                    </span>
                    {isPng && <span className="chip chip-warn">Not continuous video</span>}
                    {paused && <span className="chip">Paused</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="mono rounded border border-[var(--line)] bg-black/80 px-1.5 py-1 text-[10px] text-ink/80">
                      {state.metrics.width ? `${state.metrics.width}×${state.metrics.height}` : '—'} · {feed.fps || state.metrics.fps || 0} fps
                    </span>
                  </div>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="mono rounded border border-[var(--line)] bg-black/80 px-1.5 py-1 text-[10px] text-ink/75">
                      capture {formatMs(state.metrics.captureMs)}
                    </span>
                    <span className="mono rounded border border-[var(--line)] bg-black/80 px-1.5 py-1 text-[10px] text-ink/75">
                      transfer {formatMs(state.metrics.transferMs)}
                    </span>
                    <span className="mono rounded border border-[var(--line)] bg-black/80 px-1.5 py-1 text-[10px] text-ink/75">
                      paint {formatMs(state.metrics.renderMs)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {!active && (
              <div className="absolute inset-0 grid place-items-center p-8 text-center">
                <div className="max-w-[420px]">
                  <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-muted">
                    <MonitorPlay size={22} />
                  </div>
                  <div className="text-[14.5px] font-semibold text-ink">Nothing is being mirrored</div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                    {rokuOnly
                      ? 'Roku ECP has no screen-capture endpoint. Remote control, apps and text still work; live view requires an Android TV with ADB enabled.'
                      : adbAuthorised
                        ? 'Start viewing to open a real capture session. LumaRemote tries H.264 first and falls back to screenshots.'
                        : 'Enable debugging on the TV and accept the authorisation prompt before screen viewing can start.'}
                  </p>
                  <div className="mt-5 flex justify-center gap-2">
                    {rokuOnly ? (
                      <button type="button" className="btn btn-primary" onClick={() => onNavigate('remote')}>
                        <Radio size={14} /> Open remote
                      </button>
                    ) : adbAuthorised ? (
                      <button type="button" className="btn btn-primary" onClick={() => void toggleCapture()} disabled={busy}>
                        {busy ? <Spinner /> : <Play size={14} />} Start viewing
                      </button>
                    ) : (
                      <button type="button" className="btn btn-primary" onClick={() => void actions.connect(device.id)}>
                        <ShieldCheck size={14} /> Reconnect & authorise
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {active && feed.status === 'waiting' && (
              <div className="absolute inset-0 grid place-items-center bg-black/50">
                <div className="text-center">
                  <Loader2 size={20} className="mx-auto animate-spin text-accent" />
                  <div className="mt-2.5 text-[12px] font-medium text-ink">Waiting for the first frame</div>
                  <div className="mt-1 text-[10.5px] text-muted">
                    {isVideo ? 'The TV is starting its encoder…' : 'The TV is answering the capture request…'}
                  </div>
                </div>
              </div>
            )}

            {active && feed.status === 'error' && (
              <div className="absolute inset-0 grid place-items-center bg-black/70 p-6">
                <div className="max-w-[440px] text-center">
                  <AlertTriangle size={22} className="mx-auto text-warn" />
                  <div className="mt-2.5 text-[13px] font-semibold text-ink">The feed stopped</div>
                  <div className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{feed.error ?? 'No frames arrived from the TV.'}</div>
                  <div className="mt-4 flex justify-center gap-2">
                    {isVideo && (
                      <button type="button" className="btn" onClick={() => void actions.startCapture('png')} disabled={busy}>
                        <Camera size={14} /> Use screenshots
                      </button>
                    )}
                    <button type="button" className="btn" onClick={() => void actions.stopCapture()}>
                      Stop
                    </button>
                  </div>
                </div>
              </div>
            )}

            {active && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
                <button type="button" className="icon-btn h-7 w-7 border border-[var(--line)] bg-black/80" onClick={saveFrame} aria-label="Save current frame as PNG" title="Save current frame">
                  <Download size={13} />
                </button>
                <button type="button" className="icon-btn h-7 w-7 border border-[var(--line)] bg-black/80" onClick={() => void togglePause()} aria-label={paused ? 'Resume feed' : 'Pause feed'}>
                  {paused ? <Play size={13} /> : <Pause size={13} />}
                </button>
                <button type="button" className="icon-btn h-7 w-7 border border-[var(--line)] bg-black/80" onClick={() => void toggleFullscreen()} aria-label="Toggle fullscreen">
                  {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-faint">
            <div className="flex items-center gap-2">
              <span className={cx('dot', active ? (isVideo ? 'text-ok' : 'text-warn') : 'text-faint')} />
              {statusText}
              {active && <span>· seq {state.frameMeta?.seq ?? 0}</span>}
              {active && feed.frames > 0 && <span>· {feed.frames} frames drawn</span>}
              {active && state.metrics.dropped > 0 && <span className="text-warn">· {state.metrics.dropped} dropped</span>}
            </div>
            <div className="flex items-center gap-3">
              <span>{formatBytes(state.metrics.bytes)} / frame</span>
              <span>{formatBitrate(state.metrics.kbps)}</span>
            </div>
          </div>

          {active && (
            <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-faint">
              <MousePointerClick size={11} />
              {tapMode
                ? 'Click the video to send a tap at that point. Right-click sends Back.'
                : 'Enable “Click to tap” to send touch input. Right-click always sends Back.'}
            </div>
          )}

          {isPng && (
            <div className="mt-3">
              <InlineNote tone="warn" title="This is a screenshot feed, not video">
                LumaRemote is polling <span className="mono">screencap</span> as fast as the TV can answer. Motion will look stepped and
                audio is never included. The rate shown is real; no frame is duplicated or synthesised.
              </InlineNote>
            </div>
          )}
          {isVideo && (
            <div className="mt-3">
              <InlineNote tone="info" title="Continuous H.264 from the TV's encoder">
                Frames arrive as a real stream and are decoded with WebCodecs. Glass-to-glass latency cannot be measured without a
                synchronised source, so it is not estimated here.
              </InlineNote>
            </div>
          )}
          {feed.status === 'error' && !isPng && (
            <div className="mt-3">
              <InlineNote tone="error" title="Decoder message">
                {feed.error ?? 'No decodable frames arrived.'}
              </InlineNote>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Panel className="p-4">
            <SectionTitle
              eyebrow="Controls"
              title="Remote"
              actions={
                <button type="button" className="btn btn-ghost h-7 px-2" onClick={() => onNavigate('remote')}>
                  Full remote <ArrowRight size={12} />
                </button>
              }
            />
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {LIVE_KEYS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="flex h-[46px] flex-col items-center justify-center gap-1 rounded-md border border-[var(--line-soft)] bg-[var(--surface-2)] text-muted transition-colors hover:border-[var(--line)] hover:bg-[#1c2028] hover:text-ink disabled:opacity-35"
                    disabled={!remoteReady}
                    onClick={() => void actions.key(item.key)}
                  >
                    <Icon size={14} />
                    <span className="text-[9.5px]">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle eyebrow="Latency" title="Measured stages" description="Each stage is timed on this laptop. Video has no honest glass-to-glass estimate." />
            <div className="mt-4 space-y-1">
              <LatencyRow label="TV capture" value={isPng ? formatMs(state.metrics.captureMs) : 'n/a'} hint={isPng ? 'screencap duration' : 'streamed'} />
              <LatencyRow label="Transfer" value={isPng ? formatMs(state.metrics.transferMs) : 'n/a'} hint="USB/TCP read" />
              <LatencyRow label="Decode + paint" value={formatMs(state.metrics.renderMs)} hint="renderer" />
              <div className="hairline my-2" />
              <LatencyRow
                label="End to end"
                value={state.metrics.e2eMs === null ? 'not measurable' : formatMs(state.metrics.e2eMs)}
                hint={state.metrics.continuous ? 'continuous stream' : 'estimated'}
                accent={state.metrics.e2eMs !== null && state.metrics.e2eMs < 250}
              />
            </div>
            <div className="mt-3 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-2 text-[10px] leading-relaxed text-faint">
              {state.metrics.continuous
                ? 'The H.264 path has no shared clock with the TV, so an end-to-end number would be a guess. LumaRemote refuses to display one.'
                : 'Screenshot end-to-end is capture + transfer + paint, measured, not a guess. Network jitter can add more.'}
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle eyebrow="Stream" title="What is moving" />
            <div className="mt-3 rounded-md border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-2">
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Bitrate</span>
                <span className="mono text-[10.5px] text-muted">{active ? formatBitrate(state.metrics.kbps) : '—'}</span>
              </div>
              {active ? (
                <Sparkline values={kbpsHistory} tone={isPng ? 'warn' : 'accent'} className="mt-1.5 h-7 w-full" />
              ) : (
                <div className="mt-1.5 flex h-7 items-center text-[10px] text-faint">No stream yet</div>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <MiniStat icon={<Gauge size={13} />} label="Frames" value={`${state.metrics.fps || feed.fps || 0}/s`} />
              <MiniStat icon={<Timer size={13} />} label="Dropped" value={String(state.metrics.dropped)} />
              <MiniStat icon={<Video size={13} />} label="Size" value={state.metrics.width ? `${state.metrics.width}×${state.metrics.height}` : '—'} />
              <MiniStat icon={<Zap size={13} />} label="Paint" value={formatMs(state.metrics.renderMs)} />
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-faint">
              <Zap size={11} /> Newest-frame-only, with real backpressure.
            </div>
          </Panel>

          {probe && (
            <Panel className="p-5">
              <SectionTitle eyebrow="Probe" title="Capture methods" />
              <div className="mt-3 space-y-2">
                <ProbeRow label="screencap" ok={probe.screenshot.supported} detail={probe.screenshot.detail} />
                <ProbeRow label="screenrecord" ok={probe.continuous.supported} detail={probe.continuous.detail} />
              </div>
              <div className="mt-3 text-[10.5px] text-faint">Recommended: {probe.recommendation === 'none' ? 'none' : probe.recommendation === 'h264' ? 'continuous H.264' : 'screenshots'}.</div>
            </Panel>
          )}

          {!adbAuthorised && (
            <Panel className="p-5">
              <SectionTitle eyebrow="Setup" title="Enable screen viewing" />
              <ol className="mt-3 space-y-2.5 text-[11.5px] leading-relaxed text-muted">
                <li className="flex gap-2.5">
                  <span className="mono text-accent">01</span>
                  On the TV: Settings → Device Preferences → About → tap “Build” seven times.
                </li>
                <li className="flex gap-2.5">
                  <span className="mono text-accent">02</span>
                  Developer options → USB debugging (or Network debugging) → On.
                </li>
                <li className="flex gap-2.5">
                  <span className="mono text-accent">03</span>
                  Reconnect here and accept the authorisation prompt on the TV.
                </li>
              </ol>
              <button type="button" className="btn mt-4 w-full" onClick={() => void actions.connect(device.id)}>
                <RefreshCw size={14} /> Reconnect
              </button>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function LatencyRow({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div>
        <div className="text-[11.5px] text-muted">{label}</div>
        <div className="text-[9.5px] uppercase tracking-[0.1em] text-faint/80">{hint}</div>
      </div>
      <div className={cx('mono text-[12px]', accent ? 'text-ok' : 'text-ink/90')}>{value}</div>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="panel-quiet px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-faint">
        {icon}
        <span className="text-[9.5px] uppercase tracking-[0.12em]">{label}</span>
      </div>
      <div className="mono mt-1 truncate text-[12px] text-ink/90">{value}</div>
    </div>
  );
}

function ProbeRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-[10.5px] text-ink/85">{label}</span>
        <span className={cx('chip h-5 px-1.5 text-[9px]', ok ? 'chip-ok' : 'chip-bad')}>{ok ? 'works' : 'blocked'}</span>
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-faint">{detail}</div>
    </div>
  );
}
