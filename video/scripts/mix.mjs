import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = path.resolve(here, "..");

const video = path.join(root, "out", "tellymote-promo-vo.mp4");
const music = path.join(root, "public", "music", "bed.wav");
const out = path.join(root, "out", "tellymote-promo-final.mp4");

for (const f of [video, music]) {
  if (!fs.existsSync(f)) throw new Error(`missing input: ${f}`);
}

// Music sits under the voice and ducks further whenever someone is speaking.
const filter = [
  "[0:a]asplit=2[voice][sc]",
  "[1:a]volume=0.42[music]",
  "[music][sc]sidechaincompress=threshold=0.045:ratio=8:attack=25:release=450[ducked]",
  "[voice][ducked]amix=inputs=2:normalize=0[mixed]",
  "[mixed]loudnorm=I=-16:TP=-1.5:LRA=11[out]",
].join(";");

execFileSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-i",
    video,
    "-i",
    music,
    "-filter_complex",
    filter,
    "-map",
    "0:v",
    "-map",
    "[out]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-shortest",
    "-movflags",
    "+faststart",
    out,
  ],
  { stdio: "inherit" },
);

const probe = execFileSync("ffprobe", [
  "-v",
  "error",
  "-show_entries",
  "format=duration,size",
  "-of",
  "default=noprint_wrappers=1",
  out,
]);
console.log(String(probe).trim());
console.log(`wrote ${out}`);
