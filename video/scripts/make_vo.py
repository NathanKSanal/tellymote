"""Generate the promo voice-over with edge-tts (free Microsoft neural voices).

Run from the video/ directory:  py scripts/make_vo.py
Writes public/vo/voN.mp3 and prints each duration.
"""

import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public" / "vo"


def duration(path: Path) -> float:
    result = subprocess.run(
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
    return float(result.stdout.strip())


async def main() -> None:
    spec = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    durs = {}
    for line in spec["lines"]:
        target = OUT / f"{line['id']}.mp3"
        communicate = edge_tts.Communicate(
            line["text"],
            spec["voice"],
            rate=spec.get("rate", "+0%"),
            pitch=spec.get("pitch", "+0Hz"),
        )
        await communicate.save(str(target))
        d = duration(target)
        durs[line["id"]] = round(d, 3)
        print(f"{line['id']}: {d:6.2f}s  {target.stat().st_size / 1024:.0f} KB")
    print(json.dumps(durs, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
