#!/usr/bin/env node
/**
 * DORMIED Content Pipeline — Brand Page Generator
 *
 * Produces one static HTML file per brand at brands/[slug]/index.html
 * with fully server-rendered SEO content. brand.js re-populates the DOM
 * with interactive data (chart, market table, explanations) after load.
 *
 * Usage:
 *   node scripts/generate-brand-page.js              # smart: skip existing files
 *   node scripts/generate-brand-page.js --force      # regenerate all 175
 *   node scripts/generate-brand-page.js --slug=titleist  # one brand only
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs               = require('fs');
const path             = require('path');
const vm               = require('vm');
const { createClient } = require('@supabase/supabase-js');
const feedBake         = require('./feed-bake');

// ── Config ────────────────────────────────────────────────────────────────────

const SITE_ROOT = path.resolve(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function loadDormiedData() {
  const raw = fs.readFileSync(path.join(SITE_ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return ctx.window.DORMIED_DATA;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function shiftMonth(label, delta) {
  const [mon, year] = label.split(' ');
  const total = parseInt(year) * 12 + MONTH_NAMES.indexOf(mon) + delta;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return `${MONTH_NAMES[m]} ${y}`;
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—';
  return (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sanitize em dashes out of prose strings (site rule: no em dashes). */
function stripEmDashes(text) {
  if (!text) return text;
  return text
    .replace(/\s*—\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate.length === 10 ? isoDate + 'T12:00:00Z' : isoDate);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

// "2026-03" → "Mar 2026"
function fmtMonth(yyyymm) {
  if (!yyyymm) return '';
  const [year, mon] = yyyymm.split('-');
  const idx = parseInt(mon, 10) - 1;
  return `${MONTH_NAMES[idx]} ${year}`;
}

// ── Brand stats ───────────────────────────────────────────────────────────────

function getBrandStats(dormiedData, brandSlug) {
  const brand = dormiedData.brands.find(b => b.id === brandSlug);
  if (!brand) return null;

  const currentMonth  = dormiedData.meta.currentMonth;
  const previousMonth = dormiedData.meta.previousMonth;
  const month12ago    = shiftMonth(currentMonth, -12);

  const globalData   = brand.searchesByMarket?.global || {};
  const curSearches  = globalData[currentMonth]  || 0;
  const prevSearches = globalData[previousMonth] || 0;
  const s12ago       = globalData[month12ago]    || 0;

  // DI score: 0–100 relative to top brand, 1 decimal
  const maxSearches = Math.max(
    ...dormiedData.brands.map(b => b.searchesByMarket?.global?.[currentMonth] || 0)
  );
  const di = maxSearches > 0 ? Math.min(100, (curSearches / maxSearches) * 100) : 0;

  // Global rank
  const sorted = dormiedData.brands
    .map(b => ({ id: b.id, s: b.searchesByMarket?.global?.[currentMonth] || 0 }))
    .sort((a, b) => b.s - a.s);
  const rank = sorted.findIndex(b => b.id === brandSlug) + 1;

  // MoM %
  const momPct = prevSearches > 0
    ? ((curSearches - prevSearches) / prevSearches) * 100
    : null;

  // 3M rolling average vs prior 3M (matches da-article.js logic)
  const MONTH_KEYS_SORTED = Object.keys(globalData).sort((a, b) => {
    const [ma, ya] = a.split(' '); const [mb, yb] = b.split(' ');
    return (parseInt(ya) * 12 + MONTH_NAMES.indexOf(ma)) - (parseInt(yb) * 12 + MONTH_NAMES.indexOf(mb));
  });
  const cmPos   = MONTH_KEYS_SORTED.indexOf(currentMonth);
  const last3m  = MONTH_KEYS_SORTED.slice(Math.max(0, cmPos - 2), cmPos + 1);
  const prior3m = MONTH_KEYS_SORTED.slice(Math.max(0, cmPos - 5), Math.max(0, cmPos - 2));
  const l3avg   = last3m.length  ? last3m.reduce((s, m) => s + (globalData[m] || 0), 0) / last3m.length  : 0;
  const p3avg   = prior3m.length ? prior3m.reduce((s, m) => s + (globalData[m] || 0), 0) / prior3m.length : 0;
  const t3m     = p3avg > 0 ? (l3avg - p3avg) / p3avg * 100 : null;

  // 12M point-to-point
  const t12m = s12ago > 0 ? (curSearches - s12ago) / s12ago * 100 : null;

  return { brand, rank, di, momPct, t3m, t12m, currentMonth, curSearches };
}

// ── Meta description ──────────────────────────────────────────────────────────

function buildMetaDesc(brand) {
  const desc = (brand.description || '').trim();
  if (!desc) {
    return `${brand.name} brand profile on DORMIED. Global search interest trends, market rankings, and monthly momentum.`;
  }
  if (desc.length <= 155) return desc;
  const cut      = desc.slice(0, 155);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

// ── Supabase fetches ──────────────────────────────────────────────────────────

async function fetchTake(supabase, brandSlug) {
  const { data, error } = await supabase
    .from('brand_takes')
    .select('take, month, brand_name')
    .eq('brand_id', brandSlug)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`[brand-page] take fetch error for ${brandSlug}:`, error.message);
    return null;
  }
  return data; // { take, month, brand_name } or null
}

async function fetchExplanations(supabase, brandSlug) {
  const { data, error } = await supabase
    .from('brand_explanations')
    .select('month, explanation')
    .eq('brand_id', brandSlug)
    .order('month', { ascending: true });

  if (error) {
    console.warn(`[brand-page] explanations fetch error for ${brandSlug}:`, error.message);
    return [];
  }
  return data || []; // [{ month: '2026-01', explanation: '...' }, ...]
}

async function fetchRecentArticles(supabase, brandSlug, limit = 8) {
  const { data, error } = await supabase
    .from('dormied_articles')
    .select('slug, title, published_at, image_url')
    .eq('brand_slug', brandSlug)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn(`[brand-page] articles fetch error for ${brandSlug}:`, error.message);
    return [];
  }
  return data || [];
}

// ── Related brands ────────────────────────────────────────────────────────────

function getRelatedBrands(dormiedData, brandSlug, curSearches, count = 5) {
  const brand = dormiedData.brands.find(b => b.id === brandSlug);
  if (!brand) return [];

  const currentMonth = dormiedData.meta.currentMonth;
  const brandSubs    = new Set(brand.subCategories || []);

  const candidates = dormiedData.brands
    .filter(b => b.id !== brandSlug)
    .map(b => {
      const bSubs      = new Set(b.subCategories || []);
      const sharedSubs = [...brandSubs].filter(s => bSubs.has(s)).length;
      const sameCat    = b.category === brand.category ? 1 : 0;
      const bSearches  = b.searchesByMarket?.global?.[currentMonth] || 0;
      const volDiff    = Math.abs(bSearches - curSearches);
      return { brand: b, sharedSubs, sameCat, volDiff };
    });

  // Sort: shared sub-categories (desc) → same category (desc) → closest volume (asc)
  candidates.sort((a, b) => {
    if (b.sharedSubs !== a.sharedSubs) return b.sharedSubs - a.sharedSubs;
    if (b.sameCat    !== a.sameCat)    return b.sameCat    - a.sameCat;
    return a.volDiff - b.volDiff;
  });

  return candidates.slice(0, count).map(x => x.brand);
}

// ── Sitemap ───────────────────────────────────────────────────────────────────
// Sitemap is regenerated from the filesystem after all brand pages are written
// (see main()). Never patch-appended — that was the source of duplicate entries.

const { regenerateSitemap } = require('./generate-sitemap');
const { generateSearchIndex } = require('./generate-search-index');

// ── Per-market helpers — match brand.js exactly ───────────────────────────────

// brand.js uses `val > 0` (not `>=`), so zero reads as '0.0%' without a plus sign.
function mktFmtPct(val) {
  if (val === null || val === undefined) return '—';
  return (val > 0 ? '+' : '') + val.toFixed(1) + '%';
}

// Matches brand.js pctClass(val, threshold=0)
function mktPctClass(val) {
  if (val === null || val === undefined) return 'change-flat';
  return val > 0 ? 'change-up' : val < 0 ? 'change-down' : 'change-flat';
}

