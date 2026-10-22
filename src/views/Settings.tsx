import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Accessibility,
  Check,
  Gauge,
  KeyRound,
  Keyboard,
  Laptop,
  Lock,
  MonitorPlay,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react';
import type { AppSettings, KeyboardMap, PerformanceProfile } from '@shared/types';
import { useApp } from '../lib/store';
import { cx } from '../lib/format';
import { ConfirmDialog, InlineNote, PageHeader, Panel, SectionTitle, Toggle } from '../components/ui';

const ACCENTS: Array<{ id: AppSettings['accent']; name: string; color: string }> = [
  { id: 'amber', name: 'Amber', color: '#f2b24b' },
  { id: 'azure', name: 'Azure', color: '#5aa9ff' },
  { id: 'violet', name: 'Violet', color: '#b18cff' },
  { id: 'emerald', name: 'Emerald', color: '#4fd6a4' },
];

const PROFILES: Array<{ id: PerformanceProfile['mode']; name: string; tag: string; detail: string }> = [
  { id: 'lite', name: 'Lite', tag: 'Lowest load', detail: 'One screenshot per second at 960 px. Best when the TV is busy or the network is weak.' },
  { id: 'balanced', name: 'Balanced', tag: 'Default', detail: 'Three screenshots per second at 1280 px. A calm middle ground for menus and browsing.' },
  { id: 'performance', name: 'Performance', tag: 'Most fluid', detail: 'Up to six frames per second at 1920 px, and continuous H.264 when the TV offers it.' },
  { id: 'auto', name: 'Auto', tag: 'Adaptive', detail: 'Starts from the current timing values and backs off when capture or decoding slows down.' },
];

const DEFAULT_KEYBOARD: KeyboardMap = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  select: 'Enter',
  back: 'Escape',
  home: 'Home',
  menu: 'm',
  volumeUp: 'PageUp',
  volumeDown: 'PageDown',
  mute: 'F8',
  playPause: 'Space',
  power: 'F12',
};

const BINDING_KEYS = Object.keys(DEFAULT_KEYBOARD) as Array<keyof KeyboardMap>;

const KEY_LABELS: Record<keyof KeyboardMap, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  select: 'Select / OK',
  back: 'Back',
  home: 'Home',
  menu: 'Menu',
  volumeUp: 'Volume up',
  volumeDown: 'Volume down',
  mute: 'Mute',
  playPause: 'Play / pause',
  power: 'Power',
};

type Listening = { kind: 'keyboard'; key: keyof KeyboardMap } | { kind: 'shortcut'; key: keyof AppSettings['shortcuts'] };

function prettyKey(binding: string): string {
  return binding
    .replace(/Control/g, 'Ctrl')
    .replace(/Arrow/g, '')
    .replace(/PageUp/g, 'PgUp')
    .replace(/PageDown/g, 'PgDn')
    .replace(/Escape/g, 'Esc')
    .replace(/ /g, 'Space');
}

function normalizeBinding(value: string): string {
  return value.length === 1 ? value.toLowerCase() : value;
}

function shortcutFrom(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey) parts.push('Meta');
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join('+');
}

