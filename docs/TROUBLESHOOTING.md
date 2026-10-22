# Troubleshooting

Start with **Diagnostics**. It shows the selected interface, the last scan, every protocol port,
the authenticated transports, ADB state, measured latency and a list of suggested next steps.
`Export report` writes a redacted JSON file you can keep or share.

## The TV never appears

| Check | What to do |
| --- | --- |
| Same subnet? | `Devices → Network` must show the TV's subnet, e.g. `192.168.0.0/24`. A `172.x` or VPN adapter means the wrong interface was picked. |
| TV awake? | Some TVs drop off Wi-Fi in deep standby. Wake it with its own remote and rescan. |
| Multicast blocked? | Use `Add by IP address`. The direct probe does not need mDNS/SSDP. |
| AP/client isolation? | Guest networks and some mesh systems isolate clients. Move both devices to the main SSID. |
| Firewall? | Outbound connections are enough for discovery; the loopback feed never touches the LAN. |
| TV on Ethernet, PC on Wi-Fi? | Usually fine on one router; not fine across VLANs. |

If the card appears but every protocol says closed, the TV's remote service is off or the router is
rewriting traffic. Try `Diagnostics → Ping` to separate "host reachable" from "service present".

## Pairing fails

- **"Code rejected"** — codes expire. Start pairing again and use the code currently on screen.
- **"Timed out"** — the TV dialog must stay open. Cancel any other pairing attempt (including the
  Google TV app) and retry.
- **"Certificate rejected"** — the saved fingerprint no longer matches (TV reset or firmware update).
  Forget the device and pair again.
- **Nothing happens after entering the code** — check that the PC and TV clocks are within a few
  minutes, and that the TV is not in a different user profile.
- The six-character code is validated locally first: a typo produces an immediate error without
  contacting the TV.

## Remote connects but buttons do nothing

1. Confirm the card shows **Paired** and Diagnostics shows `atv-v2` as the active transport.
2. Try a single key while the Live feed is stopped. Capture never intentionally starves input; if
   input recovers when capture stops, report it with the diagnostics export.
3. Some firmware ignores individual key codes (for example `TV_INPUT`). The app shows a note instead
   of claiming success.
4. If only volume fails, check whether the TV routes volume to an external soundbar/AVR.

## ADB will not enable or authorise

- Menu names vary: `Settings → Device Preferences → About → Build` (7 taps), then
  `Developer options`. On some PatchWall builds the path is under `Settings → More settings`.
- Enable **USB debugging** *and* **Network debugging** if both exist.
- Approve the fingerprint dialog **on the TV**. If it never appears, revoke previous authorisations
  and reconnect.
- If port `5555` stays closed, the firmware only enables ADB over USB. The app cannot open it
  remotely; use the remote-only feature set.
- `ADB_UNAUTHORIZED` means the TV saw the key but it was not approved.
- **Asked on every connection?** Tick **“Always allow from this computer”** once. LumaRemote reuses
  the standard `%USERPROFILE%\.android\adbkey`, so it shares the trust you already gave adb/scrcpy.
  If the TV still asks after a reboot, its firmware is not persisting `adb_keys`; accept once more or
  check for a firmware update. Running a second tool with a *different* key always needs its own
  approval.
- The app never runs `adb tcpip`, never installs APKs and never changes TV settings.

## Live screen shows nothing

| Symptom | Meaning | Fix |
| --- | --- | --- |
| "ADB is not authorised" | capture needs debugging access | authorise ADB |
| "Screenshot feed" badge | `screenrecord` H.264 was refused; PNG polling is active | expected fallback; lower the profile if it is slow |
| Black frame during a film | DRM surface protected | not bypassable; control still works |
| Constant "waiting for first frame" | TV refused the capture command or the stream ended | check Diagnostics for `screenrecord` errors, retry |
| Video freezes after ~3 minutes | `screenrecord --time-limit 180` restarted | automatic; the renderer resets its decoder |
| Very low fps | capture cost exceeds the interval | Lite profile or lower resolution in Settings |
| Click-to-tap does nothing | the TV home screen is D-pad-first, or the app ignores touch | use the D-pad; touch works in apps that accept it |
| Right-click sent Back unexpectedly | right-click on the video is bound to Back by design | use the on-screen controls instead |

### Why H.264 used to show "video without codec headers"

This Mi TV's `screenrecord` is **v1.2**: it has no `--output-format=h264` option and it emits
**SPS/PPS/IDR only in the opening burst of a stream**, then nothing but non-IDR P-slices. Two
consequences were fixed in the current build:

- A renderer that attached to the Live view a moment after capture started missed the only
  parameter sets and could never configure its decoder. The app now keeps the cached SPS/PPS/IDR
  **and** asks the main process to reopen the stream when a decoder attaches, so a fresh keyframe
  burst always arrives in order.
- ADB stream IDs were being matched on the device's id instead of ours. That worked for the first
  command only; every later shell stream timed out. Streams are now keyed by the local id, with a
  regression test using deliberately different ids.

ADB commands also used to *resolve* on timeout with a truncated payload (a partial PNG looked
"valid" because it still had an IHDR). Timeouts now reject, and a PNG must end with its IEND chunk.

The app never displays a cached still as if it were live video. If the feed stops, it says so.

## High latency or stutter

- Check `Capture → captureMs` and `transferMs` in Diagnostics. If capture time alone is ~600 ms, no
  amount of tuning will make it smooth — use the H.264 path or Lite profile.
- Prefer 5 GHz Wi-Fi; 2.4 GHz with a busy channel adds jitter.
- Turn off other screen-mirroring sessions on the TV.
- The adaptive controller steps quality down when command RTT exceeds 2× baseline and never raises it
  while the remote is starved. Manual profile selection overrides it.

## App / window problems

- **Tray icon missing** — `build/icon.png` must ship with the app. Reinstall the current build.
- **Window closes instead of minimising** — turn off `Minimize to tray` in Settings.
- **Hotkeys not working** — shortcuts are ignored while a text field has focus, and some are captured
  by Windows. Remap them in Settings.
- **Blank window after an update** — quit from the tray and relaunch. The renderer is loaded from the
  packaged `dist/`, not from the network.
- **GPU/VM artefacts** — run with `--disable-gpu` for diagnosis. Smoke mode does this automatically.

## Resetting

1. `Settings → Reset settings` restores defaults without deleting pairings.
2. `Forget` on a device removes its saved record and pinned certificate.
3. To remove everything (pairings, ADB key, logs), quit the app and delete `%APPDATA%\LumaRemote`.
4. Revoke the ADB key separately on the TV if it is still authorised.

## Reporting a problem

`Diagnostics → Export report` includes app/Electron versions, network interfaces, scan history,
protocol states, measured latencies and recent logs. Keys, tokens, pairing codes and IP addresses
are redacted unless `Include IP addresses in exports` is enabled.
