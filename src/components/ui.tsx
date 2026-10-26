import { Fragment, useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import type { Capability, CapabilityState } from '@shared/types';
import { capabilityLabel, capabilityTone, cx } from '../lib/format';

export function Panel({
  children,
  className,
  quiet,
}: {
  children: ReactNode;
  className?: string;
  quiet?: boolean;
}) {
  return <div className={cx(quiet ? 'panel-quiet' : 'panel', className)}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="eyebrow mb-2 flex items-center gap-2">
          <span className="h-[3px] w-[14px] rounded-full bg-[var(--accent)]" style={{ boxShadow: '0 0 8px 0 var(--accent-glow)' }} aria-hidden />
          {eyebrow}
        </div>
        <h1 className="display text-[27px] font-semibold leading-[1.05] text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-[72ch] text-[12.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start justify-between gap-6', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h2 className="display text-[16px] font-semibold leading-tight text-ink">{title}</h2>
        {description && <p className="mt-1 max-w-[66ch] text-[11.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'ok' | 'warn' | 'bad' | 'accent';
  mono?: boolean;
}) {
  const color =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-accent' : 'text-ink';
  return (
    <div className="min-w-0 px-4 py-3.5 first:pl-0 last:pr-0">
      <div className="eyebrow truncate">{label}</div>
      <div className={cx('stat-value mt-1.5 truncate', mono && 'mono', color)}>{value}</div>
      {sub && <div className="mt-1.5 truncate text-[10.5px] text-faint">{sub}</div>}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 divide-x divide-[var(--line)] sm:grid-cols-4">{children}</div>;
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      data-on={checked}
      onClick={() => onChange(!checked)}
    />
  );
}

export function CapabilityChip({ capability, label }: { capability?: Capability; label?: string }) {
  const state: CapabilityState = capability?.state ?? 'unknown';
  return (
    <span className={cx('chip', capabilityTone(state))} title={capability?.detail ?? capabilityLabel(state)}>
      {label && <span className="text-[10px] font-medium opacity-70">{label}</span>}
      {capabilityLabel(state)}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={14} className={cx('animate-spin', className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  compact,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'py-10' : 'py-20')}>
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-muted">
        {icon}
      </div>
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      <div className="mt-1 max-w-[48ch] text-[11.5px] leading-relaxed text-muted">{body}</div>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function InlineNote({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'ok';
  title?: string;
  children: ReactNode;
}) {
  const palette = {
    info: 'border-[var(--line)] bg-[var(--surface-2)] text-muted',
    warn: 'border-warn/25 bg-warn/[0.06] text-[#e8cf9a]',
    error: 'border-bad/25 bg-bad/[0.06] text-[#ffc0c0]',
    ok: 'border-ok/25 bg-ok/[0.06] text-[#a9e9cd]',
  }[tone];
  const Icon = tone === 'error' || tone === 'warn' ? AlertTriangle : tone === 'ok' ? Check : AlertTriangle;
  return (
    <div className={cx('flex gap-3 rounded-lg border px-3.5 py-3 text-[12px] leading-relaxed', palette)}>
      <Icon size={14} className="mt-0.5 flex-none" aria-hidden />
      <div>
        {title && <div className="mb-0.5 font-semibold text-ink/90">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Keyed on `open` alone: onClose is usually an inline arrow, and re-arming on
  // every parent render would yank focus back out of the dialog.
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      [...(ref.current?.querySelectorAll<HTMLElement>('input, button, textarea, select, [tabindex="0"]') ?? [])].filter(
        (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
      );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !ref.current) return;
      // aria-modal promises the page behind is inert, so Tab must stay inside.
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && ref.current.contains(active);
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const timer = window.setTimeout(() => focusables()[0]?.focus(), 40);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(timer);
      restoreTo?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ maxWidth: width }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id={titleId} className="display text-[19px] font-semibold text-ink">
              {title}
            </h3>
            {description && <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{description}</p>}
          </div>
          <button type="button" className="icon-btn -mr-1 -mt-1" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        {children && <div className="mt-5">{children}</div>}
        {footer && <div className="mt-6 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={cx('btn', tone === 'danger' ? 'btn-danger' : 'btn-primary')}
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[13px] leading-relaxed text-muted">{message}</div>
    </Dialog>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-[11.5px] text-faint">{label}</span>
      <span className="mono truncate text-right text-[11.5px] text-ink/90">{value}</span>
    </div>
  );
}

export function Divider() {
  return <div className="hairline my-4" />;
}

/**
 * Horizontal transport chain: Remote → Screen → Output. Each node is live
 * state, and the connector animates only when that stage is actually active.
 */
export function SignalChain({
  nodes,
  active = false,
  className,
}: {
  nodes: Array<{ label: string; value: string; tone?: 'ok' | 'warn' | 'bad' | 'idle' }>;
  active?: boolean;
  className?: string;
}) {
  const tone = (value: 'ok' | 'warn' | 'bad' | 'idle' | undefined) =>
    value === 'ok' ? 'text-ok' : value === 'warn' ? 'text-warn' : value === 'bad' ? 'text-bad' : 'text-faint';
  return (
    <div className={cx('flex items-stretch', className)}>
      {nodes.map((node, index) => (
        <Fragment key={node.label}>
          <div className="min-w-0 flex-1 rounded-lg border border-[var(--line-soft)] bg-[linear-gradient(180deg,#1a1e28_0%,#141821_100%)] px-3 py-2.5 shadow-[0_1px_0_var(--edge-top)_inset]">
            <div className="eyebrow text-[9.5px]">{node.label}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={cx('dot flex-none', active && node.tone !== 'idle' ? 'dot-live' : '', tone(node.tone))} aria-hidden />
              <span className="mono truncate text-[10.5px] text-ink/90">{node.value}</span>
            </div>
          </div>
          {index < nodes.length - 1 && (
            <div className="relative my-auto h-px w-4 flex-none bg-[var(--line)]" aria-hidden>
              {active && <span className="signal-dot" />}
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** Monochrome line diagram of the laptop ↔ TV link. No gradients, no chrome. */
export function ConnectionDiagram({ active = false, className }: { active?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 280 130" className={cx('text-faint', className)} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <rect x="14" y="34" width="82" height="50" rx="5" />
        <path d="M34 94h42" />
        <rect x="184" y="22" width="82" height="62" rx="5" />
        <path d="M196 84h58" />
        <path d="M14 84h82" strokeDasharray="1 3" />
      </g>
      <path d="M96 59h88" stroke="var(--line)" strokeWidth="1" strokeDasharray="3 5" />
      <circle cx="140" cy="59" r="3.5" fill="var(--accent)" />
      {active && <circle className="diagram-pulse" cx="140" cy="59" r="3.5" fill="none" stroke="var(--accent)" />}
      <text x="55" y="112" textAnchor="middle" fill="currentColor" fontSize="9" letterSpacing="1.2">
        THIS PC
      </text>
      <text x="225" y="112" textAnchor="middle" fill="currentColor" fontSize="9" letterSpacing="1.2">
        TV
      </text>
    </svg>
  );
}

/**
 * Instrument sparkline. Draws the real series it is given; no smoothing or
 * invented data. Used for throughput once a second.
 */
export function Sparkline({
  values,
  className,
  tone = 'accent',
}: {
  values: number[];
  className?: string;
  tone?: 'accent' | 'ok' | 'warn';
}) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-accent';
  const id = useId();
  const points = values.length > 1 ? values : [0, values[0] ?? 0];
  const max = Math.max(1, ...points);
  const min = Math.min(...points);
  const range = Math.max(1, max - min);
  const step = 100 / Math.max(1, points.length - 1);
  const line = points
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(2)},${(100 - ((value - min) / range) * 100).toFixed(2)}`)
    .join(' ');
  const area = `${line} L100,100 L0,100 Z`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cx('spark-glow block', color, className)} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id}-fill)`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