// Matches brand.js fmtVol(n)
function fmtVol(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return n.toLocaleString('en-US');
}

/**
 * Port of brand.js computeMarketStats() — exact same algorithm, including the
 * three-way tiebreaker (current DI → prev-month rank → 3-months-ago rank).
 * Returns array of { key, label, flag, rank, di, vsMonth, vsYear, totalSearches }
 * in the same order as data.meta.markets (global first, then the 10 markets).
 */
function computeMarketStats(dormiedData, brand) {
  const cm    = dormiedData.meta.currentMonth;
  const pm    = dormiedData.meta.previousMonth;
  const ago3m = shiftMonth(cm, -3);
  const yam   = shiftMonth(cm, -12);

  return dormiedData.meta.markets.map(mkt => {
    const key         = mkt.key;
    const mktSearches = brand.searchesByMarket?.[key] || {};
    const allVals     = dormiedData.brands.map(b => b.searchesByMarket?.[key]?.[cm] || 0);
    const max         = Math.max(...allVals);
    const cur         = mktSearches[cm]  || 0;
    const prev        = mktSearches[pm]  || 0;
    const ya          = mktSearches[yam] || 0;

    // Build prev-month and 3M-ago rank maps for tiebreaking — mirrors brand.js exactly
    const prevSortedMkt = [...dormiedData.brands].sort((a, b) => {
      const diff = (b.searchesByMarket?.[key]?.[pm] || 0) - (a.searchesByMarket?.[key]?.[pm] || 0);
      if (Math.abs(diff) > 0.0001) return diff;
      return (b.searchesByMarket?.[key]?.[ago3m] || 0) - (a.searchesByMarket?.[key]?.[ago3m] || 0);
    });
    const prevRankMkt = new Map();
    prevSortedMkt.forEach((b, i) => prevRankMkt.set(b.id, i + 1));

    const ago3SortedMkt = [...dormiedData.brands].sort((a, b) =>
      (b.searchesByMarket?.[key]?.[ago3m] || 0) - (a.searchesByMarket?.[key]?.[ago3m] || 0)
    );
    const ago3RankMkt = new Map();
    ago3SortedMkt.forEach((b, i) => ago3RankMkt.set(b.id, i + 1));

    const sorted = [...dormiedData.brands].sort((a, b) => {
      const diff = (b.searchesByMarket?.[key]?.[cm] || 0) - (a.searchesByMarket?.[key]?.[cm] || 0);
      if (Math.abs(diff) > 0.0001) return diff;
      const prevDiff = (prevRankMkt.get(a.id) || 9999) - (prevRankMkt.get(b.id) || 9999);
      if (prevDiff !== 0) return prevDiff;
      return (ago3RankMkt.get(a.id) || 9999) - (ago3RankMkt.get(b.id) || 9999);
    });

    const rank         = sorted.findIndex(b => b.id === brand.id) + 1;
    const di           = max > 0 ? parseFloat((cur / max * 100).toFixed(1)) : 0;
    const totalSearches = dormiedData.brands.reduce((s, b) => s + (b.searchesByMarket?.[key]?.[cm] || 0), 0);

    return {
      key, label: mkt.label, flag: mkt.flag,
      rank: rank || null,
      di,
      vsMonth: prev > 0 ? (cur - prev) / prev * 100 : null,
      vsYear:  ya   > 0 ? (cur - ya)   / ya   * 100 : null,
      totalSearches,
    };
  });
}

/**
 * Render <tr> rows matching renderCountryTable() in brand.js exactly.
 * Same columns, same order, same class names, same number formatting.
 */
function buildCountryTableRows(marketStats) {
  return marketStats.map(mkt => {
    const rankStr = mkt.rank ? `#${mkt.rank}` : '—';
    const diStr   = mkt.di   ? mkt.di.toFixed(1) : '—';
    const momStr  = mktFmtPct(mkt.vsMonth);
    const yoyStr  = mktFmtPct(mkt.vsYear);
    const momCls  = mktPctClass(mkt.vsMonth);
    const yoyCls  = mktPctClass(mkt.vsYear);
    const volStr  = mkt.totalSearches > 0 ? fmtVol(mkt.totalSearches) : '—';
    const rowCls  = mkt.key === 'global' ? ' class="bp-ct-global"' : '';
    return `<tr${rowCls}>
        <td class="bp-ct-market"><span class="bp-ct-flag">${mkt.flag}</span> ${escHtml(mkt.label)}</td>
        <td class="bp-ct-rank"><span class="rank-num">${rankStr}</span></td>
        <td class="bp-ct-di"><span class="di-value">${diStr}</span></td>
        <td class="bp-ct-change"><span class="change-val ${momCls}">${momStr}</span></td>
        <td class="bp-ct-yoy"><span class="change-val ${yoyCls}">${yoyStr}</span></td>
        <td class="bp-ct-vol"><span class="bp-ct-vol-val">${volStr}</span></td>
      </tr>`;
  }).join('\n');
}

// ── HTML template ─────────────────────────────────────────────────────────────

// ── FAQ section (Supabase-driven facts + live Index data) ─────────────────────
// Renders only questions whose facts exist; a NULL fact skips its question so no
// page ships a guessed or empty answer. Answers regenerate on every bake.
function buildFaqItems({ brand, stats, dormiedData, onTourData, facts }) {
  const items = [];
  const f = facts || {};

  // Q1: ownership (owner / parent_company; notes appended when present)
  if (f.owner || f.parent_company) {
    let a = f.owner === 'Independent'
      ? `${brand.name} is independently owned.`
      : `${brand.name} is owned by ${f.parent_company || f.owner}.`;
    if (f.owner === 'Independent' && f.parent_company) a = `${brand.name} is owned by ${f.parent_company}.`;
    if (f.notes) a += ` ${f.notes}.`;
    items.push({ q: `Who owns ${brand.name}?`, aHtml: escHtml(a), aText: a });
  }

  // A founder stored as "Anonymous" signals a brand that intentionally does not
  // disclose who is behind it — never render "founded by Anonymous".
  const founderAnon  = f.founder && /^anonymous/i.test(f.founder);
  const founderKnown = f.founder && !founderAnon;

  // Q2: where based (hq_city / hq_country, founded woven in when known)
  if (f.hq_city || f.hq_country) {
    const place = [f.hq_city, f.hq_country].filter(Boolean).join(', ');
    let a = `${brand.name} is based in ${place}.`;
    if (f.founded_year && founderKnown) a += ` It was founded in ${f.founded_year} by ${f.founder}.`;
    else if (f.founded_year)            a += ` It was founded in ${f.founded_year}.`;
    else if (founderKnown)              a += ` It was founded by ${f.founder}.`;
    items.push({ q: `Where is ${brand.name} based?`, aHtml: escHtml(a), aText: a });
  }

  // Q2b: founder intentionally anonymous (by design)
  if (founderAnon) {
    const a = `${brand.name}'s founder is intentionally anonymous. The brand does not publicly disclose who is behind it.`;
    items.push({ q: `Who founded ${brand.name}?`, aHtml: escHtml(a), aText: a });
  }

  // Q3: is it a good brand — ALWAYS renders, generated from live Index data
  {
    const totalBrands = dormiedData.brands.length;
    const trend = stats.t3m === null ? null
      : Math.abs(stats.t3m) < 0.05 ? 'flat'
      : `${stats.t3m > 0 ? 'up' : 'down'} ${Math.abs(stats.t3m).toFixed(1)}% over the last three months`;

    // Strongest market: best rank across non-global markets for the current month
    let best = null;
    for (const mkt of (dormiedData.meta.markets || [])) {
      if (mkt.key === 'global') continue;
      const vals = dormiedData.brands
        .map(b => ({ id: b.id, s: b.searchesByMarket?.[mkt.key]?.[stats.currentMonth] || 0 }))
        .sort((a, b) => b.s - a.s);
      const r = vals.findIndex(v => v.id === brand.id) + 1;
      const s = vals[r - 1] ? vals[r - 1].s : 0;
      if (r > 0 && s > 0 && (!best || r < best.rank)) best = { rank: r, label: mkt.label };
    }

    let a = `As of ${stats.currentMonth}, ${brand.name} ranks #${stats.rank} of ${totalBrands} golf brands on the DORMIED Index with a DI score of ${stats.di.toFixed(1)}.`;
    if (trend) a += ` Its search interest is ${trend}.`;
    if (best)  a += ` Its strongest market is ${best.label}, where it ranks #${best.rank}.`;
    items.push({ q: `Is ${brand.name} a good golf brand?`, aHtml: escHtml(a), aText: a });
  }

  // Q4: do any pros play it — equipment brands with tour presence only
  if (onTourData && onTourData.length > 0) {
    const seen = new Map();
    for (const cat of onTourData) {
      for (const g of (cat.modelGroups || [])) {
        for (const p of (g.players || [])) if (p && p.slug && !seen.has(p.slug)) seen.set(p.slug, p);
      }
    }
    const all = [...seen.values()].sort((a, b) => (a.owgr_rank || 9999) - (b.owgr_rank || 9999));
    if (all.length > 0) {
      const top = all.slice(0, 3);
      const namesText = top.map(p => p.name).join(', ');
      const namesHtml = top.map(p => `<a href="/witb/players/${escHtml(p.slug)}/">${escHtml(p.name)}</a>`).join(', ');
      const total = onTourData[0].totalRanked;
      const aText = `Yes. ${all.length} of the ${total} ranked players in the DORMIED WITB database currently carry ${brand.name} equipment, including ${namesText}.`;
      const aHtml = `Yes. ${all.length} of the ${total} ranked players in the <a href="/witb/players/">DORMIED WITB database</a> currently carry ${escHtml(brand.name)} equipment, including ${namesHtml}.`;
      items.push({ q: `Do any pros play ${brand.name}?`, aHtml, aText });
    }
  }

  return items;
}

