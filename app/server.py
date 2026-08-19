# -*- coding: utf-8 -*-
"""
Beleggings-app (lokaal) - kleine webserver zonder externe pakketten.

Serveert de app in deze map (app/) en levert data via /api/*:
 - koersen live van Yahoo Finance (met korte cache)
 - nieuws per aandeel (Yahoo) + algemeen nieuws (jouw bronnen uit config.json)
 - dagelijks onderzoek (data/research-latest.json)
 - je portfolio en je eigen deep-dives (opgeslagen in data/)

Alles draait lokaal op je eigen pc; je data blijft privé.
Start via Start-App.ps1 of Start-App.bat (of: python app/server.py).
"""
import json
import os
import re
import sys
import time
import glob
import shutil
import subprocess
import html as _html
import threading
import webbrowser
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))        # .../app
BASE = os.path.dirname(ROOT)                             # projectmap
DATA = os.path.join(BASE, 'data')
NOTES = os.path.join(DATA, 'notes')
CONFIG_PATH = os.path.join(BASE, 'config.json')
KOOPBESLUITEN = os.path.join(BASE, 'Koopbesluiten')

os.makedirs(DATA, exist_ok=True)
os.makedirs(NOTES, exist_ok=True)

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BeleggingsApp/1.0'

# ---------------------------------------------------------------------------
# Kleine cache met tijdslimiet (voorkomt dat we Yahoo bij elke klik bevragen)
# ---------------------------------------------------------------------------
_cache = {}
_cache_lock = threading.Lock()


def cached(key, ttl, producer):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = producer()
    with _cache_lock:
        _cache[key] = (now, val)
    return val


def http_get_json(url, ttl=60):
    def prod():
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode('utf-8', 'replace'))
    return cached('json:' + url, ttl, prod)


def http_get_text(url, ttl=300):
    def prod():
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read().decode('utf-8', 'replace')
    return cached('text:' + url, ttl, prod)


# ---------------------------------------------------------------------------
# Bestanden lezen/schrijven
# ---------------------------------------------------------------------------
def load_json_file(path, default):
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return default


