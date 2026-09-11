#!/usr/bin/env node
/**
 * scripts/generate-ticker-data.js
 *
 * Builds /js/ticker-data.js — the payload behind the homepage market ticker —
 * and bakes the default (Global) tape into index.html so it paints with the
 * document instead of after hydration.
 *
 * WHY THIS IS PRECOMPUTED AND NOT DERIVED IN THE BROWSER
 * The tape needs, for each of the 11 markets, a 12-month series for the market
 * index plus a 12-month series for each of its top 10 brands. data-home.js only
 * carries 2 months for non-global markets (and 7 sparse ones for global), so the
 * browser cannot derive this; data.js can, but it is 3.1MB and is deliberately
 * not loaded on the homepage. Precomputing costs ~20KB and keeps both true.
 *
 * SERIES ARE NORMALISED TO 0..1000, NOT RAW SEARCH VOLUME
 * A sparkline min/max-normalises its own points before drawing, and the segment
 * colours depend only on the sign of each month-over-month step. Both survive
 * any monotonic rescale, so storing raw volumes (up to 8 digits) would cost
 * bytes for precision that is discarded at draw time. 0..1000 keeps direction
 * intact: a rise has to be under 0.1% of the series range to flatten, and the
 * displayed MoM figure is computed from the raw numbers here regardless.
 *
 * DI MATCHES THE REST OF THE SITE
 * di = curV / maxV * 100 within the market, the same formula app.js, home.js
 * and the brand pages use for the global index. A market's #1 is therefore
 * always exactly 100.0. Do not "improve" this independently of those three.
 *
 *   node scripts/generate-ticker-data.js          # write
 *   node scripts/generate-ticker-data.js --check  # exit 1 if stale
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT       = path.resolve(__dirname, '..');
const DATA_JS    = path.join(ROOT, 'js', 'data.js');
const OUT_FILE   = path.join(ROOT, 'js', 'ticker-data.js');
const INDEX_HTML = path.join(ROOT, 'index.html');

const CHECK_ONLY = process.argv.includes('--check');

const MONTHS_IN_SERIES = 12;
const BRANDS_PER_MARKET = 10;

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** ISO 3166-1 alpha-2 shown in the index cell eyebrow. `global` has no country. */
const MARKET_CODE = {
  global: 'GLOBAL', us: 'US', ca: 'CA', uk: 'UK', jp: 'JP', kr: 'KR',
  au: 'AU', cn: 'CN', de: 'DE', fr: 'FR', se: 'SE',
};

function shiftMonth(label, delta) {
  const parts = label.split(' ');
  const total = parseInt(parts[1], 10) * 12 + MONTH_NAMES.indexOf(parts[0]) + delta;
  return MONTH_NAMES[((total % 12) + 12) % 12] + ' ' + Math.floor(total / 12);
}

/** Rescale to integers 0..1000. See the header note on why this is lossless here. */
function normaliseSeries(values) {
  const min = Math.min.apply(null, values);
  const max = Math.max.apply(null, values);
  const span = (max - min) || 1;
  return values.map(v => Math.round((v - min) / span * 1000));
}

function pct(cur, prev) {
  if (!(prev > 0)) return null;
  return Math.round((cur - prev) / prev * 1000) / 10;
}

function loadData() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(DATA_JS, 'utf8'), ctx);
  return ctx.window.DORMIED_DATA;
}

function build(D) {
  const cur    = D.meta.currentMonth;
  const months = [];
  for (let i = MONTHS_IN_SERIES - 1; i >= 0; i--) months.push(shiftMonth(cur, -i));
  const prev = months[months.length - 2];

  const markets = D.meta.markets.map(mkt => {
    const key = mkt.key;

    // Market index: total demand across every tracked brand, month by month.
    const indexRaw = months.map(mo =>
      D.brands.reduce((sum, b) => {
        const g = (b.searchesByMarket && b.searchesByMarket[key]) || {};
        return sum + (g[mo] || 0);
      }, 0)
    );

    // Rank by current-month volume in THIS market, then DI relative to its #1.
    //
    // Search volumes are bucketed, so ties at the top are common (in CA both
    // TaylorMade and Titleist sit on the same figure). The tiebreak chain is
    // previous month, then three months ago — equivalent to the prevRank/ago3Rank
    // chain home.js and app.js use, since prevDI and ago3DI are each monotonic in
    // the underlying volume. Without it the ticker's #1 for a market could
    // disagree with the rankings page purely on array order.
    const ago3 = shiftMonth(cur, -3);
    const ranked = D.brands
      .map(b => {
        const g = (b.searchesByMarket && b.searchesByMarket[key]) || {};
        return { b, curV: g[cur] || 0, preV: g[prev] || 0, ago3V: g[ago3] || 0, g };
      })
      .filter(r => r.curV > 0)
      .sort((a, b) => (b.curV - a.curV) || (b.preV - a.preV) || (b.ago3V - a.ago3V));

    const maxV = ranked.length ? ranked[0].curV : 0;

    const brands = ranked.slice(0, BRANDS_PER_MARKET).map(r => ({
      id:   r.b.id,
      name: r.b.name,
      logo: r.b.logo || null,
      di:   maxV > 0 ? Math.round(r.curV / maxV * 1000) / 10 : 0,
      mom:  pct(r.curV, r.preV),
      s:    normaliseSeries(months.map(mo => r.g[mo] || 0)),
    }));

    return {
      key,
      code:  MARKET_CODE[key] || key.toUpperCase(),
      label: mkt.label,
      flag:  mkt.flag,
      mom:   pct(indexRaw[indexRaw.length - 1], indexRaw[indexRaw.length - 2]),
      s:     normaliseSeries(indexRaw),
      brands,
    };
  });

  return { generated: D.meta.lastUpdated, currentMonth: cur, months, markets };
}

