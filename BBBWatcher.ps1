# BBBWatcher.ps1
# Volgt meerdere beleggingsbronnen en stuurt een Telegram-melding bij nieuws:
#  - WordPress-blogs (zoals Blondjes Beleggen Beter): nieuwe posts, met TRADE ALERT
#    als de post over kopen/verkopen gaat
#  - RSS-feeds (zoals de Jong Beleggen podcast): nieuwe afleveringen
#  - SEC EDGAR: nieuwe 13F-kwartaalrapporten van bekende beleggers (verplichte,
#    officiele publicatie van al hun aandelenposities)
#
# Bronnen staan in config.json en zijn daar makkelijk aan te passen.
#
# Gebruik:
#   .\BBBWatcher.ps1          normale run (via Taakplanner elke 5 min)
#   .\BBBWatcher.ps1 -Test    stuurt een testbericht naar Telegram

param(
    [switch]$Test
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root 'config.json'
$statePath  = Join-Path $root 'state.json'
$logPath    = Join-Path $root 'watcher.log'
$alertsPath = Join-Path $root 'data\alerts.json'

# Deze link opent de Saxo Investor-app op je telefoon (app links), of anders de website
$saxoUrl = 'https://www.saxoinvestor.nl/investor'

# Woorden die erop wijzen dat een blogpost over een trade gaat
$tradePattern = 'koop|kocht|verkoop|verkocht|instap|uitstap|bijgekocht|order|winst genomen|aandeel gekocht'

# Max aantal meldingen per bron per run (tegen berichtenstortvloed)
$maxPerSource = 3

function Write-Log([string]$msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    $line | Out-File -FilePath $logPath -Append -Encoding utf8
}

function ConvertTo-PlainText([string]$html) {
    if (-not $html) { return '' }
    $t = $html -replace '<[^>]+>', ' '
    $t = [System.Net.WebUtility]::HtmlDecode($t)
    return ($t -replace '\s+', ' ').Trim()
}

function Escape-TelegramHtml([string]$s) {
    return ($s -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;')
}

function Send-Telegram([string]$text) {
    $uri = 'https://api.telegram.org/bot{0}/sendMessage' -f $config.telegramBotToken
    $payload = @{
        chat_id                  = $config.telegramChatId
        text                     = $text
        parse_mode               = 'HTML'
        disable_web_page_preview = $true
    } | ConvertTo-Json
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes | Out-Null
}

# Schrijft een melding ook naar de app (data/alerts.json), zodat je ze
# in het Meldingen-tabblad terugziet. Faalt dit, dan gaat de rest gewoon door.
function Add-AppAlert([hashtable]$a) {
    try {
        $dataDir = Join-Path $root 'data'
        if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
        $list = @()
        if (Test-Path $alertsPath) {
            try { $list = @(Get-Content $alertsPath -Raw | ConvertFrom-Json) } catch { $list = @() }
        }
        $a['time'] = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $list = @([pscustomobject]$a) + $list
        if ($list.Count -gt 100) { $list = $list[0..99] }
        $list | ConvertTo-Json -Depth 5 | Out-File -FilePath $alertsPath -Encoding utf8
    } catch { }
}

# --- Config laden ---
if (-not (Test-Path $configPath)) {
    Write-Host 'config.json ontbreekt. Zie README.md.'
    exit 1
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json
if (-not $config.telegramBotToken -or $config.telegramBotToken -like '*VUL_HIER*') {
    Write-Host 'Vul eerst je bot-token en chat-ID in config.json in (zie README.md).'
    exit 1
}

if ($Test) {
    Send-Telegram ("Testbericht van je Trade Alert watcher. Als je dit leest werkt de koppeling!`n`nSaxo Investor: $saxoUrl")
    Write-Host 'Testbericht verstuurd. Check je Telegram.'
    exit 0
}

# --- State laden (per bron een lijst met geziene ids) ---
$stateMap = @{}
if (Test-Path $statePath) {
    $rawState = Get-Content $statePath -Raw | ConvertFrom-Json
    if ($rawState.PSObject.Properties.Name -contains 'seenIds') {
        # migratie vanaf oud formaat: dat waren de ids van Blondjes Beleggen Beter
        $stateMap['bbb'] = @($rawState.seenIds | ForEach-Object { [string]$_ })
    } elseif ($rawState.PSObject.Properties.Name -contains 'sources') {
        foreach ($p in $rawState.sources.PSObject.Properties) {
            $stateMap[$p.Name] = @($p.Value | ForEach-Object { [string]$_ })
        }
    }
}

function Save-State {
    @{ sources = $stateMap } | ConvertTo-Json -Depth 5 | Out-File -FilePath $statePath -Encoding utf8
}

# Verwerkt een lijst items (nieuwste eerst) voor een bron.
# Elk item: @{ Id=..; Message=.. (kant-en-klare Telegram-tekst); Label=.. (voor log) }
function Process-Source([string]$key, [string]$displayName, [array]$items) {
    if ($items.Count -eq 0) { return }

    if (-not $stateMap.ContainsKey($key)) {
        # eerste keer dat deze bron draait: alles als gezien markeren, kort melden
        $stateMap[$key] = @($items | ForEach-Object { [string]$_.Id })
        Send-Telegram ("&#9989; Nieuwe bron actief: <b>" + (Escape-TelegramHtml $displayName) + "</b>`nJe krijgt vanaf nu een melding bij nieuws van deze bron.")
        Write-Log ('Bron geinitialiseerd: {0} ({1} items gemarkeerd als gezien)' -f $key, $items.Count)
        return
    }

    $seen = $stateMap[$key]
    $new = @($items | Where-Object { $seen -notcontains [string]$_.Id })
    if ($new.Count -eq 0) { return }
    if ($new.Count -gt $maxPerSource) { $new = $new[0..($maxPerSource - 1)] }
    [array]::Reverse($new)

    foreach ($item in $new) {
        Send-Telegram $item.Message
        Add-AppAlert @{ kind = $item.Kind; title = $item.Label; source = $displayName; link = $item.Link }
        Write-Log ('Melding verstuurd [{0}] {1}' -f $key, $item.Label)
        $stateMap[$key] = @($stateMap[$key]) + [string]$item.Id
    }
    if ($stateMap[$key].Count -gt 100) { $stateMap[$key] = $stateMap[$key][-100..-1] }
}

$hadError = $false

# --- 1. WordPress-bronnen ---
foreach ($src in @($config.wordpressSources)) {
    if (-not $src) { continue }
    try {
        $posts = Invoke-RestMethod -Uri $src.api -UserAgent 'Mozilla/5.0 (BBBWatcher)' -TimeoutSec 30
        $items = @()
        foreach ($post in $posts) {
            $title   = ConvertTo-PlainText $post.title.rendered
            $excerpt = ConvertTo-PlainText $post.excerpt.rendered
            $content = ConvertTo-PlainText $post.content.rendered
            if ($excerpt.Length -gt 300) { $excerpt = $excerpt.Substring(0, 300) + '...' }

            $isTrade = ($title -match $tradePattern) -or ($excerpt -match $tradePattern) -or ($content -match $tradePattern)
            if ($title -match $tradePattern) {
                $kop = '&#128680; <b>TRADE ALERT - ' + (Escape-TelegramHtml $src.name) + '</b>'
            } elseif ($isTrade) {
                $kop = '&#9888;&#65039; <b>Mogelijke trade - ' + (Escape-TelegramHtml $src.name) + '</b>'
            } else {
                $kop = '&#128240; <b>Nieuwe post - ' + (Escape-TelegramHtml $src.name) + '</b>'
            }

            $datum = ([datetime]$post.date).ToString('dd-MM-yyyy HH:mm')
            $msg = @(
                $kop
                ''
                ('<b>' + (Escape-TelegramHtml $title) + '</b>')
                $datum
                ''
                (Escape-TelegramHtml $excerpt)
                ''
                ('&#128073; Lees de post: ' + $post.link)
                ('&#128188; Zelf handelen? Saxo Investor: ' + $saxoUrl)
            ) -join "`n"

            $items += @{ Id = $post.id; Message = $msg; Label = $title; Link = $post.link; Kind = $(if ($isTrade) { 'trade' } else { 'post' }) }
        }
        Process-Source $src.key $src.name $items
    } catch {
        $hadError = $true
        Write-Log ('FOUT bij bron {0}: {1}' -f $src.key, $_.Exception.Message)
    }
}

# --- 2. RSS-bronnen (podcasts e.d.) ---
foreach ($src in @($config.rssSources)) {
    if (-not $src) { continue }
    try {
        $resp = Invoke-WebRequest -Uri $src.url -UserAgent 'Mozilla/5.0 (BBBWatcher)' -TimeoutSec 30 -UseBasicParsing
        [xml]$xml = $resp.Content
        $rssItems = @($xml.rss.channel.item) | Select-Object -First 10
        $items = @()
        foreach ($it in $rssItems) {
            $id = $null
            if ($it.guid) {
                if ($it.guid -is [string]) { $id = $it.guid } else { $id = $it.guid.'#text' }
            }
            if (-not $id) { $id = [string]$it.link }
            $title = ConvertTo-PlainText ([string]$it.title)
            $link  = [string]$it.link

            $msg = @(
                ('&#127908; <b>Nieuwe aflevering - ' + (Escape-TelegramHtml $src.name) + '</b>')
                ''
                ('<b>' + (Escape-TelegramHtml $title) + '</b>')
                ''
                ('&#128073; Luister/lees: ' + $link)
            ) -join "`n"

            $items += @{ Id = $id; Message = $msg; Label = $title; Link = $link; Kind = 'podcast' }
        }
        Process-Source $src.key $src.name $items
    } catch {
        $hadError = $true
        Write-Log ('FOUT bij bron {0}: {1}' -f $src.key, $_.Exception.Message)
    }
}

# --- 3. SEC 13F-kwartaalrapporten (verplichte publicatie van aandelenposities) ---
foreach ($filer in @($config.secFilers)) {
    if (-not $filer) { continue }
    try {
        $cikPadded = ('{0:D10}' -f [long]$filer.cik)
        $uri = 'https://data.sec.gov/submissions/CIK{0}.json' -f $cikPadded
        $data = Invoke-RestMethod -Uri $uri -UserAgent 'BBBWatcher personal-use williamkoedijk@hotmail.com' -TimeoutSec 30
        $recent = $data.filings.recent

        $items = @()
        for ($i = 0; $i -lt @($recent.form).Count -and $items.Count -lt 5; $i++) {
            if ($recent.form[$i] -notlike '13F-HR*') { continue }
            $acc = $recent.accessionNumber[$i]
            $accNoDash = $acc -replace '-', ''
            $link = 'https://www.sec.gov/Archives/edgar/data/{0}/{1}/{2}-index.htm' -f [long]$filer.cik, $accNoDash, $acc

            $msg = @(
                ('&#128202; <b>Kwartaalupdate (13F) - ' + (Escape-TelegramHtml $filer.name) + '</b>')
                ''
                'Alle actuele aandelenposities zijn zojuist officieel gepubliceerd bij de SEC.'
                ('Ingediend op: ' + $recent.filingDate[$i])
                ''
                ('&#128073; Bekijk het rapport: ' + $link)
                ('&#128188; Zelf handelen? Saxo Investor: ' + $saxoUrl)
            ) -join "`n"

            $items += @{ Id = $acc; Message = $msg; Label = ($filer.name + ' 13F ' + $recent.filingDate[$i]); Link = $link; Kind = 'sec' }
        }
        Process-Source ('sec-' + $cikPadded) $filer.name $items
    } catch {
        $hadError = $true
        Write-Log ('FOUT bij SEC-bron {0}: {1}' -f $filer.name, $_.Exception.Message)
    }
}

# --- 4. Portefeuille-bewaking (eigen posities uit config.portfolio) ---
# Alarmen: flinke dagdaling, daling vanaf aankoopprijs, en uitstroom-signaal
# (extreem hoog volume + dalende koers). Max 1 alarm per type per aandeel per dag.
$dailyDropPct = 5;   if ($config.alertDailyDropPct)  { $dailyDropPct = [double]$config.alertDailyDropPct }
$buyDropPct   = 15;  if ($config.alertBuyDropPct)    { $buyDropPct   = [double]$config.alertBuyDropPct }
$volumeFactor = 2.5; if ($config.alertVolumeFactor)  { $volumeFactor = [double]$config.alertVolumeFactor }

if (-not $stateMap.ContainsKey('portfolio-alerts')) { $stateMap['portfolio-alerts'] = @() }
$vandaag = Get-Date -Format 'yyyy-MM-dd'

# Portefeuille lezen: eerst uit data/holdings.json (beheerd via de app),
# anders terugvallen op config.portfolio. Zo lopen de koersalarmen automatisch
# mee met de aandelen die je in de app hebt gezet.
$holdingsPath = Join-Path $root 'data\holdings.json'
$positions = @()
if (Test-Path $holdingsPath) {
    try { $positions = @(Get-Content $holdingsPath -Raw | ConvertFrom-Json) } catch { $positions = @() }
}
if (-not $positions -or $positions.Count -eq 0) { $positions = @($config.portfolio) }

foreach ($pos in $positions) {
    if (-not $pos) { continue }
    try {
        $uri = 'https://query1.finance.yahoo.com/v8/finance/chart/{0}?range=3mo&interval=1d' -f $pos.ticker
        $d = Invoke-RestMethod -Uri $uri -UserAgent 'Mozilla/5.0 (BBBWatcher)' -TimeoutSec 30
        $res = $d.chart.result[0]
        $meta = $res.meta
        $price = [double]$meta.regularMarketPrice
        $valuta = $meta.currency

        # vorige slotkoers bepalen (laatste handelsdag voor vandaag)
        $timestamps = @($res.timestamp)
        $closes = @($res.indicators.quote[0].close)
        $vols   = @($res.indicators.quote[0].volume)
        $validCloses = @(); $validVols = @()
        for ($i = 0; $i -lt $closes.Count; $i++) {
            if ($null -ne $closes[$i]) { $validCloses += ,@($timestamps[$i], [double]$closes[$i]) }
            if ($null -ne $vols[$i] -and $vols[$i] -gt 0) { $validVols += ,@($timestamps[$i], [double]$vols[$i]) }
        }
        if ($validCloses.Count -lt 2) { continue }
        $lastTsDate = ([DateTimeOffset]::FromUnixTimeSeconds($validCloses[-1][0])).LocalDateTime.Date
        if ($lastTsDate -eq (Get-Date).Date) { $prevClose = $validCloses[-2][1] } else { $prevClose = $validCloses[-1][1] }
        $dayChange = ($price / $prevClose - 1) * 100

        # gemiddeld dagvolume (zonder de laatste, mogelijk nog lopende, dag)
        $avgVol = 0
        if ($validVols.Count -gt 5) {
            $sum = 0.0
            for ($i = 0; $i -lt $validVols.Count - 1; $i++) { $sum += $validVols[$i][1] }
            $avgVol = $sum / ($validVols.Count - 1)
        }
        $todayVol = [double]$meta.regularMarketVolume

        $alerts = @()
        if ($dayChange -le -$dailyDropPct) {
            $alerts += ,@('dag', ('&#128201; <b>DAGDALING: {0}</b>`nKoers: {1} {2} ({3}% vandaag)' -f $pos.name, [math]::Round($price,2), $valuta, [math]::Round($dayChange,1)))
        }
        if ($pos.buyPrice -and $price -le ([double]$pos.buyPrice * (1 - $buyDropPct / 100))) {
            $vanafKoop = ($price / [double]$pos.buyPrice - 1) * 100
            $alerts += ,@('aankoop', ('&#128680; <b>ONDER JE AANKOOPPRIJS: {0}</b>`nKoers: {1} {2}, dat is {3}% onder jouw aankoopprijs van {4}' -f $pos.name, [math]::Round($price,2), $valuta, [math]::Round([math]::Abs($vanafKoop),1), $pos.buyPrice))
        }
        if ($avgVol -gt 0 -and $todayVol -ge ($volumeFactor * $avgVol) -and $dayChange -lt -2) {
            $alerts += ,@('volume', ('&#127926; <b>UITSTROOM-SIGNAAL: {0}</b>`nHandelsvolume is vandaag {1}x het normale gemiddelde terwijl de koers {2}% daalt. Veel beleggers stappen mogelijk uit - zoek uit waarom.' -f $pos.name, [math]::Round($todayVol / $avgVol,1), [math]::Round($dayChange,1)))
        }

        foreach ($a in $alerts) {
            $alertId = '{0}|{1}|{2}' -f $pos.ticker, $a[0], $vandaag
            if ($stateMap['portfolio-alerts'] -contains $alertId) { continue }
            $msg = @(
                ($a[1] -replace '`n', "`n")
                ''
                'Denk aan je eigen regel: een koersdaling zonder bedrijfsnieuws is geen verkoopreden. Pak je koopbesluit-bestand erbij en check of er iets aan het BEDRIJF veranderd is.'
                ''
                ('&#128073; Nieuws en koers: https://finance.yahoo.com/quote/' + $pos.ticker)
                ('&#128188; Saxo Investor: ' + $saxoUrl)
            ) -join "`n"
            Send-Telegram $msg
            Add-AppAlert @{ kind = 'portfolio'; subtype = $a[0]; title = $pos.name; ticker = $pos.ticker; link = ('https://finance.yahoo.com/quote/' + $pos.ticker) }
            Write-Log ('Portefeuille-alarm [{0}] {1}' -f $alertId, $pos.name)
            $stateMap['portfolio-alerts'] = @($stateMap['portfolio-alerts']) + $alertId
        }
    } catch {
        $hadError = $true
        Write-Log ('FOUT bij portefeuille-check {0}: {1}' -f $pos.ticker, $_.Exception.Message)
    }
}
if ($stateMap['portfolio-alerts'].Count -gt 300) { $stateMap['portfolio-alerts'] = $stateMap['portfolio-alerts'][-300..-1] }

Save-State
if ($hadError) { exit 1 }