function generateBrandPageHtml({ brand, slug, stats, take, explanations, articles, relatedBrands, dormiedData, onTourHtml = '', onTourData = [], facts = null, dormiedLatestHtml, modsHtml = '' }) {
  const { rank, di, momPct, t3m, t12m } = stats;

  // WITB-style title: exact query phrase first, plain-language promise, year from the
  // latest snapshot so it rolls over automatically. Equipment brands (those with an
  // ON TOUR section) promise "Who Plays It"; apparel/no-tour brands promise Rank + Trend.
  // Long names drop ", Trend" to stay near 60 chars. No em dashes.
  const titleYear = (stats.currentMonth || '').split(' ')[1] || String(new Date().getFullYear());
  const hasTour   = !!onTourHtml;
  let pageTitle;
  if (hasTour) {
    pageTitle = `${brand.name}: Golf Brand Rank, Trend + Who Plays It (${titleYear}) | DORMIED`;
    if (pageTitle.length > 65) pageTitle = `${brand.name}: Golf Brand Rank + Who Plays It (${titleYear}) | DORMIED`;
  } else {
    pageTitle = `${brand.name}: Golf Brand Rank + Trend (${titleYear}) | DORMIED`;
  }
  pageTitle = escHtml(pageTitle);
  const metaDesc     = escHtml(buildMetaDesc(brand));
  const canonicalUrl = `https://dormied.com/brands/${escHtml(slug)}/`;
  const ogImage      = escHtml(brand.logo || 'https://dormied.com/images/og-image.jpg');

  const momStr = fmtPct(momPct);
  const t3mStr = fmtPct(t3m);
  const t12mStr = fmtPct(t12m);

  // Per-market table — computed server-side, same algorithm as brand.js
  const marketStats    = computeMarketStats(dormiedData, brand);
  const countryRows    = buildCountryTableRows(marketStats);

  // Meta line: Founded YYYY · Headquarters (category already shown as badge)
  const metaParts = [];
  if (brand.founded)      metaParts.push(`Founded ${brand.founded}`);
  if (brand.headquarters) metaParts.push(brand.headquarters);
  const metaLine = metaParts.join(' · ');

  // Take — only show if the take.month matches the current snapshot month
  const currentMonthYYYYMM = (() => {
    const [mon, year] = (stats.currentMonth || '').split(' ');
    const idx = MONTH_NAMES.indexOf(mon);
    return idx >= 0 && year ? `${year}-${String(idx + 1).padStart(2, '0')}` : null;
  })();
  const hasTake       = !!(take && take.take && currentMonthYYYYMM && take.month === currentMonthYYYYMM);
  const takeMonthLabel = hasTake ? fmtMonth(take.month) : '';

  // Stable first-publish date = earliest month on record for this brand (MIN
  // snapshot month). Independent of the current snapshot, so it does not move
  // when new monthly data lands. dateModified carries the current data month.
  const toISODate = (label) => {
    const [mon, yr] = (label || '').split(' ');
    const idx = MONTH_NAMES.indexOf(mon);
    return idx >= 0 && yr ? `${yr}-${String(idx + 1).padStart(2, '0')}-01` : null;
  };
  const brandMonths = Object.keys(brand.searchesByMarket?.global || {});
  const firstMonthLabel = brandMonths.length
    ? brandMonths
        .map(m => { const [mo, yr] = m.split(' '); return { m, k: parseInt(yr) * 12 + MONTH_NAMES.indexOf(mo) }; })
        .sort((a, b) => a.k - b.k)[0].m
    : null;
  const brandDatePublished = toISODate(firstMonthLabel);
  const brandDateModified  = currentMonthYYYYMM ? `${currentMonthYYYYMM}-01` : brandDatePublished;

  // JSON-LD
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home',   item: 'https://dormied.com/' },
          { '@type': 'ListItem', position: 2, name: 'Brands', item: 'https://dormied.com/brands/' },
          { '@type': 'ListItem', position: 3, name: brand.name, item: `https://dormied.com/brands/${slug}/` },
        ],
      },
      {
        '@type': 'Organization',
        name: brand.name,
        ...(brand.website     && { url: brand.website }),
        ...(brand.logo        && { logo: brand.logo }),
        ...(brand.founded     && { foundingDate: String(brand.founded) }),
        ...(brand.description && { description: stripEmDashes(brand.description) }),
      },
      {
        '@type': 'Article',
        headline: `${brand.name}: Golf Brand Profile, Rankings & News`,
        description: stripEmDashes(brand.description || `${brand.name} on the DORMIED Index.`),
        image: brand.logo || 'https://dormied.com/images/og-image.jpg',
        ...(brandDatePublished && {
          datePublished: brandDatePublished,
          dateModified:  brandDateModified,
        }),
        author:    { '@type': 'Organization', name: 'DORMIED', url: 'https://dormied.com' },
        publisher: {
          '@type': 'Organization',
          name: 'DORMIED',
          url: 'https://dormied.com',
          logo: { '@type': 'ImageObject', url: 'https://dormied.com/images/dormied-logo-colour.png' },
        },
        mainEntityOfPage: `https://dormied.com/brands/${slug}/`,
        url: `https://dormied.com/brands/${slug}/`,
      },
    ],
  });

  // FAQ (facts + live Index data). Static rendered text, no accordion, no JS.
  const faqItems = buildFaqItems({ brand, stats, dormiedData, onTourData, facts });
  const faqHtml = faqItems.length === 0 ? '' : `
            <!-- ── Frequently Asked ── -->
            <section class="bp-section" aria-labelledby="bp-faq-heading">
              <h2 class="bp-section-title bp-section-title--green" id="bp-faq-heading">Frequently Asked</h2>
${faqItems.map(it => `              <div class="bp-faq-item">
                <p class="bp-faq-q">${escHtml(it.q)}</p>
                <p class="bp-faq-a">${it.aHtml}</p>
              </div>`).join('\n')}
            </section>`;
  const faqJsonLdTag = faqItems.length === 0 ? '' : `\n  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map(it => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.aText },
    })),
  })}</script>`;

  // Article list HTML
  const articlesHtml = articles.length > 0
    ? articles.map(a => {
        const thumb = a.image_url
          ? `<img src="${escHtml(a.image_url)}" alt="${escHtml(a.title)}" class="latest-feed-thumb" loading="lazy" onerror="this.style.display='none'">`
          : '';
        return `
        <article class="latest-feed-item">
          <a href="/news/${escHtml(a.slug)}/" class="latest-feed-link">
            ${thumb}
            <div class="latest-feed-info">
              <h3 class="latest-feed-title">${escHtml(a.title)}</h3>
              <span class="latest-feed-meta">${formatDate(a.published_at)}</span>
            </div>
          </a>
        </article>`;
      }).join('\n')
    : '<p class="latest-feed-empty">No articles yet for this brand.</p>';

  // Related brands HTML
  const relatedHtml = relatedBrands.map(b => {
    const logoHtml = b.logo
      ? `<img src="${escHtml(b.logo)}" alt="${escHtml(b.name)}" class="bp-similar-logo" loading="lazy" onerror="this.style.display='none'">`
      : '';
    return `
        <a href="/brands/${escHtml(b.id)}/" class="bp-similar-card">
          ${logoHtml}
          <span class="bp-similar-name">${escHtml(b.name)}</span>
        </a>`;
  }).join('\n');

  // Take section HTML
  const takeSectionHtml = hasTake
    ? `
      <section class="bp-take-section" id="bp-take-section">
          <div class="bp-take-inner">
            <div class="bp-take-label-wrap">
              <span class="bp-take-label">THE READ</span>
              <span class="bp-take-month" id="bp-take-month">${escHtml(takeMonthLabel)}</span>
            </div>
            <div class="bp-take-body">
              <p class="bp-take-text" id="bp-take-text">${escHtml(stripEmDashes(take.take))}</p>
              <p class="bp-take-attribution" id="bp-take-attribution" style="margin-top:.6rem;font-size:.8rem;color:var(--clr-muted,#6b7a6b);font-style:italic;font-family:'Inter',sans-serif"></p>
            </div>
          </div>
      </section>`
    : `
      <section class="bp-take-section" id="bp-take-section" hidden>
          <div class="bp-take-inner">
            <div class="bp-take-label-wrap">
              <span class="bp-take-label">THE READ</span>
              <span class="bp-take-month" id="bp-take-month"></span>
            </div>
            <div class="bp-take-body">
              <p class="bp-take-text" id="bp-take-text"></p>
              <p class="bp-take-attribution" id="bp-take-attribution" style="margin-top:.6rem;font-size:.8rem;color:var(--clr-muted,#6b7a6b);font-style:italic;font-family:'Inter',sans-serif"></p>
            </div>
          </div>
      </section>`;

  // Key Moments — pre-render timeline from Supabase explanation rows

  /** Convert markdown links [label](url) → <a href="url">label</a>, escaping everything else. */
  function mdLinksToHtml(text) {
    const parts = [];
    let last = 0;
    const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      parts.push(escHtml(text.slice(last, m.index)));
      parts.push(`<a href="${escHtml(m[2])}">${escHtml(m[1])}</a>`);
      last = m.index + m[0].length;
    }
    parts.push(escHtml(text.slice(last)));
    return parts.join('');
  }

  function expToBullets(text) {
    const cleaned = stripEmDashes(text) || '';
    if (!cleaned) return '';
    let items;
    if (cleaned.indexOf('•') !== -1) {
      items = cleaned.split('•').map(s => s.trim()).filter(Boolean);
    } else {
      const sentences = cleaned.match(/[^.!?]+[.!?]*/g) || [cleaned];
      items = sentences.map(s => s.trim()).filter(s => s.length > 15);
    }
    if (!items.length) return `<p>${mdLinksToHtml(cleaned)}</p>`;
    return '<ul class="exp-bullets">' + items.map(s => `<li>${mdLinksToHtml(s)}</li>`).join('') + '</ul>';
  }

  const sortedExplanations = (explanations || []).slice().sort((a, b) => a.month < b.month ? 1 : -1); // DESC — newest first
  const explanationsSectionHtml = sortedExplanations.length > 0
    ? `
      <section class="bp-explanation-section" id="bp-explanation-section" aria-labelledby="bp-explanation-heading">
          <h2 class="bp-section-title" id="bp-explanation-heading">Key Moments</h2>
          <p class="bp-section-sub">The product, marketing, culture, and on-course moments that moved search interest in ${escHtml(brand.name)} in a given month.</p>
          <div id="bp-explanation-body" class="bp-explanation-body">
            <div class="bp-exp-timeline">
              ${sortedExplanations.map(row => {
                const label = fmtMonth(row.month);
                return `<div class="bp-exp-timeline-item" data-month="${escHtml(row.month)}">
                  <span class="bp-exp-timeline-month">${escHtml(label)}</span>
                  <div class="bp-exp-timeline-text">${expToBullets(row.explanation)}</div>
                </div>`;
              }).join('\n              ')}
            </div>
          </div>
      </section>`
    : `
      <section class="bp-explanation-section" id="bp-explanation-section" aria-labelledby="bp-explanation-heading" hidden>
          <h2 class="bp-section-title" id="bp-explanation-heading">Key Moments</h2>
          <p class="bp-section-sub">The product, marketing, culture, and on-course moments that moved search interest in ${escHtml(brand.name)} in a given month.</p>
          <div id="bp-explanation-body" class="bp-explanation-body"></div>
      </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-N4Q8J6L3');</script>
  <!-- End Google Tag Manager -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- ── Primary SEO ── -->
  <title>${pageTitle}</title>
  <meta name="description" content="${metaDesc}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" id="meta-canonical" href="${canonicalUrl}">

  <!-- ── Favicon ── -->
  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="apple-touch-icon" href="/images/dormied-icon.png">

  <!-- ── Open Graph ── -->
  <meta property="og:type"         content="website">
  <meta property="og:site_name"    content="DORMIED">
  <meta property="og:locale"       content="en_US">
  <meta id="og-url"   property="og:url"         content="${canonicalUrl}">
  <meta id="og-title" property="og:title"        content="${pageTitle}">
  <meta id="og-desc"  property="og:description"  content="${metaDesc}">
  <meta id="og-img"   property="og:image"        content="${ogImage}">
  <meta property="og:image:width"  content="1200">
  <meta property="og:image:height" content="630">

  <!-- ── Twitter Card ── -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:site"        content="@DORMIED_GOLF">
  <meta id="tw-title" name="twitter:title"       content="${pageTitle}">
  <meta id="tw-desc"  name="twitter:description" content="${metaDesc}">
  <meta id="tw-img"   name="twitter:image"       content="${ogImage}">

  <!-- ── Resource hints ── -->

  <!-- ── Fonts ── -->
  <link rel="stylesheet" href="/css/fonts.css">

  <!-- ── Styles ── -->
  <link rel="stylesheet" href="/css/styles.css?v=20260530">

  <!-- ── JSON-LD ── -->
  <script type="application/ld+json" id="brand-jsonld">${jsonld}</script>${faqJsonLdTag}
  <!-- Grow.me -->
  <script data-grow-initializer="">!(function(){window.growMe||((window.growMe=function(e){window.growMe._.push(e);}),(window.growMe._=[]));var e=document.createElement("script");(e.type="text/javascript"),(e.src="https://faves.grow.me/main.js"),(e.defer=!0),e.setAttribute("data-grow-faves-site-id","U2l0ZTowNjk5NTY3Ny0xMzU0LTQ5M2YtOWEyYi03Y2NkOTlkNWE3YWQ=");var t=document.getElementsByTagName("script")[0];t.parentNode.insertBefore(e,t);})();</script>
  <!-- Mediavine Journey ads -->
  <script type="text/javascript" async="async" data-noptimize="1" data-cfasync="false" src="//scripts.scriptwrapper.com/tags/06995677-1354-493f-9a2b-7ccd99d5a7ad.js"></script>
</head>

<body class="brand-page">

  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->


  <!-- ══ SITE HEADER ══════════════════════════════════════════════════════════ -->
  <header class="site-header" role="banner">
    <div class="container header-inner">
      <a href="/" class="site-logo" aria-label="DORMIED home">
        <img src="/images/dormied-logo-colour.png" alt="DORMIED | Golf's Brand Desk" class="logo-img"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="logo-text-fallback" style="display:none">DORMIED</span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a href="/rankings/"  class="site-nav-link">Index</a>
        <a href="/witb/"      class="site-nav-link">WITB</a>
        <a href="/scorecard/" class="site-nav-link">Scorecard</a>
        <a href="/news/"      class="site-nav-link">News</a>
        <a href="/brands/"    class="site-nav-link site-nav-link--active">Brands</a>
      </nav>

      <!-- Hamburger (mobile only) -->
      <button class="nav-hamburger" id="nav-hamburger" aria-label="Open navigation menu"
        aria-expanded="false" aria-controls="mobile-nav-panel">
        <span class="bars" aria-hidden="true">
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
        </span>
      </button>

      <div class="site-search">
        <button class="site-search-trigger" aria-label="Search" aria-haspopup="true" aria-expanded="false">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
          <span class="site-search-trigger-label">Search</span>
        </button>
        <div class="site-search-panel" hidden>
          <div class="site-search-input-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;opacity:.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="search" class="site-search-input" placeholder="Search brands, news, scorecard…" autocomplete="off" aria-label="Search dormied.com">
            <button class="site-search-close" aria-label="Close search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="site-search-results" role="listbox" aria-label="Search results"></div>
          <div class="site-search-empty" hidden>No results for that search.</div>
        </div>
      </div>
    </div>

    <!-- Mobile nav panel -->
    <nav class="mobile-nav-panel" id="mobile-nav-panel" aria-label="Mobile navigation" hidden>
      <a href="/rankings/"  class="mobile-nav-link">Index</a>
      <a href="/witb/"      class="mobile-nav-link">WITB</a>
      <a href="/scorecard/" class="mobile-nav-link">Scorecard</a>
      <a href="/news/"      class="mobile-nav-link">News</a>
      <a href="/brands/"    class="mobile-nav-link">Brands</a>
    </nav>

  </header>

  <!-- ══ MAIN ════════════════════════════════════════════════════════════════ -->
  <main id="main-content">

    <!-- ── Brand Nav Bar ── -->
    <nav class="brand-nav" aria-label="Brand navigation">
      <div class="container brand-nav-inner">
        <a href="/rankings/" class="brand-nav-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Index
        </a>
      </div>
    </nav>

    <!-- ── Loading state (hidden — static content renders immediately) ── -->
    <div id="brand-loading" class="brand-loading" hidden>
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <span>Loading brand data…</span>
      </div>
    </div>

    <div id="brand-error" class="brand-error" hidden>
      <div class="container">
        <h1 class="brand-error-title">Brand not found</h1>
        <p class="brand-error-msg">We couldn't find a brand matching that URL. It may have been removed or the URL may be incorrect.</p>
        <a href="/" class="detail-link" style="display:inline-flex;width:auto;">← Back to the DORMIED Index</a>
      </div>
    </div>

    <!-- ══ BRAND CONTENT (static — visible immediately to crawlers) ══════════ -->
    <div id="brand-content">

      <!-- ── Breadcrumb ── -->
      <nav class="breadcrumb container" aria-label="Breadcrumb">
        <a href="/" class="breadcrumb-link">Home</a>
        <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
        <a href="/brands/" class="breadcrumb-link">Brands</a>
        <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
        <span id="bp-breadcrumb-name" class="breadcrumb-item--current" aria-current="page">${escHtml(brand.name)}</span>
      </nav>

      <!-- ── Brand Header ── -->
      <section class="bp-header-section">
        <div class="container">
          <div class="bp-header">
            <div class="bp-logo-wrap" id="bp-logo">
              ${brand.logo ? `<img src="${escHtml(brand.logo)}" alt="${escHtml(brand.name)} logo" class="bp-logo-img" loading="eager" onerror="this.style.display='none'">` : ''}
            </div>
            <div class="bp-header-info">
              <div class="bp-title-row">
                <h1 class="bp-brand-name" id="bp-name">${escHtml(brand.name)}</h1>
                <span id="bp-heat" class="bp-heat-icon"></span>
              </div>
              <p class="bp-meta-line" id="bp-meta">${escHtml(metaLine)}</p>
              <div class="bp-badges" id="bp-badges">
                <span class="bp-badge">${escHtml(brand.category)}</span>
              </div>
            </div>
            <div class="bp-rank-block">
              <div class="bp-rank-num" id="bp-rank">#${rank}</div>
              <div id="bp-move"></div>
              <div class="bp-rank-label">Global Rank</div>
              <a href="/rankings/" class="bp-rank-index-link" style="display:block;margin-top:.4rem;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;color:var(--clr-green,#4a7c4a);text-decoration:none;opacity:.85" aria-label="View on the DORMIED Index">View Index →</a>
            </div>
          </div>
          <p class="bp-description" id="bp-description">${escHtml(stripEmDashes(brand.description || ''))}</p>
        </div>
      </section>

      <!-- ── Key Metrics Strip ── -->
      <section class="bp-metrics-section">
        <div class="container">
          <div class="bp-metrics-grid" id="bp-metrics">
            <div class="bp-metric-card">
              <span class="bp-metric-label">DI Score</span>
              <span class="bp-metric-val">${di.toFixed(1)}</span>
            </div>
            <div class="bp-metric-card">
              <span class="bp-metric-label">MoM Change</span>
              <span class="bp-metric-val${momPct !== null ? (momPct > 0 ? ' change-up' : momPct < 0 ? ' change-down' : ' change-flat') : ''}">${escHtml(momStr)}</span>
            </div>
            <div class="bp-metric-card">
              <span class="bp-metric-label">3M Trend</span>
              <span class="bp-metric-val${t3m !== null ? (t3m > 0 ? ' change-up' : t3m < 0 ? ' change-down' : ' change-flat') : ''}">${escHtml(t3mStr)}</span>
            </div>
            <div class="bp-metric-card">
              <span class="bp-metric-label">12M Trend</span>
              <span class="bp-metric-val${t12m !== null ? (t12m > 0 ? ' change-up' : t12m < 0 ? ' change-down' : ' change-flat') : ''}">${escHtml(t12mStr)}</span>
            </div>
          </div>
          <p class="bp-updated-line">Updated ${escHtml(stats.currentMonth || '')}</p>
        </div>
      </section>
      <div class="container">
        <div class="bp-page-grid">
          <article class="bp-page-main da-article-body">

${takeSectionHtml}

            <!-- ── ${escHtml(brand.name)} Interest Over Time ── -->
            <section class="bp-chart-section">
              <p class="bp-chart-heading">${escHtml(brand.name)} Interest Over Time</p>
              <p class="bp-chart-heading-sub">How search demand for ${escHtml(brand.name)} has moved over time, indexed against the rest of the field.</p>
              <div class="bp-chart-main">
                <div class="bp-chart-controls">
                  <div class="bp-market-tabs" id="bp-market-tabs" role="tablist" aria-label="Select market"></div>
                  <div class="bp-period-tabs" id="bp-period-tabs" role="tablist" aria-label="Select time range">
                    <button class="bp-period-btn" data-months="3"  role="tab">3M</button>
                    <button class="bp-period-btn bp-period-btn--active" data-months="6"  role="tab">6M</button>
                    <button class="bp-period-btn" data-months="12" role="tab">1Y</button>
                    <button class="bp-period-btn" data-months="0" role="tab">ALL</button>
                  </div>
                </div>
                <div class="bp-chart-subtitle" id="bp-chart-subtitle"></div>
                <div class="bp-chart-wrap">
                  <canvas id="bp-chart" aria-label="Search interest chart" role="img"></canvas>
                </div>
                <div class="bp-chart-legend">
                  <span class="bp-legend-item bp-legend-brand">Brand index</span>
                  <span class="bp-legend-item bp-legend-avg">Global index avg</span>
                  <span class="bp-legend-item bp-legend-proj">Projected</span>
                </div>
                <p id="bp-methodology-note" style="margin:.75rem 0 0;font-size:.75rem;color:var(--clr-muted,#6b7a6b);line-height:1.5;display:none"></p>
              </div>
            </section>

            <!-- ── Key Moments ── -->
${explanationsSectionHtml}

            <!-- ── Rankings by Market ── -->
            <section class="bp-section" aria-labelledby="bp-countries-heading">
              <h2 class="bp-section-title" id="bp-countries-heading">Rankings by Market</h2>
              <p class="bp-section-sub">Brand interest is not uniform. Where ${escHtml(brand.name)} is searched hardest, and where it lags, varies market to market.</p>
              <div class="table-scroll-wrap">
                <table class="bp-country-table">
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Rank</th>
                      <th>DI</th>
                      <th>vs Last Month</th>
                      <th>Year-over-Year</th>
                      <th>Index Size</th>
                    </tr>
                  </thead>
                  <tbody id="bp-country-tbody">
${countryRows}
                  </tbody>
                </table>
              </div>
              <div class="bp-dominance" id="bp-dominance"></div>
            </section>

            <!-- ── Category Standing (populated by brand.js) ── -->
            <section class="bp-section" aria-labelledby="bp-cat-heading" hidden>
              <h2 class="bp-section-title" id="bp-cat-heading">Category Standing</h2>
              <div class="bp-cat-grid" id="bp-cat-grid"></div>
            </section>

${onTourHtml}
${faqHtml}

            <!-- ── Similar Brands ── -->
            <section class="bp-section" aria-labelledby="bp-similar-heading">
              <h2 class="bp-section-title bp-section-title--green" id="bp-similar-heading">Similar Brands</h2>
              <p class="bp-section-sub">Same category · closest search interest</p>
              <div class="bp-similar-grid" id="bp-similar-grid">${relatedHtml}
              </div>
            </section>

            <!-- ── Latest on Brand ── -->
            <section class="bp-section" id="bp-latest" aria-labelledby="bp-latest-heading"${articles.length === 0 ? ' hidden' : ''}>
              <h2 class="bp-section-title bp-section-title--green" id="bp-latest-heading">Latest on <span id="bp-latest-brand-name">${escHtml(brand.name)}</span></h2>
              <div id="bp-latest-list" class="latest-feed-list">
                ${articlesHtml}
              </div>
            </section>

          </article><!-- /bp-page-main -->

          <!-- Sidebar: LATEST widget, then Brands on the Move + Recently Updated Bags -->
          <aside class="sidebar-ad-col">
            <section class="home-stories-section latest-feed-section" aria-labelledby="bp-dormied-latest-heading">
              <h2 class="latest-feed-heading" id="bp-dormied-latest-heading">Latest</h2>
              <div id="dormied-latest-list" class="latest-feed-list">
                ${dormiedLatestHtml || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
              </div>
            </section>
            ${modsHtml || ''}
          </aside>

        </div><!-- /bp-page-grid -->
      </div><!-- /container -->

    </div><!-- /brand-content -->

  </main>

  <!-- ══ FOOTER ══════════════════════════════════════════════════════════════ -->
  <footer class="site-footer" role="contentinfo">
    <div class="container footer-inner">
      <div class="footer-brand">
        <a href="/" class="footer-logo" aria-label="DORMIED home">DORMIED</a>
        <div class="footer-social">
          <a href="https://x.com/DORMIED_GOLF" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on X">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <a href="https://www.instagram.com/dormiedgolf" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on Instagram">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
          </a>
          <a href="https://dormiedgolf.substack.com/" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on Substack">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z"/></svg>
          </a>
        </div>
      </div>
      <nav class="footer-nav" aria-label="Footer navigation">
        <a href="/rankings/">Index</a>
        <a href="/witb/">WITB</a>
        <a href="/scorecard/">Scorecard</a>
        <a href="/news/">News</a>
        <a href="/brands/">Brands</a>
        <a href="/about/">About</a>
        <a href="/contact/">Contact</a>
        <a href="/privacy/">Privacy</a>
        <a href="/terms/">Terms</a>
        <a href="/sitemap.xml">Sitemap</a>
      </nav>
      <div class="footer-signup">
        <div class="footer-signup-header"><p class="footer-signup-label">THE SCORECARD</p><p class="footer-signup-sub">Golf's brand desk in your inbox. The biggest moves of the month, what drove them, and what they mean. Once a month.</p></div>
        <form class="footer-signup-form" novalidate>
          <div class="footer-signup-row">
            <input class="footer-signup-input" type="email" placeholder="Your email" required autocomplete="email" aria-label="Email address">
            <button class="footer-signup-btn" type="submit">Get The Scorecard</button>
          </div>
          <p class="footer-signup-msg" style="display:none"></p>
        </form>
      </div>
      <p class="footer-legal">© <span id="footer-year"></span> DORMIED. Rankings are independent editorial content. No brand pays for placement or improved position on the DORMIED Index. All brand names and logos are property of their respective owners.</p>
    </div>
  </footer>

  <!-- ══ SCRIPTS ══════════════════════════════════════════════════════════════ -->
  <!-- Brand slug in its own block — isolated so no upstream error can block it -->
  <script>window.__BRAND_SLUG__='${escHtml(slug)}';</script>
  <script>document.getElementById('footer-year').textContent=new Date().getFullYear();</script>
  <script defer src="/js/utils.min.js?v=20260318"></script>
  <script defer src="/js/data.min.js?v=20260709"></script>
  <script defer src="/js/take-preview.min.js?v=20260330"></script>
  <script defer src="/js/explanations.min.js?v=20260318"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <script defer src="/js/brand.min.js?v=20260707"></script>
  <script defer src="/js/feed.min.js?v=20260706"></script>
  <script defer src="/js/analytics.min.js?v=20260320a"></script>
  <script defer src="/js/signup.min.js?v=20260324d"></script>
  <script src="/js/search.min.js?v=20260529"></script>

  <!-- Mobile nav hamburger -->
  <script>
  (function(){
    var btn=document.getElementById('nav-hamburger');
    var panel=document.getElementById('mobile-nav-panel');
    if(!btn||!panel)return;
    function openNav(){btn.setAttribute('aria-expanded','true');panel.classList.add('open');panel.removeAttribute('hidden');}
    function closeNav(){btn.setAttribute('aria-expanded','false');panel.classList.remove('open');panel.setAttribute('hidden','');}
    btn.addEventListener('click',function(){btn.getAttribute('aria-expanded')==='true'?closeNav():openNav();});
    panel.querySelectorAll('a').forEach(function(a){a.addEventListener('click',closeNav);});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closeNav();});
    document.addEventListener('click',function(e){if(!btn.contains(e.target)&&!panel.contains(e.target))closeNav();});
  })();
  </script>


</body>
</html>`;
}

