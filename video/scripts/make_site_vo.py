"""Narration for the scroll site. One short clip per chapter.

Run from the repo root:  py video/scripts/make_site_vo.py
Writes docs/site/audio/chN.mp3 plus manifest.json with measured durations.
"""

import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "site" / "audio"

VOICE = "en-US-AndrewNeural"
RATE = "+3%"
PITCH = "-2Hz"

CHAPTERS = [
    (
        "hero",
        "This is TellyMote. A remote, and a live screen, for the TV across the room. It runs on your own network, and nowhere else.",
    ),
    (
        "remote",
        "Your keyboard becomes the remote. Arrow keys move. Enter selects. Page up and down for volume. No phone, no app store.",
    ),
    (
        "screen",
        "The TV screen opens on your laptop. Capture needs debugging switched on at the TV end. DRM apps stay black, and that is the DRM, not a bug.",
    ),
    (
        "protocols",
        "No vendor app, and no platform tools. TellyMote speaks Android TV Remote version two, the ADB host protocol, and Roku ECP directly.",
    ),
    (
        "numbers",
        "A hundred and sixty six automated tests. Three protocols. Zero accounts, zero relays, zero telemetry.",
    ),
    (
        "compare",
        "If all you want is mirroring, scrcpy does it better. TellyMote is for driving the TV from your desk, without turning on developer mode first.",
    ),
    (
        "download",
        "Free on Windows, macOS and Linux. github dot com, slash Nathan K Sanal, slash tellymote.",
    ),
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
    for index, (chapter, text) in enumerate(CHAPTERS, start=1):
        file = OUT / f"ch{index}.mp3"
        communicate = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
        await communicate.save(str(file))
        seconds = duration(file)
        manifest.append(
            {
                "chapter": chapter,
                "file": f"ch{index}.mp3",
                "text": text,
                "seconds": round(seconds, 3),
            }
        )
        print(f"{chapter:10} {seconds:5.2f}s  {file.stat().st_size / 1024:4.0f} KB")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    total = sum(item["seconds"] for item in manifest)
    print(f"total narration: {total:.1f}s")


if __name__ == "__main__":
    asyncio.run(main())
