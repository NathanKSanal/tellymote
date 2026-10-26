# TellyMote — Motion Design Report

The cinematic rebuild of `docs/index.html`, shipped as static HTML/CSS/JS on GitHub Pages.
This document is the companion to the site: research, stack, storyboard, the three signature
moments, dependencies, and the verification numbers behind every claim.

---

## 1. Animation research report

Evaluated against one question each: *what does this buy us on a static, no-build,
Intel-Iris-Xe-class machine, and what does it cost?*

| Candidate | Verdict | Why |
| --- | --- | --- |
| **GSAP core + ScrollTrigger** (already vendored) | **Kept, as the spine** | Scrubbed timelines give reversible scroll choreography for free; `matchMedia` gives clean desktop/mobile/reduced contexts; pin + scrub is the only dependency-grade solution for the cinema section. |
| **Lenis** (added) | **Kept** | Inertial scroll is what makes scrubbed timelines feel like one continuous take instead of a stepper. 4.8 KB gz, no DOM takeover, and it is switched off entirely under reduced motion. |
| **Three.js / OGL / WebGL** | **Rejected** | The "3D" here is three flat interface plates fanning in perspective. CSS `perspective` + `preserve-3d` renders that identically on Iris Xe at 60 fps; WebGL would add ~150 KB gz, a context-loss path, and a black-screen failure mode on old drivers for zero visual gain. |
| **SplitText (GSAP club plugin)** | **Rejected** | 21 characters in one headline. A 12-line hand-rolled splitter with `aria-label` on the `h1` does the same job with no licence question. |
| **Motion One / Anime.js** | **Rejected** | Overlap GSAP's role; two animation runtimes fighting over the same properties is a bug farm, not a feature. |
| **Locomotive Scroll / smooth-scrollbar** | **Rejected** | Lenis is smaller, maintained, and its official GSAP recipe is three lines. Locomotive also rewrites scroll containers, which breaks `position: sticky`. |
| **Canvas particle fields / shader grain** | **Rejected** | The identity is hairlines, monospace metadata and one amber accent. Particles would fight the brand and cost a per-frame canvas on integrated graphics. |
| **clip-path wipe** vs **mask-image wipe** | **mask-image won in the lab** | `clip-path: inset()` gives a hard rectangle; a `linear-gradient()` mask gives the soft 16% diagonal feather the transformation needed, and animating a custom property costs one composite-free style write per frame. |
| **ScrollTrigger pin** vs **`position: sticky`** for the remote and screen | **sticky won in the lab** | Sticky needs no spacer math, produces zero layout shift, and keeps both sections perfectly usable with JavaScript disabled. Pinning is reserved for the three places that genuinely need it (hero, cinema, protocols rail). |

The motion laboratory (`docs/_lab/`, since removed) isolated each of these as a standalone
page before any of them touched the real site. Only the winners above survived.

---

## 2. Selected stack and justification

- **GSAP 3.15.0 core** — vendored, pre-existing. Timeline math, easing, `matchMedia`.
- **ScrollTrigger 3.15.0** — vendored, pre-existing. Scrub, pin, observers.
- **Lenis 1.x** — vendored, **the only dependency added**. Inertial scroll, GSAP-ticker driven.
- **CSS** — `perspective` / `transform-style: preserve-3d` (product depth), `mask-image`
  (the wipe), `position: sticky` (two of the three signature moments), container query units
  (the typed-text overlay scales with the figure), `@media (prefers-reduced-motion)`.
- **SVG** — `stroke-dashoffset` drawing for the "how it works" wire and the protocol net,
  with native `getPointAtLength()` moving the marker dot. No library involved.
- **Hand-rolled** — character splitter, VTT caption parser, scroll-velocity marquee.

Total added payload: **one file, 16.8 KB raw / 4.8 KB gzipped**.

---

## 3. Section-by-section motion storyboard

