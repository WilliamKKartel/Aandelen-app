# Install-Task.ps1
# Registreert twee Windows Taakplanner-taken:
#  1. "BBB Trade Alert"        - draait BBBWatcher.ps1 elke 5 minuten (meldingen)
#  2. "BBB Dagelijks Onderzoek" - draait Send-DailyResearch.ps1 elke ochtend 08:00
# Beide alleen als je pc aan staat; gemiste runs worden ingehaald zodra hij aan gaat.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Standaardinstellingen; het dagelijkse onderzoek krijgt er -WakeToRun bij,
# zodat de pc uit slaapstand wakker wordt om het rapport te maken.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$settingsWake = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) -WakeToRun

function Install-Taak([string]$taskName, [string]$scriptFile, $trigger, [string]$omschrijving, $taskSettings = $null) {
    if (-not $taskSettings) { $taskSettings = $settings }
    $scriptPath = Join-Path $root $scriptFile
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath)

    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $taskSettings `
        -Description $omschrijving | Out-Null
    Write-Host ('Taak "{0}" is geregistreerd.' -f $taskName)
}

# 1. Watcher: elke 5 minuten
$watcherTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
Install-Taak 'BBB Trade Alert' 'BBBWatcher.ps1' $watcherTrigger `
    'Checkt beleggingsbronnen op nieuws en stuurt Telegram-meldingen.'

# 2. Dagelijks onderzoek: elke ochtend 08:00, maakt de pc wakker uit slaapstand
$researchTrigger = New-ScheduledTaskTrigger -Daily -At '08:00'
Install-Taak 'BBB Dagelijks Onderzoek' 'Send-DailyResearch.ps1' $researchTrigger `
    'Dagelijks beursonderzoek door Claude, resultaat via Telegram. Wekt de pc uit slaapstand.' $settingsWake

Write-Host ''
Write-Host 'Klaar! Meldingen: elke 5 min. Onderzoeksrapport: elke ochtend 08:00 (of zodra je pc daarna aan gaat).'
Write-Host 'Verwijderen kan met:  Unregister-ScheduledTask -TaskName "BBB Trade Alert"  (en/of "BBB Dagelijks Onderzoek")'
