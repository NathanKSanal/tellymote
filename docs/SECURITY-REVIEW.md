# Security review — 1.2.0

A focused review of the Electron boundary, IPC surface, local frame server, secret handling and
input validation. It is not a formal penetration test and no fuzzing was performed.

## Threat model

- The renderer is untrusted in the sense that a bug or injected string must not gain Node access.
- The LAN is trusted for discovery, but an arbitrary host on it must not be able to read captured
  frames or drive the TV without the user's intent.
- The TV itself is untrusted: its responses and files must not crash the app or escape bounds.
- Secrets (pairing key, ADB private key, pinned certificates) must not be written in plaintext or
  logged.

## Findings fixed

| Severity | Finding | Fix |
| --- | --- | --- |
| High | `isTrustedSender` accepted **any** `file://` URL, and `will-navigate` allowed navigation to any local file. A local HTML file could load in the window and inherit the preload bridge. | Trust is now the exact packaged `dist/index.html` path (or the dev-server origin). Navigation elsewhere is blocked. |
| Medium | `remote:key` cast an arbitrary string to `RemoteKey`; an unknown key could reach the encoder. | The IPC handler and `sendKey` validate against `KEY_CODES`. |
| Medium | Renderer-supplied `renderMs`, `dropped`, width, height and fps were stored without bounds. | Clamped in `main.ts` and again in `CaptureService.noteRender`. |
| Medium | Frame-server token compared with `!==` (timing signal). | `crypto.timingSafeEqual` with a length check. |
| Medium | Frame server accepted any `Host` header, allowing DNS-rebinding style access if a token leaked. | Only `127.0.0.1:<port>` is accepted (421 otherwise). |
| Low | Frame server accepted methods other than GET and unbounded long-poll waiters. | GET only (405); at most 8 waiters (429). |
| Low | Renderer sandbox was per-window; webview and insecure-content flags were implicit. | `app.enableSandbox()`, `webviewTag: false`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`. |
| Low | Device card's “Open controls” button had no handler when rendered from Devices. | Devices now passes a navigation handler; the button opens Remote. |

## Verified controls already present

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes one allowlisted invoke channel and allowlisted events only.
- Strict CSP in packaged builds; no remote origins; `object-src 'none'`, `base-uri 'none'`.
- `window.open` denied; only `https://` links are handed to the OS browser.
- Frame server binds `127.0.0.1`, ephemeral port, 24-byte per-run token, no LAN listener.
- Secrets use Electron `safeStorage`; if unavailable they stay in memory and are not written.
- Diagnostic export redacts secret-looking keys and IP addresses by default.
- ADB is optional and never enabled or installed silently; the standard `~/.android` key is reused
  only when it already exists and its public blob matches the private key.

## Residual risks

- **Roku ECP is unauthenticated.** Any host on the LAN can send the same commands to port 8060.
  This is a protocol property, documented in `SECURITY.md`.
- **ADB is powerful.** An authorised debugging connection can read packages and capture the screen.
  Users should disable debugging when not needed.
- **Unsigned build.** Smart App Control may block the packaged launcher; see `docs/BUILD.md`.
- No fuzzing of SSDP/mDNS/ADB frame parsers; those parsers do enforce length bounds but were not
  fuzzed.
