import { useEffect, useMemo, useState } from 'react';
import { AppWindow, Loader2, Play, RefreshCw, Search, ShieldCheck, Star, Terminal, Tv } from 'lucide-react';
import type { AppEntry } from '@shared/types';
import { useActiveDevice, useApp } from '../lib/store';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { EmptyState, InlineNote, PageHeader, Panel, SectionTitle } from '../components/ui';

export function Apps() {
  const { state, actions } = useApp();
  const device = useActiveDevice();
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyFavourites, setOnlyFavourites] = useState(false);
  const appsReady =
    device?.capabilities.adb.state === 'verified' ||
    state.connection.remoteTransport === 'roku' ||
    device?.capabilities.appList.state === 'verified';
  const favourites = state.settings?.favoriteApps ?? [];

  const load = async () => {
    if (!appsReady || loading) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.listApps();
      setApps(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the package list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (appsReady) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appsReady, device?.id]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return apps.filter((app) => {
      if (onlyFavourites && !favourites.includes(app.packageName)) return false;
      if (!term) return true;
      return app.label.toLowerCase().includes(term) || app.packageName.toLowerCase().includes(term);
    });
  }, [apps, favourites, onlyFavourites, query]);

  const toggleFavourite = (pkg: string) => {
    const next = favourites.includes(pkg) ? favourites.filter((item) => item !== pkg) : [...favourites, pkg].slice(0, 40);
    void actions.updateSettings({ favoriteApps: next });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title="Apps & favourites"
        description="Launch installed apps by package name. The list comes from the TV over an authorised debugging connection, not from a bundled catalogue."
        actions={
          <>
            <button type="button" className="btn" onClick={() => void load()} disabled={!appsReady || loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void actions.launchApp(favourites[0] ?? '')} disabled={!appsReady || !favourites[0]}>
              <Play size={14} /> Launch first favourite
            </button>
          </>
        }
      />

      {!appsReady ? (
        <Panel>
          <EmptyState
            icon={<Terminal size={22} />}
            title="The app list needs a supported connection"
            body="Android TV needs an authorised ADB connection for pm list packages / monkey. Roku uses its ECP app list and launch endpoints. Key control works without either."
            action={
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary" onClick={() => device && void actions.connect(device.id)}>
                  <ShieldCheck size={14} /> Reconnect & authorise
                </button>
              </div>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="search flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input className="field pl-9" placeholder="Search apps or package names" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <button type="button" className={cx('btn', onlyFavourites && 'btn-primary')} onClick={() => setOnlyFavourites((value) => !value)}>
                <Star size={13} className={onlyFavourites ? 'fill-current' : ''} /> Favourites
              </button>
            </div>

            {error && (
              <div className="mb-3">
                <InlineNote tone="error" title="Could not read apps">
                  {error}
                </InlineNote>
              </div>
            )}

            {loading && apps.length === 0 ? (
              <Panel>
                <EmptyState icon={<Loader2 size={22} className="animate-spin" />} title="Reading the package list" body="The TV is answering pm list packages over ADB." compact />
              </Panel>
            ) : filtered.length === 0 ? (
              <Panel>
                <EmptyState
                  icon={<AppWindow size={22} />}
                  title={apps.length === 0 ? 'No apps returned' : 'Nothing matches'}
                  body={apps.length === 0 ? 'The TV returned an empty package list. Try refreshing; some firmware restricts shell commands.' : 'Adjust the search or turn off the favourites filter.'}
                  compact
                />
              </Panel>
            ) : (
              <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
                {filtered.map((app) => {
                  const favourite = favourites.includes(app.packageName);
                  return (
                    <div key={app.packageName} className="group flex items-center gap-3 rounded-lg border border-[var(--line)] bg-white/[0.022] p-3 transition-colors hover:border-white/[0.13] hover:bg-white/[0.04]">
                      <div
                        className="grid h-10 w-10 flex-none place-items-center rounded-lg text-[13px] font-semibold text-white/90"
                        style={{ background: gradientFor(app.packageName) }}
                      >
                        {app.label.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium text-ink">{app.label}</div>
                        <div className="mono truncate text-[9.5px] text-faint">{app.packageName}</div>
                      </div>
                      <button
                        type="button"
                        className={cx('icon-btn h-7 w-7', favourite && 'text-accent')}
                        onClick={() => toggleFavourite(app.packageName)}
                        aria-label={favourite ? `Remove ${app.label} from favourites` : `Add ${app.label} to favourites`}
                      >
                        <Star size={13} className={favourite ? 'fill-current' : ''} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => void actions.launchApp(app.packageName)}
                        aria-label={`Launch ${app.label}`}
                        title="Launch on TV"
                      >
                        <Play size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <Panel className="p-5">
              <SectionTitle eyebrow="Favourites" title={`${favourites.length} pinned`} description="Favourites appear on the remote and the dashboard." />
              <div className="mt-3 space-y-1.5">
                {favourites.length === 0 && <div className="py-3 text-center text-[11px] text-faint">Star an app to pin it here.</div>}
                {favourites.map((pkg) => (
                  <button
                    key={pkg}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-2 text-left hover:bg-[#1c2028]"
                    onClick={() => void actions.launchApp(pkg)}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: gradientFor(pkg) }} />
                    <span className="mono min-w-0 flex-1 truncate text-[10px] text-ink/85">{pkg}</span>
                    <Play size={11} className="text-faint" />
                  </button>
                ))}
              </div>
            </Panel>

            <Panel className="p-5">
              <div className="flex items-start gap-2.5">
                <Tv size={14} className="mt-0.5 flex-none text-muted" />
                <div className="text-[11px] leading-relaxed text-muted">
                  App tiles use a generated colour, not the app's real logo. No branding is bundled or fetched from the internet.
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(140deg, hsl(${hue} 48% 34%), hsl(${(hue + 42) % 360} 42% 22%))`;
}
