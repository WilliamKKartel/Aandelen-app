/* ============================================================
   Mijn Beleggingen - front-end
   Alles draait lokaal; data komt van server.py (/api/*).
   ============================================================ */

const CHECKLIST = [
  ['moat', 'Moat', 'waarom stapt een klant niet over naar de concurrent?'],
  ['omzetgroei', 'Omzetgroei', 'groeide de omzet 5-10 jaar gestaag?'],
  ['kasstroom', 'Vrije kasstroom', 'positief en meegroeiend?'],
  ['roic', 'ROIC', 'boven de 15%, jaar na jaar?'],
  ['marges', 'Marges', 'stabiel of stijgend over 10 jaar?'],
  ['schuld', 'Schuld', 'nettoschuld onder 2-3x EBITDA?'],
  ['verwatering', 'Verwatering', 'aantal aandelen gelijk of dalend?'],
  ['waardering', 'Waardering', 'P/E vs eigen 5-jaars gemiddelde en sector?'],
  ['management', 'Management', 'hoe lang zit de CEO, maakt hij beloftes waar?'],
  ['insider', 'Insider-bezit', 'bezit management zelf veel aandelen, kopen ze bij?'],
  ['verwachtingen', 'Verwachtingen', 'wat verwachten analisten al? Is de lat haalbaar?'],
  ['klantconcentratie', 'Klantconcentratie', 'hangt de omzet aan enkele grote klanten?'],
  ['terugkerend', 'Terugkerende omzet', 'abonnementen/herhaalaankopen of steeds opnieuw verkopen?'],
  ['conjunctuur', 'Conjunctuur', 'wat deed de omzet in 2008-2009 en 2020?'],
  ['kapitaalallocatie', 'Kapitaalallocatie', 'wat doet management met de winst?'],
  ['sector', 'Sector/disruptie', 'groeit de sector zelf of wordt hij bedreigd (AI)?'],
  ['regelgeving', 'Regelgeving/geopolitiek', 'afhankelijk van subsidies, vergunningen, handelsoorlog?'],
  ['nl', 'NL-belegger', 'valutarisico? Dividendbronbelasting geregeld (W-8BEN)?'],
];
const CL_LABEL = Object.fromEntries(CHECKLIST.map(c => [c[0], c[1]]));
const KNOCKOUTS = [
  ['understandable', 'Ik begrijp echt hoe dit bedrijf geld verdient'],
  ['temporary', 'Als de koers laag staat: de reden is TIJDELIJK, niet permanent'],
  ['cleanBooks', 'Geen rode vlaggen in de boekhouding'],
];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'HKD', 'CAD', 'AUD', 'SEK', 'DKK'];

const App = {
  view: 'overzicht',
  state: { holdings: [], research: { candidates: [], market: [] }, deepdives: [], history: [], alerts: [], patterns: [], opportunities: {}, analyses: [] },
  quotes: {},        // ticker -> quote
  news: null,
  dd: null,          // (oud) handmatige deep-dive
  ddPrefill: null,
  analysis: null,    // huidig AI-onderzoeksrapport
  benchmark: null,   // wereld-ETF dagkoersen (voor vergelijking)
  screener: null,    // factor-screener resultaten
  coach: { ticker: '', name: '', action: 'Kopen', messages: [] },
};

