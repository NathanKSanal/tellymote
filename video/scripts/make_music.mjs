/**
 * Generates a quiet ambient pad for the promo (no licensing, no external assets).
 * A slow four-chord loop in A minor, detuned sine voices, soft low-pass, stereo width.
 * Output: public/music/bed.wav  (48 kHz, 16-bit, stereo)
 */
import fs from "node:fs";
import path from "node:path";

const SR = 48000;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
// Length comes from src/timing.ts so the bed always matches the cut.
const timing = fs.readFileSync(path.join(root, "src", "timing.ts"), "utf8");
const fps = Number(timing.match(/export const FPS = (\d+)/)?.[1] ?? 30);
const totalFrames = Number(timing.match(/TOTAL_FRAMES = (\d+)/)?.[1] ?? 1440);
const totalSeconds = Number(process.argv[2] || totalFrames / fps) + 1;

const note = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Am9, Fmaj7, Cadd9, G6 — comfortable, unresolved, not sentimental.
const chords = [
  [45, 52, 60, 64, 71],
  [41, 48, 57, 60, 67],
  [48, 55, 64, 67, 74],
  [43, 50, 59, 62, 69],
];
const CHORD_SECONDS = 8;
const XFADE = 2.2;

const frames = Math.ceil(totalSeconds * SR);
const left = new Float32Array(frames);
const right = new Float32Array(frames);

// Pad: each chord starts every CHORD_SECONDS, overlapping the next by XFADE.
for (let c = 0; c < Math.ceil(totalSeconds / CHORD_SECONDS) + 1; c++) {
  const chord = chords[c % chords.length];
  const start = c * (CHORD_SECONDS - XFADE);
  const dur = CHORD_SECONDS + XFADE;
  for (const midi of chord) {
    const f = note(midi);
    const gain = 0.055 / Math.sqrt(chord.length);
    for (let i = 0; i < dur * SR; i++) {
      const t = i / SR;
      const idx = Math.round(start * SR) + i;
      if (idx < 0 || idx >= frames) continue;
      // Slow swell, then release.
      const env = Math.min(1, t / 2.4) * Math.min(1, (dur - t) / 2.0);
      if (env <= 0) continue;
      const lfo = 0.9 + 0.1 * Math.sin(2 * Math.PI * 0.07 * t + midi);
      const l = Math.sin(2 * Math.PI * f * 0.9995 * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t);
      const r = Math.sin(2 * Math.PI * f * 1.0006 * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.0008 * t);
      left[idx] += l * env * gain * lfo;
      right[idx] += r * env * gain * lfo;
    }
  }
}

// One-pole low-pass around 1.6 kHz, then a gentle high-pass to remove rumble.
const lp = (arr) => {
  const a = 1 - Math.exp((-2 * Math.PI * 1600) / SR);
  let y = 0;
  for (let i = 0; i < arr.length; i++) {
    y += a * (arr[i] - y);
    arr[i] = y;
  }
};
const hp = (arr) => {
  const a = 1 - Math.exp((-2 * Math.PI * 60) / SR);
  let y = 0;
  let prev = 0;
  for (let i = 0; i < arr.length; i++) {
    y += a * (arr[i] - y);
    arr[i] -= y;
    prev = arr[i];
  }
};
lp(left);
lp(right);
hp(left);
hp(right);
void 1;

// Master fades and peak normalisation to -12 dBFS (it sits under the voice later).
let peak = 0;
for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const peakGain = 0.25 / (peak || 1);
const fade = 2 * SR;
for (let i = 0; i < frames; i++) {
  const inGain = Math.min(1, i / fade);
  const outGain = Math.min(1, (frames - i) / fade);
  const g = peakGain * inGain * outGain;
  left[i] *= g;
  right[i] *= g;
}

// 16-bit PCM WAV
const data = Buffer.alloc(frames * 4);
for (let i = 0; i < frames; i++) {
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767))), i * 4);
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767))), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const out = path.join(root, "public", "music", "bed.wav");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, data]));
console.log(`wrote ${out} (${totalSeconds.toFixed(1)}s, peak +${(20 * Math.log10(0.25)).toFixed(1)} dBFS)`);