// ── WITB On Tour data ─────────────────────────────────────────────────────────

async function witbPaginate(buildQuery, pageSize = 1000) {
  let from = 0;
  const rows = [];
  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchWitbTourData(supabase) {
  console.log('[brand-page] Fetching WITB tour data for On Tour sections...');

  const { data: players, error: pErr } = await supabase
    .from('witb_players')
    .select('id, name, slug, owgr_rank, current_bag_id')
    .not('owgr_rank', 'is', null)
    .order('owgr_rank', { ascending: true });
  if (pErr) {
    console.warn('[brand-page] fetchWitbTourData players error:', pErr.message);
    return { players: [], items: [], shaftItems: [] };
  }

  const rankedIds = new Set((players || []).map(p => p.id));

  // Items from CURRENT bags of ranked players, resolved via the witb_bags
  // is_current join — the SAME universe the WITB player pages use
  // (fetchTourComparison), so both page types share identical numbers.
  // (players.current_bag_id can disagree with witb_bags.is_current for a few
  // players; is_current is canonical.) Paginated to bypass the 1000-row cap.
  const itemsAll = await witbPaginate((from, to) =>
    supabase
      .from('witb_bag_items')
      .select('bag_id, club_type, raw_model, raw_brand, witb_brands!brand_id(name, dormied_brand_slug), witb_bags!bag_id(is_current, player_id)')
      .range(from, to)
  ).catch(e => { console.warn('[brand-page] fetchWitbTourData items error:', e.message); return []; });
  const items = itemsAll.filter(i => i.witb_bags?.is_current && rankedIds.has(i.witb_bags.player_id));

  const shaftAll = await witbPaginate((from, to) =>
    supabase
      .from('witb_bag_items')
      .select('bag_id, witb_shafts!shaft_id(dormied_brand_slug, model), witb_bags!bag_id(is_current, player_id)')
      .not('shaft_id', 'is', null)
      .range(from, to)
  ).catch(e => { console.warn('[brand-page] fetchWitbTourData shafts error:', e.message); return []; });
  const shaftItemsRaw = shaftAll.filter(i => i.witb_bags?.is_current && rankedIds.has(i.witb_bags.player_id));

  console.log(`[brand-page] On Tour: ${(players || []).length} ranked players, ${items.length} bag items, ${shaftItemsRaw.length} shaft items`);
  return { players: players || [], items, shaftItems: shaftItemsRaw };
}

function computeOnTourData({ players, items, shaftItems }, brandSlug, nameBySlug) {
  if (!brandSlug || !players.length) return [];

  const DISPLAY_CATS = [
    { name: 'Drivers',       types: ['driver'],                                              modelLabel: 'driver',      shaft: false },
    { name: 'Fairway Woods', types: ['3-wood','4-wood','5-wood','7-wood','9-wood','mini-driver'], modelLabel: 'fairway wood', shaft: false },
    { name: 'Hybrids',       types: ['hybrid','utility','utility-iron','driving-iron'],       modelLabel: 'hybrid',      shaft: false },
    { name: 'Irons',         types: ['iron'],                                                modelLabel: 'iron',        shaft: false },
    { name: 'Wedges',        types: ['wedge'],                                               modelLabel: 'wedge',       shaft: false },
    { name: 'Putters',       types: ['putter'],                                              modelLabel: 'putter',      shaft: false },
    { name: 'Balls',         types: ['ball'],                                                modelLabel: 'ball',        shaft: false },
    { name: 'Shafts',        types: null,                                                    modelLabel: 'shaft',       shaft: true  },
    { name: 'Grips',         types: ['grip'],                                                modelLabel: 'grip',        shaft: false },
  ];

  // Items are pre-filtered to is_current bags of ranked players; resolve the player
  // through the witb_bags join (canonical), not the current_bag_id pointer.
  const playerById  = new Map(players.map(p => [p.id, p]));
  const playerOf = (item) => playerById.get(item.witb_bags?.player_id);

  const results = [];

  for (const cat of DISPLAY_CATS) {
    if (cat.shaft) {
      const allShaftItems = shaftItems.filter(i => playerOf(i));
      const brandShaftItems = allShaftItems.filter(i => i.witb_shafts?.dormied_brand_slug === brandSlug);

      const brandPlayerSet = new Set();
      for (const item of brandShaftItems) {
        const p = playerOf(item);
        if (p) brandPlayerSet.add(p.id);
      }
      if (brandPlayerSet.size === 0) continue;

      const shaftBrandCounts = new Map();
      for (const item of allShaftItems) {
        const ds = item.witb_shafts?.dormied_brand_slug;
        if (!ds) continue;
        const p = playerOf(item);
        if (!p) continue;
        if (!shaftBrandCounts.has(ds)) shaftBrandCounts.set(ds, new Set());
        shaftBrandCounts.get(ds).add(p.id);
      }
      const sortedShaft = [...shaftBrandCounts.entries()].sort((a, b) => b[1].size - a[1].size);
      const rank = sortedShaft.findIndex(([ds]) => ds === brandSlug) + 1;
      if (rank === 0) continue;

      // For shafts, group by shaft model
      const shaftModelToPlayers = new Map();
      for (const item of brandShaftItems) {
        // witb_shafts.model includes brand prefix (e.g. "Fujikura Ventus Black 7 X").
        // Strip the leading brand name on the brand's own page so it reads "Ventus Black 7 X".
        const rawModel = item.witb_shafts?.model || item.raw_model || 'Unknown';
        const brandPrefix = typeof brandSlug === 'string'
          ? brandSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) // slug -> Title Case
          : '';
        const m = (brandPrefix && rawModel.toLowerCase().startsWith(brandPrefix.toLowerCase()))
          ? rawModel.slice(brandPrefix.length).trimStart()
          : rawModel;
        const p = playerOf(item); if (!p) continue;
        if (!shaftModelToPlayers.has(m)) shaftModelToPlayers.set(m, new Set());
        shaftModelToPlayers.get(m).add(p.id);
      }
      const shaftModelGroups = [...shaftModelToPlayers.entries()]
        .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
        .map(([model, playerIdSet]) => ({
          model,
          count: playerIdSet.size,
          players: [...playerIdSet]
            .map(id => playerById.get(id)).filter(Boolean)
            .sort((a, b) => (a.owgr_rank || 9999) - (b.owgr_rank || 9999)),
        }));

      results.push({
        cat: cat.name, rank, modelGroups: shaftModelGroups, topModel: null,
        playerCount: brandPlayerSet.size,
        totalRanked: players.length,
        leaderName:  (nameBySlug && nameBySlug.get(sortedShaft[0][0])) || sortedShaft[0][0],
        leaderCount: sortedShaft[0][1].size,
      });
      continue;
    }

    const catItems   = items.filter(i => cat.types.includes(i.club_type));
    const brandItems = catItems.filter(i => i.witb_brands?.dormied_brand_slug === brandSlug);

    const brandPlayerSet = new Set();
    for (const item of brandItems) {
      const p = playerOf(item);
      if (p) brandPlayerSet.add(p.id);
    }
    if (brandPlayerSet.size === 0) continue;

    const brandCounts = new Map();
    for (const item of catItems) {
      const ds = item.witb_brands?.dormied_brand_slug;
      if (!ds) continue;
      const p = playerOf(item);
      if (!p) continue;
      if (!brandCounts.has(ds)) brandCounts.set(ds, new Set());
      brandCounts.get(ds).add(p.id);
    }
    const sorted = [...brandCounts.entries()].sort((a, b) => b[1].size - a[1].size);
    const rank = sorted.findIndex(([ds]) => ds === brandSlug) + 1;
    if (rank === 0) continue;

    // Comparative-line counts use the SAME method as the WITB player pages
    // (fetchTourComparison in generate-witb-player-page.js): unique ranked
    // players counted by brand NAME with raw_brand fallback, so unmapped
    // items are included and both page types share identical numbers.
    const nameCounts = new Map();
    for (const item of catItems) {
      const bName = item.witb_brands?.name || item.raw_brand || 'Unknown';
      const p = playerOf(item);
      if (!p) continue;
      if (!nameCounts.has(bName)) nameCounts.set(bName, new Set());
      nameCounts.get(bName).add(p.id);
    }
    const brandDisplayName = brandItems[0]?.witb_brands?.name || null;
    const nameSorted   = [...nameCounts.entries()].sort((a, b) => b[1].size - a[1].size);
    const wCount       = brandDisplayName && nameCounts.has(brandDisplayName) ? nameCounts.get(brandDisplayName).size : brandPlayerSet.size;
    const wLeaderName  = nameSorted.length ? nameSorted[0][0] : null;
    const wLeaderCount = nameSorted.length ? nameSorted[0][1].size : 0;

    const globalModelCounts = new Map();
    for (const item of catItems) {
      const m = item.raw_model; if (!m) continue;
      globalModelCounts.set(m, (globalModelCounts.get(m) || 0) + 1);
    }
    const globalTop5 = [...globalModelCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m]) => m);

    // Group players by the model they use (a player may carry multiple; count each item)
    const modelToPlayers = new Map(); // model -> Set of player ids
    for (const item of brandItems) {
      const m = item.raw_model; if (!m) continue;
      const p = playerOf(item); if (!p) continue;
      if (!modelToPlayers.has(m)) modelToPlayers.set(m, new Set());
      modelToPlayers.get(m).add(p.id);
    }

    let topModel = null;
    if (modelToPlayers.size > 0) {
      const brandBest = [...modelToPlayers.entries()].sort((a, b) => b[1].size - a[1].size)[0][0];
      const globalRank = globalTop5.indexOf(brandBest);
      if (globalRank !== -1) topModel = { name: brandBest, globalRank: globalRank + 1, modelLabel: cat.modelLabel };
    }

    // Build model groups sorted by player count desc, then model name
    const modelGroups = [...modelToPlayers.entries()]
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .map(([model, playerIdSet]) => ({
        model,
        count: playerIdSet.size,
        players: [...playerIdSet]
          .map(id => playerById.get(id)).filter(Boolean)
          .sort((a, b) => (a.owgr_rank || 9999) - (b.owgr_rank || 9999)),
      }));

    results.push({
      cat: cat.name, rank, modelGroups, topModel,
      playerCount: wCount,
      totalRanked: players.length,
      leaderName:  wLeaderName,
      leaderCount: wLeaderCount,
    });
  }

  return results;
}

