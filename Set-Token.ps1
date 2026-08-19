# Set-Token.ps1
# Vraagt om je Telegram-bottoken en slaat hem op in config.json.

$ErrorActionPreference = 'Stop'
$root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root 'config.json'

$t = Read-Host 'Plak hier je bot-token (van BotFather) en druk op Enter'
$t = $t.Trim()

if ($t -notmatch '^\d+:[A-Za-z0-9_-]+$') {
    Write-Host ''
    Write-Host 'Hmm, dat ziet er niet uit als een geldig token (verwacht: cijfers, dan een dubbele punt, dan letters/cijfers).'
    Write-Host 'Controleer of je het hele token hebt gekopieerd en run dit script opnieuw.'
    exit 1
}

$c = Get-Content $configPath -Raw | ConvertFrom-Json
$c.telegramBotToken = $t
$c | ConvertTo-Json | Set-Content $configPath -Encoding UTF8

Write-Host ''
Write-Host 'Token opgeslagen! Volgende stap: stuur je bot een berichtje ("hoi") in Telegram.'
