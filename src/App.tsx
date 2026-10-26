import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, RefreshCw, ShieldAlert, Tv } from 'lucide-react';
import { api } from './lib/api';
import { useApp } from './lib/store';
import { TitleBar } from './components/TitleBar';
import { StatusBar } from './components/StatusBar';
import { Sidebar } from './components/Sidebar';
import { PairingModal } from './components/PairingModal';
import { Toasts } from './components/Toasts';
import { Dashboard } from './views/Dashboard';
import { Devices } from './views/Devices';
import { LiveScreen } from './views/LiveScreen';
import { Remote } from './views/Remote';
import { Apps } from './views/Apps';
import { Diagnostics } from './views/Diagnostics';
import { Settings } from './views/Settings';

export type ViewId = 'dashboard' | 'devices' | 'live' | 'remote' | 'apps' | 'diagnostics' | 'settings';

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (!key) return false;

  const wantsCtrl = parts.some((part) => /^(control|ctrl)$/i.test(part));
  const wantsShift = parts.some((part) => /^shift$/i.test(part));
  const wantsAlt = parts.some((part) => /^alt$/i.test(part));
  const wantsMeta = parts.some((part) => /^(meta|win|cmd|command)$/i.test(part));

  if (event.ctrlKey !== wantsCtrl) return false;
  if (event.shiftKey !== wantsShift) return false;
  if (event.altKey !== wantsAlt) return false;
  if (event.metaKey !== wantsMeta) return false;

  const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const wanted = key.length === 1 ? key.toLowerCase() : key;
  return pressed === wanted;
}

function BootScreen() {
  return (
    <div className="app-bg grid h-full place-items-center px-8 text-center">
      <div>
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-ink)]">
          <Tv size={20} strokeWidth={2} />
        </div>
        <div className="display mt-5 text-[18px] font-semibold tracking-[-0.02em] text-ink">TellyMote</div>
        <div className="mt-2 flex items-center justify-center gap-2 text-[11.5px] text-faint">
          <Loader2 size={13} className="animate-spin" />
          Preparing the local session…
        </div>
      </div>
    </div>
  );
}

function BootError({ message }: { message: string }) {
  return (
    <div className="app-bg grid h-full place-items-center px-8">
      <div className="panel max-w-[520px] p-7">
        <div className="flex items-start gap-3.5">
          <div className="grid h-10 w-10 flex-none place-items-center rounded-lg border border-bad/25 bg-bad/[0.07] text-bad">
            <ShieldAlert size={18} />
          </div>
          <div>
            <div className="eyebrow mb-1">Startup problem</div>
            <h1 className="display text-[19px] font-semibold text-ink">The main process did not answer</h1>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-[10.5px] leading-relaxed text-faint">
            Settings live in your user data folder. Pairing keys never leave this laptop.
          </span>
          <button type="button" className="btn btn-primary flex-none" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { state, actions } = useApp();
  const [view, setView] = useState<ViewId>('dashboard');
  const [bootStalled, setBootStalled] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const fullscreenRef = useRef(false);

  const toggleFullscreen = useCallback(async () => {
    try {
      const actual = await api.setFullscreen(!fullscreenRef.current);
      fullscreenRef.current = actual;
    } catch (err) {
      actions.toast('error', 'Could not change the window mode', err instanceof Error ? err.message : String(err));
    }
  }, [actions]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [view]);

  useEffect(() => {
    const shortcuts = state.settings?.shortcuts;
    if (!shortcuts) return;
    const handler = (event: KeyboardEvent) => {
      // A rebound shortcut can be a bare letter, which would otherwise fire
      // while the user is typing in the text-entry or ADB console fields.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (matchesShortcut(event, shortcuts.toggleFullscreen)) {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (matchesShortcut(event, shortcuts.toggleRemote)) {
        event.preventDefault();
        setView((current) => (current === 'remote' ? 'dashboard' : 'remote'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.settings?.shortcuts, toggleFullscreen]);

  // A hung IPC call never rejects, so the spinner needs its own way out.
  useEffect(() => {
    if (state.ready || state.bootError) return;
    const id = window.setTimeout(() => setBootStalled(true), 12000);
    return () => window.clearTimeout(id);
  }, [state.ready, state.bootError]);

  if (state.bootError) return <BootError message={state.bootError} />;
  if (!state.ready) {
    return bootStalled ? (
      <BootError message="The main process did not answer within 12 seconds. Retry, and if it keeps happening check Diagnostics in the logs folder." />
    ) : (
      <BootScreen />
    );
  }

  const body = (() => {
    switch (view) {
      case 'dashboard':
        return <Dashboard onNavigate={setView} />;
      case 'devices':
        return <Devices onNavigate={setView} />;
      case 'live':
        return <LiveScreen onNavigate={setView} />;
      case 'remote':
        return <Remote onNavigate={setView} />;
      case 'apps':
        return <Apps />;
      case 'diagnostics':
        return <Diagnostics />;
      case 'settings':
        return <Settings />;
      default:
        return null;
    }
  })();

  return (
    <div className="app-bg flex h-full min-h-0 flex-col overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar view={view} onNavigate={setView} />
        <main ref={mainRef} className="scroll-area relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1440px] px-6 py-6 pb-12">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view}
                className="view-stage"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.2, 0.7, 0.3, 1] }}
              >
                {body}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <StatusBar />
      <PairingModal />
      <Toasts />
    </div>
  );
}
