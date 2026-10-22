# Changelog

This project was previously called LumaRemote. Entries before 1.3.0 keep that name.

## Android preview 0.1.0

- Standalone Android client (Kotlin/Compose): SSDP discovery and /24 probe for ATV 6466, ADB
  5555 and Roku 8060. Discovery only; pairing/control is the next slice.
- CI Android workflow builds and uploads a debug APK.

## 1.3.2

- Added Linux AppImage and macOS ZIP builds to the release workflow, alongside Windows.
- Added an OS-detecting download page at `docs/download.html` (GitHub Pages).
- Windows remains the hardware-verified target; Linux/macOS packages are CI-built and unsigned.

## 1.3.1

- Relicensed from MIT to **FSL-1.1-MIT** (Functional Source License 1.1, MIT Future License):
  free non-competing use, including internal business use; no competing or rebranded product; each
  release becomes MIT two years after publication.
- Added `TRADEMARK.md` for the TellyMote name, wordmark and logo.
- Note: 1.3.0 was published under MIT; copies already distributed remain MIT for those copies.

## 1.3.0

- Renamed the product, app ID, installer, GitHub repository and UI from LumaRemote to TellyMote.
- Added a one-time migration of `devices.json`, `settings.json` and the encrypted vault from
  `%APPDATA%\lumaremote` to `%APPDATA%\TellyMote`, so existing pairings survive.
- Privacy check now guards the renamed bundle as well.

## 1.2.2

- Signal-chain dashboard block, Bahnschrift display face, sliding nav indicator and a live-view
  connection diagram.
- Added a Smart App Control-safe portable build whose launcher is the stock Electron binary.

## 1.2.1

- Added a privacy gate that fails CI if development TV, network or account data appears in the
  bundled renderer/main files.
- Corrected repository metadata.
- Documented what is stored locally and what a release never contains.

## 1.2.0

### Security

- Renderer trust is the exact packaged `index.html` path (or dev-server origin); navigation to other
  local files is blocked.
- Remote-key IPC validates against the known key set; renderer metrics are clamped.
- Frame server uses a constant-time token comparison, rejects non-loopback `Host` headers, accepts
  only GET, and caps long-poll waiters.
- All renderers are sandboxed; webview and insecure-content features are explicitly disabled.
- Fixed a device-card button that had no action.

### Added

- Roku ECP transport (port 8060): D-pad, home/back, volume, media keys, app list, app launch and
  literal ASCII text. No screen capture.
- README, support matrix, security policy, MIT licence and GitHub Actions CI.

### Changed

- ADB reuses the standard `%USERPROFILE%\.android` key when present, so the TV is authorised once.
- UI: persistent status bar, live throughput sparklines, device plate on the remote, tokenised
  borders/radii, pointer ring and tap ripple on the live view.

## 1.1.0

- Redesigned the UI around a flat, dense desktop system.
- Click-to-tap and right-click Back on the live view; save-frame to PNG.
- Compact remote beside the live feed.
- Fixed registry updates erasing the discovered model and trust.
- Saved devices remain visible while disconnected.

## 1.0.0

- Initial implementation: Android TV Remote v2 pairing/control, ADB capture (H.264 and PNG),
  loopback frame server, diagnostics, settings, installer.
