import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useApp } from '../lib/store';
import { cx } from '../lib/format';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
};

const TONES = {
  info: 'text-muted',
  success: 'text-ok',
  warn: 'text-warn',
  error: 'text-bad',
};

export function Toasts() {
  const { state, actions } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[336px] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {state.toasts.map((toast) => {
          const Icon = ICONS[toast.kind];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 460, damping: 34 }}
              className="toast pointer-events-auto"
            >
              <Icon size={16} className={cx('mt-0.5 flex-none', TONES[toast.kind])} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink">{toast.title}</div>
                {toast.message && <div className="mt-0.5 break-words text-[11.5px] leading-relaxed text-muted">{toast.message}</div>}
              </div>
              <button
                type="button"
                className="icon-btn -mr-1 -mt-1 h-6 w-6 flex-none"
                onClick={() => actions.dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <X size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
