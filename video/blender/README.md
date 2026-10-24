# TellyMote 3D film (Blender)

30-second motion graphics built as **real 3D geometry**, not AI-generated footage. The app screenshots
are used as textured panels, which is why the UI in the film is the actual UI.

## Why Workbench

This machine renders on an **Intel Iris Xe** — no CUDA, no OptiX. Measured on this scene at 1920×1080,
AA 32:

| Engine | Measured | 720 frames |
| --- | --- | --- |
| **Workbench (used)** | ~1.5 s/frame | ~18 min |
| EEVEE | ~70 s/frame | ~14 h |
| Cycles CPU | ~107 s/frame | ~21 h |

So the film is Workbench with AA 32, studio lighting, cavity, shadows, DOF and AgX. It looks like
motion graphics, not a photograph, and that is the honest trade.

## Render

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P video/blender/tellymote_mg.py
ffmpeg -y -framerate 24 -i "$HOME\Videos\opencode-gen\tellymote-mg\f_%04d.png" `
  -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart out\tellymote-mg-30s.mp4
```

`MG_MODE=stills` renders one frame per scene for a quick look before committing to 720 frames.
`MG_RANGE=241-480` re-renders only that frame range (used to fix two scenes without redoing the film).
`MG_DEBUG=<frame>` prints what is visible at that frame and exits.

## Structure

| Frames | Scene |
| --- | --- |
| 1–120 | Mark + wordmark |
| 121–240 | "Your TV, on your desktop." |
| 241–360 | The app window (real screenshot as a texture) |
| 361–480 | Three protocol cards: 6466/6467, 5555, 8060 |
| 481–600 | Numbers: 166 tests, 3 protocols, 0 accounts |
| 601–720 | Call to action |

Hard cuts with an accent wipe bar between scenes; camera settles inside each scene.

## Blender 5.2 gotchas hit while building this

1. **Workbench renders viewport visibility.** `object.hide_render` is ignored by the Workbench render
   path; keyframe `hide_viewport` (and `hide_render`, so a future EEVEE pass agrees).
2. **Actions no longer expose `.fcurves`.** In 5.x they live on layers → strips → channelbags; the
   script walks both shapes.
3. **`keyframe_insert` on a scaled object overwrites all three axes** if you key a scalar — that turned
   a 1-unit underline into a full cube on screen. Key non-uniform scales explicitly.
4. **AgX costs about a stop.** `view_settings.exposure = 0.55` brings the dark UI back to what the
   design intends.

## Motion rules learned the hard way

- **Never repeat a camera key at the end of a scene.** The first cut keyed the last camera position
  twice (start of hold, end of hold), so the camera froze for the last ~2 s of all six scenes.
  `mpdecimate` counted only 450 unique frames in 720 � 37 % duplicates � and the film read as stutter,
  not as a slow move. Every scene now has three distinct camera keys, so the frame changes on every
  frame.
- **A held object still needs drift.** The logo, the app panel and the numbers each get a few degrees
  or a couple of percent of motion across the hold, otherwise the "hold" looks like a dropped frame.
- **Captions as 3D text produced a hairline** through the frame. They were removed; the narration
  carries the words instead.