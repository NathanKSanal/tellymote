import type { LogEntry } from '../../shared/types';

const MAX_ENTRIES = 600;

const SECRET_KEY_PATTERN = /(key|token|secret|password|passphrase|pairingcode|cert)/i;
const PRIVATE_IP = /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g;

export class AppLog {
  private entries: LogEntry[] = [];
  private listeners = new Set<(entry: LogEntry) => void>();

  log(level: LogEntry['level'], scope: string, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = { at: Date.now(), level, scope, message, data };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    for (const listener of this.listeners) listener(entry);
  }

  debug(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log('debug', scope, message, data);
  }

  info(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log('info', scope, message, data);
  }

  warn(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log('warn', scope, message, data);
  }

  error(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log('error', scope, message, data);
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(limit = 200): LogEntry[] {
    return this.entries.slice(-limit).map((entry) => structuredClone(entry));
  }

  /** Redacts secrets and, unless requested, private addresses before export. */
  redact(includeIps: boolean, entries = this.entries): LogEntry[] {
    return entries.map((entry) => ({
      ...entry,
      data: redactObject(entry.data, includeIps),
      message: redactText(entry.message, includeIps),
    }));
  }
}

function redactText(text: string, includeIps: boolean): string {
  let out = text;
  if (!includeIps) out = out.replace(PRIVATE_IP, '«ip»');
  return out.replace(/(pairing code|code)\s*[:=]?\s*[0-9a-f]{6}/gi, '$1 «redacted»');
}

function redactObject(data: Record<string, unknown> | undefined, includeIps: boolean): Record<string, unknown> | undefined {
  if (!data) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '«redacted»';
      continue;
    }
    if (typeof value === 'string') out[key] = redactText(value, includeIps);
    else if (value && typeof value === 'object') out[key] = redactObject(value as Record<string, unknown>, includeIps);
    else out[key] = value;
  }
  return out;
}