def save_json_file(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def get_config():
    return load_json_file(CONFIG_PATH, {})


def get_holdings():
    path = os.path.join(DATA, 'holdings.json')
    h = load_json_file(path, None)
    if h is None:
        # eerste keer: overnemen uit config.portfolio
        cfg = get_config()
        h = []
        for p in cfg.get('portfolio', []):
            h.append({
                'ticker': p.get('ticker'),
                'name': p.get('name'),
                'shares': p.get('shares'),
                'buyPrice': p.get('buyPrice'),
                'currency': p.get('currency', 'USD'),
            })
        save_json_file(path, h)
    return h


def get_history():
    return load_json_file(os.path.join(DATA, 'history.json'), [])


def get_alerts():
    # PowerShell schrijft bij 1 item soms een los object i.p.v. een lijst
    a = load_json_file(os.path.join(DATA, 'alerts.json'), [])
    if isinstance(a, dict):
        return [a]
    return a if isinstance(a, list) else []


def get_patterns():
    p = load_json_file(os.path.join(DATA, 'patterns.json'), [])
    if isinstance(p, dict):
        return [p]
    return p if isinstance(p, list) else []


def get_opportunities():
    return load_json_file(os.path.join(DATA, 'opportunities.json'), {})


# ---------------------------------------------------------------------------
# Claude CLI aanroepen (voor de "tegenspraak"-discussie in de deep-dive).
# Gebruikt dezelfde ingelogde Claude als het dagelijkse onderzoek.
# ---------------------------------------------------------------------------
def find_claude():
    # De ECHTE Claude Code CLI zit altijd in een 'claude-code'-map. De losse
    # claude.exe in AnthropicClaude is de chat-app-launcher (verkeerde) - die
    # slaan we over. Een los geinstalleerde CLI (native installer / npm) staat
    # op PATH en wordt via shutil.which gevonden.
    la = os.environ.get('LOCALAPPDATA', '')
    ra = os.environ.get('APPDATA', '')
    patterns = [
        os.path.join(la, 'Packages', 'Claude_*', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '*', 'claude.exe'),
        os.path.join(ra, 'Claude', 'claude-code', '*', 'claude.exe'),
    ]
    found = []
    for p in patterns:
        found.extend(glob.glob(p))
    if found:
        found.sort(key=lambda f: os.path.getmtime(f) if os.path.exists(f) else 0)
        return found[-1]
    return shutil.which('claude')


def run_claude(prompt, timeout=120, tools=None):
    exe = find_claude()
    if not exe:
        return None, 'Claude CLI niet gevonden op deze pc.'
    args = [exe, '-p', '--model', 'sonnet']
    if tools:
        args += ['--allowedTools', tools]
    try:
        # CREATE_NO_WINDOW is nodig omdat de server als pythonw draait (geen console);
        # zonder deze vlag faalt claude.exe met returncode 129.
        p = subprocess.run(args,
                           input=prompt, capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=timeout,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        # Foutmeldingen komen bij de Claude CLI soms in stdout i.p.v. stderr.
        raw = ((p.stderr or '') + ' ' + (p.stdout or '')).strip()
        low = raw.lower()
        if p.returncode != 0 or 'oauth' in low or 'authenticate' in low:
            if 'oauth' in low or 'authenticate' in low or 'log in' in low or 'login' in low:
                return None, ('De Claude CLI is uitgelogd. Log opnieuw in (open een terminal, '
                              'typ: claude, en volg de inlog) en probeer het daarna opnieuw.')
            return None, ('Claude gaf een fout: ' + raw[:300])
        out = (p.stdout or '').strip()
        return (out if out else None), (None if out else 'Leeg antwoord van Claude.')
    except subprocess.TimeoutExpired:
        return None, 'Het duurde te lang (time-out). Probeer het nog eens.'
    except Exception as e:
        return None, str(e)


def build_debate_prompt(body):
    ticker = body.get('ticker', '')
    name = body.get('name', '') or ticker
    ctx = body.get('context', '') or ''
    messages = body.get('messages', []) or []
    lines = []
    lines.append('Je bent een scherpe, eerlijke advocaat van de duivel voor een Nederlandse')
    lines.append('lange-termijnbelegger (kwaliteitsaandelen) die overweegt %s (%s) te kopen.' % (name, ticker))
    lines.append('Doel: hem laten TWIJFELEN en zijn thesis laten verdedigen, zodat hij pas koopt')
    lines.append('als hij het echt zeker weet. Wees concreet: noem realistische risico\'s, zwakke')
    lines.append('plekken in zijn redenering, en wat de verkoper misschien weet dat hij niet ziet.')
    lines.append('Dit is GEEN koopadvies; je daagt alleen uit.')
    lines.append('')
    lines.append('Regels voor je antwoord:')
    lines.append('- Nederlands, kort (2-4 zinnen), platte tekst.')
    lines.append('- Precies 1 tegenargument of scherpe vervolgvraag per beurt.')
    lines.append('- Is zijn weerlegging sterk? Erken dat kort en leg meteen een NIEUW twijfelpunt op tafel.')
    lines.append('- Is ze zwak of ontwijkend? Prik er scherp doorheen.')
    lines.append('- Herhaal jezelf niet; bouw voort op het gesprek.')
    lines.append('')
    if ctx:
        lines.append('Zijn onderzoek tot nu toe:')
        lines.append(ctx)
        lines.append('')
    if messages:
        lines.append('Het gesprek tot nu toe:')
        for m in messages:
            who = 'Advocaat' if m.get('role') == 'devil' else 'William'
            lines.append('%s: %s' % (who, m.get('text', '')))
        lines.append('')
        lines.append('Geef nu jouw volgende beurt (alleen jouw tekst, zonder "Advocaat:" ervoor).')
    else:
        lines.append('Geef nu je EERSTE, sterkste tegenargument (alleen jouw tekst).')
    return '\n'.join(lines)


def do_debate(body):
    return run_claude(build_debate_prompt(body))


# ---------------------------------------------------------------------------
# Kansen op aanvraag zoeken (zelfde 18-punts methode als het dagelijkse
# onderzoek). Draait als achtergrondtaak want websearch duurt een paar minuten.
# ---------------------------------------------------------------------------
_job = {'running': False, 'started': 0, 'done_at': 0, 'error': None, 'focus': 'all'}
_job_lock = threading.Lock()

FOCUS_CLAUSES = {
    'all': '',
    'smallcap': ' Richt je deze keer SPECIFIEK op kleinere en goedkopere bedrijven: small- en midcaps (grofweg een beurswaarde onder de 20 miljard) met een lage of aantrekkelijke waardering, die tóch door de knock-outs en de 18-punts checklist komen. Vermijd de bekende megacaps (zoals Apple, Microsoft, ASML, UnitedHealth, Nvidia). Kwaliteit blijft de eis - het gaat om minder bekende, goedkopere namen die kansrijk zijn voor de lange termijn.',
}

OPP_PROMPT_BASE = """Je bent een onderzoeksassistent voor een Nederlandse lange-termijnbelegger (kwaliteitsaandelen, geen daytrading, geen crypto; broker Saxo). Doe NU zelfstandig onderzoek met websearch en zoek 2 tot 4 kwaliteitsbedrijven die op dit moment opvallen als kansrijk (bijvoorbeeld door een flinke koersdaling om een tijdelijke reden, sterke kwartaalcijfers, of nieuws dat de lange-termijnkansen verbetert).{focus}

Beoordeel elk bedrijf eerst op 3 KNOCK-OUTS (bij falen valt het af): A begrijpelijk businessmodel; B de reden van de lage koers is tijdelijk, niet permanent; C boekhouding schoon.
Beoordeel daarna de 18-punts checklist met verdict "ok", "twijfel" of "slecht", met exact deze keys: moat, omzetgroei, kasstroom, roic, marges, schuld, verwatering, waardering, management, insider, verwachtingen, klantconcentratie, terugkerend, conjunctuur, kapitaalallocatie, sector, regelgeving, nl.

Geef UITSLUITEND een geldig JSON-object terug (geen inleiding, geen uitleg, geen ``` eromheen), met exact deze structuur:
{
  "market": ["1-3 korte punten over wat er nu in de markt speelt"],
  "candidates": [
    {
      "ticker": "TICKER",
      "name": "Bedrijfsnaam",
      "score": 13,
      "maxScore": 18,
      "what": "1-2 zinnen wat het bedrijf doet, gewone taal",
      "whyNow": "2-3 zinnen waarom nu interessant",
      "knockouts": { "understandable": true, "temporary": true, "cleanBooks": true },
      "checklist": [ { "key": "moat", "verdict": "ok", "note": "2-6 woorden reden" } ],
      "risks": ["risico 1", "risico 2"]
    }
  ],
  "watch": ["0-2 bedrijven die het noemen waard zijn, elk 1 zin"],
  "warnings": ["1-3 waarschuwingen"]
}
Regels: "score" = het aantal checklist-punten met verdict "ok" (0-18). Elke kandidaat heeft alle 18 keys. Vind je niets echt kansrijks? Dan "candidates": []. Verzin niets."""


def extract_json(text):
    t = (text or '').strip()
    t = re.sub(r'^```[a-zA-Z]*', '', t).strip()
    t = re.sub(r'```$', '', t).strip()
    i, j = t.find('{'), t.rfind('}')
    if i >= 0 and j > i:
        t = t[i:j + 1]
    return json.loads(t)


def build_opportunity_prompt(focus):
    return OPP_PROMPT_BASE.replace('{focus}', FOCUS_CLAUSES.get(focus, ''))


def run_opportunity_job(focus):
    out, err = run_claude(build_opportunity_prompt(focus), timeout=480, tools='WebSearch,WebFetch')
    with _job_lock:
        _job['running'] = False
        _job['done_at'] = int(time.time())
        if err or not out:
            _job['error'] = err or 'Leeg antwoord van Claude.'
            return
        try:
            obj = extract_json(out)
            obj['generatedAt'] = datetime.now().isoformat(timespec='seconds')
            obj['isSeed'] = False
            obj['focus'] = focus
            # Los van het dagelijkse overzicht (research-latest.json), zodat ze
            # elkaar niet overschrijven.
            save_json_file(os.path.join(DATA, 'opportunities.json'), obj)
            _job['error'] = None
        except Exception as e:
            _job['error'] = 'Kon het resultaat niet lezen: ' + str(e)


def start_opportunity_job(focus='all'):
    if focus not in FOCUS_CLAUSES:
        focus = 'all'
    with _job_lock:
        if _job['running']:
            return {'running': True}
        _job['running'] = True
        _job['started'] = int(time.time())
        _job['error'] = None
        _job['focus'] = focus
    threading.Thread(target=run_opportunity_job, args=(focus,), daemon=True).start()
    return {'started': True}


# ---------------------------------------------------------------------------
# Volledige aandeel-analyse (AI deep-dive): typ een ticker -> Claude onderzoekt
# alles en legt het in simpele taal uit, met de 18-punts checklist.
# ---------------------------------------------------------------------------
ANALYSES_DIR = os.path.join(DATA, 'analyses')
_ajob = {'running': False, 'ticker': '', 'started': 0, 'done_at': 0, 'error': None}
_ajob_lock = threading.Lock()

ANALYZE_PROMPT = """Je bent een onderzoeksassistent voor een Nederlandse lange-termijnbelegger (kwaliteitsaandelen, lange termijn, broker Saxo). Onderzoek met websearch het aandeel {TICKER} ({NAME}) grondig en leg ALLES uit in heel eenvoudige taal, alsof je het aan een vriend uitlegt die geen verstand van beleggen heeft. Vermijd jargon; gebruik je toch een moeilijk woord, leg het meteen even uit. Gebruik echte, actuele cijfers (verzin niets; kun je iets niet vinden, zeg dat eerlijk).

Geef UITSLUITEND een geldig JSON-object terug (geen inleiding, geen uitleg eromheen, geen ``` ), met exact deze structuur:
{
  "name": "Volledige bedrijfsnaam",
  "score": <geheel getal: aantal checklist-punten met verdict "ok", 0-18>,
  "maxScore": 18,
  "sections": [
    {"id": "wat", "title": "Wat doet dit bedrijf", "body": "2-4 korte alinea's in simpele taal: wat doen ze, hoe verdienen ze geld, met een herkenbaar voorbeeld of vergelijking"},
    {"id": "cijfers", "title": "De cijfers en de prijs", "body": "simpel: groeit de omzet, houdt het bedrijf winst/geld over, hoe zit het met schulden, en is de prijs (waardering) goedkoop of duur - met de echte getallen erbij"},
    {"id": "verwachting", "title": "Is de verwachte winst haalbaar", "body": "simpel: wat verwachten kenners/analisten, en is die lat realistisch of moet alles perfect gaan?"},
    {"id": "risicos", "title": "De grootste risico's", "body": "de 2-4 grootste risico's, elk in 1-2 simpele zinnen"}
  ],
  "checklist": [
    {"key": "moat", "verdict": "ok", "note": "1 korte, simpele reden, met een getal als dat kan"}
  ],
  "conclusie": "2-4 zinnen: het sterkste en het zwakste punt, en wat je in de gaten moet houden. GEEN koopadvies."
}

De checklist moet ALLE 18 punten bevatten, in deze volgorde, met deze exacte keys en verdict "ok"/"twijfel"/"slecht":
moat, omzetgroei, kasstroom, roic, marges, schuld, verwatering, waardering, management, insider, verwachtingen, klantconcentratie, terugkerend, conjunctuur, kapitaalallocatie, sector, regelgeving, nl.
Weeg bij deze punten expliciet mee (verwerk het in de note): bij "moat" ook PRIJSZETTINGSMACHT (kan het de prijzen met de inflatie meeverhogen zonder klanten te verliezen?); bij "kasstroom" ook CASH-CONVERSIE (worden de winsten ook echt vrije kasstroom?); bij "insider" ook de ZEGGENSCHAPSSTRUCTUUR (dubbele aandelenklassen of een controlerende grootaandeelhouder/stichting - op één lijn met kleine aandeelhouders?); bij "kapitaalallocatie" ook de HERINVESTERINGS-RUIMTE tegen hoog rendement (de motor achter samengestelde groei) en goodwill uit overnames.
"score" = het aantal punten met verdict "ok". Zorg dat het JSON geldig is (dubbele quotes, geen komma na het laatste element, geen echte nieuwe regels binnen een tekst-waarde)."""

CHECK_LABELS_NL = {
    'moat': 'Slotgracht (kunnen klanten makkelijk weg?)', 'omzetgroei': 'Omzetgroei',
    'kasstroom': 'Houdt het geld over', 'roic': 'Rendement op zijn geld', 'marges': 'Winst per euro omzet',
    'schuld': 'Schulden', 'verwatering': 'Aantal aandelen', 'waardering': 'Is de prijs een koopje',
    'management': 'De bazen', 'insider': 'Bezit het management zelf aandelen', 'verwachtingen': 'Verwachte winst haalbaar',
    'klantconcentratie': 'Hangt het aan een paar klanten', 'terugkerend': 'Betalen klanten steeds opnieuw',
    'conjunctuur': 'Last van een slechte economie', 'kapitaalallocatie': 'Slim met zijn geld',
    'sector': 'Sector bedreigd (AI)', 'regelgeving': 'Afhankelijk van politiek/regels', 'nl': 'Valkuilen voor NL-belegger',
}


def run_analyze_job(ticker, name):
    prompt = ANALYZE_PROMPT.replace('{TICKER}', ticker).replace('{NAME}', name or ticker)
    out, err = run_claude(prompt, timeout=480, tools='WebSearch,WebFetch')
    with _ajob_lock:
        _ajob['running'] = False
        _ajob['done_at'] = int(time.time())
        if err or not out:
            _ajob['error'] = err or 'Leeg antwoord van Claude.'
            return
        try:
            obj = extract_json(out)
            obj['ticker'] = ticker
            obj.setdefault('name', name or ticker)
            obj['generatedAt'] = datetime.now().isoformat(timespec='seconds')
            for s in obj.get('sections', []):
                s.setdefault('discussion', [])
            obj.setdefault('checklistDiscussion', [])
            obj.setdefault('conclusieDiscussion', [])
            save_analysis(obj)
            _ajob['error'] = None
        except Exception as e:
            _ajob['error'] = 'Kon het onderzoek niet lezen: ' + str(e)


def start_analyze_job(ticker, name):
    ticker = (ticker or '').strip().upper()
    if not ticker:
        return {'error': 'Geen ticker opgegeven'}
    with _ajob_lock:
        if _ajob['running']:
            return {'running': True, 'ticker': _ajob['ticker']}
        _ajob['running'] = True
        _ajob['ticker'] = ticker
        _ajob['started'] = int(time.time())
        _ajob['error'] = None
    threading.Thread(target=run_analyze_job, args=(ticker, name), daemon=True).start()
    return {'started': True, 'ticker': ticker}


def analysis_path(ticker):
    return os.path.join(ANALYSES_DIR, os.path.basename((ticker or 'X').upper()) + '.json')


def save_analysis(obj):
    os.makedirs(ANALYSES_DIR, exist_ok=True)
    obj['updatedAt'] = datetime.now().isoformat(timespec='seconds')
    save_json_file(analysis_path(obj.get('ticker', 'X')), obj)


def get_analysis(ticker):
    return load_json_file(analysis_path(ticker), {})


def list_analyses():
    out = []
    if os.path.isdir(ANALYSES_DIR):
        for fn in sorted(os.listdir(ANALYSES_DIR)):
            if fn.endswith('.json'):
                d = load_json_file(os.path.join(ANALYSES_DIR, fn), {})
                out.append({'ticker': d.get('ticker', fn[:-5]), 'name': d.get('name', ''),
                            'score': d.get('score'), 'updatedAt': d.get('updatedAt')})
    return out


def build_coach_prompt(body):
    ticker = body.get('ticker', '')
    action = body.get('action', '')
    messages = body.get('messages', []) or []
    pats = get_patterns()
    L = []
    L.append('Je bent de persoonlijke beleggings-COACH van een Nederlandse lange-termijnbelegger (William). Je bewaakt zijn DISCIPLINE en beschermt hem tegen fouten. Je bent GEEN koersvoorspeller en GEEN koopadviseur: je geeft nooit een stellige koop/verkoop-opdracht en nooit een winstbelofte.')
    L.append('')
    L.append('Je toetst zijn beslissing aan de aanpak van de beste lange-termijnbeleggers die juist WEINIG verliezen in dalende markten (Buffett, Klarman, Howard Marks, Terry Smith). Kernprincipes:')
    L.append('- Kapitaalbehoud eerst ("verlies geen geld"): wat is het slechtste realistische scenario, en kan hij dat dragen zonder paniek?')
    L.append('- Koop kwaliteit en betaal niet te veel (veiligheidsmarge). Een topbedrijf tegen een te hoge prijs is een slechte belegging.')
    L.append('- Lange termijn: koop iets dat je 5+ jaar wilt bezitten. Een koersSTIJGING is geen koopreden (FOMO); een koersDALING zonder slecht bedrijfsnieuws is geen verkoopreden.')
    L.append('- Laat winnaars lopen; verkoop niet te vroeg voor een klein plusje.')
    L.append('- Spreiding en positiegrootte: nooit te veel in een aandeel (max ~5-10%); hou wat cash achter voor kansen, juist in dalende markten.')
    L.append('- Blijf binnen wat je zelf begrijpt.')
    L.append('- Geduld: is het niet duidelijk, dan is "nee/nog niet" ook een goede beslissing - er komt altijd een nieuwe kans.')
    L.append('')
    L.append('Zijn eigen regels: een 18-punts checklist + koopbesluit, gefaseerd instappen, niet paniekverkopen.')
    if pats:
        L.append('Zijn eerdere trades/lessen (gebruik ze om hem op zijn eigen patronen te wijzen):')
        for p in pats[:6]:
            lesson = (p.get('lesson') or p.get('pattern') or '')
            L.append('- %s: %s' % (p.get('title') or p.get('ticker', ''), lesson[:160]))
    L.append('')
    if action or ticker:
        L.append('Zijn beslissing nu: %s%s.' % (action, (' van ' + ticker) if ticker else ''))
    L.append('')
    L.append('Jouw taak: toets zijn beslissing eerlijk aan de principes EN zijn eigen regels. Bevestig kort wat gedisciplineerd is, en benoem SCHERP de risico\'s, denkfouten of emotie (FOMO, kopen bij een hoogtepunt, een winnaar te vroeg verkopen, te grote positie, paniekverkoop). Volgt zijn beslissing de principes? Zeg dan dat het PAST bij de aanpak die op lange termijn meestal werkt - maar wees eerlijk dat GEEN enkele losse trade gegarandeerd goed afloopt. Sluit af met 1-3 concrete vragen die hij zichzelf moet beantwoorden om echt zeker te zijn.')
    L.append('Antwoord in het Nederlands, in gewone taal, warm maar eerlijk en kort (max ~6-8 zinnen).')
    L.append('')
    L.append('Het gesprek tot nu toe:')
    for m in messages:
        who = 'Coach' if m.get('role') == 'coach' else 'William'
        L.append('%s: %s' % (who, m.get('text', '')))
    L.append('')
    L.append('Geef nu je volgende antwoord als coach (alleen je eigen tekst).')
    return '\n'.join(L)


def do_coach(body):
    return run_claude(build_coach_prompt(body))


def do_discuss(body):
    title = body.get('sectionTitle', '')
    ctx = body.get('sectionBody', '')
    messages = body.get('messages', []) or []
    ticker = body.get('ticker', '')
    name = body.get('name', '') or ticker
    L = []
    L.append('Je helpt een Nederlandse lange-termijnbelegger het aandeel %s (%s) begrijpen.' % (name, ticker))
    L.append('Jullie bespreken nu dit onderdeel: "%s".' % title)
    if ctx:
        L.append('Wat er in dat onderdeel staat:')
        L.append(ctx)
    L.append('')
    L.append('Beantwoord zijn vraag of ga in op zijn opmerking in HEEL eenvoudige taal (geen jargon; leg moeilijke woorden meteen uit), kort en duidelijk, in het Nederlands. Geen koopadvies. Weet je een actueel cijfer niet zeker, zeg dat dan eerlijk.')
    L.append('')
    if messages:
        L.append('Het gesprek tot nu toe:')
        for m in messages:
            who = 'Assistent' if m.get('role') == 'ai' else 'William'
            L.append('%s: %s' % (who, m.get('text', '')))
        L.append('')
        L.append('Geef nu je volgende antwoord (alleen je eigen tekst).')
    return run_claude('\n'.join(L), timeout=120)


# ---------------------------------------------------------------------------
# Tekst-hulpjes
# ---------------------------------------------------------------------------
def strip_html(s):
    if not s:
        return ''
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'\s+', ' ', s)
    return _html.unescape(s).strip()


def iso_to_epoch(iso):
    if not iso:
        return None
    try:
        return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp())
    except Exception:
        return None


