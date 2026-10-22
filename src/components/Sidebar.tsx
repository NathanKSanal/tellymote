import { motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  Grid2x2,
  LayoutDashboard,
  MonitorPlay,
  Radio,
  Settings2,
  ShieldCheck,
  Tv,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { ViewId } from '../App';
import { useApp, useDisplayDevice } from '../lib/store';
import { cx, phaseLabel, phaseTone } from '../lib/format';

interface NavItem {
  id: ViewId;
  label: string;
  icon: typeof Tv;
  badge?: 'devices' | 'live';
}

const SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Control',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'devices', label: 'Devices', icon: Tv, badge: 'devices' },
      { id: 'live', label: 'Live screen', icon: MonitorPlay, badge: 'live' },
      { id: 'remote', label: 'Remote', icon: Radio },
    ],
  },
  {
    label: 'Library',
    items: [{ id: 'apps', label: 'Apps & favourites', icon: Grid2x2 }],
  },
  {
    label: 'System',
    items: [
      { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
      { id: 'settings', label: 'Settings', icon: Settings2 },
    ],
  },
];

export function Sidebar({ view, onNavigate }: { view: ViewId; onNavigate: (view: ViewId) => void }) {
  const { state } = useApp();
  const device = useDisplayDevice();
  const tone = phaseTone(state.connection.phase);
  const live = state.connection.captureTransport !== 'none';
  const reduceMotion = useReducedMotion();

  return (
    <aside className="flex w-[212px] flex-none flex-col border-r border-[var(--line)] bg-[#0c0e12]">
      <nav className="scroll-area flex-1 overflow-y-auto px-2.5 py-4">
        {SECTIONS.map((section) => (
          <div key={section.label} className="mb-5 last:mb-0">
            <div className="eyebrow px-2 pb-1.5">{section.label}</div>
            <div className="space-y-px">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="nav-item w-full"
                    data-active={active}
                    onClick={() => onNavigate(item.id)}
                    aria-current={active ? 'page' : undefined}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="pointer-events-none absolute inset-0 rounded-[6px] bg-[#1b1f27]"
                        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 }}
                      />
                    )}
                    <Icon size={15} strokeWidth={1.9} className="relative flex-none" />
                    <span className="relative flex-1 text-left">{item.label}</span>
                    {item.badge === 'devices' && state.devices.length > 0 && (
                      <span className="mono relative text-[10px] text-faint">{state.devices.length}</span>
                    )}
                    {item.badge === 'live' && live && (
                      <span className={cx('dot relative', state.connection.captureTransport === 'adb-png' ? 'text-warn' : 'text-ok')} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex-none space-y-2.5 px-2.5 pb-3">
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5">
          <div className="flex items-center gap-2">
            <span className={cx('status-orb flex-none', tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-faint')} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] font-medium text-ink/90">{device?.name ?? 'No display'}</div>
              <div className="truncate text-[10px] text-faint">{phaseLabel(state.connection.phase)}</div>
            </div>
            {state.connection.phase === 'connected' ? (
              <Wifi size={12} className="text-ok/70" />
            ) : (
              <WifiOff size={12} className="text-faint" />
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost mt-2 h-6 w-full justify-between px-1.5 text-[10.5px]"
            onClick={() => onNavigate('devices')}
          >
            Manage devices
            <span className="text-faint">→</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-1 text-[10px] text-faint">
          <ShieldCheck size={11} className="text-ok/70" />
          <span>Loopback capture · no cloud</span>
        </div>
      </div>
    </aside>
  );
}