export function Settings() {
  const { state, actions } = useApp();
  const settings = state.settings;
  const [listening, setListening] = useState<Listening | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!listening || !settings) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setListening(null);
        return;
      }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;

      if (listening.kind === 'keyboard') {
        const next = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        const duplicate = BINDING_KEYS.find((key) => key !== listening.key && normalizeBinding(settings.keyboard[key]) === normalizeBinding(next));
        if (duplicate) {
          actions.toast('warn', 'Key already bound', `${KEY_LABELS[duplicate]} already uses ${prettyKey(next)}.`);
          setListening(null);
          return;
        }
        void actions.updateSettings({ keyboard: { ...settings.keyboard, [listening.key]: next } });
        setListening(null);
        return;
      }

      const shortcut = shortcutFrom(event);
      void actions.updateSettings({ shortcuts: { ...settings.shortcuts, [listening.key]: shortcut } });
      setListening(null);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [actions, listening, settings]);

  const duplicateBindings = useMemo(() => {
    if (!settings) return [];
    const seen = new Map<string, keyof KeyboardMap>();
    const duplicates: Array<keyof KeyboardMap> = [];
    for (const key of BINDING_KEYS) {
      const value = normalizeBinding(settings.keyboard[key]);
      if (seen.has(value)) duplicates.push(key);
      else seen.set(value, key);
    }
    return duplicates;
  }, [settings]);

  if (!settings) {
    return (
      <div>
        <PageHeader eyebrow="System" title="Settings" description="Preferences are loading from the local settings store." />
        <Panel className="p-8">
          <div className="text-[12px] text-faint">Waiting for the main process…</div>
        </Panel>
      </div>
    );
  }

  const profile = settings.performanceProfile;
  const update = (partial: Partial<AppSettings>) => void actions.updateSettings(partial);

  const setAccent = (accent: AppSettings['accent']) => {
    document.documentElement.dataset.accent = accent;
    update({ accent });
  };

  return (
    <div>
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Every preference is stored on this laptop. Nothing here changes the TV until you send a command."
        actions={
          <button type="button" className="btn" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={14} /> Reset defaults
          </button>
        }
      />

      {listening && (
        <div className="mb-4">
          <InlineNote tone="info" title="Listening for a key">
            Press the key you want to use. Escape cancels. Modifier keys alone are ignored.
          </InlineNote>
        </div>
      )}

      {duplicateBindings.length > 0 && (
        <div className="mb-4">
          <InlineNote tone="warn" title="Duplicate keyboard bindings">
            {duplicateBindings.map((key) => KEY_LABELS[key]).join(', ')} share a key with another action. Rebind them to avoid ambiguous presses.
          </InlineNote>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel className="p-5">
            <SectionTitle
              eyebrow="Appearance"
              title="Accent and interface"
              description="The shell is a dark interface by design. Accent colour is applied immediately and persists across launches."
              actions={<Sparkles size={15} className="text-faint" />}
            />
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {ACCENTS.map((accent) => (
                <button
                  key={accent.id}
                  type="button"
                  className={cx(
                    'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    settings.accent === accent.id ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-[var(--surface-2)] hover:bg-white/[0.04]',
                  )}
                  onClick={() => setAccent(accent.id)}
                  aria-pressed={settings.accent === accent.id}
                >
                  <span className="h-5 w-5 flex-none rounded-full border border-white/25" style={{ background: accent.color }} />
                  <span className="flex-1 text-[12px] font-medium text-ink/90">{accent.name}</span>
                  {settings.accent === accent.id && <Check size={13} className="text-accent" />}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-start gap-2 text-[10.5px] leading-relaxed text-faint">
              <Accessibility size={12} className="mt-0.5 flex-none" />
              Focus outlines, reduced-motion handling and 44 px title bar controls are part of the shell. A separate light theme is not included in this build.
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle
              eyebrow="Performance"
              title="Capture profile"
              description="A manual profile is applied as-is. Auto starts from the current values, backs off when frames arrive slowly, and recovers toward the Performance rate when the TV keeps up."
              actions={<Gauge size={15} className="text-faint" />}
            />
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {PROFILES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="device-card p-4 text-left"
                  data-active={profile.mode === item.id}
                  onClick={() => void actions.applyProfile(item.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-ink">{item.name}</span>
                    <span className={cx('chip', profile.mode === item.id ? 'chip-accent' : '')}>{item.tag}</span>
                  </div>
                  <div className="mt-1.5 text-[10.5px] leading-relaxed text-muted">{item.detail}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[10.5px] text-faint">
                <span className="mono text-accent/90">{profile.mode}</span>
                <span>{profile.captureFps} fps ceiling</span>
                <span>max {profile.maxWidth} px</span>
                <span>{profile.preferContinuous ? 'prefers continuous H.264' : 'screenshots first'}</span>
                <span>{profile.adaptive ? 'adaptive backoff on' : 'fixed timing'}</span>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 text-[10.5px] leading-relaxed text-faint">
              <Zap size={12} className="mt-0.5 flex-none" />
              Adaptive values are driven by measured capture and decode time. The screenshot path reports a real end-to-end estimate; continuous H.264 is left unlabelled
              because glass-to-glass cannot be measured without a camera.
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle
              eyebrow="Capture"
              title="Preferred transport"
              description="A preference is a starting point, not a promise. The app still probes the TV and falls back when a method fails."
              actions={<MonitorPlay size={15} className="text-faint" />}
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="seg" role="group" aria-label="Preferred capture transport">
                {(
                  [
                    ['auto', 'Auto'],
                    ['h264', 'Video first'],
                    ['png', 'Screenshots first'],
                  ] as const
                ).map(([value, label]) => (
                  <button key={value} type="button" data-active={settings.preferredCapture === value} onClick={() => update({ preferredCapture: value })}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-[10.5px] text-faint">
                {settings.preferredCapture === 'auto'
                  ? 'Chooses per start, based on what the TV actually answered.'
                  : settings.preferredCapture === 'h264'
                    ? 'Tries continuous H.264, then falls back to screenshots.'
                    : 'Uses screenshots unless you switch transport for one session.'}
              </span>
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle
              eyebrow="Keyboard"
              title="Key bindings"
              description="These keys control the TV while focus is outside a text field. Press Change, then press the new key."
              actions={
                <button type="button" className="btn btn-ghost h-8" onClick={() => update({ keyboard: { ...DEFAULT_KEYBOARD } })}>
                  <RotateCcw size={12} /> Restore defaults
                </button>
              }
            />
            <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
              {BINDING_KEYS.map((key) => {
                const active = listening?.kind === 'keyboard' && listening.key === key;
                return (
                  <div key={key} className="flex items-center justify-between gap-3 border-b border-[var(--line-soft)] py-2">
                    <span className="min-w-0 truncate text-[11.5px] text-muted">{KEY_LABELS[key]}</span>
                    <button
                      type="button"
                      className={cx('kbd flex-none transition-colors', active && 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent')}
                      onClick={() => setListening({ kind: 'keyboard', key })}
                      aria-label={`Change ${KEY_LABELS[key]} binding`}
                    >
                      {active ? 'Press a key…' : prettyKey(settings.keyboard[key])}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-faint">
              <Keyboard size={12} /> Arrow keys repeat while held; Enter sends OK. Bindings are case-insensitive for single letters.
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle
              eyebrow="Shortcuts"
              title="Window shortcuts"
              description="Handled inside LumaRemote while its window is focused. F11 is the default fullscreen toggle."
              actions={<Laptop size={15} className="text-faint" />}
            />
            <div className="mt-4 space-y-1">
              {(
                [
                  ['toggleRemote', 'Show or hide the remote'],
                  ['toggleFullscreen', 'Toggle fullscreen'],
                ] as const
              ).map(([key, label]) => {
                const active = listening?.kind === 'shortcut' && listening.key === key;
                return (
                  <div key={key} className="flex items-center justify-between gap-3 border-b border-[var(--line-soft)] py-2">
                    <span className="text-[11.5px] text-muted">{label}</span>
                    <button
                      type="button"
                      className={cx('kbd flex-none transition-colors', active && 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent')}
                      onClick={() => setListening({ kind: 'shortcut', key })}
                      aria-label={`Change ${label} shortcut`}
                    >
                      {active ? 'Press a shortcut…' : prettyKey(settings.shortcuts[key])}
                    </button>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel className="p-5">
            <SectionTitle eyebrow="Behaviour" title="Startup & connection" actions={<SlidersHorizontal size={15} className="text-faint" />} />
            <div className="mt-3 divide-y divide-[var(--line-soft)]">
              <SettingRow
                title="Scan on startup"
                detail="Look for TVs on the local network when the app opens."
                control={<Toggle checked={settings.scanOnStartup} onChange={(next) => update({ scanOnStartup: next })} label="Scan on startup" />}
              />
              <SettingRow
                title="Active sweep on startup"
                detail="Probe the local /24 instead of relying on mDNS and SSDP alone. Slower, more reliable."
                control={<Toggle checked={settings.activeProbeOnStartup} onChange={(next) => update({ activeProbeOnStartup: next })} label="Active sweep on startup" />}
              />
              <SettingRow
                title="Reconnect automatically"
                detail="Retry the last TV when the connection drops."
                control={<Toggle checked={settings.autoReconnect} onChange={(next) => update({ autoReconnect: next })} label="Reconnect automatically" />}
              />
              <SettingRow
                title="Launch at login"
                detail="Start minimised when you sign in to Windows."
                control={<Toggle checked={settings.launchAtLogin} onChange={(next) => update({ launchAtLogin: next })} label="Launch at login" />}
              />
              <SettingRow
                title="Keep running in the tray"
                detail="Closing the window hides it instead of quitting."
                control={<Toggle checked={settings.minimizeToTray} onChange={(next) => update({ minimizeToTray: next })} label="Keep running in the tray" />}
              />
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle eyebrow="Safety" title="Commands & exports" actions={<ShieldCheck size={15} className="text-faint" />} />
            <div className="mt-3 divide-y divide-[var(--line-soft)]">
              <SettingRow
                title="Confirm the power key"
                detail="Ask before sending power, which can switch the TV off or on depending on firmware."
                control={<Toggle checked={settings.confirmPowerOff} onChange={(next) => update({ confirmPowerOff: next })} label="Confirm the power key" />}
              />
              <SettingRow
                title="Include IP addresses in exports"
                detail="Off by default. Diagnostics otherwise redact addresses and pairing details."
                control={<Toggle checked={settings.includeIpsInExports} onChange={(next) => update({ includeIpsInExports: next })} label="Include IP addresses in exports" />}
              />
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle eyebrow="Security" title="Local by design" actions={<Lock size={15} className="text-faint" />} />
            <div className="mt-3 space-y-2.5 text-[11px] leading-relaxed text-muted">
              <div className="flex items-start gap-2">
                <KeyRound size={12} className="mt-0.5 flex-none text-accent" />
                <span>
                  Pairing certificates and keys are encrypted with Windows DPAPI through Electron safeStorage when the OS exposes it.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <Terminal size={12} className="mt-0.5 flex-none text-accent" />
                <span>Screen frames are served only on 127.0.0.1, on an ephemeral port, behind a random per-run token.</span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck size={12} className="mt-0.5 flex-none text-accent" />
                <span>No cloud relay, account, analytics or DRM bypass. Pairing is explicit; debugging is never enabled silently.</span>
              </div>
            </div>
            <div className="mt-4 space-y-1 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10.5px] text-faint">Secret store</span>
                <span className={cx('chip', state.appInfo?.security.vaultPersisted ? 'chip-ok' : 'chip-warn')}>
                  {state.appInfo?.security.vaultPersisted ? 'DPAPI available' : 'Session only'}
                </span>
              </div>
              {state.appInfo?.security.warning && <div className="text-[10.5px] leading-relaxed text-warn">{state.appInfo.security.warning}</div>}
              <div className="mt-2">
                <div className="eyebrow mb-1">User data</div>
                <div className="mono select-text break-all text-[9.5px] leading-relaxed text-faint">{state.appInfo?.userDataPath ?? '—'}</div>
              </div>
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle eyebrow="Runtime" title="Build information" actions={<Laptop size={15} className="text-faint" />} />
            <div className="mt-2">
              <div className="grid grid-cols-2 gap-x-5">
                <div className="py-1.5">
                  <div className="eyebrow">Version</div>
                  <div className="mono mt-1 text-[11.5px] text-ink/85">{state.appInfo?.version ?? '—'}</div>
                </div>
                <div className="py-1.5">
                  <div className="eyebrow">Electron</div>
                  <div className="mono mt-1 text-[11.5px] text-ink/85">{state.appInfo?.electron ?? '—'}</div>
                </div>
                <div className="py-1.5">
                  <div className="eyebrow">Chromium</div>
                  <div className="mono mt-1 text-[11.5px] text-ink/85">{state.appInfo?.chrome ?? '—'}</div>
                </div>
                <div className="py-1.5">
                  <div className="eyebrow">Node</div>
                  <div className="mono mt-1 text-[11.5px] text-ink/85">{state.appInfo?.node ?? '—'}</div>
                </div>
              </div>
            </div>
          </Panel>

          <Panel className="border-bad/20 p-5">
            <SectionTitle
              eyebrow="Danger zone"
              title="Reset preferences"
              description="Restores accent, profiles, keyboard bindings, shortcuts and behaviour to defaults. Saved TVs and pairing keys are not deleted."
              actions={<Trash2 size={15} className="text-bad/80" />}
            />
            <button type="button" className="btn btn-danger mt-4" onClick={() => setConfirmReset(true)}>
              <RotateCcw size={14} /> Reset all settings
            </button>
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset every preference?"
        message="Accent, performance, capture preference, keyboard bindings, shortcuts and behaviour return to defaults. Saved devices and pairing keys are kept."
        confirmLabel="Reset settings"
        onConfirm={() => void actions.resetSettings()}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function SettingRow({ title, detail, control }: { title: string; detail: string; control: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-[11.5px] font-medium text-ink/90">{title}</div>
        <div className="mt-0.5 text-[10.5px] leading-relaxed text-faint">{detail}</div>
      </div>
      <div className="flex-none pt-0.5">{control}</div>
    </div>
  );
}
