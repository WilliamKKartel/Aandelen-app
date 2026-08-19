# Start-App.ps1
# Start de lokale beleggings-app (server.py) en opent hem in je browser.
# Alternatief voor Start-App.bat, voor als je liever PowerShell gebruikt.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root 'app\server.py'

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $py) {
    Write-Host 'Python is niet gevonden. Installeer Python 3 (python.org) of gebruik Start-App.bat.' -ForegroundColor Red
    exit 1
}

Write-Host 'Mijn Beleggingen wordt gestart... je browser opent zo.' -ForegroundColor Green
Write-Host 'Laat dit venster open staan. Stoppen? Druk Ctrl+C.' -ForegroundColor DarkGray
& $py $server