/* ── Server-side render of the tape, so it paints with the document ───────── */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Kept in step with the same-named functions in js/ticker.js: the prerendered
 * Global tape and a client-side re-render must produce the same DOM, or the two
 * stop being interchangeable. Same DOM, not the same string — a browser
 * reserialises <path/> as <path></path>, so they will never match byte for byte
 * once parsed. If you change one, change both.
 */
function sparkline(series, w, h, stroke, pad) {
  const min = Math.min.apply(null, series);
  const max = Math.max.apply(null, series);
  const span = (max - min) || 1;
  const pts = series.map((v, i) => [
    i / (series.length - 1) * w,
    h - pad - (v - min) / span * (h - pad * 2),
  ]);
  let out = '';
  for (let i = 1; i < pts.length; i++) {
    const rising = series[i] >= series[i - 1];
    out += '<path d="M' + pts[i - 1][0].toFixed(1) + ' ' + pts[i - 1][1].toFixed(1)
         + 'L' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1) + '" fill="none" stroke="'
         + (rising ? '#22c55e' : '#ef4444') + '" stroke-width="' + stroke + '" stroke-linecap="round"/>';
  }
  return out;
}

function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  const rounded = Math.round(Math.abs(v) * 10) / 10;
  const sign = rounded === 0 ? '' : v > 0 ? '+' : '−';
  return sign + rounded.toFixed(1) + '%';
}

function deltaClass(v) {
  if (v === null || v === undefined) return 'dt-flat';
  return Math.round(Math.abs(v) * 10) / 10 === 0 ? 'dt-flat' : v > 0 ? 'dt-up' : 'dt-down';
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return (parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : String(name || '').slice(0, 2)).toUpperCase();
}

/**
 * Hide-and-reveal rather than outerHTML replacement, matching logoImg() in
 * home.js. Building markup inside the onerror attribute also meant the browser
 * re-escaped it on readback, so the prerendered and client-rendered tapes
 * serialised differently even though they parsed the same — which defeats the
 * point of keeping the two renderers in step.
 */
/**
 * Optimizer width. This is NOT size*2: /_vercel/image only serves the widths in
 * vercel.json images.sizes ([40, 80, 160, ...]) and returns 400 for anything
 * else, so the obvious 18*2=36 made every logo in the tape fail and fall back to
 * initials. 80 covers the 22px mobile tile at DPR 2 (the 18px desktop tile only
 * needs 40, but one markup serves both breakpoints, so it takes the larger).
 * Changing the tile size means re-checking this against that allowlist.
 */
const LOGO_OPTIMIZER_WIDTH = 80;

function logoHtml(brand, size) {
  const ini = esc(initials(brand.name));
  if (!brand.logo) return '<span class="dt-logo dt-logo--ini">' + ini + '</span>';
  const src = '/_vercel/image?url=' + encodeURIComponent(brand.logo)
            + '&w=' + LOGO_OPTIMIZER_WIDTH + '&q=75';
  return '<img class="dt-logo" src="' + esc(src) + '" alt="" width="' + size + '" height="' + size
       + '" loading="lazy" decoding="async"'
       + ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
       + '<span class="dt-logo dt-logo--ini" style="display:none">' + ini + '</span>';
}

function renderBrands(market) {
  return market.brands.map(b =>
    '<a class="dt-brand" href="/brands/' + esc(b.id) + '/">'
  +   '<span class="dt-brand-head">' + logoHtml(b, 18)
  +     '<span class="dt-brand-name">' + esc(b.name) + '</span></span>'
  +   '<span class="dt-brand-body">'
  +     '<span class="dt-brand-nums">'
  +       '<span class="dt-brand-di">' + b.di.toFixed(1) + '</span>'
  +       '<span class="dt-delta ' + deltaClass(b.mom) + '">' + fmtPct(b.mom) + '</span>'
  +     '</span>'
  +     '<svg class="dt-spark dt-spark--brand" viewBox="0 0 60 28" width="60" height="28" aria-hidden="true">'
  +       sparkline(b.s, 60, 28, 1.2, 4) + '</svg>'
  +   '</span>'
  + '</a>'
  ).join('');
}

