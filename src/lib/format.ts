import clsx, { type ClassValue } from 'clsx';
import type { CapabilityState, ConnectionPhase } from '@shared/types';

export const cx = (...values: ClassValue[]) => clsx(values);

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 1) return '<1 ms';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatBitrate(kbps: number): string {
  if (!kbps) return '—';
  if (kbps < 1000) return `${kbps} kbps`;
  return `${(kbps / 1000).toFixed(1)} Mbps`;
}

export function formatClock(at: number): string {
  if (!at) return '—';
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatRelative(at: number): string {
  if (!at) return 'never';
  const delta = Date.now() - at;
  if (delta < 5_000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return new Date(at).toLocaleDateString();
}

export function phaseLabel(phase: ConnectionPhase): string {
  switch (phase) {
    case 'idle':
      return 'Not connected';
    case 'discovering':
      return 'Scanning';
    case 'pairing':
      return 'Pairing';
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'degraded':
      return 'Degraded';
    case 'reconnecting':
      return 'Reconnecting';
    case 'disconnected':
      return 'Disconnected';
    case 'error':
      return 'Connection problem';
    default:
      return phase;
  }
}

export function phaseTone(phase: ConnectionPhase): 'ok' | 'warn' | 'bad' | 'idle' {
  switch (phase) {
    case 'connected':
      return 'ok';
    case 'degraded':
    case 'connecting':
    case 'pairing':
    case 'reconnecting':
      return 'warn';
    case 'error':
      return 'bad';
    default:
      return 'idle';
  }
}

export function capabilityLabel(state: CapabilityState): string {
  switch (state) {
    case 'verified':
      return 'Verified';
    case 'supported':
      return 'Supported';
    case 'conditional':
      return 'Conditional';
    case 'unsupported':
      return 'Unsupported';
    default:
      return 'Unknown';
  }
}

export function capabilityTone(state: CapabilityState): string {
  switch (state) {
    case 'verified':
      return 'chip-ok';
    case 'supported':
      return 'chip-accent';
    case 'conditional':
      return 'chip-warn';
    case 'unsupported':
      return 'chip-bad';
    default:
      return '';
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function shortHost(host: string): string {
  return host.replace(/^::ffff:/, '');
}

export function initials(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function remoteTransportLabel(transport: 'atv-v2' | 'roku' | 'adb' | 'none'): string {
  return transport === 'atv-v2' ? 'ATV v2' : transport === 'roku' ? 'Roku ECP' : transport === 'adb' ? 'ADB' : 'none';
}

/** Compact elapsed time for the session readout: 4m 12s, 1h 04m. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}
