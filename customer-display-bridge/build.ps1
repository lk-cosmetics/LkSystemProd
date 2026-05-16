$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Test-Path ".venv")) {
    python -m venv .venv
}

.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\pip.exe install -r requirements.txt

.\.venv\Scripts\pyinstaller.exe `
    --onefile `
    --clean `
    --name LED8Bridge `
    --collect-submodules serial `
    --collect-submodules uvicorn `
    main.py

if (-not (Test-Path "dist\config.json")) {
    Copy-Item "config.example.json" "dist\config.json"
}

Write-Host ""
Write-Host "Build complete:" -ForegroundColor Green
Write-Host "  $Root\dist\LED8Bridge.exe"
Write-Host "  $Root\dist\config.json"
Write-Host ""
Write-Host "Edit dist\config.json for serial_port, baud_rate, display_token, allowed_origins."
