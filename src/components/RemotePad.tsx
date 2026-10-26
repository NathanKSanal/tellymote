import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Circle,
  CornerDownLeft,
  FastForward,
  Home,
  Info,
  Menu,
  Pause,
  Play,
  Power,
  Rewind,
  Settings,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { RemoteKey } from '@shared/types';
import { useApp, useDisplayDevice } from '../lib/store';
import { cx } from '../lib/format';
import { ConfirmDialog } from './ui';

interface KeyPressOptions {
  keyName: RemoteKey;
  disabled?: boolean;
  longPress?: boolean;
  guard?: () => boolean;
}

function useKeyPress({ keyName, disabled, longPress, guard }: KeyPressOptions) {
  const { actions } = useApp();
  const [pressed, setPressed] = useState(false);
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const longHeld = useRef(false);
  const lastKeyboardAt = useRef(0);
  const current = useRef({ actions, keyName, disabled, guard });
  current.current = { actions, keyName, disabled, guard };

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const send = (action: 'tap' | 'down' | 'up') => {
    void current.current.actions.key(current.current.keyName, action);
  };

  const trigger = (action: 'tap' | 'down') => {
    if (current.current.disabled) return;
    const { guard: allow } = current.current;
    if (allow && !allow()) return;
    send(action);
  };

  /**
   * Ends a hold. The release is sent even when the pad has been disabled in the
   * meantime: a missing 'up' leaves the TV repeating the key forever.
   */
  const release = () => {
    clear();
    held.current = false;
    setPressed(false);
    if (!longHeld.current) return;
    longHeld.current = false;
    send('up');
  };
  const releaseRef = useRef(release);
  releaseRef.current = release;

  useEffect(() => () => releaseRef.current(), []);

  // Alt-tabbing or minimising mid-hold never delivers a pointerup/keyup.
  useEffect(() => {
    if (!pressed) return;
    window.addEventListener('blur', releaseRef.current);
    return () => window.removeEventListener('blur', releaseRef.current);
  }, [pressed]);

  const beginHold = () => {
    if (current.current.disabled || held.current) return;
    held.current = true;
    longHeld.current = false;
    setPressed(true);
    if (!longPress) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      longHeld.current = true;
      trigger('down');
    }, 420);
  };

  const finish = () => {
    if (!held.current) return;
    const wasLong = longHeld.current;
    clear();
    held.current = false;
    longHeld.current = false;
    setPressed(false);
    if (wasLong) send('up');
    else trigger('tap');
  };

  const isActivationKey = (key: string) => key === 'Enter' || key === ' ' || key === 'Spacebar';

  return {
    pressed,
    handlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        beginHold();
      },
      onPointerUp: () => finish(),
      onPointerCancel: () => release(),
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        if (event.detail !== 0) return;
        // A keyboard activation already fired on keyup; suppress the click the
        // browser synthesises for it. detail 0 also covers assistive tech.
        if (Date.now() - lastKeyboardAt.current < 700) return;
        trigger('tap');
      },
      onContextMenu: (event: MouseEvent) => event.preventDefault(),
      onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (!isActivationKey(event.key)) return;
        event.preventDefault();
        if (event.repeat) return;
        lastKeyboardAt.current = Date.now();
        beginHold();
      },
      onKeyUp: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (!isActivationKey(event.key)) return;
        event.preventDefault();
        lastKeyboardAt.current = Date.now();
        finish();
      },
    },
  };
}

interface KeyProps {
  keyName: RemoteKey;
  label: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  longPress?: boolean;
  tone?: 'default' | 'danger' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  guard?: () => boolean;
}

export function RemoteKeyButton({
  keyName,
  label,
  children,
  className,
  disabled,
  longPress = false,
  tone = 'default',
  size = 'md',
  title,
  guard,
}: KeyProps) {
  const { pressed, handlers } = useKeyPress({ keyName, disabled, longPress, guard });
  const height = size === 'lg' ? 'h-[52px]' : size === 'sm' ? 'h-9' : 'h-11';
  const toneClass = tone === 'danger' ? 'text-[#ff9a9a]' : tone === 'accent' ? 'text-accent' : '';

  return (
    <button
      type="button"
      className={cx('remote-key select-none', height, toneClass, className)}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      data-pressed={pressed}
      {...handlers}
    >
      {children}
    </button>
  );
}

function DpadCenter({ disabled }: { disabled: boolean }) {
  const { pressed, handlers } = useKeyPress({ keyName: 'select', disabled, longPress: true });
  return (
    <button type="button" className="dpad-ok" aria-label="Select" disabled={disabled} data-pressed={pressed} {...handlers}>
      OK
    </button>
  );
}

function Dpad() {
  const { state } = useApp();
  const disabled = state.connection.remoteTransport === 'none';
  return (
    <div className="dpad flex-none">
      <RemoteKeyButton keyName="up" label="Up" longPress disabled={disabled} className="dpad-btn left-1/2 top-2 h-14 w-16 -translate-x-1/2">
        <ArrowUp size={20} />
      </RemoteKeyButton>
      <RemoteKeyButton keyName="down" label="Down" longPress disabled={disabled} className="dpad-btn bottom-2 left-1/2 h-14 w-16 -translate-x-1/2">
        <ArrowDown size={20} />
      </RemoteKeyButton>
      <RemoteKeyButton keyName="left" label="Left" longPress disabled={disabled} className="dpad-btn left-2 top-1/2 h-16 w-14 -translate-y-1/2">
        <ArrowLeft size={20} />
      </RemoteKeyButton>
      <RemoteKeyButton keyName="right" label="Right" longPress disabled={disabled} className="dpad-btn right-2 top-1/2 h-16 w-14 -translate-y-1/2">
        <ArrowRight size={20} />
      </RemoteKeyButton>
      <DpadCenter disabled={disabled} />
    </div>
  );
}

