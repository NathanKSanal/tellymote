import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { useApp } from '../lib/store';
import { InlineNote, Spinner } from './ui';

export function PairingModal() {
  const { state, actions } = useApp();
  const prompt = state.prompt;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCode('');
    setError(null);
    setBusy(false);
    if (prompt?.kind === 'atv') {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 120);
      return () => window.clearTimeout(timer);
    }
  }, [prompt?.deviceId, prompt?.kind]);

  const submit = async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await actions.submitPairingCode(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The TV rejected the code.');
      setBusy(false);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const close = () => {
    void actions.cancelPairing();
  };

  return (
    <AnimatePresence>
      {prompt && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="presentation"
        >
          <motion.div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pair-title"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="flex items-start gap-3.5">
              <div className="grid h-10 w-10 flex-none place-items-center rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent">
                {prompt.kind === 'atv' ? <KeyRound size={18} /> : <Smartphone size={18} />}
              </div>
              <div className="min-w-0">
                <div className="eyebrow mb-1">{prompt.kind === 'atv' ? 'Secure pairing' : 'Debugging authorisation'}</div>
                <h3 id="pair-title" className="display truncate text-[19px] font-semibold text-ink">
                  {prompt.deviceName}
                </h3>
              </div>
            </div>

            {prompt.kind === 'atv' ? (
              <>
                <p className="mt-5 text-[12.5px] leading-relaxed text-muted">
                  A 6-character code is showing on the TV. Enter it exactly as displayed — digits and letters A–F.
                </p>
                <input
                  ref={inputRef}
                  className="code-input mt-4"
                  value={code}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={6}
                  placeholder="······"
                  aria-label="Pairing code shown on the TV"
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.value
                      .toUpperCase()
                      .replace(/[^0-9A-F]/g, '')
                      .slice(0, 6);
                    setCode(next);
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submit();
                  }}
                />
                {error && (
                  <div className="mt-3">
                    <InlineNote tone="error">{error}</InlineNote>
                  </div>
                )}
                <div className="mt-4 flex items-center gap-2 text-[11px] text-faint">
                  <ShieldCheck size={12} className="text-ok/70" />
                  The code is used once and never stored. The pairing certificate stays on this laptop.
                </div>
                <div className="mt-6 flex items-center justify-between">
                  <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary min-w-[130px]" onClick={() => void submit()} disabled={code.length !== 6 || busy}>
                    {busy ? <Spinner /> : <KeyRound size={14} />}
                    {busy ? 'Confirming…' : 'Pair with TV'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-5 text-[12.5px] leading-relaxed text-muted">{prompt.instructions}</p>
                {prompt.fingerprint && (
                  <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
                    <div className="eyebrow mb-1.5">Key fingerprint shown on the TV</div>
                    <div className="mono break-all text-[10.5px] leading-relaxed text-accent/90">
                      {prompt.fingerprint.replace(/(.{8})/g, '$1 ').trim()}
                    </div>
                  </div>
                )}
                <div className="mt-4 flex items-center gap-2 text-[11.5px] text-muted">
                  <Spinner className="text-accent" />
                  Waiting for you to allow debugging on the TV…
                </div>
                <div className="mt-6 flex justify-end">
                  <button type="button" className="btn" onClick={close}>
                    Stop waiting
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
