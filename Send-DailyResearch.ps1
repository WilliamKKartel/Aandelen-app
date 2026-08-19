# Send-DailyResearch.ps1
# Laat Claude (headless) dagelijks beursonderzoek doen volgens research-prompt.txt
# en stuurt het resultaat als Telegram-bericht via de bestaande bot.
#
# Vereist eenmalig: inloggen van de Claude CLI (zie README.md).

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root 'config.json'
$promptPath = Join-Path $root 'research-prompt.txt'
$logPath    = Join-Path $root 'research.log'

function Write-Log([string]$msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    $line | Out-File -FilePath $logPath -Append -Encoding utf8
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json

# Houd de pc wakker zolang dit script draait (anders valt een uit slaapstand
# gewekte laptop halverwege het onderzoek weer in slaap en sterft de run)
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class KeepAwake {
    [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
}
'@
[void][KeepAwake]::SetThreadExecutionState([uint32]'0x80000001')  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED

function Send-Telegram([string]$text) {
    $uri = 'https://api.telegram.org/bot{0}/sendMessage' -f $config.telegramBotToken
    $payload = @{
        chat_id                  = $config.telegramChatId
        text                     = $text
        disable_web_page_preview = $true
    } | ConvertTo-Json
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes | Out-Null
}

# Verstuur lange teksten in stukken (Telegram-limiet is 4096 tekens)
function Send-TelegramChunked([string]$text) {
    $max = 3800
    while ($text.Length -gt $max) {
        $cut = $text.LastIndexOf("`n", $max)
        if ($cut -lt 500) { $cut = $max }
        Send-Telegram $text.Substring(0, $cut)
        $text = $text.Substring($cut).TrimStart()
    }
    if ($text.Length -gt 0) { Send-Telegram $text }
}

# --- Claude CLI vinden (pad verandert per versie, daarom met joker) ---
$exe = $null
foreach ($p in @(
    "$env:LOCALAPPDATA\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\*\claude.exe",
    "$env:LOCALAPPDATA\AnthropicClaude\app-*\claude.exe",
    "$env:LOCALAPPDATA\AnthropicClaude\claude.exe",
    "$env:LOCALAPPDATA\Programs\Claude\claude.exe")) {
    $m = Get-ChildItem $p -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    if ($m) { $exe = $m.FullName; break }
}
if (-not $exe) {
    $cmd = Get-Command claude -ErrorAction SilentlyContinue
    if ($cmd) { $exe = $cmd.Source }
}
if (-not $exe) {
    Write-Log 'FOUT: claude.exe niet gevonden.'
    Send-Telegram 'Dagelijks onderzoek mislukt: claude.exe niet gevonden op de pc.'
    exit 1
}

# --- Onderzoek draaien ---
Write-Log ('Onderzoek gestart met ' + $exe)
$prompt = [IO.File]::ReadAllText($promptPath, [Text.Encoding]::UTF8)
$prompt = $prompt + "`n`nDatum van vandaag: " + (Get-Date -Format 'dddd d MMMM yyyy')

# Sonnet is ruim voldoende voor dit dagelijkse onderzoek en spaart je tegoed
$output = $prompt | & $exe -p --model sonnet --allowedTools 'WebSearch,WebFetch' 2>&1 | Out-String
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0 -or -not $output.Trim()) {
    Write-Log ('FOUT: onderzoek mislukt (exit {0}): {1}' -f $exitCode, $output.Trim())
    Send-Telegram ('Dagelijks onderzoek is vandaag mislukt. Foutmelding: ' + $output.Trim().Substring(0, [Math]::Min(300, $output.Trim().Length)))
    exit 1
}

# Output splitsen: alles VOOR ===DATA=== is het Telegram-bericht (zoals altijd),
# daarna komt (optioneel) een JSON-blok dat de app voedt (data/research-latest.json).
# Mislukt het JSON-deel, dan gaat Telegram gewoon door - de app houdt zijn vorige data.
$full = $output.Trim()
$idx = $full.IndexOf('===DATA===')
if ($idx -ge 0) {
    $telegramText = $full.Substring(0, $idx).Trim()
    $jsonRaw = $full.Substring($idx + '===DATA==='.Length).Trim()
    $jsonRaw = ($jsonRaw -replace '^```json', '' -replace '^```', '' -replace '```$', '').Trim()
    try {
        $obj = $jsonRaw | ConvertFrom-Json
        $obj | Add-Member -NotePropertyName generatedAt -NotePropertyValue (Get-Date -Format 's') -Force
        $obj | Add-Member -NotePropertyName isSeed -NotePropertyValue $false -Force
        $dataDir = Join-Path $root 'data'
        if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
        $obj | ConvertTo-Json -Depth 10 | Out-File -FilePath (Join-Path $dataDir 'research-latest.json') -Encoding utf8
        Write-Log 'App-data (research-latest.json) bijgewerkt.'
    } catch {
        Write-Log ('DATA-blok niet leesbaar; app-data niet bijgewerkt: ' + $_.Exception.Message)
    }
} else {
    $telegramText = $full
}

$bericht = "🔬 DAGELIJKS BEURSONDERZOEK`n`n" + $telegramText
Send-TelegramChunked $bericht
Write-Log ('Onderzoeksrapport verstuurd ({0} tekens).' -f $telegramText.Length)
[void][KeepAwake]::SetThreadExecutionState([uint32]'0x80000000')  # wakker-houden weer loslaten