function getCatIcon(cat) {
  const iconMap = {
    'Drivers':       'driver',
    'Fairway Woods': 'fairway-wood',
    'Hybrids':       'hybrid',
    'Irons':         'iron',
    'Wedges':        'wedge',
    'Putters':       'putter',
    'Balls':         'ball',
    'Grips':         'grip',
    'Shafts':        'shaft',
  };
  const name = iconMap[cat];
  if (!name) return '';
  return `<img src="/images/icons/${name}.svg" alt="" aria-hidden="true" width="18" height="18" style="flex-shrink:0;filter:brightness(0)invert(1);vertical-align:middle">`;
}

function buildOnTourHtml(brandName, onTourData) {
  if (!onTourData || onTourData.length === 0) return '';

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  const catBlocks = onTourData.map(({ cat, rank, modelGroups, topModel, playerCount, totalRanked, leaderName, leaderCount }) => {
    const icon = getCatIcon(cat);
    let headerInner = `${icon}${escHtml(cat)} <span class="bp-tour-rank">· ${ordinal(rank)} on tour</span>`;
    if (topModel) {
      headerInner += `<span class="bp-tour-model"> · ${escHtml(topModel.name)} is the no. ${topModel.globalRank} ${escHtml(topModel.modelLabel)} model</span>`;
    }

    // Comparative line matching the WITB player page language and computation
    // ("{N} of {total} current bags. {Leader} leads ({M}).") so both page types
    // share identical numbers.
    const compareLine = (playerCount && totalRanked && leaderName)
      ? `<p class="bp-tour-compare">${playerCount} of ${totalRanked} current bags. ${escHtml(leaderName)} leads (${leaderCount}).</p>`
      : '';

    const modelRows = (modelGroups || []).map(({ model, count, players }) => {
      const playerLinks = '<div class="bp-tour-players">'
        + players.map(p =>
          `<a href="/witb/players/${escHtml(p.slug)}/" class="bp-tour-player-link">${escHtml(p.name)}</a>`
        ).join('')
        + '</div>';
      return `              <tr class="bp-tour-model-row">
                <td class="bp-tour-model-name">${escHtml(model)}</td>
                <td class="bp-tour-model-count">${count}</td>
                <td class="bp-tour-model-players">${playerLinks}</td>
              </tr>`;
    }).join('\n');

    return `            <div class="bp-tour-cat">
              <p class="bp-tour-cat-header">${headerInner}</p>
              ${compareLine}
              <table class="bp-tour-model-table">
                <tbody>
${modelRows}
                </tbody>
              </table>
            </div>`;
  }).join('\n');

  return `
            <!-- ── ${escHtml(brandName)} On Tour ── -->
            <section class="bp-section bp-on-tour-section" aria-labelledby="bp-on-tour-heading">
              <h2 class="bp-section-title bp-section-title--green" id="bp-on-tour-heading">${escHtml(brandName)} On Tour</h2>
              <p class="bp-section-sub">Who plays ${escHtml(brandName)} right now, pulled from the <a href="/witb/players/">DORMIED WITB</a> tour database.</p>
${catBlocks}
            </section>`;
}