def rfc822_to_epoch(s):
    try:
        return int(parsedate_to_datetime(s).timestamp())
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Yahoo Finance: koersen
# ---------------------------------------------------------------------------
def yahoo_quote(ticker):
    url = ('https://query1.finance.yahoo.com/v8/finance/chart/%s?range=1mo&interval=1d'
           % urllib.parse.quote(ticker))
    try:
        d = http_get_json(url, ttl=60)
        res = d['chart']['result'][0]
        meta = res['meta']
        price = meta.get('regularMarketPrice')
        # Vorige SLOTKOERS bepalen uit de dagreeks (niet chartPreviousClose:
        # dat is bij range=1mo de koers van een maand geleden, geen dagverandering)
        ts = res.get('timestamp', []) or []
        raw = []
        try:
            raw = res['indicators']['quote'][0].get('close', []) or []
        except Exception:
            raw = []
        pairs = [(ts[i], raw[i]) for i in range(min(len(ts), len(raw))) if raw[i] is not None]
        closes = [c for _, c in pairs]
        # Referentie = de op-een-na-laatste slotkoers. Tijdens de beurs geeft dat
        # 'vandaag tot nu toe'; is de beurs dicht, dan de laatste handelsdag.
        prev = None
        if len(pairs) >= 2:
            prev = pairs[-2][1]
        elif pairs:
            prev = pairs[-1][1]
        if prev is None:
            prev = meta.get('chartPreviousClose') or meta.get('previousClose')
        if price is None and closes:
            price = closes[-1]
        change = None
        if price is not None and prev:
            change = (price / prev - 1) * 100
        return {
            'ticker': ticker,
            'price': price,
            'prevClose': prev,
            'changePct': change,
            'currency': meta.get('currency', 'USD'),
            'spark': closes[-30:],
            'high52': meta.get('fiftyTwoWeekHigh'),
            'low52': meta.get('fiftyTwoWeekLow'),
            'name': meta.get('shortName') or meta.get('longName'),
        }
    except Exception as e:
        return {'ticker': ticker, 'error': str(e)}


