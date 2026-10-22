import { useState } from 'react';
import { Info, Loader2, Plus, Radar, RefreshCw, ScanLine, Search, Tv, Wifi } from 'lucide-react';
import { useApp } from '../lib/store';
import { cx, formatRelative } from '../lib/format';
import type { ViewId } from '../App';
import { DeviceCard, ScanningCard } from '../components/DeviceCard';
import { EmptyState, InlineNote, PageHeader, Panel, SectionTitle, Spinner } from '../components/ui';

export function Devices({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { state, actions } = useApp();
  const [manualOpen, setManualOpen] = useState(false);
  const [host, setHost] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(Boolean(state.settings?.activeProbeOnStartup));
  const scan = state.scan;

  const add = async () => {
    if (!host.trim() || busy) return;
    setBusy(true);
    const device = await actions.addManual(host.trim(), name.trim() || undefined);
    setBusy(false);
    if (device) {
      setHost('');
      setName('');
      setManualOpen(false);
      if (device.reachable) void actions.connect(device.id);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Discovery"
        title="Devices"
        description="Saved displays, network discoveries and manual addresses. Pairing and trust are stored locally."
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setManualOpen((open) => !open)}
              aria-expanded={manualOpen}
            >
              <Plus size={14} /> Add by IP
            </button>
            {scan.running ? (
              <button type="button" className="btn btn-danger" onClick={() => void actions.cancelScan()}>
                <Loader2 size={14} className="animate-spin" /> Stop scan
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void actions.scan({ activeProbe: deep, timeoutMs: 5200 })}
              >
                <ScanLine size={14} /> Scan network
              </button>
            )}
          </>
        }
      />

      {manualOpen && (
        <Panel className="mb-5 p-5">
          <SectionTitle
            eyebrow="Manual address"
            title="Add a TV by IP or hostname"
            description="Useful when multicast discovery is blocked. The address is probed for the Android TV remote service and wireless debugging."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-[1.2fr_1fr_auto]">
            <label className="block">
              <span className="eyebrow mb-1.5 block">Address</span>
              <input
                className="field"
                placeholder="192.168.0.42"
                value={host}
                autoFocus
                spellCheck={false}
                onChange={(event) => setHost(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void add();
                }}
              />
            </label>
            <label className="block">
              <span className="eyebrow mb-1.5 block">Label (optional)</span>
              <input
                className="field"
                placeholder="Living room TV"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void add();
                }}
              />
            </label>
            <div className="flex items-end gap-2">
              <button type="button" className="btn btn-primary h-[38px]" onClick={() => void add()} disabled={!host.trim() || busy}>
                {busy ? <Spinner /> : <Plus size={14} />} {busy ? 'Probing…' : 'Add'}
              </button>
              <button type="button" className="btn h-[38px]" onClick={() => setManualOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
          <div className="mt-3 text-[10.5px] text-faint">
            Only private or local addresses are expected. TellyMote never sends traffic outside your network.
          </div>
        </Panel>
      )}

      {scan.running && (
        <div className="mb-5">
          <ScanningCard hostsProbed={scan.hostsProbed} hostsTotal={scan.hostsTotal} methods={scan.methods} />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="eyebrow">Discovered</span>
              <span className="chip">{state.devices.length} display{state.devices.length === 1 ? '' : 's'}</span>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-faint">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--accent)]"
                checked={deep}
                onChange={(event) => setDeep(event.target.checked)}
              />
              Sweep the whole subnet
            </label>
          </div>

          {state.devices.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<Radar size={22} />}
                title={scan.running ? 'Listening for displays…' : 'No displays found yet'}
                body={
                  scan.running
                    ? 'mDNS, SSDP and the direct port probe are running. Results appear as soon as a TV answers.'
                    : 'Check that the TV is on and on the same network, then scan again. If multicast is blocked, add the TV by IP address.'
                }
                action={
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-primary" onClick={() => void actions.scan({ activeProbe: deep, timeoutMs: 5200 })} disabled={scan.running}>
                      <RefreshCw size={14} /> Scan again
                    </button>
                    <button type="button" className="btn" onClick={() => setManualOpen(true)}>
                      <Plus size={14} /> Enter IP
                    </button>
                  </div>
                }
              />
            </Panel>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {state.devices.map((device) => (
                <DeviceCard key={device.id} device={device} onManage={() => onNavigate('remote')} />
              ))}
            </div>
          )}

          {!scan.running && scan.errors.length > 0 && (
            <div className="mt-4">
              <InlineNote tone="warn" title="Some discovery methods reported problems">
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {scan.errors.slice(0, 3).map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </InlineNote>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Panel className="p-5">
            <SectionTitle eyebrow="Network" title="Where we look" />
            <div className="mt-4 space-y-3 text-[11.5px]">
              <div className="flex items-start justify-between gap-3">
                <span className="text-faint">Interface</span>
                <span className="mono text-right text-ink/90">{scan.localAddress ?? 'not detected'}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-faint">Subnet</span>
                <span className="mono text-right text-ink/90">{scan.subnet ?? '—'}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-faint">Last scan</span>
                <span className="text-right text-ink/90">{scan.finishedAt ? formatRelative(scan.finishedAt) : scan.running ? 'running' : 'never'}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-faint">Hosts probed</span>
                <span className="mono text-right text-ink/90">
                  {scan.hostsProbed}
                  {scan.hostsTotal ? ` / ${scan.hostsTotal}` : ''}
                </span>
              </div>
            </div>
            <div className="hairline my-4" />
            <div className="space-y-2 text-[10.5px] leading-relaxed text-faint">
              <div className="flex items-center gap-2">
                <Wifi size={11} /> mDNS service discovery
              </div>
              <div className="flex items-center gap-2">
                <Search size={11} /> SSDP / UPnP search
              </div>
              <div className="flex items-center gap-2">
                <Radar size={11} /> Direct probe of 6466 / 6467 / 5555
              </div>
            </div>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-start gap-2.5">
              <Info size={14} className="mt-0.5 flex-none text-muted" />
              <div className="text-[11.5px] leading-relaxed text-muted">
                A TV can answer discovery but still refuse control until this laptop is paired. Pairing is always explicit and confirmed on the TV.
              </div>
            </div>
          </Panel>

          {state.settings?.lastDeviceId && (
            <Panel className="p-5">
              <div className="eyebrow mb-2">Auto reconnect</div>
              <div className="text-[11.5px] leading-relaxed text-muted">
                {state.settings.autoReconnect
                  ? 'TellyMote will try the last display when it starts, with backoff and a six-attempt cap.'
                  : 'Auto reconnect is off. Connect manually from a device card.'}
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-faint">
                <Tv size={11} />
                {state.devices.find((d) => d.id === state.settings?.lastDeviceId)?.name ?? state.settings.lastDeviceId}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
