"""Voice-over for the 30s 3D film — one short line per 5-second scene.

Run from the repo root:  py video/scripts/make_3d_vo.py
Writes docs/media/audio3d/chN.mp3 + manifest.json (measured durations).
"""

import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "media" / "audio3d"

VOICE = "en-US-AndrewNeural"
RATE = "+4%"
PITCH = "-2Hz"

LINES = [
    ("This is TellyMote. Your TV, on your desktop.", 0.6),
    ("A remote, and a live screen, on your own network.", 5.6),
    ("No account, no cloud relay, no telemetry.", 10.6),
    ("Android TV Remote version two, ADB, and Roku ECP.", 15.6),
    ("A hundred and sixty-six tests. Three protocols. Zero accounts.", 20.6),
    ("Free at github dot com slash Nathan K Sanal slash tellymote.", 25.4),
]


def duration(path: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(out.stdout.strip())


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for index, (text, at) in enumerate(LINES, start=1):
        file = OUT / f"ch{index}.mp3"
        communicate = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
        await communicate.save(str(file))
        seconds = duration(file)
        manifest.append(
            {
                "file": f"ch{index}.mp3",
                "text": text,
                "start": at,
                "seconds": round(seconds, 3),
                "end": round(at + seconds, 3),
            }
        )
        print(f"ch{index}: {seconds:4.2f}s  at {at:5.2f}s  -> {at + seconds:5.2f}s  {file.stat().st_size / 1024:3.0f} KB")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    over = [m["file"] for m in manifest if m["end"] > 30.0]
    print("over 30s:", over if over else "none")


if __name__ == "__main__":
    asyncio.run(main())