# ---------------------------------------------------------------------------
# Factor-screener: fundamentele cijfers ophalen (Yahoo quoteSummary vereist
# een cookie + "crumb") en een beheerbare lijst aandelen om te screenen.
# ---------------------------------------------------------------------------
_yahoo = {'opener': None, 'crumb': None, 'ts': 0}


def yahoo_session():
    now = time.time()
    if _yahoo['opener'] and _yahoo['crumb'] and now - _yahoo['ts'] < 1800:
        return _yahoo['opener'], _yahoo['crumb']
    import http.cookiejar
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = [('User-Agent', UA)]
    try:
        op.open('https://fc.yahoo.com', timeout=15)
    except Exception:
        pass
    crumb = None
    try:
        r = op.open('https://query1.finance.yahoo.com/v1/test/getcrumb', timeout=15)
        crumb = r.read().decode('utf-8', 'replace').strip()
    except Exception:
        pass
    _yahoo.update({'opener': op, 'crumb': crumb, 'ts': now})
    return op, crumb


def _raw(o, k):
    v = (o or {}).get(k)
    return v.get('raw') if isinstance(v, dict) else v


def fundamentals(ticker):
    op, crumb = yahoo_session()
    if not crumb or '<' in crumb:
        return {'ticker': ticker, 'error': 'geen toegang tot fundamentele data'}
    url = ('https://query1.finance.yahoo.com/v10/finance/quoteSummary/%s'
           '?modules=financialData,defaultKeyStatistics,summaryDetail,price&crumb=%s'
           % (urllib.parse.quote(ticker), urllib.parse.quote(crumb)))

    def prod():
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        r = op.open(req, timeout=20)
        return json.loads(r.read().decode('utf-8', 'replace'))
    try:
        d = cached('fund:' + ticker, 3600, prod)
        res = d['quoteSummary']['result'][0]
        fd, ks, sd, pr = res.get('financialData', {}), res.get('defaultKeyStatistics', {}), res.get('summaryDetail', {}), res.get('price', {})
        return {
            'ticker': ticker,
            'name': pr.get('longName') or pr.get('shortName') or ticker,
            'currency': pr.get('currency'),
            'trailingPE': _raw(sd, 'trailingPE'),
            'forwardPE': _raw(sd, 'forwardPE'),
            'roe': _raw(fd, 'returnOnEquity'),
            'profitMargin': _raw(fd, 'profitMargins'),
            'operMargin': _raw(fd, 'operatingMargins'),
            'debtToEquity': _raw(fd, 'debtToEquity'),
            'revenueGrowth': _raw(fd, 'revenueGrowth'),
            'earningsGrowth': _raw(fd, 'earningsGrowth'),
            'pegRatio': _raw(ks, 'pegRatio') or _raw(ks, 'trailingPegRatio'),
            'freeCashflow': _raw(fd, 'freeCashflow'),
            'marketCap': _raw(sd, 'marketCap') or _raw(pr, 'marketCap'),
        }
    except Exception as e:
        return {'ticker': ticker, 'error': str(e)[:140]}


