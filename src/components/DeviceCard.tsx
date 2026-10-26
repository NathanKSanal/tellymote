import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  MonitorPlay,
  MoreHorizontal,
  Pencil,
  Plug,
  ShieldCheck,
  Trash2,
  Tv,
  Unplug,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { DiscoveredDevice } from '@shared/types';
import { useApp } from '../lib/store';
import { cx, formatRelative, shortHost } from '../lib/format';
import { CapabilityChip, ConfirmDialog, Dialog, Spinner } from './ui';

export function DeviceCard({ device, onManage }: { device: DiscoveredDevice; onManage?: () => void }) {
  const { state, actions } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(device.name);
  const [confirmForget, setConfirmForget] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const active = state.connection.deviceId === device.id;
  const connected = active && (state.connection.phase === 'connected' || state.connection.phase === 'degraded');
  const busy =
    active && (state.connection.phase === 'connecting' || state.connection.phase === 'pairing' || state.connection.phase === 'reconnecting');

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menuOpen]);

  const openRename = () => {
    setMenuOpen(false);
    // Seed on open: a cancelled edit or a name that changed since mount must not leak in.
    setName(device.name);
    setRenaming(true);
  };

  const remoteReady = device.capabilities.remote.state === 'verified' || device.protocols.includes('atv-remote-v2') || device.protocols.includes('roku-ecp');
  const adbReady = device.capabilities.adb.state === 'verified' || device.protocols.includes('adb');
  const rokuReady = device.protocols.includes('roku-ecp');

  return (
    <div className="device-card p-4" data-active={active}>
      <div className="flex items-start gap-3.5">
        <div
          className={cx(
            'grid h-10 w-10 flex-none place-items-center rounded-lg border',
            active
              ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent'
              : 'border-[var(--line)] bg-[var(--surface-2)] text-muted',
          )}
        >
          <Tv size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="display truncate text-[14.5px] font-semibold text-ink">{device.name}</h3>
            {device.simulated && <span className="chip chip-warn">Simulated</span>}
            {active && <span className="chip chip-accent">Active</span>}
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted">
            {[device.manufacturer, device.model].filter(Boolean).join(' · ') || 'Android TV'}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-faint">
            <span className="mono">{shortHost(device.host)}</span>
            <span className="text-[var(--line)]">•</span>
            <span>{device.source === 'saved' ? 'Saved' : device.source.toUpperCase()}</span>
            <span className="text-[var(--line)]">•</span>
            <span className="inline-flex items-center gap-1">
              {device.reachable ? <Wifi size={10} className="text-ok/80" /> : <WifiOff size={10} />}
              {device.reachable ? 'Reachable' : formatRelative(device.lastSeen)}
            </span>
          </div>
        </div>
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            ref={menuButton}
            className="icon-btn h-7 w-7"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Device actions"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} role="presentation" />
              <div className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-1 shadow-xl">
                <button
                  type="button"
                  className="btn btn-ghost h-8 w-full justify-start px-2 text-[11.5px]"
                  onClick={openRename}
                >
                  <Pencil size={13} /> Rename
                </button>
                <button
                  type="button"
                  className="btn btn-ghost h-8 w-full justify-start px-2 text-[11.5px] text-[#ffb4b4] hover:bg-bad/10"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmForget(true);
                  }}
                >
                  <Trash2 size={13} /> Forget device
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={cx('chip', remoteReady ? 'chip-ok' : '')}>
          <ShieldCheck size={10} />
          {remoteReady ? 'Remote ready' : 'Remote unknown'}
        </span>
        <span className={cx('chip', adbReady ? 'chip-ok' : '')}>
          <Plug size={10} />
          {adbReady ? 'ADB authorised' : 'ADB off'}
        </span>
        {rokuReady && (
          <span className="chip chip-ok">
            <Wifi size={10} /> Roku ECP
          </span>
        )}
        <CapabilityChip capability={device.capabilities.screenCapture} label="Screen" />
        <CapabilityChip capability={device.capabilities.continuousStream} label="Stream" />
      </div>

      {device.notes && device.notes.length > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-2 text-[10.5px] leading-relaxed text-faint">
          {device.notes[0]}
        </div>
      )}

      <div className="mt-3.5 flex items-center gap-2">
        {busy ? (
          <div className="flex h-8 flex-1 items-center gap-2 text-[11.5px] text-muted">
            <Spinner /> {state.connection.phase === 'pairing' ? 'Waiting for the code…' : 'Connecting…'}
          </div>
        ) : connected ? (
          <>
            <button type="button" className="btn flex-1" onClick={onManage ?? (() => undefined)}>
              <MonitorPlay size={14} /> Open controls
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void actions.disconnect()}
              title="Disconnect from this TV"
            >
              <Unplug size={14} /> Disconnect
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary flex-1"
              onClick={() => void actions.connect(device.id)}
            >
              <Plug size={14} />
              {device.trusted ? 'Reconnect' : 'Connect & pair'}
            </button>
            {device.trusted && (
              <button
                type="button"
                className="btn"
                onClick={() => void actions.pair(device.id)}
                title="Pair this laptop again"
              >
                <ShieldCheck size={14} /> Re-pair
              </button>
            )}
          </>
        )}
      </div>

      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename device"
        description="A local label only. It does not change anything on the TV."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setRenaming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!name.trim()}
              onClick={() => {
                void actions.rename(device.id, name.trim());
                setRenaming(false);
              }}
            >
              <Check size={14} /> Save
            </button>
          </>
        }
      >
        <input
          className="field"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          aria-label="Device name"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) {
              void actions.rename(device.id, name.trim());
              setRenaming(false);
            }
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={confirmForget}
        title={`Forget ${device.name}?`}
        message="This removes the saved pairing certificate and pinned fingerprint from this laptop. The TV keeps its own record; you can pair again at any time."
        confirmLabel="Forget device"
        onConfirm={() => void actions.forget(device.id)}
        onCancel={() => setConfirmForget(false)}
      />
    </div>
  );
}

export function ScanningCard({ hostsProbed, hostsTotal, methods }: { hostsProbed: number; hostsTotal: number; methods: string[] }) {
  const percent = hostsTotal > 0 ? Math.min(100, Math.round((hostsProbed / hostsTotal) * 100)) : 0;
  return (
    <div className="panel scan-sheen overflow-hidden p-4">
      <div className="flex items-center gap-3">
        <Loader2 size={16} className="animate-spin text-accent" />
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold text-ink">Looking for displays on your network</div>
          <div className="mt-0.5 text-[11px] text-faint">
            {hostsTotal > 0 ? `${hostsProbed} of ${hostsTotal} addresses` : 'Opening discovery sockets…'}
          </div>
        </div>
        <span className="mono text-[11px] text-muted">{percent}%</span>
      </div>
      <div className="meter mt-3">
        <span style={{ width: `${Math.max(4, percent)}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {methods.map((method) => (
          <span key={method} className="chip">
            {method}
          </span>
        ))}
      </div>
    </div>
  );
}
