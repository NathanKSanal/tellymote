# TellyMote Android (first slice)

Standalone Android client for TellyMote. This is **not** an Electron port: the TV protocols are
re-implemented in Kotlin.

## Current status

This slice does:

- SSDP M-SEARCH discovery
- `/24` TCP probe for ATV Remote v2 (`6466`), Roku ECP (`8060`) and ADB (`5555`)
- A Compose device list with protocol badges

It does **not** control anything yet. Pairing/remote control is the next slice.

Preview APK: [android-v0.1.0](https://github.com/NathanKSanal/tellymote/releases/tag/android-v0.1.0)
(debug-signed, Android 8.0+). iOS follows after the Android protocol core is complete.

## Build

Local:

```bash
cd mobile/android
gradle :core:test :app:assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

Requires JDK 17+ and the Android SDK (platform 35, build-tools 35.0.0). CI installs both, so the
simplest path is the **Android** workflow artifact.

Install on a phone:

```bash
adb install -r app-debug.apk
```

## Roadmap

1. **Discovery** (this slice)
2. ATV Remote v2 pairing + D-pad/volume remote
3. ADB PNG live view
4. H.264 live view via MediaCodec
5. Roku ECP + saved devices/settings

## Permissions

`INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`. No location,
storage, camera or account permissions. Cleartext traffic is enabled only because Roku ECP is HTTP
on the LAN; ATV and ADB use TLS/raw sockets.
