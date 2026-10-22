# Supported platforms

TellyMote is an **Android TV / Google TV** remote and screen viewer, plus a **Roku** remote. A
standalone **Android client** is in progress; iOS is planned after it. It is not a universal
smart-TV remote, and the repository does not claim to be one.

## Host platforms

| Host | Status |
| --- | --- |
| **Windows 10/11 x64** | **Verified.** Installer, portable and SAC-safe portable. |
| **Linux** | AppImage built by CI; unsigned and not hardware-verified. |
| **macOS** | arm64/x64 ZIP built by CI; unsigned and not hardware-verified. |
| **Android** | **Preview 0.1.0:** discovery only (SSDP + `/24` probe). Pairing, remote and live view are the next slices. |
| **iOS** | Planned after Android; the pure-Kotlin protocol core is designed to be reused. |

Windows-specific desktop code is limited to the title-bar overlay, login item behaviour and DPAPI via
Electron's `safeStorage`; Electron provides equivalents on macOS/Linux.

## Status levels

| Level | Meaning |
| --- | --- |
| **Verified** | Exercised on real hardware and observed working. |
| **Expected** | The same standard protocols are present, but this exact model was not tested. |
| **Partial** | Some features work; the control or capture protocol is not the supported one. |
| **Unsupported** | A different protocol is required. |

## Televisions and boxes

| Platform | Remote control | Screen view | Status |
| --- | --- | --- | --- |
| **Xiaomi Mi TV 4A (MiTV4I, Android 9)** | ATV Remote v2 | ADB H.264 / PNG | **Verified** (remote, apps, ADB, PNG); H.264 stream verified, final paint pending |
| Other **Android TV / Google TV** sets (Sony, TCL, Philips, Hisense, Sharp, Nvidia Shield, Chromecast with Google TV, Mi Box, emulators) | ATV Remote v2 (ports 6466/6467) | ADB (port 5555) | **Expected** — same protocols, not individually tested |
| **Fire TV / Fire OS** | Usually no ATV Remote v2 | ADB may work | **Partial / unverified** |
| **Samsung Tizen** | Proprietary WebSocket API on 8001/8002 | Not implemented | **Unsupported** |
| **LG webOS** | Proprietary WebSocket API on 3000 | Not implemented | **Unsupported** |
| **Roku** (TVs and players) | ECP HTTP API on 8060 | No capture endpoint | **Implemented, mock-tested** (remote, apps, text; not yet hardware-verified) |
| **Apple TV** | MRP / Companion Link | Not implemented | **Unsupported** |
| **Vizio SmartCast** | Proprietary HTTPS API | Not implemented | **Unsupported** |
| **Hisense VIDAA** | Proprietary | Not implemented | **Unsupported** |

“Android TV” here means a device running Google's Android TV / Google TV with the **Android TV Remote
Service v2** installed. Some Android-based TVs ship without it; those fall back to ADB key events if
debugging is enabled.

## Features that are platform-independent

Discovery (mDNS, SSDP, TCP probe), saved devices, the local-only frame server, diagnostics and the
UI work with any reachable host. They do not imply control support.

## Limits that are not bugs

- **DRM playback** is black in captures. Android blocks protected surfaces; this is not bypassed.
- **Screen view requires ADB debugging.** ATV Remote v2 alone cannot capture video.
- **No audio capture.** The Android TV remote protocol carries no display audio.
- **No TV-side app is installed.** The app never pushes APKs or changes TV settings.

## Roadmap for other platforms

Each ecosystem needs its own adapter; they are not variations of the Android TV protocol.

1. **Samsung Tizen** — WebSocket, on-TV allow prompt, token persistence.
2. **LG webOS** — WebSocket registration, on-TV prompt, client-key persistence.
3. **Apple TV** — MRP/Companion Link, significantly more work.

Until those adapters exist, the honest answer is: **Android TV / Google TV (full) and Roku (control only).**
