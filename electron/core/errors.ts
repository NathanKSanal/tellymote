import type { AppError, ErrorCode } from '../../shared/types';

const HINTS: Partial<Record<ErrorCode, string>> = {
  TV_NOT_FOUND: 'Make sure the TV is on and on the same Wi-Fi network, then rescan or enter its IP address.',
  UNREACHABLE: 'The TV stopped answering. Check that it is powered on and connected to the same network.',
  PAIRING_REQUIRED: 'Send a pairing request and confirm the code shown on the TV.',
  PAIRING_REJECTED: 'The code was rejected. Start pairing again and enter the new 6-character code.',
  PAIRING_TIMEOUT: 'The TV did not answer in time. Keep the pairing dialog open on the TV and retry.',
  CERT_REJECTED: 'The TV no longer trusts this laptop. Forget the device here and pair again.',
  REMOTE_UNAVAILABLE: 'This TV does not expose the Android TV remote service. Try enabling network remote in TV settings.',
  ADB_NOT_ENABLED: 'Enable Developer options → USB debugging (or Wireless debugging) on the TV.',
  ADB_UNAUTHORIZED: 'Accept the "Allow USB debugging" prompt on the TV, then retry.',
  ADB_NOT_INSTALLED: 'No ADB service is reachable on port 5555. Enable wireless debugging on the TV.',
  CAPTURE_UNSUPPORTED: 'Screen viewing needs ADB authorisation. Remote control still works without it.',
  CAPTURE_TIMEOUT: 'The TV is slow to capture. Lower the capture rate in Settings → Performance.',
  PROTECTED_CONTENT: 'This app is blocking screen capture (DRM). That restriction cannot be bypassed.',
  TV_OVERLOADED: 'The TV is struggling. LumaRemote will reduce capture quality automatically.',
  NETWORK_BLOCKED: 'The network may be using client isolation. Disable AP isolation or use the same VLAN.',
  NETWORK_LOST: 'Reconnect when the TV is back on the network.',
  INVALID_INPUT: 'Check the value and try again.',
  UNSUPPORTED_COMMAND: 'This control is not supported by the connected TV or the active transport.',
  INTERNAL: 'Check Diagnostics → Suggested next steps.',
};

export function appError(code: ErrorCode, message: string, detail?: string, hint?: string): AppError {
  return { code, message, detail, hint: hint ?? HINTS[code], at: Date.now() };
}

export function toAppError(err: unknown, fallback: ErrorCode = 'INTERNAL'): AppError {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err && 'at' in err) {
    return err as AppError;
  }
  const message = err instanceof Error ? err.message : String(err);
  return appError(fallback, message);
}

export function describeNodeError(err: unknown): { code: string; message: string } {
  if (err && typeof err === 'object') {
    const anyErr = err as { code?: string; message?: string; errno?: number };
    return { code: anyErr.code ?? 'UNKNOWN', message: anyErr.message ?? String(err) };
  }
  return { code: 'UNKNOWN', message: String(err) };
}

export function isTlsTrustFailure(err: unknown): boolean {
  const { code, message } = describeNodeError(err);
  return (
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED' ||
    code === 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE' ||
    /certificate|handshake|alert/i.test(message)
  );
}

export type { AppError };
