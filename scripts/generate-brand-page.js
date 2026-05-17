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
    .replace(/\s*—\s*/g, '. ')
    .replace(/—/g, ', ')
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

function generateBrandPageHtml({ brand, slug, stats, take, explanations, articles, relatedBrands, dormiedData }) {
  const { rank, di, momPct, t3m, t12m } = stats;

  const pageTitle    = `${escHtml(brand.name)} | DORMIED Brand Profile`;
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

  // Take
  const hasTake       = !!(take && take.take);
  const takeMonthLabel = hasTake ? fmtMonth(take.month) : '';

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
        ...(brand.description && { description: brand.description }),
      },
    ],
  });

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
        <div class="container">
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
        </div>
      </section>`
    : `
      <section class="bp-take-section" id="bp-take-section" hidden>
        <div class="container">
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
        </div>
      </section>`;

  // Key Moments — pre-render timeline from Supabase explanation rows
  function expToBullets(text) {
    if (!text) return '';
    let items;
    if (text.indexOf('•') !== -1) {
      items = text.split('•').map(s => s.trim()).filter(Boolean);
    } else {
      const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
      items = sentences.map(s => s.trim()).filter(s => s.length > 15);
    }
    if (!items.length) return `<p>${escHtml(text)}</p>`;
    return '<ul class="exp-bullets">' + items.map(s => `<li>${escHtml(s)}</li>`).join('') + '</ul>';
  }

  const sortedExplanations = (explanations || []).slice().sort((a, b) => a.month < b.month ? 1 : -1); // DESC — newest first
  const explanationsSectionHtml = sortedExplanations.length > 0
    ? `
      <section class="bp-explanation-section" id="bp-explanation-section" aria-labelledby="bp-explanation-heading">
        <div class="container">
          <h2 class="bp-section-title" id="bp-explanation-heading">Key Moments</h2>
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
        </div>
      </section>`
    : `
      <section class="bp-explanation-section" id="bp-explanation-section" aria-labelledby="bp-explanation-heading" hidden>
        <div class="container">
          <h2 class="bp-section-title" id="bp-explanation-heading">Key Moments</h2>
          <div id="bp-explanation-body" class="bp-explanation-body"></div>
        </div>
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
  <link rel="preconnect" href="https://pagead2.googlesyndication.com">

  <!-- ── Fonts ── -->
  <link rel="stylesheet" href="/css/fonts.css">

  <!-- ── Styles ── -->
  <link rel="stylesheet" href="/css/styles.css?v=20260508">

  <!-- ── JSON-LD ── -->
  <script type="application/ld+json" id="brand-jsonld">${jsonld}</script>
</head>

<body class="brand-page">

  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->

  <!-- ══ TOP AD ZONE ══════════════════════════════════════════════════════════ -->
  <div class="ad-top-zone" aria-hidden="true">
    <div class="ad-billboard desktop-ad">
      <ins class="adsbygoogle"
     style="display:inline-block;width:970px;height:250px"
     data-ad-client="ca-pub-5259693727609263"
     data-ad-slot="7637269940"></ins>
    </div>
    <div class="ad-leaderboard tablet-ad">
      <ins class="adsbygoogle"
     style="display:inline-block;width:728px;height:90px"
     data-ad-client="ca-pub-5259693727609263"
     data-ad-slot="7127101656"></ins>
    </div>
    <div class="ad-mobile-banner mobile-ad">
      <ins class="adsbygoogle"
     style="display:inline-block;width:320px;height:50px"
     data-ad-client="ca-pub-5259693727609263"
     data-ad-slot="7841984771"></ins>
    </div>
  </div>

  <!-- ══ SITE HEADER ══════════════════════════════════════════════════════════ -->
  <header class="site-header" role="banner">
    <div class="container header-inner">
      <a href="/" class="site-logo" aria-label="DORMIED home">
        <img src="/images/dormied-logo-colour.png" alt="DORMIED — Golf's Brand Desk" class="logo-img"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="logo-text-fallback" style="display:none">DORMIED</span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a href="/rankings/"  class="site-nav-link">Index</a>
        <a href="/scorecard/" class="site-nav-link">Scorecard</a>
        <a href="/news/"      class="site-nav-link">News</a>
        <a href="/brands/"    class="site-nav-link site-nav-link--active">Brands</a>
      </nav>
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
              <span class="bp-metric-val">${escHtml(momStr)}</span>
            </div>
            <div class="bp-metric-card">
              <span class="bp-metric-label">3M Trend</span>
              <span class="bp-metric-val">${escHtml(t3mStr)}</span>
            </div>
            <div class="bp-metric-card">
              <span class="bp-metric-label">12M Trend</span>
              <span class="bp-metric-val">${escHtml(t12mStr)}</span>
            </div>
          </div>
        </div>
      </section>
