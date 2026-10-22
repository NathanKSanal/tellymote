# Build, test and packaging

## Toolchain

| Tool | Version used | Notes |
| --- | --- | --- |
| Node.js | 24.19.0 (20+ works) | ESM scripts, native `fetch`, WebCrypto |
| npm | 11.17.0 | lockfile committed |
| Electron | 44.9.1 | Chromium + Node 24 runtime |
| Vite | 8.3.4 | renderer bundling, Tailwind 4 plugin |
| TypeScript | 5.9.3 | two projects: renderer + Electron |
| Vitest | 3.2.7 | node environment, forks pool |
| electron-builder | 26.15.3 | NSIS x64 installer |

No Rust, MSVC, Android SDK or platform-tools are required.

## Scripts

```powershell
npm install            # once
npm run dev            # Vite dev server + Electron, hot reload
npm run typecheck      # tsc renderer project + tsc Electron project
npm test               # 143 tests in 14 suites
npm run build          # vite build (dist/) + esbuild (dist-electron/)
npm start              # run the production build
npm run package        # build + electron-builder --win nsis
node scripts/make-icon.mjs   # regenerate build/icon.png
```

## What the build produces

```
dist/                     renderer: index.html + hashed JS/CSS
dist-electron/main.cjs    Electron main process (CJS bundle, electron external)
dist-electron/preload.cjs sandbox-safe contextBridge
release/win-unpacked/     runnable app directory
release/TellyMote-1.0.0-x64.exe   NSIS installer
```

esbuild bundles the main and preload entries with `platform: node`, `target: node22`, `format: cjs`
and `external: ['electron']`. No native modules are compiled, so there is no `@electron/rebuild`
step for app code and the installer works on a clean Windows machine.

`build/icon.png` (1024²) is generated procedurally by `scripts/make-icon.mjs` (PNG encoder over
`zlib`, no image dependency). electron-builder converts it to the EXE/installer icon and the file is
included in the asar so the tray can load it at runtime.

## TypeScript projects

| Project | Scope | Module settings |
| --- | --- | --- |
| `tsconfig.json` | `src/`, `shared/` | bundler resolution, DOM + WebCodecs |
| `tsconfig.electron.json` | `electron/`, `shared/`, tests | NodeNext, node types |

Run both with `npm run typecheck`. They are intentionally separate: the renderer must never gain
Node types.

## Tests

```powershell
npm test                       # all suites
npx vitest run tests/atv-client.test.ts
npx vitest run -t "pairing"
```

- Environment: `node`, pool `forks`, 20 s timeout.
- Mock servers bind ephemeral ports (`127.0.0.1:0`), so suites can run in parallel.
- TLS mocks use certificates minted in `tests/helpers/certs.ts`; ADB mocks implement the real packet
  framing and auth sequence; the frame server is exercised over real HTTP.
- Tests import production modules directly — there is no duplicated "test implementation".

Coverage by area: protobuf framing, ATV messages and feature negotiation, pairing state machine,
ATV client over TLS, ADB host protocol incl. RSA padding, certificates/secret derivation, frame
server semantics, settings sanitisation, capability honesty rules, Annex-B parsing, interface
ranking, vault and discovery packet parsing.

## Smoke test

```powershell
npx electron . --smoke
$env:LUMA_SMOKE_VIEWS='dashboard,devices,live,remote,apps,diagnostics,settings'
$env:LUMA_SMOKE_OUT='.smoke'
npx electron . --smoke
```

Smoke mode boots the real app, waits for each view, writes PNG screenshots and exits non-zero on a
missing view. It disables hardware acceleration because `webContents.capturePage()` returns
`UnknownVizError` on the GPU path in VMs and remote sessions. Smoke mode never scans the network.

## Packaging

`npm run package` runs the build then `electron-builder --win nsis`. Configuration lives in
`package.json → build`:

- appId `com.tellymote.app`, productName `TellyMote`, NSIS x64
- per-user install, selectable directory, desktop shortcut
- files: `dist/**`, `dist-electron/**`, `build/icon.png`, `package.json`

The installer is **not code-signed** (no certificate was available). Windows SmartScreen will warn on
first run. To sign, add a certificate and electron-builder's `win.certificateFile` /
`win.certificatePassword` (or Azure Trusted Signing) settings; no app code changes are needed.

### Smart App Control

If **Windows Security → App & browser control → Smart App Control** is On, Windows blocks unsigned
executables whose hash it does not recognise. electron-builder normally rewrites the Electron
launcher (icon, version resources, integrity), which changes its hash and makes it look unfamiliar.
`win.signAndEditExecutable` is therefore set to `false`: the packaged `TellyMote.exe` stays
byte-identical to the stock Electron binary, which Smart App Control already trusts. The trade-off is
that the file icon and version metadata are Electron's, not TellyMote's.

For distribution to other machines, buy a code-signing certificate (or use Azure Trusted Signing),
set `signAndEditExecutable` back to `true`, and sign both the app and the NSIS installer. A
self-signed certificate will **not** satisfy Smart App Control.

### Smart App Control-safe portable

Even with resource editing skipped, electron-builder's launcher hash can be unfamiliar to Smart App
Control on a specific machine. The stock `electron.exe` is already trusted and loads
`resources\app.asar` from its own folder, so a portable copy can use it as the launcher:

```powershell
npm run package
powershell -ExecutionPolicy Bypass -File .\scripts\make-safe-portable.ps1
# release\TellyMote-<version>-portable-safe.zip
```

The trade-off is that the file icon and version metadata are Electron's; the in-app window and tray
icons are still TellyMote's. This does not weaken the app: the same `app.asar`, CSP, sandbox and IPC
checks are used.



## Reproducing the documented environment check

```powershell
node -v; npm -v
Get-Command rustc,cargo,adb -ErrorAction SilentlyContinue
Get-NetIPConfiguration | Where-Object { $_.IPv4Address } | Select-Object InterfaceAlias, IPv4Address
Test-NetConnection 192.168.0.1 -Port 6466   # example probe
```

## Common build problems

| Problem | Cause | Fix |
| --- | --- | --- |
| `vite: not found` | dependencies not installed | `npm install` |
| `tsc` errors in `shared/` | both projects include shared code | fix in shared, then run both projects |
| Electron window is blank | `dist/` missing | `npm run build` before `npm start` |
| `capturePage` fails in smoke | GPU path in VM | already handled: smoke disables HW acceleration |
| Installer build downloads slowly | electron-builder fetches NSIS/winCodeSign | first run only; cached in `%LOCALAPPDATA%\electron-builder` |
| Antivirus flags the unsigned installer | no code-signing certificate | expected; sign the build for distribution |
