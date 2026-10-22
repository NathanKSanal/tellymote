# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
**Report a vulnerability** form (Security → Advisories) on this repository, or contact the maintainer
privately. Include the affected version, platform, and reproduction steps. You should get an
acknowledgement within a few days.

See [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md) for the 1.2.0 review, fixed findings and residual risks.

## What this app can do

LumaRemote talks directly to a TV on your LAN. With ADB authorised, it can inject input, read
packages, and capture the screen. That is equivalent to giving a debugger access to the TV. Treat an
authorised ADB connection as sensitive.

- The app never opens a listening socket on the LAN. The frame server binds `127.0.0.1` only and
  requires a per-run token.
- **Roku ECP is unauthenticated by design.** Any device on the same LAN can send the same HTTP
  commands to port 8060. Use it only on a trusted network; there is no pairing or token to protect it.
- No telemetry, cloud relay, account, or update check exists.
- Pairing certificates, the ADB private key and router secrets are stored through Electron
  `safeStorage` (DPAPI on Windows). If the OS cannot encrypt, secrets stay in memory for the session
  and are never written in plaintext.
- Diagnostic exports redact keys, pairing codes, tokens and (by default) IP addresses.
- ADB is optional. Nothing is enabled or installed on the TV silently.

## Scope

- Supported: the current release on Windows 10/11 x64 with Android TV / Google TV devices.
- Out of scope: vulnerabilities in the TV firmware or in ADB itself; physical access attacks; users
  who expose the app's data folder or an ADB port to an untrusted network.
