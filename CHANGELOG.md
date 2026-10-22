# Changelog

## 1.2.0

### Security

- Renderer trust is now the exact packaged `index.html` path (or dev-server origin); navigation to
  other local files is blocked.
- Remote-key IPC validates against the known key set; renderer metrics are clamped.
- Frame server uses a constant-time token comparison, rejects non-loopback `Host` headers, accepts
  only GET, and caps long-poll waiters.
- All renderers are sandboxed; webview and insecure-content features are explicitly disabled.
- Fixed a device-card button that had no action.

### Added

- **Roku ECP** transport (port 8060): D-pad, home/back, volume, media keys, app list, app launch and
  literal ASCII text. No screen capture. Discovery probes 8060 and marks `roku-ecp`.
- README, support matrix, security policy, MIT licence and GitHub Actions CI.

### Changed

- ADB reuses the standard `%USERPROFILE%\.android` key when present, so the TV is authorised once
  for all tools rather than once per app.
- UI: persistent status bar, live throughput sparklines, device plate on the remote, consistent
  tokenised borders/radii, and a pointer ring + tap ripple on the live view.

## 1.1.0

- Redesigned the UI around a flat, dense desktop system.
- Click-to-tap and right-click Back on the live view; save-frame to PNG.
- Compact remote beside the live feed.
- Fixed registry updates erasing the discovered model and trust.
- Saved devices remain visible while disconnected.

## 1.0.0

- Initial implementation: Android TV Remote v2 pairing/control, ADB capture (H.264 and PNG),
  loopback frame server, diagnostics, settings, installer.
