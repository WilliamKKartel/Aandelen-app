# BBB Trade Alert 🚨

Krijg een Telegram-melding zodra **Blondjes Beleggen Beter** (Janneke Willemse)
een nieuwe post plaatst — met een duidelijke **TRADE ALERT** als de post over
kopen of verkopen gaat. In het bericht zit een link naar de post én naar
Saxo Investor, zodat jij de trade direct zelf kunt beoordelen en plaatsen.

## Hoe het werkt

- Haar trades verschijnen altijd als (gratis, openbare) blogpost op
  blondjesbeleggenbeter.nl.
- Dit script checkt elke 5 minuten via de site of er een nieuwe post is.
- Nieuwe post → Telegram-bericht met titel, samenvatting, link naar de post
  en link naar Saxo Investor.
- Posts met koop/verkoop-woorden krijgen het label 🚨 TRADE ALERT.

## Eenmalige installatie (± 5 minuten)

### Stap 1 — Maak een Telegram-bot

1. Open Telegram en zoek naar **@BotFather** (officiële bot met blauw vinkje).
2. Stuur `/newbot` en volg de stappen (kies een naam, bijv. `BBBTradeAlertBot`).
3. Je krijgt een **token**, iets als `1234567890:AAExxx...`. Kopieer die.

### Stap 2 — Vul het token in

Open `config.json` en plak je token bij `telegramBotToken` (tussen de quotes).

### Stap 3 — Koppel je eigen chat

1. Zoek in Telegram je nieuwe bot op en stuur hem een berichtje (bijv. "hoi").
2. Open PowerShell in deze map en run:

   ```powershell
   .\Get-ChatId.ps1
   ```

   Je chat-ID wordt automatisch in `config.json` gezet.

### Stap 4 — Test

```powershell
.\BBBWatcher.ps1 -Test
```

Je hoort binnen een paar seconden een Telegram-melding te krijgen.

### Stap 5 — Zet de automatische check aan

```powershell
.\Install-Task.ps1
```

Klaar! Vanaf nu checkt je pc elke 5 minuten en krijg je automatisch bericht.

## Goed om te weten

- **De meldingen werken alleen als je pc aan staat.** Tip: meld je op de site
  ook aan voor haar gratis e-mailservice als backup voor als je pc uit staat.
- **Trades plaats je altijd zelf** in Saxo Investor. Dit is bewust: zo houd
  jij de controle over je geld en beslis je per trade of je meedoet.
- Blind kopiëren heeft risico's: tegen de tijd dat de post online staat kan de
  koers al bewogen zijn, en haar situatie (inleg, spreiding, horizon) is niet
  dezelfde als die van jou. Gebruik de melding als signaal, niet als bevel.
- Logboek: `watcher.log` in deze map. Uitzetten kan met:
  `Unregister-ScheduledTask -TaskName "BBB Trade Alert"`

---

# 📊 De app: Mijn Beleggingen

Naast de Telegram-meldingen is er nu een **visuele app** die alles op één plek
laat zien. Hij draait volledig **lokaal op je eigen pc** (privé, geen cloud,
geen abonnement) en gebruikt dezelfde motor als hierboven.

## Starten

Dubbelklik op **`Start-App.bat`**. Er opent een zwart venster (dat mag open
blijven staan) en je browser opent automatisch de app. Klaar.

> Stoppen? Sluit gewoon het zwarte venster.
> De app heeft Python nodig; dat staat al op je pc.

## Wat je ziet (acht tabbladen)

- **Overzicht** — je aandelen met live koersen, dagbeweging, waarde (ook
  omgerekend naar euro) en je rendement sinds aankoop. Aandelen voeg je toe
  met "Aandeel toevoegen": **zoek op naam of ticker** en hij vult ticker,
  naam, valuta én het juiste beurs-achtervoegsel (`.AS`, `.PA`, `.L`) zelf in.
  Verkocht? Klik het €-icoon om de positie naar je Historie te verplaatsen.
- **Meldingen** — alles wat de bewaker de afgelopen tijd zag: koersval-,
  nieuws-, podcast- en 13F-signalen, met een badge voor ongelezen meldingen.
  Deze worden gevuld door de watcher (hieronder), ook als de app dicht staat.
- **Historie** — je winsthistorie: alle aandelen die je hebt gehad met het
  rendement **na transactiekosten** (die vul je per trade in), een kosten-kolom,
  en een vergelijking **vs een wereld-ETF** (standaard Vanguard FTSE All-World,
  VWRL — instelbaar in `config.json`): deed jouw keuze het beter dan gewoon de
  index, over dezelfde periode? (Vul koop/verkoopdatums in om te vergelijken.)
