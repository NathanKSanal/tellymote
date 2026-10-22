#!/usr/bin/env node
/**
 * Generates build/icon.png without any image dependency.
 *
 * The mark is a rounded charcoal tile with a warm amber "screen" outline and a
 * play glyph — the same amber accent the app uses by default. Everything is
 * rasterised with a 3x supersample so the installer, window and tray icons stay
 * crisp when downscaled by Windows.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const SS = 3;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function inTriangle(px, py, a, b, c) {
  const sign = (p1, p2, p3) =>
    (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function roundedTileMask(x, y) {
  // 24 px margin keeps the painted tile off the canvas edge.
  return sdRoundRect(x, y, SIZE / 2, SIZE / 2, SIZE / 2 - 24, SIZE / 2 - 24, 210) <= 0;
}

function amber(t) {
  // #f6b73c -> #ff8a00
  return [mix(246, 255, t), mix(183, 138, t), mix(60, 0, t)];
}

function sample(x, y) {
  if (!roundedTileMask(x, y)) return null;

  // Base tile: vertical charcoal gradient with a soft warm bloom top-left.
  const v = clamp01(y / SIZE);
  let r = mix(26, 10, v);
  let g = mix(30, 11, v);
  let b = mix(39, 15, v);

  const glow = clamp01(1 - Math.hypot(x - SIZE * 0.26, y - SIZE * 0.2) / (SIZE * 0.72));
  r += 46 * glow ** 3;
  g += 27 * glow ** 3;
  b += 4 * glow ** 3;

  // Hairline inner rim for a machined edge.
  const sdTile = sdRoundRect(x, y, SIZE / 2, SIZE / 2, SIZE / 2 - 24, SIZE / 2 - 24, 210);
  const rim = clamp01(1 - Math.abs(sdTile + 6) / 3);
  r = mix(r, 78, rim * 0.5);
  g = mix(g, 66, rim * 0.5);
  b = mix(b, 48, rim * 0.5);

  // Screen outline with a top-lit amber gradient.
  const sdScreen = sdRoundRect(x, y, 512, 474, 286, 214, 58);
  const screenStroke = Math.abs(sdScreen) <= 27;
  const stand = sdRoundRect(x, y, 512, 742, 26, 34, 10) <= 0;
  const foot = sdRoundRect(x, y, 512, 800, 132, 23, 12) <= 0;

  if (screenStroke || stand || foot) {
    const t = clamp01((x - 226) / 572);
    const [ar, ag, ab] = amber(t);
    const bright = 0.85 + 0.15 * clamp01(1 - y / SIZE);
    r = mix(r, ar * bright, 0.97);
    g = mix(g, ag * bright, 0.97);
    b = mix(b, ab * bright, 0.97);
  }

  // Play glyph, pushed slightly right so it reads as centred.
  if (inTriangle(x, y, [470, 386], [470, 562], [612, 474])) {
    const t = clamp01((y - 386) / 176);
    const [ar, ag, ab] = amber(t);
    r = mix(r, ar, 0.99);
    g = mix(g, ag, 0.99);
    b = mix(b, ab, 0.99);
  }

  return [clamp01(r / 255) * 255, clamp01(g / 255) * 255, clamp01(b / 255) * 255];
}

// --- rasterise -------------------------------------------------------------
const px = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const sampleX = x + (sx + 0.5) / SS;
        const sampleY = y + (sy + 0.5) / SS;
        const c = sample(sampleX, sampleY);
        if (c) {
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
    }
    const n = SS * SS;
    const i = (y * SIZE + x) * 4;
    if (a > 0) {
      const cover = a / (255 * n);
      px[i] = Math.round(r / (n * cover));
      px[i + 1] = Math.round(g / (n * cover));
      px[i + 2] = Math.round(b / (n * cover));
    }
    px[i + 3] = Math.round(a / n);
  }
}

// --- PNG encode ------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Wrote ${out} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} kB)`);