def get_watchlist():
    path = os.path.join(DATA, 'watchlist.json')
    w = load_json_file(path, None)
    if w is None:
        seen = []

        def add(t):
            t = (t or '').strip().upper()
            if t and t not in seen:
                seen.append(t)
        for h in get_holdings():
            add(h.get('ticker'))
        for t in get_history():
            add(t.get('ticker'))
        for a in list_analyses():
            add(a.get('ticker'))
        r = load_json_file(os.path.join(DATA, 'research-latest.json'), {})
        for c in (r.get('candidates') or []):
            add(c.get('ticker'))
        w = seen
        save_json_file(path, w)
    return w if isinstance(w, list) else []


def get_benchmark():
    """Wereld-ETF als maatstaf (standaard Vanguard FTSE All-World, VWRL.AS in euro).
    Geeft dagelijkse slotkoersen zodat de app je trades met dezelfde periodes kan vergelijken."""
    cfg = get_config()
    ticker = cfg.get('benchmarkTicker', 'VWRL.AS')
    name = cfg.get('benchmarkName', 'Vanguard FTSE All-World (VWRL)')
    url = ('https://query1.finance.yahoo.com/v8/finance/chart/%s?range=10y&interval=1d'
           % urllib.parse.quote(ticker))
    try:
        d = http_get_json(url, ttl=3600)
        res = d['chart']['result'][0]
        meta = res['meta']
        ts = res.get('timestamp', []) or []
        raw = res['indicators']['quote'][0].get('close', []) or []
        closes = [[ts[i], raw[i]] for i in range(min(len(ts), len(raw))) if raw[i] is not None]
        return {'ticker': ticker, 'name': name, 'currency': meta.get('currency', 'EUR'),
                'last': meta.get('regularMarketPrice'), 'closes': closes}
    except Exception as e:
        return {'ticker': ticker, 'name': name, 'closes': [], 'error': str(e)}


