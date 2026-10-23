# Setup — from a cold TV to a working remote

This guide covers the **desktop app**. The standalone Android client is a separate preview; see
[mobile/android/README.md](../mobile/android/README.md).

It assumes a **Xiaomi Mi TV 4A 43"** (Android TV 9 / PatchWall) and a Windows PC on the
same network. Menu names vary slightly by firmware; the app never depends on a specific menu path.

## 1. Network prerequisites

| Requirement | Why |
| --- | --- |
| PC and TV on the **same subnet** (e.g. `192.0.2.0/24`) | Every protocol is link-local. |
| Client/AP isolation **off** | Guest Wi-Fi and some mesh systems block device-to-device traffic. |
| Multicast (mDNS/SSDP) allowed, or manual IP entry | Some routers filter multicast; manual entry bypasses it. |
| TV awake or in standby with network standby enabled | A fully powered-off TV cannot answer. |

The app shows the selected interface and subnet in `Devices → Network`. Virtual adapters
(Hyper-V, WSL, Docker, VPN) are ranked below Wi-Fi/Ethernet automatically.

## 2. Install and launch

```powershell
cd tellymote
npm install
npm run dev
```

or run the packaged installer (`release/TellyMote-1.0.0-x64.exe`).

On first launch Windows Firewall may ask about network access. TellyMote sends discovery datagrams
and listens for multicast/unicast replies (mDNS on UDP 5353, SSDP on an ephemeral port), makes
outbound TCP connections, and binds one **loopback** HTTP port for the video feed. It never opens an
inbound TCP port on the LAN. If inbound replies are blocked, mDNS/SSDP discovery can be incomplete,
but manual IP entry and the direct TCP probe still work.

## 3. Discover the TV

1. Open **Devices**.
2. Press **Scan network**. mDNS, SSDP and a direct probe of TCP `6466`, `6467` and `5555` run in
   parallel for about five seconds.
3. If nothing appears, use **Add by IP address** (e.g. `192.0.2.42`). The app probes the address
   directly and tells you which services answered.

Results are labelled by source (`mDNS`, `SSDP`, `Probe`, `Manual`, `Saved`). A device is only marked
**Active** after a protocol actually answers; open ports alone are not treated as proof of control.

## 4. Pair the remote (required for control)

1. Select the TV card → **Pair**.
2. The TV displays a six-character code.
3. Enter it in the dialog and confirm. TellyMote validates the code's checksum locally and refuses
   an implausible code before sending the pairing secret, then completes the TLS handshake.
4. The card shows **Paired** and the Dashboard shows the authenticated session.

What happens under the hood: a 2048-bit RSA client certificate is generated locally, the pairing
secret is derived from both public keys plus the code tail, and the resulting session is pinned to
the TV's certificate fingerprint. The private key is encrypted with Windows DPAPI.

**If the code is rejected:** start pairing again and re-read the code from the TV — codes expire.
Check that the PC clock is roughly correct, and that the TV is not showing a different pairing dialog.

## 5. Authorise ADB (screen viewing, text, app list)

Control works without ADB. Screen capture, text injection and the installed-app list do not.

1. On the TV: `Settings → Device Preferences → About → Build` — press **7 times**.
2. `Settings → Device Preferences → Developer options`:
   - enable **USB debugging** and/or **Network debugging** (firmware naming differs);
   - keep "verify apps over USB" off if the TV offers it.
3. Back in TellyMote, reconnect the device (or press **Reconnect & authorise** in Apps). If the TV's
   debugging service is reachable, the app sends its public key and waits for approval.
4. The TV shows an RSA fingerprint dialog. Compare it with the fingerprint in the app and approve.
5. Diagnostics should now show `adb: authorized` and the device model/Android version.

The app does **not** enable debugging for you, does not reboot the TV, and does not install anything
without an explicit action. See [ADB.md](ADB.md) for details and security notes.

## 6. View the screen

1. Open **Live**.
2. Press **Start viewing**.
3. The app probes capture methods in order:
   - **H.264** (`screenrecord --output-format=h264 -`) → true continuous video, decoded by WebCodecs.
   - **PNG** (`screencap -p`) → a screenshot feed, clearly labelled "not continuous video".
4. The badge, metrics panel and footer always state which method is live and what was measured.

If the TV refuses both, the Live view explains the reason (ADB not authorised, protected content,
encoder missing) instead of showing a placeholder image.

## 7. Daily use

- The last device reconnects automatically if **Auto-reconnect** is on.
- Closing the window minimises to the tray by default; quit from the tray menu.
- `Ctrl+Shift+R` jumps to the Remote view; `F11` toggles fullscreen.
- The Remote view keeps working while the Live feed is paused or stopped: capture never starves
  input.

## 8. Uninstall / reset

- Uninstall through Windows Settings; the installer is per-user.
- Local state lives in `%APPDATA%\TellyMote` (settings, saved devices, encrypted keys, logs).
  Deleting that folder removes pairings and requires pairing again.
- To revoke ADB access without uninstalling, remove the authorised key in the TV's Developer options.