| # | Section | Motion |
| --- | --- | --- |
| 01 | Preloader | Monospace boot lines type out, then the curtain lifts. Timer-driven teardown with a 4.2 s watchdog so a slow video decode can never strand the page. |
| 02 | Hero — *Signature 01* | Pinned. Headline splits into 21 characters and rises; three interface plates fan in from centre with a rim-light sweep; on scroll the fan folds into a closed deck, the deck tilts back and departs. |
| 03 | Ledger strip | Odometer count-ups (3 protocols / 166 tests / 0 relays / 720p), each digit a rolled column. |
| 04 | The film — pinned cinema | Scroll is the playhead: `currentTime` is scrubbed across the 30 s film with a timecode HUD, chapter ticks and captions parsed from the shipped VTT. Below the pin, the same film exists as a plain `<video controls>` with captions. |
| 05 | How it works | An SVG wire draws itself left to right; a dot travels the path via `getPointAtLength()`; three nodes ignite as it passes them. |
| 06 | Remote — *Signature 02* | Sticky 300 vh. Three beats crossfade; the pad turns toward whichever control is described; the matching key ring pulses; in beat three the phrase `tellymote` types itself into the text-entry field. Scrubbing backwards un-types it. |
| 07 | Live screen — *Signature 03* | Sticky 280 vh. The tilted remote panel grows and straightens, then a diagonal mask wipe replaces the remote with the live dashboard while a scan line sweeps and a frame counter rolls 0000→0720. |
| 08 | Protocols | The laptop→TV net draws its three wires in staggered windows, ports light, then the section pins horizontally and the protocol cards rail past. |
| 09 | Compare / ledger / returns | Table rows and matrix cells reveal in grouped staggers; the returns marquee speed reacts to scroll velocity (JS-driven, paused at rest). |
| 10 | Download / footer | Quiet. A single reveal and the magnetic button treatment. Nothing competes with the CTA. |

---

## 4. The three signature moments

**01 — The Product Reveal.** Three real interface screenshots (devices, dashboard, remote)
enter as a fanned 3D composition: `rotateY ±18°`, `z −160 px`, centre plate forward. Scrolling
folds the fan into a closed deck (`yPercent ±1.6`, `z ±30`), then the whole deck tilts on X,
scales past the camera and fades — the interface literally leaves the stage before the film
starts. Pure CSS 3D; GSAP only interpolates transforms.

**02 — The Remote Experience.** One sticky slot, three beats, zero cuts. The pad rotates
`−10° → −5° → +5° → 0°` and scales `0.96 → 1.05` as the narrative moves from D-pad to volume to
text. Key rings (`up`, `ok`, `vol`, `text`) are absolutely positioned over measured regions of
`media/remote.png`, so the highlight lands on the real pixels. The typed phrase is scrubbed,
not timed: scroll back and the letters retract.

**03 — The Live Screen Transformation.** The remote panel arrives small and tilted — an object
you *operate*. It grows to fill the frame and straightens — an object you *watch* — and at the
exact moment it flattens, a 102° gradient mask wipes the remote away to reveal the dashboard
underneath, led by a scan line and a frame counter. One gesture carries the whole product
story: control becomes viewing.

---

## 5. Dependencies added

| File | Size (raw / gz) | Notes |
| --- | --- | --- |
| `docs/site/vendor/lenis.min.js` | 16.8 KB / 4.8 KB | The only addition. Vendored locally; no CDN, no network request after load. |

Everything else was already in the repository (GSAP core, ScrollTrigger) or is hand-written
CSS/SVG/JS. No frameworks, no bundler, no build step, no backend, no analytics.

---

## 6. Performance verification

Headless Chrome over CDP, local static server, settled frames (Lenis immediate jumps).

| Check | 1440×900 | 390×844 |
| --- | --- | --- |
| Console errors / page errors | 0 / 0 | 0 / 0 |
| Horizontal overflow | 0 px | 0 px |
| Page height before vs after scroll (CLS) | 17277 → 17277 | 9581 → 9581 |
| ScrollTriggers / pinned | 47 / 3 | 46 / 0 |
| Network requests, external hosts | 24 / 0 | — |
| Broken images | 0 of 6 | 0 of 6 |

