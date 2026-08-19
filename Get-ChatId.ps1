# Get-ChatId.ps1
# Haalt je Telegram chat-ID op. Stuur EERST een berichtje (bijv. "hoi") naar je
# bot in Telegram, en voer dan dit script uit. Het gevonden chat-ID wordt
# automatisch in config.json gezet.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root 'config.json'

$config = Get-Content $configPath -Raw | ConvertFrom-Json
if (-not $config.telegramBotToken -or $config.telegramBotToken -like '*VUL_HIER*') {
    Write-Host 'Vul eerst je bot-token in config.json in en probeer opnieuw.'
    exit 1
}

$resp = Invoke-RestMethod -Uri ('https://api.telegram.org/bot{0}/getUpdates' -f $config.telegramBotToken)
$chats = @($resp.result | ForEach-Object { $_.message.chat } | Where-Object { $_ } | Sort-Object id -Unique)

if ($chats.Count -eq 0) {
    Write-Host 'Geen berichten gevonden. Stuur eerst een berichtje naar je bot in Telegram en run dit script opnieuw.'
    exit 1
}

foreach ($chat in $chats) {
    Write-Host ('Gevonden chat: id={0} naam={1} {2}' -f $chat.id, $chat.first_name, $chat.username)
}

$config.telegramChatId = [string]$chats[0].id
$config | ConvertTo-Json | Out-File -FilePath $configPath -Encoding utf8
Write-Host ('Chat-ID {0} is opgeslagen in config.json.' -f $chats[0].id)
Write-Host 'Test nu de koppeling met:  .\BBBWatcher.ps1 -Test'
