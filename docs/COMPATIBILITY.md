# Compatibility report — Xiaomi Mi TV 4A 43"

Target device: **Xiaomi Mi TV 4A 43"**, Android TV 9 / PatchWall, 1280×720 panel mode, stock remote.
Tested against: a Xiaomi Mi TV 4A 43" reporting model `MiTV4I`, Android 9 / SDK 28, over a private LAN.
Build machine: Windows 11 x64, Wi-Fi on a private /24 network.

> **Read this first.** Rows marked **verified** were exercised against the real TV above and the
> evidence is recorded in the app's Diagnostics export. Rows marked **pending** were not exercised
> before the TV was powered off; the code path exists and is unit/mock-tested, but that is not proof
> of firmware acceptance. Nothing here is presented as working until the TV actually answers.

> The **Android client** is a separate implementation and is currently a discovery-only preview;
> see [mobile/android/README.md](../mobile/android/README.md).

## Status matrix

| Capability | Implementation | Automated evidence | On real Mi TV |
| --- | --- | --- | --- |
| mDNS `_androidtvremote2._tcp` discovery | full DNS-SD listener | discovery tests with synthetic packets | **not observed** (device arrived via SSDP) |
| SSDP/UPnP discovery | M-SEARCH + parsing | discovery tests | **verified** — device found, `Linux/4.9.113, Chromecast/1.6.18` |
| Active TCP probe `6466/6467/5555` | bounded concurrency sweep | probe tests | **verified** — all three ports open while awake |
| Manual IP entry | probe + save | discovery tests | **implemented**, not exercised |
| Saved devices / reconnect | registry + auto-connect | registry/settings tests | **verified** — device persisted across restarts |
| ATV v2 pairing (polo, port 6467) | full state machine, local code checksum | pairing-session tests over TLS | **verified** — TV trusted, pinned cert reused |
| ATV v2 control (port 6466) | protobuf varint framing, feature mask 622 | atv-client tests over TLS | **verified** — session `atv-v2`, mask `0x26e` |
| D-pad, OK, back, home, menu, settings | key codes | message tests | **verified (partial)** — `right` + `select` accepted; used to accept the TV's ADB dialog |
| Volume, mute | key codes | message tests | **pending** — negotiated, not individually pressed |
| Play/pause, rewind, fast-forward, next/previous | key codes | message tests | **pending** |
| Channel up/down | key codes | message tests | **pending** |
| Long-press | key down/up action | message tests | **pending** |
| Command throttle | identical taps < 24 ms coalesced | atv-client test | **mock-tested** |
| Adaptive Auto | measured frame-time backoff/recovery | not unit-tested | **implemented** |
| Power | `KEYCODE_POWER` | message tests | **conditional** — may only sleep |
| Text input via TV IME | experimental batch edit | encoding tests | **experimental** |
| ADB authorisation (PKCS#1 v1.5) | hand-rolled host protocol | adb tests including padding recovery | **verified** — authorised, `MiTV4I`, Android 9 / SDK 28 |
| ADB text injection | `input text` | command construction tests | **pending** |
| App list | `pm list packages` | command tests | **verified** — real package list rendered |
| App launch | `monkey` (LEANBACK first) | command tests | **pending** |
| Screenshot feed | `screencap -p`, newest-frame-only | frame-server + capture tests | **verified** — real 1280×720 frames, ~0.4–0.5 fps |
| Continuous H.264 | `screenrecord` Annex-B + WebCodecs | Annex-B + decoder-feed tests | **stream verified** — SPS/PPS/IDR observed; final paint pending |
| Audio capture | not implemented | — | **unsupported** |
| Cast as a control/mirror path | rejected with explanation | capability tests | **unsupported** |
| Install TV-side receiver | disabled by policy | capability tests | **unsupported** |
| DRM-protected playback | not bypassed | — | **black frames expected** |

## What was measured on the real TV

- **ADB:** `authorized: true`, `model: MiTV4I`, Android `9`, `sdk: 28`. The TV prompts for
  authorisation on a fresh connection; the dialog can be accepted with the ATV remote.
- **Screenshot path:** full 1280×720 PNG delivered in roughly **0.5–2 s** once the ADB stream-id
  bug was fixed. Earlier attempts took 13+ s and returned a truncated PNG that still had a valid
  header — both the bug and the false "success" are fixed.
- **H.264 path:** the stream is genuine Annex-B. The opening burst contains
  `00 00 00 01 67 …` (SPS), `68 …` (PPS) and `65 …` (IDR); every later chunk is `41 …`
  (non-IDR slice). Measured throughput while the screen changed: ~2.7 Mbps at 1280×720.
- **Firmware quirk:** `screenrecord` is **v1.2** and has no `--output-format=h264` option. It only
  emits parameter sets and a keyframe when the stream opens, never again. TellyMote caches them and
  reopens the stream when a decoder attaches, so a late Live view still gets an in-order keyframe
  burst.
- **Sleep behaviour:** this TV drops Wi-Fi completely in deep standby (all ports closed, no ICMP).
  The app reconnects when it returns, but it cannot wake the TV from that state.

## Why some rows are still "pending"

The TV was powered off before the final end-to-end pass, so the last confirmation —
watching decoded H.264 frames paint after the header fix — could not be captured. The stream,
parameter-set caching, ADB framing and screenshot rendering were all verified directly. The app
marks a capability **verified** only after the device answers, so it will never claim more than it
has seen.

## How to verify on your TV (5 minutes)

1. Run `npm run dev` (or the installer) on the same network as the TV.
2. `Devices → Scan network` → confirm the TV appears (source `SSDP`, `mDNS`, `Probe` or `Manual`).
3. Pair if needed, then enable Developer options + network debugging and approve the ADB prompt
   (tick "Always allow", or the TV will ask again on the next connection).
4. `Diagnostics` → check `adb: authorized`, model, Android version and resolution.
5. `Live screen` → confirm the badge:
   - **Continuous H.264** for the video path,
   - **Not continuous video** for the PNG screenshot feed (explicitly labelled).
6. Press D-pad / OK / back / volume and confirm the TV reacts.
7. `Diagnostics → Export` records exactly what passed.

Any row that fails is expected to fail **visibly**: the app downgrades the capability, shows the
reason, and keeps the remaining features working. There is no silent fallback that pretends a
screenshot is video.
