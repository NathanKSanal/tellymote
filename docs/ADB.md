# ADB — what TellyMote uses and why

TellyMote never shells out to `adb.exe`. The ADB host protocol is implemented in
`electron/core/remote/adb/` so the app works on a machine with no Android SDK, no platform-tools and
no `PATH` changes. This also keeps key material inside the app's encrypted vault.

## What ADB unlocks

| Feature | Without ADB | With authorised ADB |
| --- | --- | --- |
| D-pad / OK / back / home / volume | ✅ ATV Remote v2 | still ATV v2 |
| Power / menu / transport | ✅ ATV Remote v2 | still ATV v2 |
| Text entry | experimental TV IME | ✅ `input text` (reliable) |
| App list | ❌ | ✅ `pm list packages` |
| Launch by package | deep link only | ✅ `monkey` (LEANBACK first, then generic) |
| Live screen | ❌ | ✅ H.264 or PNG capture |
| Device model / Android version / resolution | partial | ✅ `getprop`, `wm size` |

ADB is **optional**. Nothing is enabled or installed silently, and no command runs before the user
approves the RSA key on the TV.

## Protocol flow (implemented from scratch)

```
host  → CNXN  (version, maxdata, "host::features=…")
tv    → AUTH  TOKEN   (20 random bytes)
host  → AUTH  SIGNATURE  SHA1(token) signed with RSA PKCS#1 v1.5
tv    → AUTH  TOKEN   (key unknown → user prompt)
host  → AUTH  RSAPUBLICKEY  (Android RSAPublicKey wire format + "\0")
tv    → CNXN  (device banner: "device::ro.product.name=…")
```

Details that matter on real hardware:

- The signature **must** use PKCS#1 v1.5 SHA-1. Node's `crypto.sign` is called with explicit
  `RSA_PKCS1_PADDING`; PSS signatures are rejected by `adbd`.
- The public key is sent in Android's `RSAPublicKey` layout (32-bit word count, modulus, exponent),
  not PEM.
- Legacy TCP `5555` is unencrypted by design; the transport is link-local. There is no ADB over TLS
  in this app.
- One persistent connection carries shell commands; capture has its own stream so a long-running
  `screenrecord` cannot block input.

## Authorising once, not every time

TellyMote does **not** create a separate ADB identity when a standard one already exists. On connect
it reads `%USERPROFILE%\.android\adbkey` and `adbkey.pub` (the key adb, scrcpy and Android Studio
use), verifies that the private key matches the public blob, and stores that identity in its
encrypted vault. The TV already trusts that key, so there is no new prompt for TellyMote.

- It never writes to `~/.android`; the private key is only copied into the DPAPI-encrypted vault.
- If no standard key exists, one is generated and kept in the vault. Accept the TV prompt **once**
  and tick **“Always allow from this computer”**.
- The TV, not the app, decides how long that trust lasts. It can ask again after you choose
  **Revoke USB debugging authorizations**, after a firmware reset, or on firmware that does not
  persist `adb_keys` across reboots.
- Two different ADB clients with two different keys will each be asked once. Sharing the standard
  key is what makes it a single approval for all of them.

### Commands used

| Purpose | Command |
| --- | --- |
| Key injection fallback | `input keyevent <code>` |
| Text | `input text <shell-quoted>` |
| Installed apps | `pm list packages`, then labels where available |
| Launch | `monkey -p <pkg> -c android.intent.category.LEANBACK_LAUNCHER 1`, then `monkey -p <pkg> 1` |
| Device info | `getprop ro.product.model`, `ro.build.version.release`, `ro.build.version.sdk`, `wm size` |
| Screenshot | `screencap -p` (PNG over the shell stream) |
| Continuous video | `screenrecord --output-format=h264 --time-limit 180 --bit-rate <n> -` |
| Capture timing | `date +%s%N` brackets around `screencap` |

No command writes to the TV's storage, changes settings, installs packages or reboots the device.

## Authorising the key

1. Enable Developer options on the TV (About → Build ×7).
2. Enable USB debugging / Network debugging.
3. In TellyMote, reconnect the device (or press **Reconnect & authorise** in Apps). The first
   connection sends the public key.
4. The TV shows a fingerprint. Compare it with the one in the app before approving.
5. The key stays authorised until it is revoked in the TV's Developer options or the app's data is
   deleted.

The private key is generated on first use and stored encrypted with Windows DPAPI
(`safeStorage`). If DPAPI is unavailable the app keeps it in memory for the session and shows a
security warning in Diagnostics.

## Capture specifics and limits

- `screenrecord` encodes at the TV's hardware encoder. On a Mi TV 4A the practical ceiling is
  720p–1080p at a few Mbit/s; the app starts at the profile bitrate and backs off if frames are late.
- `screenrecord` has a **180-second limit** per invocation; the app restarts the stream and the
  renderer resets its decoder cleanly.
- DRM-protected video surfaces may be black in the capture. That is the platform protecting content;
  TellyMote does not attempt to bypass it and reports the limitation.
- Audio capture is **not** offered: `screenrecord` audio capture is not available on this class of
  device, and the app does not claim it.
- If `screenrecord` refuses `--output-format=h264`, the app falls back to `screencap` and labels the
  feed as a screenshot feed.

## Revoking access

- TV: Developer options → revoke USB debugging authorisations, or delete the key entry.
- App: `Disconnect` and forget the device; or delete `%APPDATA%\TellyMote` to remove all keys.
- Nothing is left listening on the TV after the app closes; there is no agent or receiver installed.
