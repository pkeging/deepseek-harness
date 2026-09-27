$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$env:DSH_ROOT = (Resolve-Path (Join-Path $scriptDir "..")).Path
$env:DSH_MULTIUSER_DATA = Join-Path $scriptDir "data"
$env:DSH_MULTIUSER_HOST = "127.0.0.1"
$env:DSH_MULTIUSER_PORT = "4000"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  52kg Harness Multi-User Proxy" -ForegroundColor Cyan
Write-Host "  DSH_ROOT: $env:DSH_ROOT" -ForegroundColor Gray
Write-Host "  DATA:     $env:DSH_MULTIUSER_DATA" -ForegroundColor Gray
Write-Host "  URL:      http://$env:DSH_MULTIUSER_HOST:$env:DSH_MULTIUSER_PORT" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

node src/index.js
