/** Minimal DNS packet codec for mDNS queries and replies (RFC 1035 + compression). */

export interface DnsQuestion {
  name: string;
  type: number;
  cls: number;
}

export interface DnsRecord {
  name: string;
  type: number;
  cls: number;
  ttl: number;
  data: Buffer;
  /** Decoded convenience fields. */
  ptr?: string;
  srv?: { priority: number; weight: number; port: number; target: string };
  txt?: Record<string, string>;
  a?: string;
  aaaa?: string;
}

export const DNS_TYPE = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33, ANY: 255 } as const;
export const DNS_CLASS_IN = 1;

export function encodeName(name: string): Buffer {
  const parts = name.replace(/\.$/, '').split('.').filter(Boolean);
  const buffers: Buffer[] = [];
  for (const part of parts) {
    const label = Buffer.from(part, 'utf8');
    if (label.length > 63) throw new Error(`DNS label too long: ${part}`);
    buffers.push(Buffer.from([label.length]), label);
  }
  buffers.push(Buffer.from([0]));
  return Buffer.concat(buffers);
}

export function encodeQuery(questions: DnsQuestion[], id = 0): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0000, 2); // standard query
  header.writeUInt16BE(questions.length, 4);
  const parts: Buffer[] = [header];
  for (const q of questions) {
    parts.push(encodeName(q.name));
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(q.type, 0);
    tail.writeUInt16BE(q.cls, 2);
    parts.push(tail);
  }
  return Buffer.concat(parts);
}

function readName(buf: Buffer, offset: number, depth = 0): { name: string; offset: number } {
  if (depth > 8) throw new Error('DNS compression loop');
  const labels: string[] = [];
  let pos = offset;
  let next = offset;
  let jumped = false;
  while (pos < buf.length) {
    const len = buf[pos];
    if (len === 0) {
      pos += 1;
      if (!jumped) next = pos;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new Error('Truncated DNS pointer');
      const pointer = ((len & 0x3f) << 8) | buf[pos + 1];
      if (!jumped) next = pos + 2;
      const resolved = readName(buf, pointer, depth + 1);
      labels.push(resolved.name);
      jumped = true;
      pos = next;
      break;
    }
    pos += 1;
    if (pos + len > buf.length) throw new Error('Truncated DNS label');
    labels.push(buf.subarray(pos, pos + len).toString('utf8'));
    pos += len;
  }
  return { name: labels.filter(Boolean).join('.'), offset: jumped ? next : pos };
}

function parseTxt(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < buf.length) {
    const len = buf[pos++];
    if (pos + len > buf.length) break;
    const entry = buf.subarray(pos, pos + len).toString('utf8');
    pos += len;
    const eq = entry.indexOf('=');
    if (eq > 0) out[entry.slice(0, eq)] = entry.slice(eq + 1);
    else out[entry] = '';
  }
  return out;
}

export interface ParsedDns {
  id: number;
  authoritative: boolean;
  questions: DnsQuestion[];
  answers: DnsRecord[];
  additionals: DnsRecord[];
}

export function parseDns(buf: Buffer): ParsedDns {
  if (buf.length < 12) throw new Error('Short DNS packet');
  const id = buf.readUInt16BE(0);
  const flags = buf.readUInt16BE(2);
  const qd = buf.readUInt16BE(4);
  const an = buf.readUInt16BE(6);
  const ns = buf.readUInt16BE(8);
  const ar = buf.readUInt16BE(10);
  let offset = 12;
  const questions: DnsQuestion[] = [];
  for (let i = 0; i < qd; i++) {
    const { name, offset: next } = readName(buf, offset);
    if (next + 4 > buf.length) throw new Error('Truncated DNS question');
    questions.push({ name, type: buf.readUInt16BE(next), cls: buf.readUInt16BE(next + 2) });
    offset = next + 4;
  }
  const readRecords = (count: number): DnsRecord[] => {
    const records: DnsRecord[] = [];
    for (let i = 0; i < count; i++) {
      const { name, offset: next } = readName(buf, offset);
      if (next + 10 > buf.length) break;
      const type = buf.readUInt16BE(next);
      const cls = buf.readUInt16BE(next + 2) & 0x7fff;
      const ttl = buf.readUInt32BE(next + 4);
      const rdLength = buf.readUInt16BE(next + 8);
      const start = next + 10;
      if (start + rdLength > buf.length) break;
      const data = buf.subarray(start, start + rdLength);
      const record: DnsRecord = { name, type, cls, ttl, data };
      if (type === DNS_TYPE.PTR) record.ptr = readName(buf, start).name;
      else if (type === DNS_TYPE.SRV && data.length >= 6) {
        record.srv = {
          priority: data.readUInt16BE(0),
          weight: data.readUInt16BE(2),
          port: data.readUInt16BE(4),
          target: readName(buf, start + 6).name,
        };
      } else if (type === DNS_TYPE.TXT) record.txt = parseTxt(data);
      else if (type === DNS_TYPE.A && data.length === 4) record.a = [...data].join('.');
      else if (type === DNS_TYPE.AAAA && data.length === 16) {
        const groups: string[] = [];
        for (let g = 0; g < 16; g += 2) groups.push(data.readUInt16BE(g).toString(16));
        record.aaaa = groups.join(':');
      }
      records.push(record);
      offset = start + rdLength;
    }
    return records;
  };
  const answers = readRecords(an);
  const authorities = readRecords(ns);
  void authorities;
  const additionals = readRecords(ar);
  return { id, authoritative: (flags & 0x0400) !== 0, questions, answers, additionals };
}