// ── Process one brand ─────────────────────────────────────────────────────────

async function processOneBrand(dormiedData, supabase, brandSlug, force, witbTourData, factsBySlug, modsHtml = '') {
  const outPath = path.join(SITE_ROOT, 'brands', brandSlug, 'index.html');

  // Smart skip: file exists and not forced
  if (!force && fs.existsSync(outPath)) {
    return { slug: brandSlug, status: 'skipped' };
  }

  const stats = getBrandStats(dormiedData, brandSlug);
  if (!stats) {
    console.warn(`[brand-page] No data for: ${brandSlug}`);
    return { slug: brandSlug, status: 'no-data' };
  }

  const { brand, curSearches } = stats;

  // Fetch take, explanations, recent articles, and global latest feed in parallel
  const [take, explanations, articles, latestFeedArticles] = await Promise.all([
    fetchTake(supabase, brandSlug),
    fetchExplanations(supabase, brandSlug),
    fetchRecentArticles(supabase, brandSlug),
    feedBake.fetchLatestArticles(supabase, 10, null),
  ]);
  const dormiedLatestHtml = latestFeedArticles.length
    ? feedBake.renderLatestFeedHtml(latestFeedArticles, dormiedData)
    : null;

  const relatedBrands = getRelatedBrands(dormiedData, brandSlug, curSearches);

  const nameBySlug = new Map(dormiedData.brands.map(b => [b.id, b.name]));
  const onTourData = witbTourData ? computeOnTourData(witbTourData, brandSlug, nameBySlug) : [];
  const onTourHtml = buildOnTourHtml(brand.name, onTourData);

  const facts = (factsBySlug && factsBySlug.get(brandSlug)) || null;

  const html = generateBrandPageHtml({ brand, slug: brandSlug, stats, take, explanations, articles, relatedBrands, dormiedData, onTourHtml, onTourData, facts, dormiedLatestHtml, modsHtml });

  // Write file
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');

  return { slug: brandSlug, status: 'written' };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args    = process.argv.slice(2);
  const force   = args.includes('--force');
  const slugArg = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');

  const dormiedData = loadDormiedData();
  const supabase    = getSupabase();

  const today = new Date().toISOString().slice(0, 10);
  console.log(`[brand-page] Starting — ${today}`);
  if (force)   console.log('[brand-page] --force: regenerating all brands');
  if (slugArg) console.log(`[brand-page] --slug: single brand — ${slugArg}`);

  const allSlugs = dormiedData.brands.map(b => b.id);

  const targets = slugArg
    ? allSlugs.filter(s => s === slugArg)
    : allSlugs;

  if (slugArg && targets.length === 0) {
    console.error(`[brand-page] Slug not found in data.js: "${slugArg}"`);
    process.exit(1);
  }

  let written = 0, skipped = 0, errors = 0;

  // Fetch WITB tour data once for all brands (On Tour section)
  let witbTourData = null;
  try {
    witbTourData = await fetchWitbTourData(supabase);
  } catch (e) {
    console.warn('[brand-page] WITB tour data fetch failed (On Tour sections will be empty):', e.message);
  }

  // Brand facts for the FAQ section (fetched once for all brands; NULL fact = question skipped)
  let factsBySlug = new Map();
  try {
    const { data: factRows, error: factsErr } = await supabase.from('dormied_brand_facts').select('*');
    if (factsErr) console.warn('[brand-page] brand facts fetch failed (FAQ facts questions skipped):', factsErr.message);
    factsBySlug = new Map((factRows || []).map(r => [r.brand_slug, r]));
    console.log(`[brand-page] Brand facts loaded: ${factsBySlug.size}`);
  } catch (e) {
    console.warn('[brand-page] brand facts fetch failed:', e.message);
  }

  // Baked sidebar modules (Brands on the Move / Recently Updated Bags) — fetched
  // once for the whole run (brand-independent) and reused on every brand page.
  let modsHtml = '';
  try {
    modsHtml = await require('./feed-bake').fetchSidebarModulesHtml(supabase, dormiedData) || '';
  } catch (e) {
    console.warn('[brand-page] sidebar modules fetch failed:', e.message);
  }

  for (const slug of targets) {
    try {
      const result = await processOneBrand(dormiedData, supabase, slug, force, witbTourData, factsBySlug, modsHtml);
      if (result.status === 'written') {
        console.log(`[brand-page] ✓ brands/${slug}/index.html`);
        written++;
      } else if (result.status === 'skipped') {
        skipped++;
      } else {
        errors++;
      }
    } catch (err) {
      console.error(`[brand-page] ✗ ${slug}:`, err.message);
      errors++;
    }
  }

  console.log(`\n[brand-page] Done — ${written} written, ${skipped} skipped, ${errors} errors`);

  // Regenerate sitemap once after all brand pages are written (never per-brand,
  // which would trigger 175 filesystem scans).
  if (written > 0) {
    try {
      regenerateSitemap();
    } catch (e) {
      console.warn('[brand-page] Sitemap regeneration failed:', e.message);
    }
    try {
      generateSearchIndex();
    } catch (e) {
      console.warn('[brand-page] Search index regeneration failed:', e.message);
    }
  }
}

main()
  .then(() => {
    /* ── Pipeline trigger: regenerate /brands/ index page after brand pages update ── */
    const { execSync } = require('child_process');
    try {
      execSync('node scripts/generate-index-pages.js --brands', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
      });
    } catch (e) {
      console.warn('[brand-page] Warning: generate-index-pages.js --brands failed:', e.message);
    }
  })
  .catch(err => {
    console.error('[brand-page] Fatal:', err.message);
    process.exit(1);
  });
