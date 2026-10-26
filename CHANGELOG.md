# Changelog

This project was previously called LumaRemote. Entries before 1.3.0 keep that name.

## 1.4.0

- **First launch introduces the project.** A freshly installed build opens
  <https://nathanksanal.github.io/tellymote/> once in the default browser alongside the app. A marker
  in the userData folder stops it reopening on later launches or after updates; development builds
  never open it.
- **New interface across all seven views.** A broadcast control-room design system: layered light on
  a warm charcoal surface, hairline instrument panels, tabular mono readouts, and a single amber
  signal colour that glows only where something is live. The remote is a machined slab, the live
  feed sits in a monitor bezel, throughput draws as a real sparkline.
- **Layout holds its shape on smaller laptops.** Two-column instrument layouts now persist down to
  1024 px; the remote pad and its link readout (transport, key round trip, commands sent) stay
  in view while the page scrolls.
- **Motion is deliberate and optional.** View reveals, live-dot breathing and connector pulses all
  honour `prefers-reduced-motion`; nothing loops for decoration.
- **Control-room details:** capability rows gained separators and hover, text entry stretches to
  fill its panel, apps carry a provenance footer, and dashboards gained a connected-since strip.
- **Fixes:** the app no longer double-fires a key when Enter activates a focused pad button; the
  device menu closes on Escape and returns focus; rename re-seeds with the current name; the pairing
  dialog traps focus; session teardown never reports a phase the TV did not confirm; the screen feed
  retries a dead poll without inventing dropped counts.
- **Website rebuilt** as a scroll-choreographed film with a captioned 3D cut and a smooth-scroll
  engine; all motion documentation lives in `docs/MOTION.md`.

## 1.3.3

- **Remote page no longer dead-ends.** With a saved TV that is currently off, the full pad stays
  visible and a one-click **Connect** action replaces the empty state. Previously the page showed
  "No display connected" and hid the product.
- README now opens with a screenshot tour and a download button, plus an explicit "why Windows
  warns" section and SHA-256 verification steps.
- Download page: hero screenshot, screenshot grid, "why does Windows warn?" disclosure, a portable
  ZIP secondary button, and a link to the new comparison page.
- New comparison page: `docs/alternatives.html` (TellyMote vs scrcpy, Google TV app, Unified Remote,
  Yatse, adb keyevent scripts).
- Release notes rewritten: portable ZIP first, hash verification, honest limits.

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
