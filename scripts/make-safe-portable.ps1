# Builds a portable folder whose launcher is the stock Electron binary.
#
# electron-builder rewrites the app executable, which changes its hash. On
# machines with Windows Smart App Control enabled, that unfamiliar hash can be
# blocked. The stock electron.exe is already trusted, and Electron will load
# resources\app.asar next to it, so replacing the launcher makes the same app
# runnable without weakening any app-level security.
#
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\make-safe-portable.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$source = Join-Path $root "release\win-unpacked"
$target = Join-Path $root "release\win-unpacked-safe"
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"
$zip = Join-Path $root "release\TellyMote-$version-portable-safe.zip"

if (-not (Test-Path $source)) { throw "Run 'npm run package' first; $source is missing." }
if (-not (Test-Path $electron)) {
  Write-Host "Electron binary missing; running its installer."
  Push-Location (Join-Path $root "node_modules\electron")
  node install.js
  Pop-Location
}
if (-not (Test-Path $electron)) { throw "Electron binary not found at $electron." }

Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $source $target -Recurse
Copy-Item $electron (Join-Path $target "TellyMote.exe") -Force
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $target "*") -DestinationPath $zip -CompressionLevel Optimal -Force

Write-Host "Wrote $zip"
Write-Host "Launcher SHA-256: $((Get-FileHash (Join-Path $target 'TellyMote.exe') -Algorithm SHA256).Hash)"