- **Patronen** — leg afgeronde trades vast als casus: waarom ging hij omlaag,
  waarom herstelde hij, en welk patroon herken je? Zo zie je een vergelijkbare
  situatie de volgende keer sneller aankomen.
- **Nieuws** — links het nieuws rond jóuw aandelen (live), rechts je eigen
  bronnen (Blondjes Beleggen Beter, Jong Beleggen).
- **Kansen** — het dagelijkse onderzoek van Claude volgens je 18-punts
  checklist: marktsamenvatting + kandidaten met score, knock-outs, risico's
  en **de datum + tijd waarop de call is gegeven**. Met de knop **Zoek nieuwe
  kansen** laat je Claude nu meteen nieuwe kansrijke aandelen zoeken (draait
  een paar minuten op de achtergrond; elke kans kun je in de deep-dive uitpluizen).
  Kies er eerst het type bij: **Alle kwaliteit** of **Kleiner & goedkoper**
  (small-/midcaps met lagere waardering). Daaronder staat de **🔎 Screener**: een
  eerste zeef op de cijfers van je eigen lijst met een **score /8** —
  waarde (P/E, PEG, vrije-kasstroom-opbrengst), kwaliteit (rendement op geld,
  marge, schuld) en groei (omzet én winst) — gesorteerd op de beste. "Lijst
  beheren" om aandelen toe te voegen; elke naam klik je door naar de deep-dive
  (die de volledige 18-punts checklist doet — de screener staat daar los van).
- **Deep-dive** — typ een aandeel en Claude zoekt alles op en legt het in
  **simpele taal** uit: wat het bedrijf doet, de cijfers en de prijs, of de
  verwachte winst haalbaar is, de grootste risico's en de volledige 18-punts
  checklist. **Onder elk kopje** een vak waarin je vragen kunt stellen tot je het
  snapt. Onderaan sla je het op als **onderzoeksrapport** (in `data/analyses/`);
  je opgeslagen rapporten staan bovenaan om te heropenen. Gebruikt dezelfde Claude
  als je dagelijkse onderzoek. Vanuit een kans (tab Kansen) open je 'm met één klik.
- **Coach** — leg een beslissing voor (kopen/verkopen/bijkopen/houden + je reden) en
  de coach toetst 'm aan de aanpak van beleggers die weinig verliezen in dalende
  markten (Buffett, Klarman, Marks, Terry Smith) én aan je eigen regels en patronen,
  en wijst je op valkuilen (FOMO, kopen op de top, winnaar te vroeg verkopen,
  te grote positie, paniek). Bewaakt je **discipline** — geen koopadvies of winstbelofte.

## Hoe het samenwerkt met de rest

- Je portefeuille staat in **`data/holdings.json`** (beheerd via de app). De
  watcher leest die nu ook, dus je koersalarmen lopen automatisch mee.
- Het dagelijkse onderzoek schrijft naast het Telegram-bericht ook
  **`data/research-latest.json`**; dat vult het tabblad Kansen. Tot de eerste
  nieuwe run staat er een voorbeeld (Alphabet) als demo.
- Je eigen deep-dives komen in **`data/notes/`**. Je oude
  `Koopbesluiten/*.txt` blijven zichtbaar onder "Eerdere Koopbesluiten".

## Altijd aan (achtergrondbewaking + auto-start)

- De app-server start **automatisch als je je pc aanzet** (een snelkoppeling in
  je Opstarten-map). Zo werkt je bookmark/snelkoppeling altijd meteen. Wil je dit
  uit? Verwijder "Mijn Beleggingen (server).lnk" uit `shell:startup`.
- Openen doe je met de snelkoppeling **Mijn Beleggingen** op je bureaublad (of
  pin hem aan je taakbalk), of via de bookmark op `http://127.0.0.1:8765`. Draait
  de app al, dan opent klikken gewoon je browser — nooit dubbel.
- De **BBBWatcher** blijft elke 5 minuten (via Taakplanner) je aandelen en
  bronnen bewaken en waarschuwt via Telegram — óók als de app dicht is. Elke
  waarschuwing verschijnt nu ook in het **Meldingen**-tabblad (`data/alerts.json`).

## AI-functies (Claude CLI)

Drie onderdelen gebruiken de Claude CLI (dezelfde die je dagelijkse onderzoek
draait): **Zoek nieuwe kansen** (Kansen), de **discussie** in de deep-dive, en
het **dagelijkse onderzoek**. Werken die niet en zie je "De Claude CLI is
uitgelogd"? Log dan opnieuw in: open PowerShell en typ `claude`, volg de inlog.
Daarna werkt alles weer.

Alle data blijft in deze map op je eigen pc. **Onderzoek, geen koopadvies —
je handelt altijd zelf in Saxo Investor.**
