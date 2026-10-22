/** PNG inspection without decoding pixels. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngInfo {
  width: number;
  height: number;
  valid: boolean;
}

export function isPng(buf: Buffer): boolean {
  return buf.length > 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE) && buf.toString('ascii', 12, 16) === 'IHDR';
}

const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/** A truncated PNG can still carry a valid IHDR header; require IEND too. */
export function isCompletePng(buf: Buffer): boolean {
  return isPng(buf) && buf.length >= 20 && buf.subarray(buf.length - PNG_IEND.length).equals(PNG_IEND);
}

export function parsePngSize(buf: Buffer): PngInfo {
  if (!isPng(buf)) return { width: 0, height: 0, valid: false };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), valid: true };
}
