import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Grid2x2,
  Info,
  Keyboard,
  MonitorPlay,
  Radio,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Type,
  Volume2,
} from 'lucide-react';
import type { RemoteKey } from '@shared/types';
import type { ViewId } from '../App';
import { useApp, useDisplayDevice } from '../lib/store';
import { api } from '../lib/api';
import { cx, formatMs, remoteTransportLabel, shortHost } from '../lib/format';
import { RemotePad } from '../components/RemotePad';
import { ConfirmDialog, EmptyState, InlineNote, KeyValue, PageHeader, Panel, SectionTitle, Toggle } from '../components/ui';

const EXTRA_KEYS: Array<{ key: RemoteKey; label: string; icon: typeof Info; note?: string }> = [
  { key: 'guide', label: 'Guide', icon: Grid2x2, note: 'TV app dependent' },
  { key: 'info', label: 'Info', icon: Info, note: 'TV app dependent' },
  { key: 'input', label: 'Input', icon: MonitorPlay, note: 'TV app dependent' },
  { key: 'settings', label: 'Settings', icon: Settings, note: 'TV app dependent' },
  { key: 'channelUp', label: 'Channel +', icon: ChevronUp, note: 'TV app dependent' },
  { key: 'channelDown', label: 'Channel −', icon: ChevronDown, note: 'TV app dependent' },
  { key: 'backspace', label: 'Backspace', icon: CornerDownLeft },
  { key: 'sleep', label: 'Sleep', icon: ArrowDown, note: 'Only if the TV supports it' },
];