export function RemotePad({ className }: { className?: string }) {
  const { state, actions } = useApp();
  const device = useDisplayDevice();
  const [confirmPower, setConfirmPower] = useState(false);
  const disabled = state.connection.remoteTransport === 'none';

  const powerGuard = () => {
    if (state.settings?.confirmPowerOff) {
      setConfirmPower(true);
      return false;
    }
    return true;
  };

  return (
    <>
      <div className={cx('remote mx-auto', className)} aria-label="Virtual remote control">
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-3">
          <div className="min-w-0">
            <div className="eyebrow">Remote</div>
            <div className="mt-0.5 truncate text-[11.5px] text-ink/90">{device?.name ?? 'No display'}</div>
          </div>
          <span className={cx('dot flex-none', disabled ? 'text-faint' : 'text-ok')} aria-hidden />
        </div>

        <div className="mb-4 flex items-center justify-between gap-2">
          <RemoteKeyButton
            keyName="power"
            label="Power"
            tone="danger"
            disabled={disabled}
            className="h-10 flex-1"
            guard={powerGuard}
            title="Power (confirmation can be disabled in Settings)"
          >
            <Power size={15} />
          </RemoteKeyButton>
          <RemoteKeyButton keyName="input" label="Input source" disabled={disabled} className="h-10 flex-1" title="Input source — may be ignored by some TV apps">
            <span className="text-[9px] font-bold tracking-[0.14em]">INPUT</span>
          </RemoteKeyButton>
          <RemoteKeyButton keyName="settings" label="Settings" disabled={disabled} className="h-10 flex-1" title="Settings — depends on the active TV app">
            <Settings size={15} />
          </RemoteKeyButton>
          <RemoteKeyButton keyName="info" label="Info" disabled={disabled} className="h-10 w-10 flex-none" title="Info — may be ignored">
            <Info size={15} />
          </RemoteKeyButton>
        </div>

        <div className="flex items-center justify-center gap-4">
          <Dpad />
          <div className="flex w-[52px] flex-none flex-col gap-2">
            <RemoteKeyButton keyName="volumeUp" label="Volume up" disabled={disabled} className="h-10">
              <Volume2 size={18} />
            </RemoteKeyButton>
            <RemoteKeyButton keyName="mute" label="Mute" disabled={disabled} className="h-10" tone="accent">
              <VolumeX size={17} />
            </RemoteKeyButton>
            <RemoteKeyButton keyName="volumeDown" label="Volume down" disabled={disabled} className="h-10">
              <Volume1 size={18} />
            </RemoteKeyButton>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <RemoteKeyButton keyName="back" label="Back" longPress disabled={disabled}>
            <CornerDownLeft size={17} />
          </RemoteKeyButton>
          <RemoteKeyButton keyName="home" label="Home" disabled={disabled}>
            <Home size={17} />
          </RemoteKeyButton>
          <RemoteKeyButton keyName="menu" label="Menu" disabled={disabled}>
            <Menu size={17} />
          </RemoteKeyButton>
        </div>

        <div className="mt-3 grid grid-cols-5 gap-1.5">
          <RemoteKeyButton keyName="previous" label="Previous" disabled={disabled} size="sm">
            <SkipBack size={15} />
          </RemoteKeyButton>
          <RemoteKeyButton keyName="rewind" label="Rewind" disabled={disabled} size="sm">
            <Rewind size={15} />
          </RemoteKeyButton>
          <RemoteKeyButton keyName="playPause" label="Play or pause" disabled={disabled} size="sm">
            <Play size={15} />
            <Pause size={15} className="-ml-1" />
          </RemoteKeyButton>
          <RemoteKeyButton keyName="fastForward" label="Fast forward" disabled={disabled} size="sm">
            <FastForward size={15} />
          </RemoteKeyButton>
          <RemoteKeyButton keyName="next" label="Next" disabled={disabled} size="sm">
            <SkipForward size={15} />
          </RemoteKeyButton>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <RemoteKeyButton keyName="channelDown" label="Channel down" disabled={disabled} size="sm" title="Channel keys depend on the active TV app">
            <ChevronDown size={15} />
            <span className="ml-1 text-[10px] font-semibold">CH</span>
          </RemoteKeyButton>
          <RemoteKeyButton keyName="channelUp" label="Channel up" disabled={disabled} size="sm" title="Channel keys depend on the active TV app">
            <ChevronUp size={15} />
            <span className="ml-1 text-[10px] font-semibold">CH</span>
          </RemoteKeyButton>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-faint">
          <Circle size={6} className="fill-current" />
          {state.connection.phase === 'connected' ? 'Remote service connected' : 'Connect a TV to enable the remote'}
        </div>
      </div>

      <ConfirmDialog
        open={confirmPower}
        title="Send the power key?"
        message="Power toggles the TV on supported hardware. If the TV ignores it, use the original remote or the TV's power button."
        confirmLabel="Send power"
        onConfirm={() => void actions.key('power', 'tap')}
        onCancel={() => setConfirmPower(false)}
      />
    </>
  );
}
