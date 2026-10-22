import { describe, expect, it } from 'vitest';
import { annexB, concatChunks, firstNal, makeNal, nalTypes } from '../src/lib/annexb';

describe('Annex-B NAL scanning', () => {
  it('detects SPS, PPS and IDR types in an access unit', () => {
    const buffer = annexB(makeNal(7), makeNal(8), makeNal(5), makeNal(1));
    expect(nalTypes(buffer)).toEqual([7, 8, 5, 1]);
  });

  it('handles three-byte start codes', () => {
    const buffer = new Uint8Array([0, 0, 1, 0x67, 1, 2, 3, 0, 0, 1, 0x68, 9]);
    expect(nalTypes(buffer)).toEqual([7, 8]);
  });

  it('does not mistake emulation-prevention bytes for a start code', () => {
    const buffer = new Uint8Array([0, 0, 1, 0x65, 0, 0, 3, 1, 0, 0, 3, 0, 0, 1, 0x41, 0]);
    expect(nalTypes(buffer)).toEqual([5, 1]);
  });

  it('ignores a truncated start code at the end of a chunk', () => {
    expect(nalTypes(new Uint8Array([0, 0, 1]))).toEqual([]);
    expect(nalTypes(new Uint8Array([0, 0, 1, 0x65, 0, 0]))).toEqual([5]);
  });

  it('returns an empty list for empty input', () => {
    expect(nalTypes(new Uint8Array())).toEqual([]);
  });
});

describe('NAL extraction', () => {
  it('extracts the SPS payload without its start code', () => {
    const sps = makeNal(7, 12);
    const buffer = annexB(sps, makeNal(8), makeNal(5));
    expect(firstNal([buffer], 7)).toEqual(sps);
  });

  it('finds a NAL split across several chunks', () => {
    const sps = makeNal(7, 20);
    const pps = makeNal(8, 12);
    const buffer = annexB(sps, pps);
    const chunks = [buffer.subarray(0, 2), buffer.subarray(2, 5), buffer.subarray(5, 30), buffer.subarray(30)];
    expect(firstNal(chunks, 7)).toEqual(sps);
    expect(firstNal(chunks, 8)).toEqual(pps);
  });

  it('returns null when the requested NAL is absent', () => {
    const buffer = annexB(makeNal(1), makeNal(1));
    expect(firstNal([buffer], 7)).toBeNull();
    expect(firstNal([], 7)).toBeNull();
  });

  it('skips earlier NALs of other types', () => {
    const idr = makeNal(5, 6);
    const buffer = annexB(makeNal(9), makeNal(7), idr);
    expect(firstNal([buffer], 5)).toEqual(idr);
  });
});

describe('buffer helpers', () => {
  it('concatenates arbitrary Uint8Array chunks', () => {
    expect([...concatChunks([new Uint8Array([1, 2]), new Uint8Array([3])])]).toEqual([1, 2, 3]);
    expect(concatChunks([])).toEqual(new Uint8Array());
  });

  it('builds Annex-B buffers with four-byte start codes', () => {
    const out = annexB(new Uint8Array([0x67]), new Uint8Array([0x68]));
    expect([...out]).toEqual([0, 0, 0, 1, 0x67, 0, 0, 0, 1, 0x68]);
  });
});