function renderOptions(data, activeKey) {
  return data.markets.map(m =>
    '<li class="dt-opt' + (m.key === activeKey ? ' is-active' : '') + '" role="option" tabindex="-1"'
  +   ' data-market="' + esc(m.key) + '" aria-selected="' + (m.key === activeKey ? 'true' : 'false') + '">'
  +   '<span class="dt-opt-flag">' + esc(m.flag) + '</span>'
  +   '<span class="dt-opt-name">' + esc(m.label) + '</span>'
  +   '<span class="dt-delta ' + deltaClass(m.mom) + '">' + fmtPct(m.mom) + '</span>'
  +   '<span class="dt-opt-tick">' + (m.key === activeKey ? '✓' : '') + '</span>'
  + '</li>'
  ).join('');
}

function renderTape(data, activeKey) {
  const m = data.markets.find(x => x.key === activeKey) || data.markets[0];
  const reticle = '<svg class="dt-reticle" viewBox="0 0 16 16" width="15" height="15" fill="none" '
                + 'stroke="currentColor" stroke-width="1.3" aria-hidden="true">'
                + '<circle cx="8" cy="8" r="6.4"/><circle cx="8" cy="8" r="2.1"/></svg>';

  // .dt-head exists only so mobile can put the picker button, the index delta
  // and the index sparkline on one grid row with the eyebrow beneath both. At
  // >=768px it is display:contents and the picker and index cells become direct
  // children of the tape row, as in the desktop design.
  return '<div class="dt-tape-inner">'
    + '<div class="dt-head">'
    + '<div class="dt-picker">'
    +   '<button type="button" class="dt-picker-btn" id="dt-picker-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="dt-picker-menu">'
    +     reticle
    +     '<span class="dt-picker-name" id="dt-market-name">' + esc(m.label) + '</span>'
    +     '<span class="dt-caret" aria-hidden="true">▾</span>'
    +   '</button>'
    +   '<ul class="dt-menu" id="dt-picker-menu" role="listbox" aria-label="Choose a market" hidden>'
    +     renderOptions(data, m.key)
    +   '</ul>'
    + '</div>'
    + '<div class="dt-index">'
    +   '<span class="dt-eyebrow" id="dt-index-eyebrow">DORMIED Index · ' + esc(m.code) + '</span>'
    +   '<span class="dt-index-row">'
    +     '<span class="dt-index-delta dt-delta ' + deltaClass(m.mom) + '">' + fmtPct(m.mom) + '</span>'
    +     '<svg class="dt-spark dt-spark--index" viewBox="0 0 64 30" width="64" height="30" aria-hidden="true">'
    +       sparkline(m.s, 64, 30, 1.3, 4) + '</svg>'
    +   '</span>'
    + '</div>'
    + '</div>'
    + '<div class="dt-rail-head" aria-hidden="true">'
    +   '<span class="dt-eyebrow" id="dt-rail-eyebrow">Top 10 · <span id="dt-rail-market">' + esc(m.label) + '</span> · MoM</span>'
    +   '<span class="dt-swipe">Swipe →</span>'
    + '</div>'
    + '<div class="dt-rail" id="dt-rail">' + renderBrands(m) + '</div>'
    + '<div class="dt-arrows">'
    +   '<button type="button" class="dt-arrow" id="dt-prev" aria-label="Scroll brands left">‹</button>'
    +   '<button type="button" class="dt-arrow" id="dt-next" aria-label="Scroll brands right">›</button>'
    + '</div>'
  + '</div>';
}

/* ── Write ────────────────────────────────────────────────────────────────── */

const START = '<!-- PRERENDER-START:ticker -->';
const END   = '<!-- PRERENDER-END:ticker -->';

function patchIndex(html, tapeHtml) {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a === -1 || b === -1) {
    throw new Error('index.html is missing the ' + START + ' / ' + END + ' markers');
  }
  return html.slice(0, a + START.length) + tapeHtml + html.slice(b);
}

function main() {
  const D    = loadData();
  const data = build(D);

  const js = '// ticker-data.js — homepage market ticker. Auto-generated by '
           + 'scripts/generate-ticker-data.js. Do not edit by hand.\n'
           + 'window.DORMIED_TICKER=' + JSON.stringify(data) + ';\n';

  const tape = renderTape(data, 'global');
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const patched = patchIndex(html, tape);

  if (CHECK_ONLY) {
    const jsStale   = !fs.existsSync(OUT_FILE) || fs.readFileSync(OUT_FILE, 'utf8') !== js;
    const htmlStale = patched !== html;
    if (jsStale || htmlStale) {
      console.error('[ticker] STALE:'
        + (jsStale   ? ' js/ticker-data.js' : '')
        + (htmlStale ? ' index.html prerender' : '')
        + ' — run: node scripts/generate-ticker-data.js');
      process.exit(1);
    }
    console.log('[ticker] ✓ up to date');
    return;
  }

  fs.writeFileSync(OUT_FILE, js);
  fs.writeFileSync(INDEX_HTML, patched);

  const kb = (Buffer.byteLength(js) / 1024).toFixed(1);
  console.log('[ticker] ✓ js/ticker-data.js (' + kb + 'KB, ' + data.markets.length
    + ' markets × ' + BRANDS_PER_MARKET + ' brands, ' + MONTHS_IN_SERIES + ' months)');
  console.log('[ticker] ✓ index.html tape prerendered for Global');
}

main();