/* ---------- kleine hulpjes ---------- */
const $ = sel => document.querySelector(sel);
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'dataset') for (const d in v) e.dataset[d] = v[d];
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (let kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  return e;
}
function money(v, cur) {
  if (v == null || isNaN(v)) return '—';
  try { return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 2 }).format(v); }
  catch (e) { return (cur || '') + ' ' + Number(v).toFixed(2); }
}
function eur(v) { return money(v, 'EUR'); }
function pct(v) {
  if (v == null || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(1).replace('.', ',') + '%';
}
function num(x) {
  if (x == null || x === '') return null;
  const n = parseFloat(String(x).replace(',', '.'));
  return isNaN(n) ? null : n;
}
function timeAgo(sec) {
  if (!sec) return '';
  const d = Date.now() / 1000 - sec;
  if (d < 90) return 'zojuist';
  if (d < 3600) return Math.round(d / 60) + ' min geleden';
  if (d < 86400) return Math.round(d / 3600) + ' u geleden';
  if (d < 7 * 86400) return Math.round(d / 86400) + ' d geleden';
  return new Date(sec * 1000).toLocaleDateString('nl-NL');
}
function initials(t) { return (t || '?').slice(0, 3).toUpperCase(); }
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}
function round2(x) { return Math.round(x * 100) / 100; }
function todayStr() { return new Date().toISOString().slice(0, 10); }

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = el('div', { class: 'toast' }); document.body.appendChild(t); }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- svg-grafiekjes ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs) {
  const e = document.createElementNS(SVGNS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function sparkline(data, w = 92, h = 30) {
  if (!data || data.length < 2) return el('span', { class: 'muted tiny' }, '—');
  const min = Math.min(...data), max = Math.max(...data), rng = (max - min) || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1) * w).toFixed(1)},${(h - ((v - min) / rng) * (h - 4) - 2).toFixed(1)}`).join(' ');
  const up = data[data.length - 1] >= data[0];
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h });
  svg.appendChild(svgEl('polyline', {
    points: pts, fill: 'none', stroke: up ? 'var(--pos)' : 'var(--neg)',
    'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));
  return svg;
}
function scoreRing(score, max) {
  const r = 24, c = 2 * Math.PI * r, frac = Math.max(0, Math.min(1, score / max));
  const svg = svgEl('svg', { viewBox: '0 0 58 58', class: 'score-ring' });
  svg.appendChild(svgEl('circle', { cx: 29, cy: 29, r, fill: 'none', stroke: 'var(--border)', 'stroke-width': 5 }));
  const col = frac >= 13 / 18 ? 'var(--pos)' : frac >= 0.5 ? 'var(--warn)' : 'var(--neg)';
  svg.appendChild(svgEl('circle', {
    cx: 29, cy: 29, r, fill: 'none', stroke: col, 'stroke-width': 5, 'stroke-linecap': 'round',
    'stroke-dasharray': `${(c * frac).toFixed(1)} ${c.toFixed(1)}`, transform: 'rotate(-90 29 29)',
  }));
  const t = svgEl('text', { x: 29, y: 34, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 700, fill: 'var(--text)' });
  t.textContent = score;
  svg.appendChild(t);
  return svg;
}

/* ---------- modal ---------- */
function modal(title, bodyNode, footNode, wide) {
  const root = $('#modal-root');
  const overlay = el('div', { class: 'modal-overlay', onclick: e => { if (e.target === overlay) close(); } });
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  const box = el('div', { class: 'modal' + (wide ? ' wide' : '') },
    el('div', { class: 'modal-head' },
      el('h3', {}, title),
      el('button', { class: 'icon-btn', onclick: close, title: 'Sluiten', html: '<svg viewBox="0 0 24 24"><path d="M6 5 5 6l6 6-6 6 1 1 6-6 6 6 1-1-6-6 6-6-1-1-6 6z"/></svg>' })
    ),
    el('div', { class: 'modal-body' }, bodyNode),
    footNode ? el('div', { class: 'modal-foot' }, footNode) : null
  );
  overlay.appendChild(box);
  root.appendChild(overlay);
  return { close };
}

/* ============================================================
   Router
   ============================================================ */
const TITLES = {
  overzicht: ['Overzicht', 'Je portfolio, live koersen en resultaat'],
  meldingen: ['Meldingen', 'Wat de bewaker de afgelopen tijd zag — ook als de app dicht stond'],
  historie: ['Winsthistorie', 'Aandelen die je hebt gehad en wat je ermee pakte'],
  patronen: ['Patronen', 'Leer van eerdere trades: waarom bewoog het, en herken je het weer?'],
  nieuws: ['Nieuws', 'Wat er speelt rond jouw aandelen en in de markt'],
  kansen: ['Kansen', 'Dagelijks onderzoek volgens je 18-punts checklist'],
  deepdive: ['Deep-dive', 'Zoek een aandeel zelf grondig uit voor je koopt'],
  coach: ['Coach', 'Leg een beslissing voor en laat je discipline bewaken'],
};
function setView(name) {
  App.view = name;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('#section-title').textContent = TITLES[name][0];
  $('#section-sub').textContent = TITLES[name][1];
  render();
}
function render() {
  const v = $('#view');
  v.innerHTML = '';
  if (App.view === 'overzicht') renderOverzicht(v);
  else if (App.view === 'meldingen') renderMeldingen(v);
  else if (App.view === 'historie') renderHistorie(v);
  else if (App.view === 'patronen') renderPatronen(v);
  else if (App.view === 'nieuws') renderNieuws(v);
  else if (App.view === 'kansen') renderKansen(v);
  else if (App.view === 'deepdive') renderDeepdive(v);
  else if (App.view === 'coach') renderCoach(v);
}

/* ============================================================
   COACH (discipline-bewaker)
   ============================================================ */
function renderCoach(v) {
  App.coach = App.coach || { ticker: '', name: '', action: 'Kopen', messages: [] };
  v.appendChild(el('div', { class: 'card dd-section' },
    el('h2', {}, '🧭 Je beleggings-coach'),
    el('p', { class: 'tiny muted', style: 'margin:0;line-height:1.55' }, 'Leg een beslissing voor (kopen, verkopen, bijkopen of houden). De coach toetst \'m aan de aanpak van beleggers die wéinig verliezen in dalende markten (Buffett, Klarman, Marks, Terry Smith) én aan je eigen regels, en wijst je op valkuilen. Hij bewaakt je discipline — hij geeft geen koopadvies en geen winstbelofte.')));

  const acList = el('div', { class: 'ac-list', style: 'display:none' });
  const search = el('input', { type: 'text', value: App.coach.ticker || '', placeholder: 'Aandeel (optioneel)', style: 'flex:1;min-width:150px;font-family:inherit;font-size:14px;padding:9px 11px;border:1px solid var(--border-strong);border-radius:9px;background:var(--panel);color:var(--text)' });
  search.addEventListener('input', () => { App.coach.ticker = search.value.trim().toUpperCase(); });
  attachAutocomplete(search, acList, r => { App.coach.ticker = r.symbol; App.coach.name = r.name; search.value = r.symbol; acList.style.display = 'none'; });
  const actionSel = el('select', { style: SELECT_STYLE + ';width:auto' }, ...['Kopen', 'Bijkopen', 'Verkopen', 'Houden', 'Twijfel'].map(a => el('option', { value: a, selected: App.coach.action === a ? 'selected' : null }, a)));
  actionSel.addEventListener('change', () => { App.coach.action = actionSel.value; });
  const reason = el('textarea', { rows: 2, placeholder: 'Wat wil je doen en waarom? (bv. "SAP kopen omdat de cloud hard groeit en hij ~25% onder z\'n top staat")', style: 'width:100%;font-family:inherit;font-size:13.5px;padding:9px 11px;border:1px solid var(--border-strong);border-radius:9px;background:var(--panel-2);color:var(--text);resize:vertical;margin-top:10px' });
  const askBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:10px' }, '🧭 Vraag de coach');
  askBtn.addEventListener('click', () => {
    const r = reason.value.trim();
    if (!r) { toast('Beschrijf kort je beslissing'); return; }
    const first = 'Ik overweeg: ' + App.coach.action + (App.coach.ticker ? ' van ' + App.coach.ticker : '') + '. Mijn reden: ' + r;
    reason.value = '';
    coachTurn(first);
  });
  v.appendChild(el('div', { class: 'card dd-section' },
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' },
      el('div', { class: 'ac-wrap', style: 'flex:1;min-width:150px' }, search, acList), actionSel),
    reason, askBtn));

  v.appendChild(el('div', { class: 'card dd-section', id: 'coach-chat' }));
  renderCoachChat(false);
}
function renderCoachChat(loading) {
  const box = document.getElementById('coach-chat');
  if (!box) return;
  box.innerHTML = '';
  const msgs = App.coach.messages || [];
  if (!msgs.length && !loading) { box.appendChild(el('p', { class: 'muted tiny' }, 'Nog geen gesprek. Leg hierboven een beslissing voor, dan geeft de coach zijn eerlijke check.')); return; }
  const list = el('div', { class: 'debate-msgs' });
  msgs.forEach(m => list.appendChild(el('div', { class: 'bub ' + (m.role === 'coach' ? 'coach' : 'user') },
    el('div', { class: 'who' }, m.role === 'coach' ? 'COACH' : 'JIJ'), el('div', {}, m.text))));
  if (loading) list.appendChild(el('div', { class: 'bub coach thinking' }, el('span', { class: 'spinner' }), ' de coach denkt na…'));
  box.appendChild(list);
  if (loading) return;
  if (msgs.length) {
    const ta = el('textarea', { class: 'debate-input', rows: 1, placeholder: 'Reageer of stel een vraag…' });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = ta.value.trim(); if (t) coachTurn(t); } });
    box.appendChild(el('div', { class: 'debate-input' }, ta,
      el('button', { class: 'btn btn-primary', onclick: () => { const t = ta.value.trim(); if (t) coachTurn(t); } }, 'Stuur')));
    box.appendChild(el('div', { class: 'debate-btns' },
      el('button', { class: 'btn btn-sm', onclick: () => { App.coach.messages = []; renderCoachChat(false); } }, 'Nieuw gesprek')));
  }
}
async function coachTurn(text) {
  App.coach.messages = App.coach.messages || [];
  App.coach.messages.push({ role: 'user', text });
  renderCoachChat(true);
  try {
    const d = await api('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: App.coach.ticker, action: App.coach.action, messages: App.coach.messages }) });
    if (d.reply) App.coach.messages.push({ role: 'coach', text: d.reply });
    else toast(d.error || 'De coach kon even niet reageren');
  } catch (e) { toast('Kon de coach niet bereiken'); }
  renderCoachChat(false);
}

/* ============================================================
   OVERZICHT / PORTFOLIO
   ============================================================ */
function renderOverzicht(v) {
  const holdings = App.state.holdings || [];
  v.appendChild(el('div', { class: 'cards-row', id: 'summary' },
    statCard('Totale waarde', '—', ''),
    statCard('Vandaag', '—', ''),
    statCard('Totaal rendement', '—', 'sinds je aankoop')
  ));
  const head = el('div', { class: 'section-head' },
    el('h2', {}, 'Mijn aandelen'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => holdingForm() },
      el('span', { html: '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor"><path d="M11 5v6H5v2h6v6h2v-6h6v-2h-6V5z"/></svg>' }), 'Aandeel toevoegen')
  );
  v.appendChild(head);

  if (!holdings.length) {
    v.appendChild(emptyState('portfolio', 'Nog geen aandelen',
      'Voeg je aandelen uit Saxo Investor toe om koersen en resultaat te volgen.',
      'Aandeel toevoegen', () => holdingForm()));
    return;
  }
  const table = el('table', { class: 'holdings' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Aandeel'),
      el('th', { class: 'r' }, 'Koers'),
      el('th', { class: 'r' }, 'Dag'),
      el('th', { class: 'r' }, 'Aantal'),
      el('th', { class: 'r' }, 'Waarde'),
      el('th', { class: 'r' }, 'Rendement'),
      el('th', {}, ''),
      el('th', {}, '')
    )),
    el('tbody', { id: 'holdings-body' },
      el('tr', {}, el('td', { colspan: 8, class: 'loading-row' }, el('span', { class: 'spinner' }), ' koersen ophalen…')))
  );
  v.appendChild(table);
  loadQuotes();
}
function statCard(label, value, sub, cls) {
  return el('div', { class: 'card stat' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value ' + (cls || ''), html: value }),
    el('div', { class: 'sub' }, sub || '')
  );
}
async function loadQuotes() {
  try {
    const d = await api('/api/quotes');
    App.quotes = {};
    (d.quotes || []).forEach(q => App.quotes[q.ticker] = q);
  } catch (e) {
    const body = $('#holdings-body');
    if (body) body.innerHTML = '<tr><td colspan="8" class="loading-row">Koersen ophalen mislukt (geen internet?). Klik op Ververs.</td></tr>';
    return;
  }
  paintHoldings();
}
function paintHoldings() {
  const body = $('#holdings-body');
  if (!body) return;
  body.innerHTML = '';
  let totalEur = 0, dayEur = 0, costEur = 0, costsEur = 0, haveValue = false, haveCost = false;

  App.state.holdings.forEach((h, idx) => {
    const q = App.quotes[h.ticker] || {};
    const cur = q.currency || h.currency || 'USD';
    const rate = q.eurRate || (cur === 'EUR' ? 1 : null);
    const price = q.price;
    const shares = num(h.shares);
    const buy = num(h.buyPrice);
    const value = (price != null && shares != null) ? price * shares : null;
    const valueEur = (value != null && rate) ? value * rate : null;
    if (valueEur != null) { totalEur += valueEur; haveValue = true; }
    if (value != null && q.changePct != null && rate) {
      dayEur += valueEur - (valueEur / (1 + q.changePct / 100));
    }
    let retPct = null;
    if (price != null && buy != null && buy > 0) retPct = (price / buy - 1) * 100;
    if (value != null && buy != null && shares != null && rate) { costEur += buy * shares * rate; costsEur += num(h.cost) || 0; haveCost = true; }

    const up = q.changePct != null && q.changePct >= 0;
    const needFill = shares == null || buy == null;

    body.appendChild(el('tr', {},
      el('td', {},
        el('div', { class: 'tk' },
          el('div', { class: 'logo' }, initials(h.ticker)),
          el('div', { class: 'nm' },
            el('b', {}, h.ticker),
            el('span', {}, q.name || h.name || '')
          )
        )
      ),
      el('td', { class: 'r num' }, price != null ? money(price, cur) : (q.error ? 'geen data' : '—')),
      el('td', { class: 'r' }, q.changePct != null
        ? el('span', { class: 'pill ' + (up ? 'up' : 'down') }, pct(q.changePct)) : el('span', { class: 'muted' }, '—')),
      el('td', { class: 'r num' }, shares != null ? String(h.shares) : el('span', { class: 'fill-hint', onclick: () => holdingForm(idx) }, 'aantal +')),
      el('td', { class: 'r num' }, value != null
        ? el('div', {}, el('div', {}, money(value, cur)), valueEur != null && cur !== 'EUR' ? el('div', { class: 'tiny muted' }, '≈ ' + eur(valueEur)) : null)
        : el('span', { class: 'muted' }, '—')),
      el('td', { class: 'r' }, retPct != null
        ? el('span', { class: 'chg ' + (retPct >= 0 ? 'up' : 'down') }, pct(retPct))
        : el('span', { class: 'fill-hint', onclick: () => holdingForm(idx) }, needFill ? 'aankoop +' : '—')),
      el('td', { class: 'r' }, sparkline(q.spark)),
      el('td', { class: 'r' },
        el('div', { class: 'row-actions' },
          el('button', { class: 'icon-btn', title: 'Deep-dive', onclick: () => openDeepdiveFor(h.ticker, h.name), html: '<svg viewBox="0 0 24 24"><path d="M10 4a6 6 0 1 0 3.5 10.9l4.8 4.8 1.4-1.4-4.8-4.8A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>' }),
          el('button', { class: 'icon-btn', title: 'Bewerken', onclick: () => holdingForm(idx), html: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4Zm14.7-11.3 1.3-1.3a1.4 1.4 0 0 0 0-2l-1.4-1.4a1.4 1.4 0 0 0-2 0l-1.3 1.3 3.4 3.4Z"/></svg>' }),
          el('button', { class: 'icon-btn', title: 'Verkocht → historie', onclick: () => sellForm(idx), html: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1.6 5.3c1 0 1.9.3 2.5 1l-1.1 1.1a2 2 0 0 0-1.4-.6c-.8 0-1.4.5-1.7 1.2H14l-.5 1.1h-2.1v.5H13l-.5 1.1h-1.6c.3.7.9 1.2 1.7 1.2.6 0 1.1-.2 1.4-.6l1.1 1.1c-.6.6-1.5 1-2.5 1-1.7 0-3.1-1.1-3.7-2.7H8v-1.1h.9v-.5H8v-1.1h1.2c.6-1.6 2-2.7 3.7-2.7Z"/></svg>' }),
          el('button', { class: 'icon-btn', title: 'Verwijderen', onclick: () => removeHolding(idx), html: '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7L6 7Zm3-3h6l1 2H8l1-2Z"/></svg>' })
        )
      )
    ));
  });

  // samenvatting-kaarten bijwerken
  const summary = $('#summary');
  if (summary && haveValue) {
    const dayPct = (totalEur - dayEur) > 0 ? dayEur / (totalEur - dayEur) * 100 : null;
    const base = costEur + costsEur;
    const totRet = haveCost && base > 0 ? (totalEur - base) / base * 100 : null;
    summary.replaceWith(el('div', { class: 'cards-row', id: 'summary' },
      statCard('Totale waarde', eur(totalEur), App.state.holdings.length + (App.state.holdings.length === 1 ? ' positie' : ' posities')),
      statCard('Vandaag', (dayEur >= 0 ? '+' : '−') + eur(Math.abs(dayEur)),
        dayPct != null ? pct(dayPct) : ''),
      totRet != null
        ? statCard('Totaal rendement (netto)', pct(totRet), 'winst ' + eur(totalEur - base) + (costsEur > 0 ? ' · kosten ' + eur(costsEur) : ''))
        : statCard('Totaal rendement', '—', 'vul aankoopprijzen in')
    ));
    // kleur op de dag/rendement waarde
    const cards = $('#summary').querySelectorAll('.value');
    if (cards[1]) cards[1].style.color = dayEur >= 0 ? 'var(--pos)' : 'var(--neg)';
    if (cards[2] && totRet != null) cards[2].style.color = totRet >= 0 ? 'var(--pos)' : 'var(--neg)';
  }
}

const SELECT_STYLE = 'width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--border-strong);background:var(--panel-2);color:var(--text);font-family:inherit;font-size:14px';
function currencySelect(selected) {
  return el('select', { style: SELECT_STYLE },
    ...CURRENCIES.map(c => el('option', { value: c, selected: (selected || 'USD') === c ? 'selected' : null }, c)));
}
// Zoek-autocomplete: koppelt een zoekveld aan de resultatenlijst en roept onPick(resultaat) aan.
function attachAutocomplete(inputEl, listEl, onPick) {
  let timer = null;
  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { listEl.style.display = 'none'; return; }
    timer = setTimeout(async () => {
      let res = [];
      try { const d = await api('/api/search?q=' + encodeURIComponent(q)); res = d.results || []; } catch (e) {}
      listEl.innerHTML = '';
      if (!res.length) { listEl.appendChild(el('div', { class: 'ac-empty' }, 'Niets gevonden — typ anders de ticker rechtstreeks in.')); listEl.style.display = 'block'; return; }
      res.forEach(r => listEl.appendChild(el('div', { class: 'ac-item', onmousedown: e => { e.preventDefault(); onPick(r); } },
        el('span', { class: 'sym' }, r.symbol),
        el('span', { class: 'nm2' }, r.name),
        el('span', { class: 'exch' }, r.exchange))));
      listEl.style.display = 'block';
    }, 280);
  });
  inputEl.addEventListener('blur', () => setTimeout(() => { listEl.style.display = 'none'; }, 150));
}

function holdingForm(idx) {
  const editing = idx != null;
  const h = editing ? App.state.holdings[idx] : { ticker: '', name: '', shares: '', buyPrice: '', buyDate: '', currency: 'USD' };
  const f = {};
  const acList = el('div', { class: 'ac-list', style: 'display:none' });
  const search = el('input', { type: 'text', placeholder: 'Typ een naam of ticker, bv. "ASML" of "Nvidia"' });
  f.currency = currencySelect(h.currency);
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Zoek aandeel (alle beurzen die Saxo ook heeft)'),
      el('div', { class: 'ac-wrap' }, search, acList)),
    el('div', { class: 'form-grid' },
      el('div', {}, el('label', {}, 'Ticker *'), f.ticker = el('input', { type: 'text', value: h.ticker || '', placeholder: 'bv. ASML.AS' })),
      el('div', {}, el('label', {}, 'Naam'), f.name = el('input', { type: 'text', value: h.name || '' })),
      el('div', {}, el('label', {}, 'Aantal aandelen'), f.shares = el('input', { type: 'text', value: h.shares ?? '', placeholder: 'bv. 12' })),
      el('div', {}, el('label', {}, 'Aankoopkoers (per aandeel)'), f.buyPrice = el('input', { type: 'text', value: h.buyPrice ?? '', placeholder: 'bv. 210,50' })),
      el('div', {}, el('label', {}, 'Aankoopdatum (optioneel)'), f.buyDate = el('input', { type: 'text', value: h.buyDate || '', placeholder: 'jjjj-mm-dd' })),
      el('div', {}, el('label', {}, 'Valuta'), f.currency),
      el('div', {}, el('label', {}, 'Transactiekosten (€)'), f.cost = el('input', { type: 'text', value: h.cost ?? '', placeholder: 'bv. 3,00' }))
    ),
    el('p', { class: 'tiny muted', style: 'margin-top:12px' }, 'Kies je via zoeken? Dan vult hij ticker, naam en valuta automatisch goed in — ook het beurs-achtervoegsel zoals .AS (Amsterdam). De transactiekosten zijn wat Saxo je rekent (in euro).')
  );
  attachAutocomplete(search, acList, r => {
    f.ticker.value = r.symbol; f.name.value = r.name; search.value = r.symbol + ' — ' + r.name;
    acList.style.display = 'none';
    api('/api/quotes?tickers=' + encodeURIComponent(r.symbol)).then(d => {
      const qd = (d.quotes || []).find(x => x.ticker === r.symbol);
      if (qd && qd.currency) f.currency.value = qd.currency;
      if (qd && qd.name && !f.name.value) f.name.value = qd.name;
    }).catch(() => {});
  });
  const save = el('button', { class: 'btn btn-primary' }, editing ? 'Opslaan' : 'Toevoegen');
  const m = modal(editing ? 'Aandeel bewerken' : 'Aandeel toevoegen', body,
    [el('button', { class: 'btn', onclick: () => m.close() }, 'Annuleren'), save]);
  save.addEventListener('click', async () => {
    const ticker = f.ticker.value.trim().toUpperCase();
    if (!ticker) { f.ticker.focus(); toast('Kies of typ een ticker'); return; }
    const rec = { ticker, name: f.name.value.trim(), shares: num(f.shares.value), buyPrice: num(f.buyPrice.value), buyDate: f.buyDate.value.trim(), currency: f.currency.value, cost: num(f.cost.value) };
    if (editing) App.state.holdings[idx] = rec; else App.state.holdings.push(rec);
    await saveHoldings();
    m.close();
    render();
  });
}
async function removeHolding(idx) {
  const h = App.state.holdings[idx];
  if (!confirm(`"${h.ticker}" verwijderen uit je portfolio?\n(Je verkoopt hiermee niets — dit haalt het aandeel alleen uit de app.)`)) return;
  App.state.holdings.splice(idx, 1);
  await saveHoldings();
  render();
}
async function saveHoldings() {
  try {
    await api('/api/holdings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ holdings: App.state.holdings }) });
    toast('Portfolio opgeslagen');
  } catch (e) { toast('Opslaan mislukt'); }
}

/* ============================================================
   HISTORIE / winsthistorie
   ============================================================ */
function statColor(label, value, color, sub) {
  const c = statCard(label, value, sub);
  if (color) c.querySelector('.value').style.color = color;
  return c;
}
function saveHistory() {
  return api('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history: App.state.history }) })
    .catch(() => toast('Opslaan historie mislukt'));
}
// "Verkocht" vanuit Overzicht -> verplaatst een positie naar de historie
function sellForm(idx) {
  const h = App.state.holdings[idx];
  const q = App.quotes[h.ticker] || {};
  const f = {};
  const body = el('div', {},
    el('p', { class: 'tiny muted', style: 'margin-top:0' }, 'Dit haalt de positie uit je portfolio en zet hem in je Historie. Je verkoopt hiermee niets in Saxo — dat doe je daar zelf.'),
    el('div', { class: 'form-grid' },
      el('div', {}, el('label', {}, 'Verkoopkoers (per aandeel)'), f.sell = el('input', { type: 'text', value: q.price != null ? String(round2(q.price)) : (h.buyPrice ?? '') })),
      el('div', {}, el('label', {}, 'Verkoopdatum'), f.date = el('input', { type: 'text', value: todayStr(), placeholder: 'jjjj-mm-dd' })),
      el('div', {}, el('label', {}, 'Verkoopkosten (€)'), f.sellCost = el('input', { type: 'text', placeholder: 'bv. 3,00' })),
      el('div', {}, el('label', {}, 'Aankoopkosten (€)'), f.buyCost = el('input', { type: 'text', value: h.cost ?? '', placeholder: 'bv. 3,00' })),
      el('div', { class: 'full' }, el('label', {}, 'Notitie (optioneel)'), f.note = el('input', { type: 'text', placeholder: 'bv. reden van verkoop' }))
    )
  );
  const save = el('button', { class: 'btn btn-primary' }, 'Naar historie');
  const m = modal('Verkocht: ' + h.ticker, body, [el('button', { class: 'btn', onclick: () => m.close() }, 'Annuleren'), save]);
  save.addEventListener('click', async () => {
    const sell = num(f.sell.value), buy = num(h.buyPrice);
    App.state.history = asArr(App.state.history);
    App.state.history.push({
      ticker: h.ticker, name: h.name || q.name || '', shares: num(h.shares),
      buyPrice: buy, sellPrice: sell, currency: h.currency || q.currency || 'USD',
      buyDate: h.buyDate || '', sellDate: f.date.value.trim() || todayStr(),
      returnPct: (sell != null && buy) ? (sell / buy - 1) * 100 : null,
      buyCost: num(f.buyCost.value), sellCost: num(f.sellCost.value),
      note: f.note.value.trim(),
    });
    App.state.holdings.splice(idx, 1);
    await saveHistory(); await saveHoldings();
    m.close(); toast('Naar historie verplaatst'); render();
  });
}
function loadBenchmark() {
  if (App.benchmark || App._bmLoading) return;
  App._bmLoading = true;
  api('/api/benchmark').then(d => {
    App.benchmark = d; App._bmLoading = false;
    if (App.view === 'historie' || App.view === 'overzicht') render();
  }).catch(() => { App._bmLoading = false; });
}
function bmReturn(fromDate, toDate) {
  const bm = App.benchmark;
  if (!bm || !bm.closes || !bm.closes.length || !fromDate) return null;
  const near = ds => {
    const t = new Date(ds + 'T12:00:00').getTime() / 1000;
    if (isNaN(t)) return null;
    let best = null;
    for (const [ts, c] of bm.closes) { if (ts <= t) best = c; else break; }
    return best != null ? best : bm.closes[0][1];
  };
  const a = near(fromDate);
  const b = toDate ? near(toDate) : (bm.last || bm.closes[bm.closes.length - 1][1]);
  return (a && b) ? (b / a - 1) * 100 : null;
}
// rendement en winst NA transactiekosten (kosten in euro)
function tradeNet(t) {
  const gross = t.profitEur != null ? Number(t.profitEur)
    : ((t.sellPrice != null && t.buyPrice != null && t.shares != null) ? (t.sellPrice - t.buyPrice) * t.shares : null);
  const cost = (num(t.buyCost) || 0) + (num(t.sellCost) || 0);
  const netProfit = gross != null ? gross - cost : null;
  let costBasis = null;
  if (t.profitEur != null && t.returnPct) costBasis = Number(t.profitEur) / (Number(t.returnPct) / 100);
  else if (t.buyPrice != null && t.shares != null) costBasis = t.buyPrice * t.shares;
  const netPct = (netProfit != null && costBasis) ? netProfit / costBasis * 100 : (t.returnPct != null ? Number(t.returnPct) : null);
  return { gross, cost, netProfit, netPct, cur: t.profitEur != null ? 'EUR' : (t.currency || 'EUR') };
}
function renderHistorie(v) {
  const hist = asArr(App.state.history);
  const closed = hist.filter(t => t && t.returnPct != null);
  const n = closed.length;
  loadBenchmark();

  const nets = closed.map(tradeNet);
  const avgNet = n ? nets.reduce((s, x) => s + (x.netPct ?? 0), 0) / n : null;
  const wins = nets.filter(x => (x.netPct ?? 0) >= 0).length;
  const totalCost = nets.reduce((s, x) => s + (x.cost || 0), 0);
  const netProfitSum = nets.reduce((s, x) => s + (x.netProfit || 0), 0);

  // vergelijking met de wereld-ETF (alleen trades met beide datums)
  const dated = closed.filter(t => t.buyDate && t.sellDate);
  let bmYou = null, bmEtf = null;
  if (dated.length && App.benchmark && App.benchmark.closes && App.benchmark.closes.length) {
    let sy = 0, se = 0, k = 0;
    dated.forEach(t => { const er = bmReturn(t.buyDate, t.sellDate); if (er != null) { sy += tradeNet(t).netPct ?? 0; se += er; k++; } });
    if (k) { bmYou = sy / k; bmEtf = se / k; }
  }

  v.appendChild(el('div', { class: 'cards-row' },
    statCard('Afgeronde trades', String(n), n ? (wins + ' met winst · kosten ' + eur(totalCost)) : 'nog geen'),
    statColor('Netto rendement (gem.)', avgNet != null ? pct(avgNet) : '—', avgNet != null ? (avgNet >= 0 ? 'var(--pos)' : 'var(--neg)') : null, n ? ('netto winst ' + eur(netProfitSum)) : 'na kosten'),
    bmYou != null
      ? statColor('vs Wereld-ETF', (bmYou - bmEtf >= 0 ? '+' : '−') + Math.abs(bmYou - bmEtf).toFixed(1).replace('.', ',') + '%', bmYou >= bmEtf ? 'var(--pos)' : 'var(--neg)', 'jij ' + pct(bmYou) + ' · ETF ' + pct(bmEtf))
      : statCard('vs Wereld-ETF', '—', dated.length ? 'ETF laden…' : 'vul koop/verkoopdatums in')
  ));
  v.appendChild(el('div', { class: 'section-head' },
    el('h2', {}, 'Afgeronde posities'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => tradeForm() }, '+ Trade toevoegen')));

  if (!closed.length) {
    v.appendChild(emptyState('historie', 'Nog geen historie',
      'Verkoop je een aandeel? Gebruik het €-icoon in Overzicht om het naar je historie te verplaatsen. Of voeg een eerdere trade handmatig toe.',
      'Trade toevoegen', () => tradeForm()));
    return;
  }
  const rows = closed.slice().sort((a, b) => new Date(b.sellDate || 0) - new Date(a.sellDate || 0));
  v.appendChild(el('table', { class: 'holdings' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Aandeel'), el('th', {}, 'Periode'),
      el('th', { class: 'r' }, 'Rendement (netto)'), el('th', { class: 'r' }, 'Kosten'),
      el('th', { class: 'r' }, 'Winst/verlies'), el('th', { class: 'r' }, 'vs ETF'), el('th', {}, ''))),
    el('tbody', {}, ...rows.map(t => histRow(t, hist.indexOf(t))))
  ));
  v.appendChild(el('p', { class: 'tiny muted', style: 'margin-top:12px' },
    'Netto = na transactiekosten. "vs ETF" vergelijkt jouw netto rendement met ' + ((App.benchmark && App.benchmark.name) || 'een wereld-ETF') + ' over dezelfde periode (groen = jij won, rood = ETF won; alleen bij ingevulde datums).'));
}
function histRow(t, idx) {
  const x = tradeNet(t);
  const pos = (x.netPct ?? 0) >= 0;
  const period = (t.buyDate || t.sellDate) ? (fmtDate(t.buyDate) || '?') + ' → ' + (fmtDate(t.sellDate) || '?') : 'datum onbekend';
  const er = (t.buyDate && t.sellDate) ? bmReturn(t.buyDate, t.sellDate) : null;
  return el('tr', {},
    el('td', {}, el('div', { class: 'tk' },
      el('div', { class: 'logo' }, initials(t.ticker)),
      el('div', { class: 'nm' }, el('b', {}, t.ticker), el('span', {}, t.name || '')))),
    el('td', {}, el('div', { class: 'hist-period' }, period),
      t.note ? el('div', { class: 'hist-note' }, t.note) : null),
    el('td', { class: 'r' },
      el('div', { class: pos ? 'ret-pos' : 'ret-neg' }, x.netPct != null ? pct(x.netPct) : '—'),
      (x.cost > 0 && t.returnPct != null) ? el('div', { class: 'tiny muted' }, 'bruto ' + pct(Number(t.returnPct))) : null),
    el('td', { class: 'r num' }, x.cost > 0 ? eur(x.cost) : el('span', { class: 'muted' }, '—')),
    el('td', { class: 'r num' }, x.netProfit != null ? el('span', { class: pos ? 'ret-pos' : 'ret-neg' }, (x.netProfit >= 0 ? '+' : '−') + money(Math.abs(x.netProfit), x.cur)) : '—'),
    el('td', { class: 'r' }, er != null
      ? el('span', { class: (x.netPct ?? 0) >= er ? 'ret-pos' : 'ret-neg' }, ((x.netPct ?? 0) >= er ? '✓ ' : '✗ ') + pct(er))
      : el('span', { class: 'muted tiny' }, t.buyDate && t.sellDate ? '—' : 'geen datum')),
    el('td', { class: 'r' }, el('div', { class: 'row-actions' },
      el('button', { class: 'icon-btn', title: 'Bewerken', onclick: () => tradeForm(idx), html: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4Zm14.7-11.3 1.3-1.3a1.4 1.4 0 0 0 0-2l-1.4-1.4a1.4 1.4 0 0 0-2 0l-1.3 1.3 3.4 3.4Z"/></svg>' }),
      el('button', { class: 'icon-btn', title: 'Verwijderen', onclick: () => removeTrade(idx), html: '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7L6 7Zm3-3h6l1 2H8l1-2Z"/></svg>' }))));
}
function tradeForm(idx) {
  const editing = idx != null;
  const t = editing ? App.state.history[idx] : { ticker: '', name: '', shares: '', buyPrice: '', sellPrice: '', buyDate: '', sellDate: todayStr(), currency: 'USD', note: '' };
  const f = {};
  const acList = el('div', { class: 'ac-list', style: 'display:none' });
  const search = el('input', { type: 'text', placeholder: 'Zoek op naam of ticker' });
  f.currency = currencySelect(t.currency);
  const body = el('div', {},
    !editing ? el('div', { class: 'field' }, el('label', {}, 'Zoek aandeel'), el('div', { class: 'ac-wrap' }, search, acList)) : null,
    el('div', { class: 'form-grid' },
      el('div', {}, el('label', {}, 'Ticker *'), f.ticker = el('input', { type: 'text', value: t.ticker || '' })),
      el('div', {}, el('label', {}, 'Naam'), f.name = el('input', { type: 'text', value: t.name || '' })),
      el('div', {}, el('label', {}, 'Aantal'), f.shares = el('input', { type: 'text', value: t.shares ?? '' })),
      el('div', {}, el('label', {}, 'Valuta'), f.currency),
      el('div', {}, el('label', {}, 'Aankoopkoers'), f.buyPrice = el('input', { type: 'text', value: t.buyPrice ?? '' })),
      el('div', {}, el('label', {}, 'Verkoopkoers'), f.sellPrice = el('input', { type: 'text', value: t.sellPrice ?? '' })),
      el('div', {}, el('label', {}, 'Aankoopdatum'), f.buyDate = el('input', { type: 'text', value: t.buyDate || '', placeholder: 'jjjj-mm-dd' })),
      el('div', {}, el('label', {}, 'Verkoopdatum'), f.sellDate = el('input', { type: 'text', value: t.sellDate || '', placeholder: 'jjjj-mm-dd' })),
      el('div', {}, el('label', {}, 'Aankoopkosten (€)'), f.buyCost = el('input', { type: 'text', value: t.buyCost ?? '', placeholder: 'bv. 3,00' })),
      el('div', {}, el('label', {}, 'Verkoopkosten (€)'), f.sellCost = el('input', { type: 'text', value: t.sellCost ?? '', placeholder: 'bv. 3,00' })),
      el('div', { class: 'full' }, el('label', {}, 'Notitie (optioneel)'), f.note = el('input', { type: 'text', value: t.note || '' }))
    )
  );
  attachAutocomplete(search, acList, r => {
    f.ticker.value = r.symbol; f.name.value = r.name; search.value = r.symbol + ' — ' + r.name; acList.style.display = 'none';
    api('/api/quotes?tickers=' + encodeURIComponent(r.symbol)).then(d => { const qd = (d.quotes || []).find(x => x.ticker === r.symbol); if (qd && qd.currency) f.currency.value = qd.currency; }).catch(() => {});
  });
  const save = el('button', { class: 'btn btn-primary' }, editing ? 'Opslaan' : 'Toevoegen');
  const m = modal(editing ? 'Trade bewerken' : 'Trade toevoegen', body, [el('button', { class: 'btn', onclick: () => m.close() }, 'Annuleren'), save]);
  save.addEventListener('click', async () => {
    const ticker = f.ticker.value.trim().toUpperCase();
    if (!ticker) { toast('Kies of typ een ticker'); return; }
    const buy = num(f.buyPrice.value), sell = num(f.sellPrice.value);
    const rec = {
      ticker, name: f.name.value.trim(), shares: num(f.shares.value),
      buyPrice: buy, sellPrice: sell, currency: f.currency.value,
      buyDate: f.buyDate.value.trim(), sellDate: f.sellDate.value.trim() || todayStr(),
      returnPct: (sell != null && buy) ? (sell / buy - 1) * 100 : null,
      buyCost: num(f.buyCost.value), sellCost: num(f.sellCost.value),
      note: f.note.value.trim(),
    };
    App.state.history = asArr(App.state.history);
    if (editing) App.state.history[idx] = rec; else App.state.history.push(rec);
    await saveHistory(); m.close(); render();
  });
}
async function removeTrade(idx) {
  if (!confirm('Deze trade uit je historie verwijderen?')) return;
  App.state.history.splice(idx, 1);
  await saveHistory(); render();
}

/* ============================================================
   MELDINGEN (bewaking)
   ============================================================ */
const ALERT_META = {
  portfolio: { icon: '📉', label: 'Portefeuille' },
  trade: { icon: '🚨', label: 'Trade-signaal' },
  post: { icon: '📰', label: 'Nieuwe post' },
  podcast: { icon: '🎧', label: 'Podcast' },
  sec: { icon: '📊', label: '13F-update' },
  info: { icon: 'ℹ️', label: 'Info' },
};
const PORTFOLIO_SUBTYPE = {
  dag: 'Flinke dagdaling',
  aankoop: 'Onder je aankoopprijs',
  volume: 'Uitstroom-signaal (hoog volume + daling)',
};
function alertMessage(a) {
  if (a.kind === 'portfolio') {
    const s = PORTFOLIO_SUBTYPE[a.subtype] || 'Koersbeweging';
    return { title: a.title || a.ticker || 'Aandeel', detail: s + (a.ticker ? ' · ' + a.ticker : '') };
  }
  return { title: a.title || (ALERT_META[a.kind] || {}).label || 'Melding', detail: a.detail || a.source || '' };
}
function renderMeldingen(v) {
  const alerts = asArr(App.state.alerts).slice().sort((a, b) => (b.time || 0) - (a.time || 0));
  markAlertsSeen();
  v.appendChild(el('div', { class: 'section-head' },
    el('h2', {}, 'Meldingen'),
    el('span', { class: 'hint' }, 'De bewaker checkt elke 5 min — ook als de app dicht staat')));
  if (!alerts.length) {
    v.appendChild(emptyState('meldingen', 'Nog geen meldingen',
      'Zodra er iets gebeurt met je aandelen of je bronnen, verschijnt het hier (en in Telegram).'));
    return;
  }
  const list = el('div', { class: 'card news-list' });
  alerts.forEach(a => {
    const m = ALERT_META[a.kind] || ALERT_META.info;
    const msg = alertMessage(a);
    const attrs = a.link ? { class: 'alert-item', href: a.link, target: '_blank', rel: 'noopener' } : { class: 'alert-item' };
    list.appendChild(el(a.link ? 'a' : 'div', attrs,
      el('div', { class: 'alert-ic ' + (a.kind || 'info') }, m.icon),
      el('div', { class: 'alert-body' },
        el('div', { class: 'alert-title' }, msg.title),
        msg.detail ? el('div', { class: 'alert-detail' }, msg.detail) : null,
        el('div', { class: 'alert-time' }, timeAgo(a.time)))));
  });
  v.appendChild(list);
}
function latestAlertTime() {
  return asArr(App.state.alerts).reduce((mx, a) => Math.max(mx, a.time || 0), 0);
}
function updateAlertBadge() {
  const badge = document.getElementById('nav-badge');
  if (!badge) return;
  let lastSeen = 0;
  try { lastSeen = parseInt(localStorage.getItem('alertsSeen') || '0', 10) || 0; } catch (e) {}
  const unseen = asArr(App.state.alerts).filter(a => (a.time || 0) > lastSeen).length;
  if (unseen > 0) { badge.textContent = unseen > 99 ? '99+' : String(unseen); badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }
}
function markAlertsSeen() {
  try { localStorage.setItem('alertsSeen', String(latestAlertTime())); } catch (e) {}
  updateAlertBadge();
}

/* ============================================================
   PATRONEN (leren van eerdere trades)
   ============================================================ */
function renderPatronen(v) {
  const pats = asArr(App.state.patterns);
  v.appendChild(el('div', { class: 'section-head' },
    el('h2', {}, 'Patronen & lessen'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => patternForm() }, '+ Patroon toevoegen')));
  if (!pats.length) {
    v.appendChild(emptyState('patronen', 'Nog geen patronen',
      'Leg een afgeronde trade vast als casus: waarom ging hij omlaag, waarom herstelde hij, en welk patroon herken je? Zo zie je het de volgende keer sneller aankomen.',
      'Patroon toevoegen', () => patternForm()));
    return;
  }
  pats.forEach((p, i) => v.appendChild(patternCard(p, i)));
}
function patternCard(p, idx) {
  const ret = (p.returnPct !== '' && p.returnPct != null && !isNaN(Number(p.returnPct))) ? Number(p.returnPct) : null;
  return el('div', { class: 'card pat' },
    el('div', { class: 'pat-head' },
      el('div', { class: 'logo' }, initials(p.ticker)),
      el('div', { class: 't' },
        el('b', {}, p.title || p.name || p.ticker),
        el('div', { class: 'sub' }, (p.ticker || '') + (p.name ? ' · ' + p.name : '') +
          ((p.boughtWhen || p.soldWhen) ? '  |  ' + (p.boughtWhen || '?') + ' → ' + (p.soldWhen || '?') : ''))),
      ret != null ? el('span', { class: ret >= 0 ? 'ret-pos' : 'ret-neg', style: 'font-size:16px' }, pct(ret)) : null),
    el('div', { class: 'pat-grid' },
      el('div', { class: 'pat-block down' }, el('div', { class: 'lbl' }, '▼ Waarom omlaag'), el('div', { class: 'txt' }, p.whyLow || '—')),
      el('div', { class: 'pat-block up' }, el('div', { class: 'lbl' }, '▲ Waarom weer omhoog'), el('div', { class: 'txt' }, p.whyHigh || '—'))),
    p.pattern ? el('div', { class: 'pat-key' }, el('div', { class: 'lbl' }, '⟳ Het patroon — waar herken je dit aan'), el('div', { class: 'txt' }, p.pattern)) : null,
    p.lesson ? el('div', { class: 'pat-lesson' }, el('b', {}, 'Les: '), p.lesson) : null,
    el('div', { class: 'pat-foot' },
      el('button', { class: 'btn btn-sm', onclick: () => patternForm(idx) }, 'Bewerken'),
      el('button', { class: 'btn btn-sm btn-danger', onclick: () => removePattern(idx) }, 'Verwijderen')));
}
function patternForm(idx) {
  const editing = idx != null;
  const p = editing ? App.state.patterns[idx] : { ticker: '', name: '', title: '', whyLow: '', whyHigh: '', pattern: '', lesson: '', boughtWhen: '', soldWhen: '', returnPct: '' };
  const f = {};
  const acList = el('div', { class: 'ac-list', style: 'display:none' });
  const search = el('input', { type: 'text', placeholder: 'Zoek aandeel (naam of ticker)' });
  const body = el('div', {},
    !editing ? el('div', { class: 'field' }, el('label', {}, 'Zoek aandeel'), el('div', { class: 'ac-wrap' }, search, acList)) : null,
    el('div', { class: 'form-grid' },
      el('div', {}, el('label', {}, 'Ticker'), f.ticker = el('input', { type: 'text', value: p.ticker || '' })),
      el('div', {}, el('label', {}, 'Naam'), f.name = el('input', { type: 'text', value: p.name || '' })),
      el('div', { class: 'full' }, el('label', {}, 'Titel van de casus'), f.title = el('input', { type: 'text', value: p.title || '', placeholder: 'bv. Gekocht in de dip, verkocht op de top' })),
      el('div', {}, el('label', {}, 'Gekocht (wanneer)'), f.boughtWhen = el('input', { type: 'text', value: p.boughtWhen || '', placeholder: 'bv. nov 2024' })),
      el('div', {}, el('label', {}, 'Verkocht (wanneer)'), f.soldWhen = el('input', { type: 'text', value: p.soldWhen || '', placeholder: 'bv. jul 2025' })),
      el('div', {}, el('label', {}, 'Rendement % (optioneel)'), f.returnPct = el('input', { type: 'text', value: p.returnPct ?? '' })),
      el('div', { class: 'full' }, el('label', {}, 'Waarom ging hij omlaag / stond hij laag?'), f.whyLow = el('textarea', {}, p.whyLow || '')),
      el('div', { class: 'full' }, el('label', {}, 'Waarom herstelde / steeg hij weer?'), f.whyHigh = el('textarea', {}, p.whyHigh || '')),
      el('div', { class: 'full' }, el('label', {}, 'Het patroon — waaraan herken je dit de volgende keer?'), f.pattern = el('textarea', {}, p.pattern || '')),
      el('div', { class: 'full' }, el('label', {}, 'Les voor de toekomst'), f.lesson = el('textarea', {}, p.lesson || ''))
    )
  );
  attachAutocomplete(search, acList, r => { f.ticker.value = r.symbol; f.name.value = r.name; search.value = r.symbol + ' — ' + r.name; acList.style.display = 'none'; });
  const save = el('button', { class: 'btn btn-primary' }, editing ? 'Opslaan' : 'Toevoegen');
  const m = modal(editing ? 'Patroon bewerken' : 'Patroon toevoegen', body, [el('button', { class: 'btn', onclick: () => m.close() }, 'Annuleren'), save], true);
  save.addEventListener('click', async () => {
    const rec = {
      ticker: f.ticker.value.trim().toUpperCase(), name: f.name.value.trim(), title: f.title.value.trim(),
      boughtWhen: f.boughtWhen.value.trim(), soldWhen: f.soldWhen.value.trim(), returnPct: f.returnPct.value.trim(),
      whyLow: f.whyLow.value.trim(), whyHigh: f.whyHigh.value.trim(), pattern: f.pattern.value.trim(), lesson: f.lesson.value.trim(),
    };
    if (!rec.ticker && !rec.title) { toast('Vul minstens een ticker of titel in'); return; }
    App.state.patterns = asArr(App.state.patterns);
    if (editing) App.state.patterns[idx] = rec; else App.state.patterns.push(rec);
    await savePatterns(); m.close(); render();
  });
}
function savePatterns() {
  return api('/api/patterns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patterns: App.state.patterns }) }).catch(() => toast('Opslaan mislukt'));
}
async function removePattern(idx) {
  if (!confirm('Dit patroon verwijderen?')) return;
  App.state.patterns.splice(idx, 1);
  await savePatterns(); render();
}

/* ============================================================
   DEEP-DIVE DISCUSSIE (advocaat van de duivel via Claude)
   ============================================================ */
function debateContext() {
  const dd = App.dd; const L = [];
  if (dd.verhaal.wat) L.push('Wat het doet: ' + dd.verhaal.wat);
  if (dd.verhaal.waarom) L.push('Waarom nu (niet gewoon een ETF): ' + dd.verhaal.waarom);
  const tw = CHECKLIST.filter(c => ['twijfel', 'slecht'].includes((dd.checklist[c[0]] || {}).verdict))
    .map(c => c[1] + (dd.checklist[c[0]].note ? ' (' + dd.checklist[c[0]].note + ')' : ''));
  if (tw.length) L.push('Zwakke punten/twijfels uit de checklist: ' + tw.join('; '));
  const risks = [dd.duivel.risk1, dd.duivel.risk2, dd.duivel.risk3].filter(Boolean);
  if (risks.length) L.push('Risico\'s die hij zelf al ziet: ' + risks.join('; '));
  return L.join('\n');
}
async function debateTurn(userText) {
  App.dd.debate = asArr(App.dd.debate);
  if (userText) App.dd.debate.push({ role: 'user', text: userText });
  renderDebate(true);
  try {
    const d = await api('/api/debate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: App.dd.ticker, name: App.dd.name, context: debateContext(), messages: App.dd.debate }),
    });
    if (d.reply) App.dd.debate.push({ role: 'devil', text: d.reply });
    else toast(d.error || 'De advocaat kon even niet reageren');
  } catch (e) { toast('Kon de advocaat niet bereiken'); }
  renderDebate(false);
}
function renderDebate(loading) {
  const box = document.getElementById('dd-debate-body');
  if (!box) return;
  box.innerHTML = '';
  const msgs = App.dd.debate = asArr(App.dd.debate);
  const list = el('div', { class: 'debate-msgs' });
  msgs.forEach(m => list.appendChild(el('div', { class: 'bub ' + (m.role === 'devil' ? 'devil' : 'user') },
    el('div', { class: 'who' }, m.role === 'devil' ? 'ADVOCAAT VAN DE DUIVEL' : 'JIJ'),
    el('div', {}, m.text))));
  if (loading) list.appendChild(el('div', { class: 'bub devil thinking' }, el('span', { class: 'spinner' }), ' de advocaat denkt na…'));
  if (msgs.length || loading) box.appendChild(list);
  else box.appendChild(el('div', { class: 'debate-empty' }, 'Nog geen discussie. Klik hieronder — Claude geeft zijn scherpste tegenargument tegen dit aandeel, en jij verdedigt je keuze.'));

  if (loading) return;
  const lastIsDevil = msgs.length && msgs[msgs.length - 1].role === 'devil';
  if (lastIsDevil) {
    const ta = el('textarea', { placeholder: 'Jouw weerlegging…' });
    box.appendChild(el('div', { class: 'debate-input' }, ta,
      el('button', { class: 'btn btn-primary', onclick: () => { const t = ta.value.trim(); if (t) debateTurn(t); else toast('Typ je weerlegging'); } }, 'Reageer')));
    box.appendChild(el('div', { class: 'debate-btns' },
      el('button', { class: 'btn btn-sm', onclick: () => debateTurn(null) }, 'Nog een tegenargument'),
      el('span', { class: 'tiny muted', style: 'align-self:center' }, 'Overtuigd? Sla de deep-dive op om de discussie te bewaren.')));
  } else {
    box.appendChild(el('div', { class: 'debate-btns' },
      el('button', { class: 'btn btn-primary', onclick: () => debateTurn(null) }, msgs.length ? 'Volgende tegenargument' : 'Daag me uit')));
  }
}

/* ============================================================
   NIEUWS
   ============================================================ */
async function renderNieuws(v) {
  const grid = el('div', { class: 'news-grid' },
    el('div', {},
      el('div', { class: 'section-head' }, el('h2', {}, 'Rond jouw aandelen'), el('span', { class: 'hint', id: 'news-hint' }, 'laden…')),
      el('div', { class: 'card news-list', id: 'ticker-news' }, el('div', { class: 'loading-row' }, el('span', { class: 'spinner' }), ' nieuws ophalen…'))
    ),
    el('div', {},
      el('div', { class: 'section-head' }, el('h2', {}, 'Jouw bronnen & markt')),
      el('div', { class: 'card news-list', id: 'general-news' }, el('div', { class: 'loading-row' }, el('span', { class: 'spinner' })))
    )
  );
  v.appendChild(grid);
  try {
    const d = await api('/api/news');
    paintNews(d);
  } catch (e) {
    $('#ticker-news').innerHTML = '<div class="loading-row">Nieuws ophalen mislukt. Klik op Ververs.</div>';
    $('#general-news').innerHTML = '';
  }
}
function newsItem(n) {
  const chip = n.kind === 'blog' ? 'blog' : n.kind === 'podcast' ? 'podcast' : '';
  return el('a', { class: 'news-item', href: n.link || '#', target: '_blank', rel: 'noopener', style: 'display:block' },
    el('div', { class: 'news-meta' },
      el('span', { class: 'src-chip ' + chip }, n.publisher || n.source || 'Nieuws'),
      el('span', { class: 'news-time' }, timeAgo(n.time)),
      ...((n.tickers || []).slice(0, 4).map(t => el('span', { class: 'tk-chip' }, t)))
    ),
    el('div', { class: 'news-title' }, n.title || '(geen titel)'),
    n.summary ? el('div', { class: 'news-sum' }, n.summary) : null
  );
}
function paintNews(d) {
  const tn = $('#ticker-news'); tn.innerHTML = '';
  const groups = d.tickers || {};
  const keys = Object.keys(groups);
  $('#news-hint').textContent = keys.length ? keys.join(' · ') : '';
  let merged = [];
  keys.forEach(t => (groups[t] || []).forEach(n => merged.push(n)));
  merged.sort((a, b) => (b.time || 0) - (a.time || 0));
  if (!merged.length) tn.appendChild(el('div', { class: 'loading-row' }, App.state.holdings.length ? 'Geen recent nieuws gevonden voor je aandelen.' : 'Voeg eerst aandelen toe bij Overzicht.'));
  merged.slice(0, 20).forEach(n => tn.appendChild(newsItem(n)));

  const gn = $('#general-news'); gn.innerHTML = '';
  const gen = d.general || [];
  if (!gen.length) gn.appendChild(el('div', { class: 'loading-row' }, 'Geen algemeen nieuws opgehaald.'));
  gen.slice(0, 15).forEach(n => gn.appendChild(newsItem(n)));
}

/* ============================================================
   KANSEN / RESEARCH
   ============================================================ */
function asArr(x) { return Array.isArray(x) ? x : (x == null ? [] : [x]); }
function renderKansen(v) {
  // --- zoek-bediening ---
  v.appendChild(el('div', { class: 'section-head', style: 'align-items:flex-start' },
    el('div', { style: 'max-width:640px' },
      el('h2', {}, 'Kansen zoeken'),
      el('div', { class: 'tiny muted' }, 'Laat Claude nu zelf nieuwe kansrijke aandelen zoeken volgens je 18-punts methode. Duurt een paar minuten; je kunt intussen doorwerken. Dit staat los van je dagelijkse overzicht hieronder.')),
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' },
      el('select', { id: 'opp-focus', style: 'font-family:inherit;font-size:13.5px;padding:8px 10px;border-radius:9px;border:1px solid var(--border-strong);background:var(--panel);color:var(--text)' },
        el('option', { value: 'all' }, 'Alle kwaliteit'),
        el('option', { value: 'smallcap' }, 'Kleiner & goedkoper')),
      el('button', { class: 'btn btn-primary', id: 'opp-btn', onclick: findOpportunities }, '🔍 Zoek nieuwe kansen'))));

  // --- factor-screener (kwaliteit & waarde) ---
  renderScreener(v);

  // --- zelf gezochte kansen (los van het dagelijkse overzicht) ---
  const opp = App.state.opportunities || {};
  const oppCands = asArr(opp.candidates);
  oppCands.forEach(c => { c.checklist = asArr(c.checklist); c.risks = asArr(c.risks); c.callAt = c.callAt || opp.generatedAt; });
  if (oppCands.length) {
    const focusLabel = opp.focus === 'smallcap' ? 'kleiner & goedkoper' : 'alle kwaliteit';
    v.appendChild(el('div', { class: 'section-head', style: 'margin-top:22px' },
      el('h2', {}, '🔍 Zelf gezocht'),
      el('span', { class: 'hint' }, oppCands.length + ' gevonden · ' + focusLabel + (opp.generatedAt ? ' · ' + fmtDateTime(opp.generatedAt) : ''))));
    oppCands.forEach(c => v.appendChild(candidateCard(c)));
  }

  // --- dagelijks overzicht (automatisch onderzoek) ---
  const r = App.state.research || {};
  ['market', 'candidates', 'watch', 'warnings'].forEach(k => r[k] = asArr(r[k]));
  r.candidates.forEach(c => { c.checklist = asArr(c.checklist); c.risks = asArr(c.risks); c.callAt = c.callAt || r.generatedAt; });
  v.appendChild(el('div', { class: 'section-head', style: 'margin-top:26px' },
    el('h2', {}, '🗓️ Dagelijks overzicht'),
    el('span', { class: 'hint' }, r.generatedAt ? fmtDateTime(r.generatedAt) : 'elke ochtend automatisch')));
  if (r.isSeed) v.appendChild(el('div', { class: 'seed-banner' },
    'Voorbeeld-onderzoek. Zodra het dagelijkse onderzoek draait, zie je hier elke ochtend verse kansen.'));
  if (r.market.length) v.appendChild(el('div', { class: 'card market-card' },
    el('h2', {}, '📈 Het nieuws van vandaag'), el('ul', {}, ...r.market.map(m => el('li', {}, m)))));
  if (!r.candidates.length) {
    v.appendChild(emptyState('kansen', 'Nog geen kansen vandaag', 'Het dagelijkse onderzoek heeft nog geen kandidaten opgeleverd, of vond vandaag niets echt kansrijks. Geduld is ook een beslissing.'));
  } else {
    r.candidates.forEach(c => v.appendChild(candidateCard(c)));
  }
  if (r.watch.length) v.appendChild(el('div', { class: 'card market-card', style: 'margin-top:20px' },
    el('h2', {}, '🥈 Ook het noemen waard'), el('ul', {}, ...r.watch.map(w => el('li', {}, w)))));
  if (r.warnings.length) v.appendChild(el('div', { class: 'card market-card', style: 'border-color:var(--warn)' },
    el('h2', { style: 'color:var(--warn)' }, '⚠️ Let op'), el('ul', {}, ...r.warnings.map(w => el('li', {}, w)))));

  v.appendChild(el('p', { class: 'tiny muted', style: 'margin-top:18px;text-align:center' },
    'Onderzoek, geen koopadvies. Gebruik dit als startpunt en zoek zelf verder uit in een deep-dive.'));
  checkOppStatus();
}
function candidateCard(c) {
  const ko = c.knockouts || {};
  const koRow = el('div', { class: 'knockouts' },
    koPill('Begrijpelijk', ko.understandable),
    koPill('Probleem tijdelijk', ko.temporary),
    koPill('Boekhouding schoon', ko.cleanBooks)
  );
  const cl = c.checklist || [];
  const mini = el('div', { class: 'checklist-mini' },
    ...cl.map(item => el('div', { class: 'cl-row' },
      el('span', { class: 'dot ' + (item.verdict || 'twijfel') }),
      el('span', { class: 'lbl' }, CL_LABEL[item.key] || item.key), ':',
      el('span', { class: 'nt' }, ' ' + (item.note || ''))
    ))
  );
  const callTime = c.callAt || (App.state.research && App.state.research.generatedAt);
  return el('div', { class: 'card cand' },
    callTime ? el('div', { class: 'call-chip' }, '📅 Call gegeven: ', el('b', {}, fmtDateTime(callTime))) : null,
    el('div', { class: 'cand-head' },
      scoreRing(c.score ?? 0, c.maxScore || 18),
      el('div', { class: 'cand-title' },
        el('div', {}, el('b', {}, c.name || c.ticker), el('span', { class: 'tkr' }, c.ticker)),
        c.what ? el('p', {}, c.what) : null
      )
    ),
    c.whyNow ? el('p', { style: 'margin:12px 0 0;font-size:13.5px' }, el('b', {}, 'Waarom nu: '), c.whyNow) : null,
    koRow,
    cl.length ? mini : null,
    (c.risks && c.risks.length) ? el('div', { class: 'risks' },
      el('div', { class: 'rt' }, 'Grootste risico\'s'),
      el('ul', {}, ...c.risks.map(x => el('li', {}, x)))) : null,
    el('div', { class: 'cand-foot' },
      el('a', { class: 'btn btn-sm', href: 'https://finance.yahoo.com/quote/' + c.ticker, target: '_blank', rel: 'noopener' }, 'Yahoo Finance ↗'),
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openDeepdiveFor(c.ticker, c.name, c) }, 'Zelf uitzoeken →')
    )
  );
}
function koPill(label, ok) {
  return el('span', { class: 'ko ' + (ok ? 'ok' : 'no') },
    el('span', { html: ok ? '✓' : '✗' }), label);
}

// --- Kansen op aanvraag zoeken (achtergrondtaak op de server) ---
let _oppTimer = null;
function setOppRunningUI(running) {
  const btn = document.getElementById('opp-btn');
  if (!btn) return;
  btn.disabled = running;
  btn.innerHTML = '';
  if (running) { btn.appendChild(el('span', { class: 'spinner' })); btn.appendChild(document.createTextNode(' Aan het zoeken…')); }
  else btn.textContent = '🔍 Zoek nieuwe kansen';
}
async function findOpportunities() {
  const focusEl = document.getElementById('opp-focus');
  const focus = focusEl ? focusEl.value : 'all';
  setOppRunningUI(true);
  try {
    const r = await api('/api/find-opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ focus }) });
    if (r.started || r.running) { toast(focus === 'smallcap' ? 'Zoektocht (kleiner & goedkoper) gestart…' : 'Zoektocht gestart — dit duurt een paar minuten'); pollOpp(); }
    else { setOppRunningUI(false); toast('Kon niet starten'); }
  } catch (e) { setOppRunningUI(false); toast('Kon de zoektocht niet starten'); }
}
function pollOpp() {
  clearTimeout(_oppTimer);
  _oppTimer = setTimeout(async () => {
    let s = {};
    try { s = await api('/api/research-status'); } catch (e) { pollOpp(); return; }
    if (s.running) { pollOpp(); return; }
    setOppRunningUI(false);
    if (s.error) { toast('Zoeken mislukt: ' + s.error); return; }
    try { App.state.opportunities = await api('/api/opportunities'); } catch (e) {}
    toast('Nieuwe kansen binnen!');
    if (App.view === 'kansen') render();
  }, 4000);
}
async function checkOppStatus() {
  try {
    const s = await api('/api/research-status');
    if (s.running) { setOppRunningUI(true); pollOpp(); }
  } catch (e) {}
}

// --- Factor-screener (kwaliteit & waarde) ---
function scoreFund(f) {
  const fcfY = (f.freeCashflow != null && f.marketCap) ? f.freeCashflow / f.marketCap : null;
  const c = {
    pe: (f.forwardPE != null && f.forwardPE > 0 && f.forwardPE < 22),           // waarde
    peg: (f.pegRatio != null && f.pegRatio > 0 && f.pegRatio < 1.5),            // waarde vs groei
    fcf: (fcfY != null && fcfY > 0.04),                                        // echte cash-opbrengst
    roe: (f.roe != null && f.roe > 0.15),                                      // kwaliteit
    marge: (f.operMargin != null && f.operMargin > 0.15),                      // kwaliteit
    schuld: (f.debtToEquity != null && f.debtToEquity < 100),                  // kwaliteit (D/E < 1,0)
    omzet: (f.revenueGrowth != null && f.revenueGrowth > 0.05),                // groei
    winst: (f.earningsGrowth != null && f.earningsGrowth > 0.08),              // groei
  };
  const score = ['pe', 'peg', 'fcf', 'roe', 'marge', 'schuld', 'omzet', 'winst'].reduce((s, k) => s + (c[k] ? 1 : 0), 0);
  return { c, score, fcfY, max: 8 };
}
function renderScreener(v) {
  v.appendChild(el('div', {},
    el('div', { class: 'section-head', style: 'margin-top:10px' },
      el('div', { style: 'max-width:640px' },
        el('h2', {}, '🔎 Screener — kwaliteit & waarde'),
        el('div', { class: 'tiny muted' }, 'Een eerste zeef op de cijfers van je eigen lijst: hoge kwaliteit (rendement, marge, lage schuld, groei) tegen een nette prijs. Onderzoek elke naam daarna in de deep-dive — goedkoop kan ook een valkuil zijn.')),
      el('div', { style: 'display:flex;gap:8px' },
        el('button', { class: 'btn btn-sm', onclick: manageWatchlist }, 'Lijst beheren'),
        el('button', { class: 'btn btn-sm', onclick: () => loadScreener(true) }, 'Ververs'))),
    el('div', { id: 'screener-body' })));
  loadScreener();
  paintScreener();
}
function paintScreener() {
  const box = document.getElementById('screener-body');
  if (!box) return;
  box.innerHTML = '';
  if (!App.screener) { box.appendChild(el('div', { class: 'loading-row' }, el('span', { class: 'spinner' }), ' cijfers ophalen…')); return; }
  const scored = (App.screener.results || []).map(f => ({ f, ...scoreFund(f) }));
  scored.sort((a, b) => b.score - a.score || ((a.f.forwardPE ?? 99) - (b.f.forwardPE ?? 99)));
  if (!scored.length) { box.appendChild(el('div', { class: 'loading-row' }, 'Je screener-lijst is leeg. Klik op "Lijst beheren" om aandelen toe te voegen.')); return; }
  const cell = (ok, txt) => el('td', { class: 'r num ' + (ok === true ? 'sc-good' : ok === false ? 'sc-bad' : '') }, txt);
  const pf = x => x != null ? Math.round(x * 100) + '%' : '—';
  const table = el('table', { class: 'holdings screener-table' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Aandeel'),
      el('th', { class: 'r' }, 'P/E'), el('th', { class: 'r' }, 'PEG'), el('th', { class: 'r' }, 'FCF'),
      el('th', { class: 'r' }, 'ROE'), el('th', { class: 'r' }, 'Marge'), el('th', { class: 'r' }, 'Schuld'),
      el('th', { class: 'r' }, 'Omzet+'), el('th', { class: 'r' }, 'Winst+'),
      el('th', { class: 'r' }, 'Score'), el('th', {}, ''))),
    el('tbody', {}, ...scored.map(({ f, c, score, fcfY, max }) => f.error
      ? el('tr', {}, el('td', {}, el('div', { class: 'tk' }, el('div', { class: 'logo' }, initials(f.ticker)), el('div', { class: 'nm' }, el('b', {}, f.ticker)))), el('td', { colspan: 10, class: 'muted tiny' }, 'geen cijfers beschikbaar'))
      : el('tr', {},
        el('td', {}, el('div', { class: 'tk' }, el('div', { class: 'logo' }, initials(f.ticker)), el('div', { class: 'nm' }, el('b', {}, f.ticker), el('span', {}, (f.name || '').slice(0, 20))))),
        cell(c.pe, f.forwardPE != null ? f.forwardPE.toFixed(1) : '—'),
        cell(c.peg, f.pegRatio != null ? f.pegRatio.toFixed(2) : '—'),
        cell(c.fcf, fcfY != null ? pf(fcfY) : '—'),
        cell(c.roe, pf(f.roe)),
        cell(c.marge, pf(f.operMargin)),
        cell(c.schuld, f.debtToEquity != null ? (f.debtToEquity / 100).toFixed(2) : '—'),
        cell(c.omzet, pf(f.revenueGrowth)),
        cell(c.winst, pf(f.earningsGrowth)),
        el('td', { class: 'r' }, el('span', { class: 'sc-badge sc-' + (score >= 6 ? 'hi' : score >= 4 ? 'mid' : 'lo') }, score + '/' + max)),
        el('td', { class: 'r' }, el('button', { class: 'btn btn-sm btn-primary', onclick: () => openDeepdiveFor(f.ticker, f.name) }, 'Uitzoeken →'))))));
  box.appendChild(el('div', { style: 'overflow-x:auto' }, table));
  box.appendChild(el('p', { class: 'tiny muted', style: 'margin-top:8px' }, 'Groen = voldoet. Waarde: P/E<22, PEG<1,5, FCF-opbrengst>4%. Kwaliteit: ROE>15%, marge>15%, schuld<1,0. Groei: omzet>5%, winst>8%. Cijfers via Yahoo — kunnen ontbreken of afwijken; verifieer in de deep-dive.'));
}
function loadScreener(force) {
  if (App._screenerLoading) return;
  if (App.screener && !force) return;
  if (force) { App.screener = null; paintScreener(); }
  App._screenerLoading = true;
  api('/api/screener').then(d => { App.screener = d; App._screenerLoading = false; if (App.view === 'kansen') paintScreener(); })
    .catch(() => { App._screenerLoading = false; if (App.view === 'kansen') { const b = document.getElementById('screener-body'); if (b) b.innerHTML = '<div class="loading-row">Cijfers ophalen mislukt. Klik op Ververs.</div>'; } });
}
function manageWatchlist() {
  const tickers = (App.screener && App.screener.watchlist) ? App.screener.watchlist.slice() : [];
  const listBox = el('div', { class: 'wl-chips' });
  const renderChips = () => {
    listBox.innerHTML = '';
    tickers.forEach((t, i) => listBox.appendChild(el('span', { class: 'wl-chip' }, t,
      el('button', { class: 'wl-x', onclick: () => { tickers.splice(i, 1); renderChips(); } }, '×'))));
    if (!tickers.length) listBox.appendChild(el('span', { class: 'muted tiny' }, 'Nog geen aandelen.'));
  };
  renderChips();
  const acList = el('div', { class: 'ac-list', style: 'display:none' });
  const search = el('input', { type: 'text', placeholder: 'Zoek en voeg een aandeel toe', style: 'width:100%;font-family:inherit;font-size:14px;padding:9px 11px;border:1px solid var(--border-strong);border-radius:9px;background:var(--panel-2);color:var(--text)' });
  attachAutocomplete(search, acList, r => { if (!tickers.includes(r.symbol)) { tickers.push(r.symbol); renderChips(); } search.value = ''; acList.style.display = 'none'; });
  const body = el('div', {},
    el('p', { class: 'tiny muted', style: 'margin-top:0' }, 'De aandelen die de screener beoordeelt. Voeg toe of verwijder — meer aandelen = meer om uit te kiezen (maar de eerste keer duurt het ophalen wat langer).'),
    el('div', { class: 'ac-wrap', style: 'margin-bottom:12px' }, search, acList),
    listBox);
  const save = el('button', { class: 'btn btn-primary' }, 'Opslaan');
  const m = modal('Screener-lijst beheren', body, [el('button', { class: 'btn', onclick: () => m.close() }, 'Annuleren'), save]);
  save.addEventListener('click', async () => {
    try { await api('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) }); toast('Lijst opgeslagen'); } catch (e) { toast('Opslaan mislukt'); }
    m.close();
    loadScreener(true);
  });
}

/* ============================================================
   DEEP-DIVE
   ============================================================ */
function emptyNote(ticker, name) {
  const checklist = {};
  CHECKLIST.forEach(c => checklist[c[0]] = { verdict: null, note: '' });
  return {
    ticker: ticker || '', name: name || '',
    basis: { koers: '', investeren: '', procent: '', delen: '' },
    verhaal: { wat: '', waarom: '', hoelang: '' },
    knockouts: { understandable: false, temporary: false, temporaryReason: '', cleanBooks: false },
    checklist,
    duivel: { verkoper: '', risk1: '', risk2: '', risk3: '', slechtste: '', daling30: '' },
    emotie: { fomo: false, zelf: false, geslapen: false, vijfjaar: false },
    verkoopplan: { r1: '', r2: '', r3: '', herbeoordeling: '' },
    achteraf: { gebeurd: '', klopte: '', leer: '' },
    debate: [],
  };
}
function seedFromCandidate(note, c) {
  if (c.what) note.verhaal.wat = c.what;
  if (c.knockouts) {
    note.knockouts.understandable = !!c.knockouts.understandable;
    note.knockouts.temporary = !!c.knockouts.temporary;
    note.knockouts.cleanBooks = !!c.knockouts.cleanBooks;
  }
  (c.checklist || []).forEach(item => {
    if (note.checklist[item.key]) note.checklist[item.key] = { verdict: item.verdict || null, note: item.note || '' };
  });
  (c.risks || []).forEach((r, i) => { note.duivel['risk' + (i + 1)] = r; });
  return note;
}
function openDeepdiveFor(ticker, name) {
  App._ddTicker = ticker;
  App._ddName = name || '';
  App.analysis = null;
  const has = (App.state.analyses || []).some(a => a.ticker === ticker);
  setView('deepdive');
  if (has) loadAnalysis(ticker);
}
function renderDeepdive(v) {
  // --- aandeel zoeken + onderzoeken ---
  const acList = el('div', { class: 'ac-list', style: 'display:none' });
  const search = el('input', {
    type: 'text', id: 'analyze-search', value: App._ddTicker || '',
    placeholder: 'Typ een aandeel, bv. "SAP" of "ASML"',
    style: 'flex:1;min-width:180px;font-family:inherit;font-size:14px;padding:10px 12px;border:1px solid var(--border-strong);border-radius:9px;background:var(--panel);color:var(--text)'
  });
  const btn = el('button', { class: 'btn btn-primary', id: 'analyze-btn', onclick: () => startAnalyze(search.value) }, '🔬 Onderzoek dit aandeel');
  attachAutocomplete(search, acList, r => { search.value = r.symbol; App._ddTicker = r.symbol; App._ddName = r.name; acList.style.display = 'none'; });
  v.appendChild(el('div', {},
    el('h2', { style: 'margin-bottom:6px' }, 'Onderzoek een aandeel'),
    el('div', { class: 'tiny muted', style: 'margin-bottom:12px;max-width:660px' }, 'Typ een aandeel; Claude zoekt alles op en legt het in simpele taal uit — inclusief de 18-punts checklist. Onder elk kopje kun je vragen stellen tot je het snapt. Duurt een paar minuten.'),
    el('div', { class: 'ac-wrap' },
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, search, btn),
      acList)));

  // --- opgeslagen rapporten ---
  const saved = App.state.analyses || [];
  if (saved.length) {
    const list = el('div', { class: 'saved-reports' });
    saved.forEach(s => list.appendChild(el('button', { class: 'report-chip', onclick: () => loadAnalysis(s.ticker) },
      el('b', {}, s.ticker), s.name ? el('span', { class: 'rc-name' }, s.name) : null,
      s.score != null ? el('span', { class: 'rc-score' }, s.score + '/18') : null)));
    v.appendChild(el('div', { style: 'margin-top:18px' },
      el('div', { class: 'tiny muted', style: 'margin-bottom:8px' }, 'Je opgeslagen onderzoeksrapporten:'), list));
  }

  // --- huidig rapport ---
  if (App.analysis && App.analysis.ticker) {
    v.appendChild(el('div', { class: 'report-divider' }));
    renderReport(v);
  }
  checkAnalyzeStatus();
}
function paras(text) {
  return String(text || '').split(/\n{1,}/).map(p => p.trim()).filter(Boolean)
    .map(p => el('p', { style: 'margin:0 0 10px;line-height:1.6' }, p));
}
function checklistText(cl) {
  return asArr(cl).map((item, i) => (i + 1) + '. ' + (CL_LABEL[item.key] || item.key) + ': ' + (item.verdict || '') + (item.note ? ' (' + item.note + ')' : '')).join('\n');
}
function renderReport(v) {
  const a = App.analysis;
  v.appendChild(el('div', { class: 'card report-head' },
    scoreRing(a.score ?? 0, a.maxScore || 18),
    el('div', {},
      el('h2', {}, a.name || a.ticker),
      el('div', { class: 'muted tiny' }, a.ticker + (a.generatedAt ? ' · onderzocht ' + fmtDateTime(a.generatedAt) : '')))));

  asArr(a.sections).forEach(s => {
    s.discussion = asArr(s.discussion);
    v.appendChild(el('div', { class: 'card dd-section' },
      el('h2', {}, s.title),
      ...paras(s.body),
      makeDiscussion(s.discussion, { ticker: a.ticker, name: a.name, title: s.title, body: s.body })));
  });

  a.checklistDiscussion = asArr(a.checklistDiscussion);
  const clCard = el('div', { class: 'card dd-section' }, el('h2', {}, 'De 18-punts checklist'));
  asArr(a.checklist).forEach((item, i) => clCard.appendChild(el('div', { class: 'cl-line' },
    el('span', { class: 'dot ' + (item.verdict || 'twijfel') }),
    el('b', {}, (i + 1) + '. ' + (CL_LABEL[item.key] || item.key)),
    el('span', { class: 'nt' }, item.note ? ' — ' + item.note : ''))));
  clCard.appendChild(makeDiscussion(a.checklistDiscussion, { ticker: a.ticker, name: a.name, title: 'De 18-punts checklist', body: checklistText(a.checklist) }));
  v.appendChild(clCard);

  a.conclusieDiscussion = asArr(a.conclusieDiscussion);
  v.appendChild(el('div', { class: 'card dd-section' },
    el('h2', {}, 'Conclusie' + (a.score != null ? ' · ' + a.score + '/18' : '')),
    ...paras(a.conclusie),
    makeDiscussion(a.conclusieDiscussion, { ticker: a.ticker, name: a.name, title: 'Conclusie', body: a.conclusie })));

  v.appendChild(el('div', { class: 'dd-actions' },
    el('button', { class: 'btn btn-primary', onclick: saveAnalysis }, '💾 Opslaan als rapport'),
    el('button', { class: 'btn', onclick: () => { App.analysis = null; render(); } }, 'Ander aandeel'),
    el('span', { class: 'save-state', id: 'analysis-saved' }, a.updatedAt ? 'opgeslagen ' + new Date(a.updatedAt).toLocaleString('nl-NL') : 'nog niet opgeslagen')));
  v.appendChild(el('p', { class: 'tiny muted', style: 'text-align:center;margin-top:12px' },
    'Onderzoek, geen koopadvies. Verifieer de kerngetallen zelf en beslis zelf.'));
}
// --- discussie onder een kopje ---
function makeDiscussion(messages, meta) {
  const box = el('div', { class: 'disc' });
  renderDisc(box, messages, meta, false);
  return box;
}
function renderDisc(box, messages, meta, loading) {
  box.innerHTML = '';
  if (messages.length || loading) {
    const list = el('div', { class: 'disc-msgs' });
    messages.forEach(m => list.appendChild(el('div', { class: 'dbub ' + (m.role === 'ai' ? 'ai' : 'me') },
      el('div', { class: 'who' }, m.role === 'ai' ? 'UITLEG' : 'JIJ'), el('div', {}, m.text))));
    if (loading) list.appendChild(el('div', { class: 'dbub ai thinking' }, el('span', { class: 'spinner' }), ' denkt na…'));
    box.appendChild(list);
  }
  if (loading) return;
  const ta = el('textarea', { class: 'disc-input', rows: 1, placeholder: 'Stel hier een vraag of bespreek dit onderdeel…' });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = ta.value.trim(); if (t) discussTurn(box, messages, meta, t); } });
  box.appendChild(el('div', { class: 'disc-row' }, ta,
    el('button', { class: 'btn btn-sm btn-primary', onclick: () => { const t = ta.value.trim(); if (t) discussTurn(box, messages, meta, t); } }, 'Vraag')));
}
async function discussTurn(box, messages, meta, text) {
  messages.push({ role: 'user', text });
  renderDisc(box, messages, meta, true);
  try {
    const d = await api('/api/discuss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: meta.ticker, name: meta.name, sectionTitle: meta.title, sectionBody: meta.body, messages })
    });
    if (d.reply) messages.push({ role: 'ai', text: d.reply });
    else toast(d.error || 'Kon even niet antwoorden');
  } catch (e) { toast('Kon de assistent niet bereiken'); }
  renderDisc(box, messages, meta, false);
}
// --- onderzoek starten / laden / opslaan ---
let _aTimer = null;
function setAnalyzeRunningUI(running, ticker) {
  const btn = document.getElementById('analyze-btn');
  if (!btn) return;
  btn.disabled = running;
  btn.innerHTML = '';
  if (running) { btn.appendChild(el('span', { class: 'spinner' })); btn.appendChild(document.createTextNode(' Onderzoekt ' + (ticker || '') + '…')); }
  else btn.textContent = '🔬 Onderzoek dit aandeel';
}
async function startAnalyze(raw) {
  const ticker = (raw || '').trim().toUpperCase().split(/\s/)[0].replace(/[^A-Z0-9.\-]/g, '');
  if (!ticker) { toast('Typ een aandeel'); return; }
  App._ddTicker = ticker;
  setAnalyzeRunningUI(true, ticker);
  try {
    const r = await api('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker, name: App._ddName || '' }) });
    if (r.started || r.running) { toast('Onderzoek gestart voor ' + ticker + ' — dit duurt een paar minuten'); analyzePoll(); }
    else { setAnalyzeRunningUI(false); toast(r.error || 'Kon niet starten'); }
  } catch (e) { setAnalyzeRunningUI(false); toast('Kon het onderzoek niet starten'); }
}
function analyzePoll() {
  clearTimeout(_aTimer);
  _aTimer = setTimeout(async () => {
    let s = {};
    try { s = await api('/api/analyze-status'); } catch (e) { analyzePoll(); return; }
    if (s.running) { analyzePoll(); return; }
    setAnalyzeRunningUI(false);
    if (s.error) { toast('Onderzoek mislukt: ' + s.error); return; }
    try { App.state.analyses = (await api('/api/state')).analyses; } catch (e) {}
    await loadAnalysis(s.ticker || App._ddTicker);
    toast('Onderzoek klaar!');
  }, 4000);
}
async function checkAnalyzeStatus() {
  try { const s = await api('/api/analyze-status'); if (s.running) { setAnalyzeRunningUI(true, s.ticker); analyzePoll(); } } catch (e) {}
}
async function loadAnalysis(ticker) {
  try { App.analysis = await api('/api/analysis?ticker=' + encodeURIComponent(ticker)); } catch (e) { App.analysis = null; }
  App._ddTicker = ticker;
  if (App.view === 'deepdive') render();
}
async function saveAnalysis() {
  if (!App.analysis) return;
  try {
    await api('/api/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(App.analysis) });
    App.analysis.updatedAt = new Date().toISOString();
    const s = document.getElementById('analysis-saved'); if (s) s.textContent = 'opgeslagen ' + new Date().toLocaleString('nl-NL');
    toast('Rapport opgeslagen');
    try { App.state.analyses = (await api('/api/state')).analyses; } catch (e) {}
  } catch (e) { toast('Opslaan mislukt'); }
}
function newDeepdivePrompt() {
  const t = prompt('Welke ticker wil je uitzoeken? (bv. NVDA of ASML.AS)');
  if (!t) return;
  App._ddTarget = t.trim().toUpperCase();
  App.ddPrefill = null;
  render();
}
async function loadDeepdive(ticker) {
  let note = null;
  try { note = await api('/api/deepdive?ticker=' + encodeURIComponent(ticker)); } catch (e) { note = {}; }
  if (!note || !note.ticker) {
    const name = App.ddPrefill && App.ddPrefill.ticker === ticker ? App.ddPrefill.name : (App.quotes[ticker] && App.quotes[ticker].name) || '';
    note = emptyNote(ticker, name);
    if (App.ddPrefill && App.ddPrefill.ticker === ticker && App.ddPrefill.candidate) seedFromCandidate(note, App.ddPrefill.candidate);
  } else {
    // zorg dat alle checklist-keys bestaan
    const full = emptyNote(note.ticker, note.name);
    note.checklist = Object.assign(full.checklist, note.checklist || {});
    for (const k of ['basis', 'verhaal', 'knockouts', 'duivel', 'emotie', 'verkoopplan', 'achteraf'])
      note[k] = Object.assign(full[k], note[k] || {});
    note.debate = asArr(note.debate);
  }
  App.dd = note;
  paintDeepdiveForm();
}
function setPath(obj, path, val) {
  const parts = path.split('.'); let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
  o[parts[parts.length - 1]] = val;
}
function ddScore() {
  let ok = 0;
  CHECKLIST.forEach(c => { if (App.dd.checklist[c[0]].verdict === 'ok') ok++; });
  return ok;
}
function updateScore() {
  const s = ddScore();
  const box = $('#dd-score');
  if (!box) return;
  box.innerHTML = '';
  const col = s >= 13 ? 'var(--pos)' : s >= 9 ? 'var(--warn)' : 'var(--neg)';
  box.appendChild(el('span', { class: 'num-big', style: 'color:' + col }, s));
  box.appendChild(el('span', { class: 'muted' }, '/ 18'));
  box.appendChild(el('span', { class: 'tiny muted', style: 'margin-left:4px' }, s >= 13 ? 'sterk' : 'onder 13 → overslaan'));
}
function fld(label, q, path, textarea) {
  const val = path.split('.').reduce((o, k) => (o || {})[k], App.dd) || '';
  const input = textarea
    ? el('textarea', { dataset: { path }, rows: 2 }, val)
    : el('input', { type: 'text', dataset: { path }, value: val });
  return el('div', { class: 'field' }, el('label', {}, label, q ? el('span', { class: 'q' }, ' — ' + q) : null), input);
}
function chk(label, path) {
  const val = path.split('.').reduce((o, k) => (o || {})[k], App.dd);
  return el('label', { class: 'check-line' },
    el('input', { type: 'checkbox', dataset: { path }, checked: val ? 'checked' : null }),
    el('span', {}, label));
}
function paintDeepdiveForm() {
  const root = $('#dd-form');
  root.innerHTML = '';
  const dd = App.dd;

  // 1. Basis
  root.appendChild(el('div', { class: 'card dd-section' },
    el('h2', {}, '1 · De basis — ' + dd.ticker),
    el('div', { class: 'form-grid' },
      wrapFld('Koers nu', 'basis.koers'),
      wrapFld('Hoeveel investeren (EUR)', 'basis.investeren'),
      wrapFld('% van portefeuille (>10% = te veel)', 'basis.procent'),
      wrapFld('Koop ik in delen?', 'basis.delen')
    )
  ));

  // 2. Mijn verhaal
  root.appendChild(el('div', { class: 'card dd-section' },
    el('h2', {}, '2 · Mijn verhaal (het belangrijkste vak)'),
    fld('Wat doet dit bedrijf, in mijn eigen woorden', 'zo simpel dat een vriend het snapt', 'verhaal.wat', true),
    fld('Waarom koop ik dit NU en niet gewoon een wereldwijde ETF?', '', 'verhaal.waarom', true),
    fld('Hoe lang houd ik dit vast', '', 'verhaal.hoelang', false)
  ));

  // 3. Knock-outs
  const koReason = el('div', { class: 'field', style: 'margin-left:25px' },
    el('input', { type: 'text', dataset: { path: 'knockouts.temporaryReason' }, value: dd.knockouts.temporaryReason || '', placeholder: 'De reden is namelijk…' }));
  root.appendChild(el('div', { class: 'card dd-section' },
    el('h2', {}, '3 · De drie knock-outs (1× nee = niet kopen)'),
    chk(KNOCKOUTS[0][1], 'knockouts.understandable'),
    chk(KNOCKOUTS[1][1], 'knockouts.temporary'),
    koReason,
    chk(KNOCKOUTS[2][1], 'knockouts.cleanBooks')
  ));

  // 4. 18-punts checklist
  const clWrap = el('div', { class: 'card dd-section' }, el('h2', {}, '4 · De 18-punts checklist'));
  CHECKLIST.forEach((c, i) => {
    const cur = dd.checklist[c[0]];
    const verds = el('div', { class: 'verdicts' },
      ...['ok', 'twijfel', 'slecht'].map(vd => {
        const b = el('button', { class: 'verd' + (cur.verdict === vd ? ' on' : ''), dataset: { v: vd }, type: 'button' },
          vd === 'ok' ? 'OK' : vd === 'twijfel' ? 'Twijfel' : 'Slecht');
        b.addEventListener('click', () => {
          cur.verdict = cur.verdict === vd ? null : vd;
          clWrap.querySelectorAll(`[data-key="${c[0]}"] .verd`).forEach(x => x.classList.toggle('on', x.dataset.v === cur.verdict));
          updateScore();
        });
        return b;
      }));
    clWrap.appendChild(el('div', { class: 'cl-item', dataset: { key: c[0] } },
      el('div', { class: 'cl-q' }, el('b', {}, (i + 1) + '.'), c[1], el('span', { class: 'q' }, ' — ' + c[2])),
      el('div', { class: 'cl-controls' },
        verds,
        el('input', { type: 'text', value: cur.note || '', placeholder: 'reden / cijfers', oninput: e => cur.note = e.target.value })
      )
    ));
  });
  root.appendChild(clWrap);

  // 5. Advocaat van de duivel
  root.appendChild(el('div', { class: 'card dd-section' },
    el('h2', {}, '5 · Advocaat van de duivel'),
    fld('Wat weet/denkt de verkoper misschien dat ik niet zie?', '', 'duivel.verkoper', true),
    fld('Grootste risico 1', '', 'duivel.risk1', false),
    fld('Grootste risico 2', '', 'duivel.risk2', false),
    fld('Grootste risico 3', '', 'duivel.risk3', false),
    fld('Slechtste realistische scenario — hoeveel verlies, kan ik dat dragen?', '', 'duivel.slechtste', true),
    fld('Koers daalt morgen 30% zonder nieuws. Wat doe ik? (eerlijk!)', '', 'duivel.daling30', true)
  ));

  // 5b. Discussie: laat je uitdagen
  root.appendChild(el('div', { class: 'card dd-section' },
    el('h2', {}, '⚔ Laat je uitdagen (advocaat van de duivel)'),
    el('p', { class: 'tiny muted', style: 'margin:-6px 0 12px' }, 'Claude speelt tegenstander: hij geeft tegenargumenten, jij weerlegt ze — tot je echt zeker bent. Vul eerst je verhaal en de checklist hierboven in voor de scherpste tegenspraak.'),
    el('div', { id: 'dd-debate-body' })
  ));
  renderDebate(false);

  // 6. Emotie-check
  root.appendChild(el('div', { class: 'card dd-section' },
    el('h2', {}, '6 · Emotie-check'),
    chk('Ik koop NIET uit FOMO (omdat hij hard gestegen is)', 'emotie.fomo'),
    chk('Ik koop NIET alleen omdat een ander het kocht — ik snap het ZELF', 'emotie.zelf'),
    chk('Ik heb hier minimaal 2 nachten over geslapen', 'emotie.geslapen'),
    chk('Dit geld heb ik de komende 5+ jaar niet nodig', 'emotie.vijfjaar')
  ));

  // 7. Verkoopplan
  root.appendChild(el('div', { class: 'card dd-section' },
    el('h2', {}, '7 · Mijn verkoopplan (nu bepalen, niet bij paniek)'),
    el('p', { class: 'tiny muted', style: 'margin:-6px 0 12px' }, 'Een koersdaling ZONDER bedrijfsnieuws is GEEN verkoopreden.'),
    fld('Ik verkoop als… (1)', '', 'verkoopplan.r1', false),
    fld('Ik verkoop als… (2)', '', 'verkoopplan.r2', false),
    fld('Ik verkoop als… (3)', '', 'verkoopplan.r3', false),
    fld('Herbeoordeling gepland op (bv. volgende kwartaalcijfers)', '', 'verkoopplan.herbeoordeling', false)
  ));

  // 8. Achteraf
  root.appendChild(el('div', { class: 'card dd-section' },
    el('h2', {}, '8 · Achteraf invullen (na 6-12 maanden)'),
    fld('Wat is er sindsdien gebeurd', '', 'achteraf.gebeurd', true),
    fld('Klopte mijn verhaal uit vak 2', '', 'achteraf.klopte', true),
    fld('Wat leer ik hiervan', '', 'achteraf.leer', true)
  ));

  // opslaan-balk
  root.appendChild(el('div', { class: 'dd-actions' },
    el('button', { class: 'btn btn-primary', onclick: saveDeepdive }, 'Deep-dive opslaan'),
    el('button', { class: 'btn', onclick: copyDeepdiveText }, 'Kopieer als tekst'),
    el('span', { class: 'save-state', id: 'dd-saved' }, dd.updated ? 'laatst opgeslagen ' + new Date(dd.updated).toLocaleString('nl-NL') : 'nog niet opgeslagen')
  ));

  // live binding voor alle [data-path] velden
  root.querySelectorAll('[data-path]').forEach(inp => {
    const ev = inp.type === 'checkbox' ? 'change' : 'input';
    inp.addEventListener(ev, () => setPath(App.dd, inp.dataset.path, inp.type === 'checkbox' ? inp.checked : inp.value));
  });
  updateScore();
}
function wrapFld(label, path) {
  const val = path.split('.').reduce((o, k) => (o || {})[k], App.dd) || '';
  return el('div', {}, el('label', {}, label), el('input', { type: 'text', dataset: { path }, value: val }));
}
async function saveDeepdive() {
  App.dd.score = ddScore();
  try {
    await api('/api/deepdive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(App.dd) });
    App.dd.updated = new Date().toISOString();
    const s = $('#dd-saved'); if (s) s.textContent = 'opgeslagen ' + new Date().toLocaleString('nl-NL');
    toast('Deep-dive opgeslagen (score ' + App.dd.score + '/18)');
    // deepdives-lijst verversen zodat hij in de kiezer verschijnt
    try { const st = await api('/api/state'); App.state.deepdives = st.deepdives; } catch (e) {}
  } catch (e) { toast('Opslaan mislukt'); }
}
function copyDeepdiveText() {
  const dd = App.dd;
  const L = [];
  L.push('KOOPBESLUIT — ' + (dd.name ? dd.name + ' ' : '') + '(' + dd.ticker + ')');
  L.push('Bijgewerkt: ' + new Date().toLocaleDateString('nl-NL'));
  L.push('');
  L.push('1. DE BASIS');
  L.push('Koers nu: ' + dd.basis.koers);
  L.push('Investeren (EUR): ' + dd.basis.investeren + '  |  % portefeuille: ' + dd.basis.procent);
  L.push('In delen kopen: ' + dd.basis.delen);
  L.push('');
  L.push('2. MIJN VERHAAL');
  L.push('Wat: ' + dd.verhaal.wat);
  L.push('Waarom nu i.p.v. ETF: ' + dd.verhaal.waarom);
  L.push('Horizon: ' + dd.verhaal.hoelang);
  L.push('');
  L.push('3. KNOCK-OUTS');
  L.push('[' + (dd.knockouts.understandable ? 'x' : ' ') + '] Begrijpelijk businessmodel');
  L.push('[' + (dd.knockouts.temporary ? 'x' : ' ') + '] Reden tijdelijk: ' + dd.knockouts.temporaryReason);
  L.push('[' + (dd.knockouts.cleanBooks ? 'x' : ' ') + '] Boekhouding schoon');
  L.push('');
  L.push('4. 18-PUNTS CHECKLIST — SCORE ' + ddScore() + '/18');
  CHECKLIST.forEach((c, i) => {
    const cur = dd.checklist[c[0]];
    const v = cur.verdict ? cur.verdict.toUpperCase() : '—';
    L.push((i + 1) + '. ' + c[1] + ': ' + v + (cur.note ? ' — ' + cur.note : ''));
  });
  L.push('');
  L.push('5. ADVOCAAT VAN DE DUIVEL');
  L.push('Verkoper weet: ' + dd.duivel.verkoper);
  L.push('Risico 1: ' + dd.duivel.risk1);
  L.push('Risico 2: ' + dd.duivel.risk2);
  L.push('Risico 3: ' + dd.duivel.risk3);
  L.push('Slechtste scenario: ' + dd.duivel.slechtste);
  L.push('-30% morgen: ' + dd.duivel.daling30);
  L.push('');
  L.push('6. EMOTIE-CHECK');
  L.push('[' + (dd.emotie.fomo ? 'x' : ' ') + '] Geen FOMO   [' + (dd.emotie.zelf ? 'x' : ' ') + '] Zelf onderzocht   [' + (dd.emotie.geslapen ? 'x' : ' ') + '] 2 nachten geslapen   [' + (dd.emotie.vijfjaar ? 'x' : ' ') + '] 5+ jaar missen');
  L.push('');
  L.push('7. VERKOOPPLAN');
  L.push('1) ' + dd.verkoopplan.r1);
  L.push('2) ' + dd.verkoopplan.r2);
  L.push('3) ' + dd.verkoopplan.r3);
  L.push('Herbeoordeling: ' + dd.verkoopplan.herbeoordeling);
  L.push('');
  L.push('Onderzoek, geen koopadvies. Beslis zelf en spreid je inleg.');
  navigator.clipboard.writeText(L.join('\n')).then(() => toast('Gekopieerd naar klembord'), () => toast('Kopiëren mislukt'));
}
async function viewKoopbesluit(file, name) {
  try {
    const d = await api('/api/koopbesluit?file=' + encodeURIComponent(file));
    modal(name || file, el('pre', {}, d.text || '(leeg)'), null, true);
  } catch (e) { toast('Kon bestand niet lezen'); }
}

/* ============================================================
   Diversen
   ============================================================ */
function emptyState(icon, title, text, btnLabel, btnFn) {
  return el('div', { class: 'card empty' },
    el('div', { html: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 14l3-3 2 2 4-5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' }),
    el('h3', { style: 'margin-bottom:6px' }, title),
    el('p', { style: 'max-width:420px;margin:0 auto 16px' }, text),
    btnLabel ? el('button', { class: 'btn btn-primary', onclick: btnFn }, btnLabel) : null
  );
}
function setUpdated() {
  $('#updated').textContent = 'bijgewerkt ' + new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

async function boot() {
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#refresh').addEventListener('click', refresh);
  try {
    const st = await api('/api/state');
    App.state = st;
  } catch (e) {
    $('#view').innerHTML = '<div class="empty"><h3>De app kan de server niet bereiken</h3><p>Draait server.py nog? Start de app opnieuw via Start-App.</p></div>';
    return;
  }
  setUpdated();
  updateAlertBadge();
  setView('overzicht');
}
async function refresh() {
  const btn = $('#refresh');
  btn.disabled = true;
  App.quotes = {}; App.news = null;
  try { App.state = await api('/api/state'); } catch (e) {}
  setUpdated();
  updateAlertBadge();
  render();
  setTimeout(() => btn.disabled = false, 600);
}

boot();
