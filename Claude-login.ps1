# Claude-login.ps1
# Logt de Claude CLI (die je app en dagelijks onderzoek gebruiken) opnieuw in.
# Opent een browser voor de inlog. Wordt aangeroepen door Claude-inloggen.bat.

$exe = (Get-ChildItem "$env:LOCALAPPDATA\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\*\claude.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName | Select-Object -Last 1).FullName
if (-not $exe) {
    $cmd = Get-Command claude -ErrorAction SilentlyContinue
    if ($cmd) { $exe = $cmd.Source }
}
if (-not $exe) {
    Write-Host 'claude.exe niet gevonden. Staat de Claude desktop-app geinstalleerd?' -ForegroundColor Red
    Read-Host 'Druk op Enter om te sluiten'
    exit 1
}

Write-Host 'Huidige status:' -ForegroundColor DarkGray
& $exe auth status
Write-Host ''
Write-Host 'Er opent zo een browser - log daar in met je Claude-account.' -ForegroundColor Green
Write-Host ''
& $exe auth login
Write-Host ''
Write-Host 'Nieuwe status:' -ForegroundColor DarkGray
& $exe auth status
Write-Host ''
Write-Host 'Klaar. Dit venster mag dicht.' -ForegroundColor DarkGray
Read-Host 'Druk op Enter om te sluiten'