- **JS budget:** all JavaScript transferred = **62.8 KB gzipped** (GSAP 27.6, ScrollTrigger 17.6,
  Lenis 4.7, site.js 10.5, player.js 2.4) against the ~150 KB budget. Raw on disk: 174 KB.
- **No layout shift:** every image carries `width`/`height` attributes plus `height: auto`, so
  the aspect box is reserved before decode; sticky sections need no spacer elements.
- **Lazy by construction:** the promo video is `preload="none"`, the film `preload="metadata"`,
  images `decoding="async"`; nothing is fetched after load.
- **Listener hygiene:** every ticker and ScrollTrigger lives inside a `gsap.matchMedia` context
  and is torn down on context revert (verified: marquee and cinema tickers return cleanup
  functions).

---

## 7. Accessibility verification

- **Reduced motion** (`prefers-reduced-motion: reduce`, emulated): `html.reduced` — Lenis never
  starts, pinning and scrubbing are never created (9 ScrollTriggers, 0 pins), the cinema falls
  back to a plain captioned player, the wipe resolves to the final dashboard, marquees become
  static centred rows, and the page is 100% complete: 0 overflow, 0 console errors, stable
  height. A `?motion=reduced|full` override exists for testing either branch.
- **No JavaScript:** `html.no-js` keeps every section readable; the film and promo are plain
  `<video controls>` with `<track kind="captions">`; the wipe layer and frame badge are hidden.
- **Keyboard:** native scrolling is never hijacked (Lenis binds wheel only), 50 focusable
  elements in DOM order, global `:focus-visible` outline (2 px accent, 3 px offset), skip link
  revealed on focus.
- **Screen readers:** the split headline keeps its sentence as `aria-label` with characters
  `aria-hidden`; decorative layers (cursor, grain, scan, key rings, watermark) are
  `aria-hidden="true"`; both videos carry descriptive `aria-label`s and English caption tracks.

---

## 8. Responsive testing results

| Viewport | Overflow | Pins | Height stable | Errors |
| --- | --- | --- | --- | --- |
| 390×844 | 0 | 0 | yes | 0 |
| 768×1024 | 0 | 0 | yes | 0 |
| 1024×768 | 0 | 0 | yes | 0 |
| 1280×800 | 0 | 3 | yes | 0 |
| 1440×900 | 0 | 3 | yes | 0 |
| 1600×900 | 0 | 3 | yes | 0 |

Below 1081 px the composition changes rather than shrinks: pins are dropped, the cinema becomes
a captioned player with controls, the hero plates use a narrower fan, the wipe runs unscrubbed
over a short window, and the remote's key rings light per beat (nearest beat to the viewport
centre) instead of per scrub progress.

---

## 9. Remaining limitations

- The pinned cinema and the two sticky signatures are desktop-only by design; touch devices get
  the unscrubbed versions. This is deliberate (scrubbing a video by thumb is unpleasant), not
  an oversight.
- `mask-image` wipe feather is a fixed 16% band; it does not adapt to viewport width. At very
  narrow widths the feather reads slightly softer relative to the frame.
- The typed-text overlay sizes with container query units; browsers without `cqw` support
  (pre-2023) fall back to the `clamp()` minimum, which sits a pixel high in the field.
- Headless Chrome reports `video.currentTime` as 0 immediately after a programmatic seek even
  though the rendered frame is correct (verified against screenshots); automated assertions on
  the cinema therefore read the HUD timecode, not the media element.
- `docs/site/audio/` (seven narration chapters + manifest) predates this rebuild and is
  referenced by nothing; left untouched rather than deleted without approval.
- The 30 s film is a single 1920×1080 MP4; adaptive bitrate is out of scope for a static site.