${takeSectionHtml}

      <!-- ── Main Chart Section ── -->
      <section class="bp-chart-section">
        <div class="container bp-chart-container">
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
        </div>
      </section>

      <!-- ── Mid-page Ad (after chart) ── -->
      <div class="ad-top-zone bp-mid-ad" aria-hidden="true">
        <div class="ad-leaderboard tablet-ad">
          <ins class="adsbygoogle"
     style="display:inline-block;width:728px;height:90px"
     data-ad-client="ca-pub-5259693727609263"
     data-ad-slot="3187856648"></ins>
        </div>
        <div class="ad-in-table mobile-ad">
          <ins class="adsbygoogle"
     style="display:inline-block;width:300px;height:250px"
     data-ad-client="ca-pub-5259693727609263"
     data-ad-slot="5011106608"></ins>
        </div>
      </div>

      <!-- ── Key Moments (pre-rendered; brand.js can update on period tab change) ── -->
      ${explanationsSectionHtml}

      <!-- ── Two-column layout: content + sidebar ad ── -->
      <div class="container">
        <div class="table-layout">
          <div class="bp-sections-col">

            <!-- ── Rankings by Market (server-rendered; brand.js overwrites on load) ── -->
            <section class="bp-section" aria-labelledby="bp-countries-heading">
              <h2 class="bp-section-title" id="bp-countries-heading">Rankings by Market</h2>
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

            <!-- ── Mid-page Ad (after Rankings by Market) ── -->
            <div class="ad-top-zone bp-mid-ad" aria-hidden="true">
              <div class="ad-leaderboard tablet-ad">
                <ins class="adsbygoogle"
     style="display:inline-block;width:728px;height:90px"
     data-ad-client="ca-pub-5259693727609263"
     data-ad-slot="3187856648"></ins>
              </div>
              <div class="ad-in-table mobile-ad">
                <ins class="adsbygoogle"
     style="display:inline-block;width:300px;height:250px"
     data-ad-client="ca-pub-5259693727609263"
     data-ad-slot="5011106608"></ins>
              </div>
            </div>

            <!-- ── Category Standing (populated by brand.js) ── -->
            <section class="bp-section" aria-labelledby="bp-cat-heading" hidden>
              <h2 class="bp-section-title" id="bp-cat-heading">Category Standing</h2>
              <div class="bp-cat-grid" id="bp-cat-grid"></div>
            </section>

            <!-- ── Similar Brands ── -->
            <section class="bp-section" aria-labelledby="bp-similar-heading">
              <h2 class="bp-section-title" id="bp-similar-heading">Similar Brands</h2>
              <p class="bp-section-sub">Same category · closest search interest</p>
              <div class="bp-similar-grid" id="bp-similar-grid">${relatedHtml}
              </div>
            </section>

            <!-- ── Latest on Brand ── -->
            <section class="bp-section" id="bp-latest" aria-labelledby="bp-latest-heading"${articles.length === 0 ? ' hidden' : ''}>
              <h2 class="bp-section-title" id="bp-latest-heading">Latest on <span id="bp-latest-brand-name">${escHtml(brand.name)}</span></h2>
              <div id="bp-latest-list" class="latest-feed-list">
                ${articlesHtml}
              </div>
            </section>

          </div><!-- /bp-sections-col -->

          <!-- ── Sidebar: Skyscraper Ad ── -->
          <aside class="sidebar-ad-col">
            <div class="sidebar-sticky-zone" aria-hidden="true">
              <div class="ad-skyscraper">
                <ins class="adsbygoogle"
     style="display:inline-block;width:160px;height:600px"
     data-ad-client="ca-pub-5259693727609263"
     data-ad-slot="6935529969"></ins>
              </div>
            </div>
          </aside>

        </div><!-- /table-layout -->
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
  <script defer src="/js/data.min.js?v=20260507a"></script>
  <script defer src="/js/take-preview.min.js?v=20260330"></script>
  <script defer src="/js/explanations.min.js?v=20260318"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <script defer src="/js/brand.min.js?v=20260514a"></script>
  <script defer src="/js/feed.min.js?v=20260517c"></script>
  <script defer src="/js/analytics.min.js?v=20260320a"></script>
  <script defer src="/js/signup.min.js?v=20260324d"></script>
  <script src="/js/search.min.js?v=20260508"></script>

  <script>
    window.addEventListener('load',function(){
  var s=document.createElement('script');
  s.async=true;s.crossOrigin='anonymous';
  s.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5259693727609263';
  document.head.appendChild(s);
  s.onload=function(){
    var ads=document.querySelectorAll('.adsbygoogle');
    for(var i=0;i<ads.length;i++){(adsbygoogle=window.adsbygoogle||[]).push({});}
  };
});
  </script>

</body>
</html>`;
}

// ── Process one brand ─────────────────────────────────────────────────────────

async function processOneBrand(dormiedData, supabase, brandSlug, force) {
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

  // Fetch take, explanations, and recent articles in parallel
  const [take, explanations, articles] = await Promise.all([
    fetchTake(supabase, brandSlug),
    fetchExplanations(supabase, brandSlug),
    fetchRecentArticles(supabase, brandSlug),
  ]);

  const relatedBrands = getRelatedBrands(dormiedData, brandSlug, curSearches);

  const html = generateBrandPageHtml({ brand, slug: brandSlug, stats, take, explanations, articles, relatedBrands, dormiedData });

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

  for (const slug of targets) {
    try {
      const result = await processOneBrand(dormiedData, supabase, slug, force);
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
