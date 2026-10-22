import { useEffect, useId, useRef, type ReactNode } from 'react';
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="eyebrow mb-1.5">{eyebrow}</div>
        <h1 className="display text-[22px] font-semibold leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-[72ch] text-[12px] leading-relaxed text-muted">{description}</p>}
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
        <h2 className="display text-[14.5px] font-semibold text-ink">{title}</h2>
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
    <div className="min-w-0 px-4 py-3 first:pl-0 last:pr-0">
      <div className="eyebrow truncate">{label}</div>
      <div className={cx('mt-1 truncate text-[17px] font-semibold leading-none', mono && 'mono', color)}>{value}</div>
      {sub && <div className="mt-1 truncate text-[10.5px] text-faint">{sub}</div>}
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

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const timer = window.setTimeout(() => {
      const focusable = ref.current?.querySelector<HTMLElement>('input, button, textarea, select, [tabindex="0"]');
      focusable?.focus();
    }, 40);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

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
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cx('block', color, className)} aria-hidden="true">
      <path d={area} fill="currentColor" opacity={0.08} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