def fx_to_eur(cur):
    cur = (cur or 'EUR').upper()
    if cur == 'EUR':
        return 1.0
    url = ('https://query1.finance.yahoo.com/v8/finance/chart/%sEUR=X?range=1d&interval=1d'
           % urllib.parse.quote(cur))
    try:
        d = http_get_json(url, ttl=3600)
        return d['chart']['result'][0]['meta'].get('regularMarketPrice')
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Nieuws
# ---------------------------------------------------------------------------
def yahoo_news(ticker, count=6):
    url = ('https://query1.finance.yahoo.com/v1/finance/search?q=%s&newsCount=%d&quotesCount=0'
           % (urllib.parse.quote(ticker), count))
    try:
        d = http_get_json(url, ttl=600)
        out = []
        for n in d.get('news', []):
            out.append({
                'title': n.get('title'),
                'link': n.get('link'),
                'publisher': n.get('publisher'),
                'time': n.get('providerPublishTime'),
                'tickers': n.get('relatedTickers', []),
                'source': 'Yahoo Finance',
                'kind': 'ticker',
            })
        return out
    except Exception:
        return []


def general_news():
    cfg = get_config()
    items = []
    for src in cfg.get('wordpressSources', []) or []:
        try:
            posts = http_get_json(src['api'], ttl=900)
            for p in posts[:5]:
                items.append({
                    'title': strip_html(p.get('title', {}).get('rendered', '')),
                    'link': p.get('link'),
                    'time': iso_to_epoch(p.get('date')),
                    'publisher': src.get('name'),
                    'source': src.get('name'),
                    'summary': strip_html(p.get('excerpt', {}).get('rendered', ''))[:240],
                    'kind': 'blog',
                })
        except Exception:
            pass
    for src in cfg.get('rssSources', []) or []:
        try:
            xmltext = http_get_text(src['url'], ttl=900)
            root = ET.fromstring(xmltext)
            n = 0
            for item in root.iter('item'):
                if n >= 5:
                    break
                n += 1
                items.append({
                    'title': strip_html(item.findtext('title') or ''),
                    'link': (item.findtext('link') or '').strip(),
                    'time': rfc822_to_epoch(item.findtext('pubDate') or ''),
                    'publisher': src.get('name'),
                    'source': src.get('name'),
                    'summary': '',
                    'kind': 'podcast',
                })
        except Exception:
            pass
    items.sort(key=lambda x: x.get('time') or 0, reverse=True)
    return items


