/**
 * Annex-B H.264 helpers used by the live-screen feed.
 *
 * Kept free of React and DOM types so the parsing rules can be unit-tested in
 * Node and reused by any decoder path.
 */

/** Returns the nal_unit_type of every Annex-B NAL in the buffer. */
export function nalTypes(bytes: Uint8Array): number[] {
  const types: number[] = [];
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      types.push(bytes[i + 3] & 0x1f);
      i += 2;
    }
  }
  return types;
}

/**
 * Copies the payload of the first NAL of `type` (without its start code).
 * Returns null when no such NAL exists in the buffered chunks.
 */
export function firstNal(chunks: Uint8Array[], type: number): Uint8Array | null {
  const merged = concatChunks(chunks);
  for (let i = 0; i < merged.length - 3; i++) {
    if (merged[i] === 0 && merged[i + 1] === 0 && merged[i + 2] === 1) {
      let end = merged.length;
      for (let j = i + 3; j < merged.length - 3; j++) {
        if (merged[j] === 0 && merged[j + 1] === 0 && merged[j + 2] === 1) {
          // A four-byte start code (00 00 00 01) is detected on its second
          // zero; the extra zero belongs to the delimiter, not the NAL.
          end = j > i + 3 && merged[j - 1] === 0 ? j - 1 : j;
          break;
        }
      }
      if ((merged[i + 3] & 0x1f) === type) return merged.slice(i + 3, end);
    }
  }
  return null;
}

export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Builds an Annex-B buffer from NAL payloads (start-code prefixed). */
export function annexB(...nals: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const nal of nals) parts.push(new Uint8Array([0, 0, 0, 1]), nal);
  return concatChunks(parts);
}

/** Creates a synthetic NAL with the given nal_unit_type and payload length. */
export function makeNal(type: number, length = 8): Uint8Array {
  const out = new Uint8Array(Math.max(1, length));
  out[0] = type & 0x1f;
  for (let i = 1; i < out.length; i++) out[i] = (i * 7 + type) & 0xff;
  return out;
}
