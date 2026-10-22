# LumaRemote — Architecture & Compatibility Plan

## 1. Environment inspection (measured, not assumed)

| Item | Result | Consequence |
| --- | --- | --- |
| OS | Windows 11 (win32), PowerShell 5.1 | Windows-first target satisfied |
| Node.js | v24.19.0 | Runs Electron main + Vite build |
| npm | 11.17.0 | Registry reachable |
| Rust / cargo | **not installed** | Tauri 2 cannot be built in this environment |
| MSVC build tools / vswhere | **not installed** | Rust MSVC target cannot link either |
| WebView2 | present | Electron also benefits |
| `adb` on PATH | **absent** | App must ship its own ADB implementation (no platform-tools dependency) |
| Wi-Fi LAN | private `/24`, link 115.6 Mbps | Real discovery must work on a local /24 |
| Hosts answering on LAN | `.1` (router), `.100`, `.104`, `.108` (randomised MACs, no Android TV ports) | **No Mi TV reachable at build time** → hardware validation must be reported honestly as pending |
| Ports probed | 6466/6467 (ATV remote v2), 6095 (v1), 5555 (ADB), 8009 (Cast), 80/443 | None open on the above hosts |

### Stack decision (documented deviation)

The brief prefers Tauri 2. Tauri requires a Rust toolchain **and** the MSVC linker; neither is
installed, and installing Visual Studio Build Tools + rustup is a multi-GB, machine-level change that
is outside the scope of an application build. The core requirements (Windows desktop shell,
React + TypeScript + Vite, Tailwind design system, native networking, no cloud, low latency) are all
met by **Electron 44 + React 19 + Vite 8 + TypeScript + Tailwind 4**, with all native work done in a
Node main process (raw sockets, TLS, protobuf, ADB, frame server). No native modules are used, so the
app packages as a single signed-ready NSIS installer.

The renderer never talks to the network. All protocol logic lives behind a typed IPC boundary.

## 2. Module map

```
electron/
  main.ts                 window lifecycle, CSP, navigation guard, single instance, tray
  preload.ts              contextBridge → typed, validated API surface
  core/
    log.ts                structured ring log + redaction
    settings.ts           settings store (safeStorage-encrypted secrets, JSON prefs)
    session.ts            orchestrator: discovery, pairing, connect, capture, diagnostics, reconnect
    discovery/            ssdp, mdns, dns-sd, tcp probe, interface ranking (cancellable)
    registry/             device identity, saved devices, capability cache
    remote/atv/           protobuf codec, pairing (polo), remote v2 control, keycodes
    remote/adb/           ADB wire protocol, shell/exec, device props, capture commands
    security/             certificates, ADB key material, DPAPI-backed vault
    capture/              PNG screenshot feed + H.264 stream providers
    streaming/            loopback frame server (127.0.0.1, token-gated)
src/                      React renderer (no sockets)
  components/             shell, sidebar, title bar, remote pad, pairing modal, toasts
  views/                  Dashboard, Devices, LiveScreen, Remote, Apps, Diagnostics, Settings
  lib/                    typed IPC client, store, screen-feed hooks, Annex-B helpers
tests/                    unit + protocol integration tests against mock servers
docs/                     architecture, setup, ADB, compatibility, troubleshooting
```

## 3. Protocol strategy (capability-driven)

### Remote control
1. **Android TV Remote Service v2** — protobuf over TLS, pairing on `6467`, control on `6466`
   (Google TV pairing protocol `polo`). This is the primary path: authenticated, no developer mode,
   supports D-pad, back/home/menu, volume, power, media transport, app deep links, long-press.
2. **ADB** — optional, user-authorised. Adds text injection, app launch by package, package listing,
   screenshot capture. Never enabled silently.
3. **Command throttle** — identical taps of the same key inside 24 ms are coalesced (the TV would
   collapse them anyway); distinct keys and long-press down/up edges are always delivered. The
   Diagnostics transport panel reports the command count, and the UI notes a coalesced press rather
   than pretending it was sent twice.
4. Xiaomi-specific HTTP bridges (`:6095`, miIO) are **not** assumed. They are probed only as a
   capability signal, and only documented endpoints would be used. No undocumented port is trusted
   merely because it is open.

### Screen capture (ordered, each tested before advertised)
1. **ADB H.264 elementary stream** (`screenrecord --output-format=h264 -`) decoded with WebCodecs.
   Continuous video, lowest latency path. Requires ADB authorisation. Detected by parsing for
   Annex-B start codes; falls back automatically if the device refuses.
2. **ADB PNG screenshots** (`exec:screencap -p`) on a persistent connection, newest-frame-only,
   measured end-to-end. This is a screenshot feed, and the UI labels it exactly that way.
3. **Unsupported** — remote control keeps working; the Live screen explains why.

No casting *to* the TV is used as a substitute. No synthetic frames are ever displayed.

## 4. Latency model

Measured per stage and surfaced honestly:

```
t0 capture request  → t1 TV capture done → t2 bytes received → t3 decoded → t4 painted
```
- command RTT: TLS write → first response byte (ping request/response, or ADB `echo` round trip)
- capture duration: measured on-device via `date +%s%N` brackets around `screencap`
- transfer: t2 − t1
- decode/paint: t4 − t3 in the renderer, reported back over IPC
- PNG end-to-end: the sum of the measured stages, shown as an estimate (the TV exposes no frame
  timestamp, so it cannot be called glass-to-glass truth).

For H.264 the TV exposes no trustworthy capture timestamp and there is no synchronised source, so
end-to-end is shown as **not measurable** instead of invented. The Live view reports decode-queue
delay and dropped frames, which are real, and the transport badge says "Continuous" only when a real
stream is being decoded.

## 5. Adaptive engine

Capabilities are measured per device, cached, and re-probed on demand. The profiles are real capture
schedules, not labels:

| Preset | Capture rate | Max width | Transport |
| --- | --- | --- | --- |
| Lite | 1 fps | 960 | PNG |
| Balanced (default) | 3 fps | 1280 | PNG |
| Performance | 6 fps | 1920 | H.264 if verified |
| Auto | starts at the current values | current | current |

In **Auto**, four consecutive frames slower than 1200 ms reduce the rate by 30 % (floor 1 fps), and
twelve healthy frames raise it by 1 fps up to 6 fps. A manually selected profile is applied exactly
as chosen and the controller never changes it. The remote transport is independent of the capture
scheduler: capture has at most one request in flight, so key events never queue behind a screenshot.
Manual override always wins.

## 6. Security

- Pairing certificate (2048-bit RSA) generated locally, private key encrypted with Windows DPAPI via
  Electron `safeStorage`; never written to logs.
- ADB key also generated locally; the public key is what the user approves on the TV.
- Device TLS certificates are trusted on first use and pinned by SHA-256 fingerprint afterwards.
- Loopback frame server binds `127.0.0.1` on an ephemeral port and requires a per-session bearer token.
- Logs redact tokens, keys, pairing codes, and IPs on export (opt-in to include IPs).
- No telemetry, no cloud, no remote-control listener.

## 7. Verification status legend

- **Verified** — exercised against real hardware and/or a protocol conformance test in this repo.
- **Implemented** — code complete, unit/integration tested against a mock, **not yet** run on the Mi TV.
- **Conditional** — depends on firmware/authorisation; the app probes before offering it.
- **Unsupported** — not possible through legitimate local protocols; explicitly disabled.

This project ships with **no real Mi TV available on the build network**. Every hardware-dependent
capability is therefore reported as *implemented, pending on-device verification*, and the app itself
performs the same verification at runtime rather than trusting this document.