export function Remote({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { state, actions } = useApp();
  const device = useDisplayDevice();
  const [keyboardEnabled, setKeyboardEnabled] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmPower, setConfirmPower] = useState(false);
  const [link, setLink] = useState<{ rttMs: number | null; keyRttMs: number | null; commandsSent: number } | null>(null);
  const isActive = Boolean(device && state.connection.deviceId === device.id);
  const remoteReady = state.connection.remoteTransport !== 'none';
  const rokuReady = state.connection.remoteTransport === 'roku';
  const textReady = device?.capabilities.adb.state === 'verified' || rokuReady;

  const keyBindings = useMemo(() => {
    const map = new Map<string, RemoteKey>();
    if (!state.settings) return map;
    for (const [key, binding] of Object.entries(state.settings.keyboard) as Array<[RemoteKey, string]>) {
      if (binding) map.set(binding.length === 1 ? binding.toLowerCase() : binding, key);
    }
    return map;
  }, [state.settings]);

  useEffect(() => {
    if (!device) return;
    let stale = false;
    void api
      .diagnostics()
      .then((snapshot) => {
        // A slow snapshot from the previous TV must not be shown for this one.
        if (!stale)
          setLink({ rttMs: snapshot.network.rttMs, keyRttMs: snapshot.remote.keyRttMs, commandsSent: snapshot.remote.commandsSent });
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [device?.id, state.connection.phase]);

  useEffect(() => {
    if (!keyboardEnabled || !remoteReady) return;
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      // Activation keys on a focused control already send their own press; firing the
      // binding too would double-tap the TV. Arrow-key navigation stays global.
      if ((event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') && target?.closest('button, a[href], [role="button"], [tabindex]')) return;
      const lookup = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const remoteKey = keyBindings.get(lookup);
      if (!remoteKey) return;
      event.preventDefault();
      if (remoteKey === 'power' && state.settings?.confirmPowerOff) {
        setConfirmPower(true);
        return;
      }
      void actions.key(remoteKey);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions, keyBindings, keyboardEnabled, remoteReady, state.settings?.confirmPowerOff]);

  if (!device) {
    return (
      <div>
        <PageHeader eyebrow="Remote" title="Control" description="Pair a TV to send real key events over your network." />
        <Panel>
          <EmptyState icon={<Radio size={22} />} title="No display connected" body="Choose a TV and pair it once. After that, control is instant and local." action={<button type="button" className="btn btn-primary" onClick={() => onNavigate('devices')}>Choose a display</button>} />
        </Panel>
      </div>
    );
  }

  const sendText = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const sent = await actions.text(text);
    setSending(false);
    // Keep what was typed when the TV refused it so it can be corrected.
    if (sent) setText('');
  };

  return (
    <div>
      <PageHeader
        eyebrow="Remote"
        title="Control"
        description={`${shortHost(device.host)} · ${[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Android TV'}`}
        actions={
          <>
            <span className={cx('chip', remoteReady ? 'chip-ok' : 'chip-bad')}>
              <span className="dot" />
              {state.connection.remoteTransport === 'atv-v2' ? 'Android TV remote v2' : state.connection.remoteTransport === 'roku' ? 'Roku ECP' : state.connection.remoteTransport === 'adb' ? 'ADB key fallback' : 'Not connected'}
            </span>
            {link?.rttMs != null && <span className="chip mono">RTT {formatMs(link.rttMs)}</span>}
            <button type="button" className="btn" onClick={() => onNavigate('apps')}>
              <Grid2x2 size={14} /> Apps
            </button>
          </>
        }
      />

      {!isActive && (
        <div className="mb-4">
          <InlineNote tone="warn" title={`${shortHost(device.host)} is saved but not connected`}>
            <span className="block">
              Connect to send keys. Pairing is already stored on this laptop, so this is one click — no code needed
              unless the TV forgot it.
            </span>
            <button type="button" className="btn btn-primary mt-2 h-8" onClick={() => void actions.connect(device.id)}>
              <Radio size={13} /> Connect to {shortHost(device.host)}
            </button>
          </InlineNote>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4 lg:sticky lg:top-2 lg:self-start">
          <RemotePad />
          <Panel className="p-4">
            <div className="eyebrow mb-2 flex items-center gap-2">
              Link
              {remoteReady && <span className="dot dot-live text-ok" aria-hidden />}
            </div>
            <div className="divide-y divide-[var(--line-soft)]">
              <KeyValue label="Transport" value={remoteTransportLabel(state.connection.remoteTransport)} />
              <KeyValue label="Key round trip" value={link?.keyRttMs != null ? formatMs(link.keyRttMs) : 'not measured'} />
              <KeyValue label="Network round trip" value={link?.rttMs != null ? formatMs(link.rttMs) : 'not measured'} />
              <KeyValue label="Commands sent" value={link?.commandsSent ?? 0} />
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel className="p-5">
            <SectionTitle
              eyebrow="Keyboard"
              title="Type on the TV from this keyboard"
              description="Only works while focus is outside a text field. Bindings can be changed in Settings."
              actions={<Toggle checked={keyboardEnabled} onChange={setKeyboardEnabled} label="Enable keyboard control" />}
            />
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {(Object.entries(state.settings?.keyboard ?? {}) as Array<[string, string]>).map(([label, binding]) => (
                <div key={label} className="flex items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-1.5">
                  <span className="text-[11px] capitalize text-muted">{label.replace(/([A-Z])/g, ' $1')}</span>
                  <kbd className="kbd">{prettyKey(binding)}</kbd>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-faint">
              <Keyboard size={12} /> Pressed keys are sent immediately. Hold arrows for repeat.
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel className="flex flex-col p-5">
              <SectionTitle eyebrow="Text entry" title="Send text to the TV" description="Requires an authorised debugging connection." />
              <textarea
                className="field mt-3 min-h-[92px] flex-1 resize-none py-2.5"
                placeholder={textReady ? 'Type something and send it to the focused field on the TV…' : 'Debugging is not authorised'}
                value={text}
                maxLength={500}
                disabled={!textReady}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void sendText();
                  }
                }}
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-faint">{text.length}/500 · ASCII only</span>
                <button type="button" className="btn btn-primary h-8" onClick={() => void sendText()} disabled={!text.trim() || sending || !textReady}>
                  <Send size={13} /> {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
              {!textReady && (
                <div className="mt-3 text-[10.5px] leading-relaxed text-faint">
                  Android TV text entry needs ADB debugging. Roku accepts literal keys (Lit_) over ECP. Both are ASCII-only.
                </div>
              )}
            </Panel>

            <Panel className="flex flex-col p-5">
              <SectionTitle eyebrow="Favourites" title="Launch something" description="Deep links need debugging; keys work without it." />
              <div className="mt-3 flex-1 space-y-1.5">
                {(state.settings?.favoriteApps ?? []).slice(0, 5).map((pkg) => (
                  <button
                    key={pkg}
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-2 text-left transition-colors hover:bg-[#1c2028]"
                    onClick={() => void actions.launchApp(pkg)}
                    disabled={!textReady}
                    title={textReady ? `Launch ${pkg}` : 'Requires an authorised debugging connection'}
                  >
                    <span className="grid h-7 w-7 flex-none place-items-center rounded-md bg-[var(--accent-soft)] text-[11px] font-semibold text-accent">
                      {pkg.split('.').slice(-1)[0]?.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink/90">{friendly(pkg)}</span>
                    <span className="mono text-[9px] text-faint">{pkg.split('.').slice(-1)[0]}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-ghost mt-3 h-8 w-full" onClick={() => onNavigate('apps')}>
                Manage apps <ArrowRight size={12} />
              </button>
            </Panel>
          </div>

          <Panel className="p-5">
            <SectionTitle
              eyebrow="Advanced keys"
              title="Keys some TV apps ignore"
              description="Android TV accepts these key codes, but whether the foreground app reacts is up to the app. They are grouped separately so the main pad stays honest."
            />
            <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
              {EXTRA_KEYS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="flex h-[54px] flex-col items-center justify-center gap-1 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] text-muted transition-colors hover:bg-[#1c2028] hover:text-ink disabled:opacity-30"
                    disabled={!remoteReady}
                    onClick={() => void actions.key(item.key)}
                    title={item.note}
                  >
                    <Icon size={14} />
                    <span className="text-[9.5px]">{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-faint">
              <Sparkles size={11} /> Long press OK or an arrow for continuous navigation.
            </div>
          </Panel>

          {isActive && !remoteReady && (
            <InlineNote tone="warn" title="No remote transport">
              The TV is not accepting key events right now. Reconnect from Devices; if the native remote service is unavailable, TellyMote can fall back to ADB key events when debugging is authorised.
            </InlineNote>
          )}

          {remoteReady && (
            <div className="flex items-center gap-2 text-[10.5px] text-faint">
              <ShieldCheck size={12} className="text-ok/70" />
              Keys travel directly from this laptop to the TV. No relay, no account, no telemetry.
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmPower}
        title="Send the power key?"
        message="Power toggles the TV on supported hardware. If the TV ignores it, use the original remote or the TV's power button."
        confirmLabel="Send power"
        onConfirm={() => void actions.key('power')}
        onCancel={() => setConfirmPower(false)}
      />
    </div>
  );
}

function prettyKey(binding: string): string {
  const glyphs: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: '↵',
    Escape: 'Esc',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
    ' ': 'Space',
  };
  if (glyphs[binding]) return glyphs[binding];
  return binding
    .replace(/Control/g, 'Ctrl')
    .replace(/Arrow/g, '')
    .replace(/PageUp/g, 'PgUp')
    .replace(/PageDown/g, 'PgDn')
    .replace(/Escape/g, 'Esc')
    .replace(/ /g, 'Space');
}

function friendly(pkg: string): string {
  const known: Record<string, string> = {
    'com.netflix.ninja': 'Netflix',
    'com.google.android.youtube.tv': 'YouTube',
    'com.amazon.amazonvideo.livingroom': 'Prime Video',
    'com.disney.disneyplus': 'Disney+',
    'com.spotify.tv.android': 'Spotify',
    'com.google.android.videos': 'Google TV',
    'com.xiaomi.tv.patchwall': 'PatchWall',
    'com.mitv.tvhome': 'Mi TV Home',
  };
  return known[pkg] ?? pkg.split('.').slice(-1)[0] ?? pkg;
}
