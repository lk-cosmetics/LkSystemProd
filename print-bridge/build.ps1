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
    --name TP80BEPrintBridge `
    --collect-all escpos `
    --collect-submodules win32 `
    --collect-submodules uvicorn `
    --hidden-import win32print `
    --hidden-import win32api `
    --hidden-import win32com `
    main.py

if (-not (Test-Path "dist\config.json")) {
    Copy-Item "config.example.json" "dist\config.json"
}

Write-Host ""
Write-Host "Build complete:" -ForegroundColor Green
Write-Host "  $Root\dist\TP80BEPrintBridge.exe"
Write-Host "  $Root\dist\config.json"
Write-Host ""
Write-Host "Edit dist\config.json for printer_name, print_token, allowed_origins."
