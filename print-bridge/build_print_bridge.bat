@echo off
REM Wrapper that calls the PowerShell build script.
powershell -ExecutionPolicy Bypass -File "%~dp0build.ps1"