# ---------------------------------------------------------------------------
# Aandelen zoeken (autocomplete) - Yahoo dekt vrijwel alle beurzen die Saxo ook heeft
# ---------------------------------------------------------------------------
def yahoo_search(query):
    query = (query or '').strip()
    if len(query) < 1:
        return []
    url = ('https://query1.finance.yahoo.com/v1/finance/search?q=%s&quotesCount=10&newsCount=0&enableFuzzyQuery=true'
           % urllib.parse.quote(query))
    try:
        d = http_get_json(url, ttl=600)
        out = []
        for it in d.get('quotes', []):
            sym = it.get('symbol')
            if not sym:
                continue
            qt = it.get('quoteType')
            if qt not in ('EQUITY', 'ETF'):
                continue
            out.append({
                'symbol': sym,
                'name': it.get('shortname') or it.get('longname') or sym,
                'exchange': it.get('exchDisp') or it.get('exchange') or '',
                'type': qt,
            })
        return out
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Deep-dives (eigen analyses)
# ---------------------------------------------------------------------------
def list_deepdives():
    out = []
    if os.path.isdir(NOTES):
        for fn in sorted(os.listdir(NOTES)):
            if fn.endswith('.json'):
                data = load_json_file(os.path.join(NOTES, fn), {})
                out.append({
                    'ticker': data.get('ticker', fn[:-5]),
                    'name': data.get('name', ''),
                    'type': 'note',
                    'updated': data.get('updated'),
                    'score': data.get('score'),
                })
    if os.path.isdir(KOOPBESLUITEN):
        for fn in sorted(os.listdir(KOOPBESLUITEN)):
            low = fn.lower()
            if low.endswith('.txt') and 'template' not in low:
                out.append({
                    'file': fn,
                    'type': 'txt',
                    'name': fn.replace('Koopbesluit', '').replace('.txt', '').strip(),
                })
    return out


def read_koopbesluit(fn):
    # alleen bestanden binnen de Koopbesluiten-map, geen padtrucs
    safe = os.path.basename(fn or '')
    path = os.path.join(KOOPBESLUITEN, safe)
    if not os.path.isfile(path):
        return ''
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            return f.read()
    except Exception:
        return ''


