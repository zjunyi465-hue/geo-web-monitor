$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Please install Node.js 24+ first.' }
& node scripts/check-env.mjs
if ($LASTEXITCODE -ne 0) { throw 'Environment check failed. See docs/quickstart.md.' }
Write-Host 'Keep this terminal open. Press Ctrl+C to stop GEO Web Monitor.'
& node src/server.js
exit $LASTEXITCODE
