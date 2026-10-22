# Privacy and your data

LumaRemote has no account, no telemetry, no cloud relay and no update check. Everything it learns
about your TV stays on the laptop that ran it.

## What is stored, and where

The installer contains **only the application**. It does not contain any device list, pairing key,
screenshot or setting from the machine that built it.

On first run the app creates its own folder:

```
%APPDATA%\lumaremote\
  devices.json    saved TV names, addresses, capabilities
  settings.json   your preferences
  secrets.bin     DPAPI-encrypted pairing certificate, ADB key, pinned fingerprints
  logs\           recent local log entries (redacted on export)
```

A fresh install on another machine starts with an empty device list; there is nothing to import.

## What is not included in a release

- No `devices.json`, `settings.json` or `secrets.bin`.
- No TV IP address, MAC address, model, serial or ADB key fingerprint from the development network.
- No personal Windows user path, email address or GitHub account name in the application code.
- No screenshots or diagnostics exports.

The build runs `npm run privacy` after bundling. It scans `dist/`, `dist-electron/`, `build/` and
`package.json` for the exact development TV/network/account values and fails CI if any appear. The
same check runs in GitHub Actions.

## Removing your data

- **Forget** a device in the app: removes its saved record and pinned fingerprint.
- **Settings → Reset settings**: restores defaults without deleting pairings.
- To remove everything, quit the app and delete `%APPDATA%\lumaremote`.
- Revoke the ADB key on the TV separately if you no longer want debugging access.

## Sharing diagnostics

**Diagnostics → Export** redacts keys, pairing codes and tokens, and redacts IP addresses unless you
explicitly enable `Include IP addresses in exports`. Review the JSON before posting it publicly.