# ---------------------------------------------------------------------------
# HTTP-handler
# ---------------------------------------------------------------------------
STATIC = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/index.html': ('index.html', 'text/html; charset=utf-8'),
    '/styles.css': ('styles.css', 'text/css; charset=utf-8'),
    '/app.js': ('app.js', 'application/javascript; charset=utf-8'),
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # geen console-ruis

    def _send(self, code, body, ctype='application/json; charset=utf-8'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _static(self, name, ctype):
        path = os.path.join(ROOT, name)
        try:
            with open(path, 'rb') as f:
                self._send(200, f.read().decode('utf-8'), ctype)
        except Exception as e:
            self._send(404, {'error': 'bestand niet gevonden: %s (%s)' % (name, e)})

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        path = u.path
        q = urllib.parse.parse_qs(u.query)
        try:
            if path in STATIC:
                name, ctype = STATIC[path]
                return self._static(name, ctype)
            if path == '/api/state':
                return self._send(200, self.api_state())
            if path == '/api/quotes':
                return self._send(200, self.api_quotes(q))
            if path == '/api/news':
                return self._send(200, self.api_news(q))
            if path == '/api/research':
                return self._send(200, load_json_file(os.path.join(DATA, 'research-latest.json'),
                                                       {'candidates': [], 'market': []}))
            if path == '/api/research-status':
                with _job_lock:
                    return self._send(200, dict(_job))
            if path == '/api/opportunities':
                return self._send(200, get_opportunities())
            if path == '/api/analyze-status':
                with _ajob_lock:
                    return self._send(200, dict(_ajob))
            if path == '/api/analyses':
                return self._send(200, {'items': list_analyses()})
            if path == '/api/analysis':
                return self._send(200, get_analysis(q.get('ticker', [''])[0]))
            if path == '/api/search':
                return self._send(200, {'results': yahoo_search(q.get('q', [''])[0])})
            if path == '/api/history':
                return self._send(200, {'history': get_history()})
            if path == '/api/benchmark':
                return self._send(200, get_benchmark())
            if path == '/api/watchlist':
                return self._send(200, {'tickers': get_watchlist()})
            if path == '/api/screener':
                wl = get_watchlist()
                return self._send(200, {'watchlist': wl, 'results': [fundamentals(t) for t in wl]})
            if path == '/api/alerts':
                return self._send(200, {'alerts': get_alerts()})
            if path == '/api/patterns':
                return self._send(200, {'patterns': get_patterns()})
            if path == '/api/deepdives':
                return self._send(200, {'items': list_deepdives()})
            if path == '/api/deepdive':
                t = (q.get('ticker', [''])[0] or '').upper()
                return self._send(200, load_json_file(os.path.join(NOTES, t + '.json'), {}))
            if path == '/api/koopbesluit':
                return self._send(200, {'text': read_koopbesluit(q.get('file', [''])[0])})
            self._send(404, {'error': 'onbekend pad'})
        except Exception as e:
            self._send(500, {'error': str(e)})

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        length = int(self.headers.get('Content-Length', '0') or 0)
        raw = self.rfile.read(length) if length else b''
        try:
            body = json.loads(raw.decode('utf-8')) if raw else {}
        except Exception:
            body = {}
        try:
            if u.path == '/api/holdings':
                holdings = body.get('holdings', body)
                save_json_file(os.path.join(DATA, 'holdings.json'), holdings)
                return self._send(200, {'ok': True, 'count': len(holdings)})
            if u.path == '/api/history':
                hist = body.get('history', body)
                save_json_file(os.path.join(DATA, 'history.json'), hist)
                return self._send(200, {'ok': True, 'count': len(hist)})
            if u.path == '/api/watchlist':
                tickers = body.get('tickers', body)
                tickers = [str(t).strip().upper() for t in tickers if str(t).strip()]
                save_json_file(os.path.join(DATA, 'watchlist.json'), tickers)
                return self._send(200, {'ok': True, 'count': len(tickers)})
            if u.path == '/api/patterns':
                pats = body.get('patterns', body)
                save_json_file(os.path.join(DATA, 'patterns.json'), pats)
                return self._send(200, {'ok': True, 'count': len(pats)})
            if u.path == '/api/debate':
                reply, err = do_debate(body)
                return self._send(200, {'reply': reply} if reply else {'error': err or 'Onbekende fout'})
            if u.path == '/api/find-opportunities':
                return self._send(200, start_opportunity_job(body.get('focus', 'all')))
            if u.path == '/api/analyze':
                return self._send(200, start_analyze_job(body.get('ticker', ''), body.get('name', '')))
            if u.path == '/api/analysis':
                save_analysis(body)
                return self._send(200, {'ok': True})
            if u.path == '/api/discuss':
                reply, err = do_discuss(body)
                return self._send(200, {'reply': reply} if reply else {'error': err or 'Onbekende fout'})
            if u.path == '/api/coach':
                reply, err = do_coach(body)
                return self._send(200, {'reply': reply} if reply else {'error': err or 'Onbekende fout'})
            if u.path == '/api/deepdive':
                t = (body.get('ticker') or 'ONBEKEND').upper()
                body['ticker'] = t
                body['updated'] = datetime.now().isoformat(timespec='seconds')
                save_json_file(os.path.join(NOTES, t + '.json'), body)
                return self._send(200, {'ok': True})
            self._send(404, {'error': 'onbekend pad'})
        except Exception as e:
            self._send(500, {'error': str(e)})

    # ---- API-implementaties ----
    def api_state(self):
        return {
            'holdings': get_holdings(),
            'research': load_json_file(os.path.join(DATA, 'research-latest.json'),
                                       {'candidates': [], 'market': []}),
            'deepdives': list_deepdives(),
            'history': get_history(),
            'alerts': get_alerts(),
            'patterns': get_patterns(),
            'opportunities': get_opportunities(),
            'analyses': list_analyses(),
            'time': int(time.time()),
        }

    def api_quotes(self, q):
        holdings = {h['ticker']: h for h in get_holdings() if h.get('ticker')}
        extra = []
        if 'tickers' in q:
            extra = [t.strip().upper() for t in q['tickers'][0].split(',') if t.strip()]
        tickers = list(dict.fromkeys(list(holdings.keys()) + extra))
        out = []
        fx_cache = {}
        for t in tickers:
            qd = yahoo_quote(t)
            h = holdings.get(t)
            if h:
                qd['shares'] = h.get('shares')
                qd['buyPrice'] = h.get('buyPrice')
            cur = (qd.get('currency') or 'EUR').upper()
            if cur not in fx_cache:
                fx_cache[cur] = fx_to_eur(cur)
            qd['eurRate'] = fx_cache[cur]
            out.append(qd)
        return {'quotes': out, 'time': int(time.time())}

    def api_news(self, q):
        tickers = []
        if 'tickers' in q:
            tickers = [t.strip().upper() for t in q['tickers'][0].split(',') if t.strip()]
        else:
            tickers = [h['ticker'] for h in get_holdings() if h.get('ticker')]
        per_ticker = {}
        seen = set()
        for t in tickers[:12]:
            items = []
            for n in yahoo_news(t):
                key = n.get('link') or n.get('title')
                if key in seen:
                    continue
                seen.add(key)
                items.append(n)
            if items:
                per_ticker[t] = items
        return {'tickers': per_ticker, 'general': general_news(), 'time': int(time.time())}


def already_running(port):
    """Draait onze app al op deze poort? Dan hoeven we geen tweede te starten."""
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/state' % port, timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def main():
    canonical = 8765
    # Draait de app al? Dan alleen de browser openen (voor de snelkoppeling in je balk).
    if already_running(canonical):
        print('De app draait al op http://127.0.0.1:%d/' % canonical)
        if '--no-browser' not in sys.argv:
            webbrowser.open('http://127.0.0.1:%d/' % canonical)
        return

    port = None
    httpd = None
    for p in range(8765, 8800):
        try:
            httpd = ThreadingHTTPServer(('127.0.0.1', p), Handler)
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        print('Geen vrije poort gevonden tussen 8765 en 8799.')
        sys.exit(1)
    url = 'http://127.0.0.1:%d/' % port
    print('=' * 52)
    print(' Beleggings-app draait!')
    print(' Open in je browser:  ' + url)
    print(' (Laat dit venster open staan. Sluiten? Ctrl+C.)')
    print('=' * 52)
    if '--no-browser' not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nApp gestopt.')


if __name__ == '__main__':
    main()
