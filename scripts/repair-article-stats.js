'use strict';
/**
 * repair-article-stats.js
 * Patches every article's static .da-brand-card-stats HTML to match
 * the formatting that da-article.js applies dynamically:
 *   - DI Score: 1 decimal float
 *   - M/M, 3M, 12M: toFixed(1) format with sign
 *   - 3M and 12M get da-mom-up / da-mom-down / da-mom-flat color classes
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const NEWS_DIR  = path.join(ROOT, 'news');
const DATA_DIR  = path.join(ROOT, 'js', 'brand-data');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function shiftMonth(label, delta) {
  const parts = label.split(' ');
  const total = parseInt(parts[1]) * 12 + MONTHS.indexOf(parts[0]) + delta;
  const m = ((total % 12) + 12) % 12;
  return `${MONTHS[m]} ${Math.floor(total / 12)}`;
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—';
  return (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
}

function pctClass(val) {
  if (val === null || val === undefined) return '';
  if (val > 0.05)  return 'da-mom-up';
  if (val < -0.05) return 'da-mom-down';
  return 'da-mom-flat';
}

// Load all brand data files into a map: brandSlug → DORMIED_DATA
const brandDataCache = {};
function getBrandData(brandSlug) {
  if (brandDataCache[brandSlug]) return brandDataCache[brandSlug];
  const filePath = path.join(DATA_DIR, `${brandSlug}.js`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const src = fs.readFileSync(filePath, 'utf8').replace('window.DORMIED_DATA', 'var DORMIED_DATA');
    const fn = new Function('var DORMIED_DATA; ' + src + '; return DORMIED_DATA;');
    const data = fn();
    brandDataCache[brandSlug] = data;
    return data;
  } catch (e) {
    console.error(`  [ERROR] Failed to load brand data for ${brandSlug}:`, e.message);
    return null;
  }
}

function computeStats(data, brandSlug) {
  const brand = data.brands.find(b => b.id === brandSlug);
  if (!brand) return null;

  const cm  = data.meta.currentMonth;
  const pm  = data.meta.previousMonth;
  const g   = (brand.searchesByMarket && brand.searchesByMarket.global) || {};
  const cur  = g[cm] || 0;
  const prev = g[pm] || 0;
  const s12ago = g[shiftMonth(cm, -12)] || 0;

  // DI (1 decimal)
  const maxVal = Math.max(...data.brands.map(b =>
    (b.searchesByMarket && b.searchesByMarket.global && b.searchesByMarket.global[cm]) || 0
  ));
  const di = maxVal > 0 ? Math.min(100, cur / maxVal * 100) : 0;

  // Rank (with tiebreaker on prev — matches da-article.js)
  const allPrev = {};
  data.brands.forEach(b => {
    allPrev[b.id] = (b.searchesByMarket && b.searchesByMarket.global && b.searchesByMarket.global[pm]) || 0;
  });
  const sorted = data.brands
    .map(b => ({ id: b.id, v: (b.searchesByMarket && b.searchesByMarket.global && b.searchesByMarket.global[cm]) || 0 }))
    .sort((a, b) => {
      const diff = b.v - a.v;
      if (Math.abs(diff) > 0.0001) return diff;
      return (allPrev[b.id] || 0) - (allPrev[a.id] || 0);
    });
  const rank = sorted.findIndex(b => b.id === brandSlug) + 1;

  // M/M
  const momPct = prev > 0 ? (cur - prev) / prev * 100 : null;

  // 3M rolling average
  const allKeys = Object.keys(g).sort((a, b) => {
    const pa = parseInt(a.split(' ')[1]) * 12 + MONTHS.indexOf(a.split(' ')[0]);
    const pb = parseInt(b.split(' ')[1]) * 12 + MONTHS.indexOf(b.split(' ')[0]);
    return pa - pb;
  });
  const cmPos   = allKeys.indexOf(cm);
  const last3m  = allKeys.slice(Math.max(0, cmPos - 2), cmPos + 1);
  const prior3m = allKeys.slice(Math.max(0, cmPos - 5), Math.max(0, cmPos - 2));
  const l3avg   = last3m.length  ? last3m.reduce((s, m)  => s + (g[m] || 0), 0) / last3m.length  : 0;
  const p3avg   = prior3m.length ? prior3m.reduce((s, m) => s + (g[m] || 0), 0) / prior3m.length : 0;
  const t3m     = p3avg > 0 ? (l3avg - p3avg) / p3avg * 100 : null;

  // 12M point-to-point (matches da-article.js)
  const t12m = s12ago > 0 ? (cur - s12ago) / s12ago * 100 : null;

  return {
    rank,
    di,
    momPct,
    momStr:       fmtPct(momPct),
    momClass:     momPct > 0.05 ? 'da-mom-up' : momPct < -0.05 ? 'da-mom-down' : 'da-mom-flat',
    trend3mStr:   fmtPct(t3m),
    trend3mClass: pctClass(t3m),
    trend12mStr:  fmtPct(t12m),
    trend12mClass: pctClass(t12m),
  };
}

function buildStatsHtml(stats) {
  return [
    `<div class="bp-metric-card"><span class="bp-metric-label">Global Rank</span><span class="bp-metric-val">#${stats.rank}</span></div>`,
    `<div class="bp-metric-card"><span class="bp-metric-label">DI Score</span><span class="bp-metric-val">${stats.di.toFixed(1)}</span></div>`,
    `<div class="bp-metric-card"><span class="bp-metric-label">M/M Change</span><span class="bp-metric-val ${stats.momClass}">${stats.momStr}</span></div>`,
    `<div class="bp-metric-card"><span class="bp-metric-label">3M Trend</span><span class="bp-metric-val ${stats.trend3mClass}">${stats.trend3mStr}</span></div>`,
    `<div class="bp-metric-card"><span class="bp-metric-label">12M Trend</span><span class="bp-metric-val ${stats.trend12mClass}">${stats.trend12mStr}</span></div>`,
  ].join('');
}

// Replace the full da-brand-card-stats block (open tag + all children + closing tag).
// Uses div-depth counting so it handles any number of inner cards.
// Also sweeps past any orphaned bp-metric-card divs that may have been left by a
// previous broken patch attempt, plus the stray </div> that follows them.
function replaceStatsBlock(html, newInnerHtml) {
  const open = '<div class="da-brand-card-stats">';
  const start = html.indexOf(open);
  if (start === -1) return null;

  // Step 1: depth-count to find the closing </div> of the stats block itself
  let depth = 0;
  let i = start;
  while (i < html.length) {
    if (html.startsWith('<div', i)) {
      depth++;
      i += 4;
    } else if (html.startsWith('</div>', i)) {
      depth--;
      if (depth === 0) {
        i += 6; // move past the closing </div>
        break;
      }
      i += 6;
    } else {
      i++;
    }
  }
  // i now points to the character AFTER the stats block's closing </div>

  // Step 2: skip any orphaned <div class="bp-metric-card">…</div> blocks
  // and one stray </div> left over from a prior broken patch
  let j = i;
  let changed = true;
  while (changed) {
    changed = false;
    // skip whitespace
    const wsStart = j;
    while (j < html.length && /\s/.test(html[j])) j++;
    // consume an orphaned metric-card div
    if (html.startsWith('<div class="bp-metric-card">', j)) {
      // depth-count to its closing </div>
      let d2 = 0;
      while (j < html.length) {
        if (html.startsWith('<div', j))  { d2++; j += 4; }
        else if (html.startsWith('</div>', j)) { d2--; j += 6; if (d2 === 0) break; }
        else j++;
      }
      changed = true;
    } else {
      // put whitespace back if nothing was consumed
      j = wsStart;
    }
  }
  // skip whitespace again, then consume a stray </div> if present
  while (j < html.length && /\s/.test(html[j])) j++;
  if (html.startsWith('</div>', j)) {
    // only consume it if it looks like the orphan-block closer, i.e. the very
    // next non-whitespace after is also </div> (the outer container closing)
    const peek = j + 6;
    let k = peek;
    while (k < html.length && /\s/.test(html[k])) k++;
    if (html.startsWith('</div>', k) || html.startsWith('</', k)) {
      j += 6; // consume the stray </div>
    }
  }

  const before = html.slice(0, start);
  const after  = html.slice(j);
  return before + open + newInnerHtml + '</div>' + after;
}

let patched = 0, skipped = 0, errors = 0;

const articleDirs = fs.readdirSync(NEWS_DIR).filter(d =>
  fs.statSync(path.join(NEWS_DIR, d)).isDirectory()
);

for (const dir of articleDirs) {
  const htmlPath = path.join(NEWS_DIR, dir, 'index.html');
  if (!fs.existsSync(htmlPath)) continue;

  const html = fs.readFileSync(htmlPath, 'utf8');

  // Extract brand slug
  const slugMatch = html.match(/window\.__DA_BRAND_SLUG__\s*=\s*'([^']+)'/);
  if (!slugMatch) { skipped++; continue; }
  const brandSlug = slugMatch[1];

  // Check stats block exists
  if (!html.includes('<div class="da-brand-card-stats">')) { skipped++; continue; }

  // Load brand data
  const data = getBrandData(brandSlug);
  if (!data) {
    console.warn(`  [WARN] No brand data for ${brandSlug} in ${dir}`);
    errors++;
    continue;
  }

  const stats = computeStats(data, brandSlug);
  if (!stats) {
    console.warn(`  [WARN] Brand ${brandSlug} not found in data for ${dir}`);
    errors++;
    continue;
  }

  const newStats = buildStatsHtml(stats);
  const newHtml  = replaceStatsBlock(html, newStats);

  if (!newHtml || newHtml === html) {
    skipped++;
    continue;
  }

  fs.writeFileSync(htmlPath, newHtml, 'utf8');
  console.log(`  [OK] ${dir} → rank=#${stats.rank} di=${stats.di.toFixed(1)} mom=${stats.momStr} 3m=${stats.trend3mStr} 12m=${stats.trend12mStr}`);
  patched++;
}

console.log(`\nDone: ${patched} patched, ${skipped} skipped (unchanged/no stats), ${errors} errors`);
