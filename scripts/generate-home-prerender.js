#!/usr/bin/env node
/**
 * scripts/generate-home-prerender.js
 *
 * Pre-renders static HTML into index.html so Googlebot sees brand and player
 * links, and the LCP hero image is present in the initial document.
 *
 * Sections patched (using idempotent marker comments):
 *   hero-preload              — <link rel="preload"> in <head> for the LCP image
 *   dormied-latest            — hero article card with LCP image
 *   witb-leaders-top          — top 5 ranked players (links to /witb/players/{slug}/)
 *   witb-leaders-drivers      — top 5 driver brands (links to /brands/{slug}/)
 *   witb-leaders-putters      — top 5 putter brands (links to /brands/{slug}/)
 *   sb-top                    — top 5 brands by DI score (links to /brands/{id}/)
 *   sb-movers                 — biggest monthly gainers
 *   sb-drops                  — biggest monthly losers
 *
 * Usage:
 *   node scripts/generate-home-prerender.js
 *
 * Re-running is safe — replaces between the markers, does not duplicate.
 *
 * Hero article is fetched live from Supabase (requires SUPABASE_URL +
 * SUPABASE_SERVICE_KEY). If those env vars are absent the hero and preload
 * sections are left unchanged; the scoreboard/WITB sections still update.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const feedBake = require('./feed-bake');

const SITE_ROOT  = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(SITE_ROOT, 'index.html');
const DATA_JS    = path.join(SITE_ROOT, 'js', 'data-home.js');
const LEADERS_JS = path.join(SITE_ROOT, 'js', 'witb-leaders.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Vercel Image Optimization proxy URL — returns WebP/AVIF at width w. */
function vitUrl(src, w) {
  if (!src) return src;
  return '/_vercel/image?url=' + encodeURIComponent(src) + '&w=' + w + '&q=75';
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || '').slice(0, 2).toUpperCase();
}

function logoImg(brand, cls, size) {
  size = size || 20;
  const ini      = esc(initials(brand.name));
  const fallback = "this.style.display='none';this.nextElementSibling.style.display='flex'";
  if (brand.logo) {
    return `<img class="${cls}" src="${esc(vitUrl(brand.logo, size * 2))}" alt="" width="${size}" height="${size}" loading="lazy" onerror="${fallback}"><span class="brand-initials-fallback ${cls}-fallback" style="display:none">${ini}</span>`;
  }
  return `<span class="brand-initials-fallback ${cls}-fallback">${ini}</span>`;
}

function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '';
  const base = 0x1F1E6;
  const c1   = countryCode.charCodeAt(0) - 65;
  const c2   = countryCode.charCodeAt(1) - 65;
  if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) return '';
  return String.fromCodePoint(base + c1) + String.fromCodePoint(base + c2);
}

// ── Parse JS data files ────────────────────────────────────────────────────────

function loadDataHomeJs() {
  const src = fs.readFileSync(DATA_JS, 'utf8');
  const m   = src.match(/window\.DORMIED_DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) throw new Error('Could not extract JSON from data-home.js');
  return JSON.parse(m[1]);
}

function loadWitbLeadersJs() {
  const src = fs.readFileSync(LEADERS_JS, 'utf8');
  const m   = src.match(/window\.DORMIED_WITB_LEADERS\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) throw new Error('Could not extract JSON from witb-leaders.js');
  return JSON.parse(m[1]);
}

// ── Brand ranking (exact mirror of computeHomeRankings in home.js) ────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function shiftMonth(label, delta) {
  const parts = label.split(' ');
  const total = parseInt(parts[1], 10) * 12 + MONTH_NAMES.indexOf(parts[0]) + delta;
  return MONTH_NAMES[((total % 12) + 12) % 12] + ' ' + Math.floor(total / 12);
}

function computeHomeRankings(data) {
  const { meta, brands } = data;
  const cur  = meta.currentMonth;
  const prev = meta.previousMonth;
  const ago3 = shiftMonth(cur, -3);

  const all = brands.map(b => {
    const g     = (b.searchesByMarket && b.searchesByMarket.global) || {};
    const curV  = g[cur]  || 0;
    const preV  = g[prev] || 0;
    const ago3V = g[ago3] || 0;
    const pct   = preV > 0 ? (curV - preV) / preV * 100 : null;
    return { id: b.id, name: b.name, logo: b.logo || '', category: b.category || '',
             curV, preV, ago3V, pct };
  });

  let maxV = 0, maxPreV = 0, maxAgo3V = 0;
  all.forEach(b => {
    if (b.curV  > maxV)     maxV     = b.curV;
    if (b.preV  > maxPreV)  maxPreV  = b.preV;
    if (b.ago3V > maxAgo3V) maxAgo3V = b.ago3V;
  });
  all.forEach(b => {
    b.di     = maxV     > 0 ? b.curV  / maxV     * 100 : 0;
    b.prevDI = maxPreV  > 0 ? b.preV  / maxPreV  * 100 : 0;
    b.ago3DI = maxAgo3V > 0 ? b.ago3V / maxAgo3V * 100 : 0;
  });

  const prevSorted = all.slice().sort((a, b) => {
    const d = b.prevDI - a.prevDI;
    if (Math.abs(d) > 0.0001) return d;
    return b.ago3DI - a.ago3DI;
  });
  const prevRankMap = {};
  prevSorted.forEach((b, i) => { prevRankMap[b.id] = i + 1; });

  const ago3Sorted = all.slice().sort((a, b) => b.ago3DI - a.ago3DI);
  const ago3RankMap = {};
  ago3Sorted.forEach((b, i) => { ago3RankMap[b.id] = i + 1; });

  all.sort((a, b) => {
    const d = b.di - a.di;
    if (Math.abs(d) > 0.0001) return d;
    const pd = (prevRankMap[a.id] || 9999) - (prevRankMap[b.id] || 9999);
    if (pd !== 0) return pd;
    return (ago3RankMap[a.id] || 9999) - (ago3RankMap[b.id] || 9999);
  });
  all.forEach((b, i) => { b.rank = i + 1; });

  all.forEach(b => {
    const pr      = prevRankMap[b.id];
    b.rankChange  = (pr != null && b.preV > 0) ? pr - b.rank : null;
    b.di          = parseFloat(b.di.toFixed(1));
    b.pct         = b.pct !== null ? parseFloat(b.pct.toFixed(4)) : null;
  });

  return all.filter(b => b.curV > 0);
}

// ── HTML generators (match home.js output exactly) ────────────────────────────

function sbCard(brand, badgeHtml, badgeCls) {
  const rcHtml = brand.rankChange != null && brand.rankChange !== 0
    ? `<div class="sb-card-rc ${brand.rankChange > 0 ? 'sb-card-rc--up' : 'sb-card-rc--down'}">${brand.rankChange > 0 ? '▲' : '▼'}${Math.abs(brand.rankChange)}</div>`
    : (brand.rankChange === 0 ? `<div class="sb-card-rc sb-card-rc--flat">—</div>` : '');

  return `<a href="/brands/${esc(brand.id)}/" class="sb-card" data-brand-id="${esc(brand.id)}">`
       + `<div class="sb-card-rank ${badgeCls}">${badgeHtml}</div>`
       + logoImg(brand, 'sb-card-logo', 20)
       + `<div class="sb-card-info"><div class="sb-card-name">${esc(brand.name)}</div></div>`
       + rcHtml
       + `<div class="sb-card-di">${brand.di != null ? brand.di.toFixed(1) : '—'}</div>`
       + `</a>`;
}

function generateScoreboardSections(ranked) {
  const top5   = ranked.slice(0, 5);
  const movers = ranked.filter(b => b.pct !== null && b.pct > 0)
                       .sort((a, b) => b.pct - a.pct)
                       .slice(0, 5);
  const drops  = ranked.filter(b => b.pct !== null && b.pct < 0)
                       .sort((a, b) => a.pct - b.pct)
                       .slice(0, 5);

  return {
    'sb-top':    '<div class="sb-col-title">Top 5</div>'
               + top5.map(b => sbCard(b, '#' + b.rank, '')).join(''),

    'sb-movers': '<div class="sb-col-title">Biggest Movers</div>'
               + (movers.length
                   ? movers.map(b => sbCard(b, '+' + b.pct.toFixed(1) + '%', 'sb-card-rank--up')).join('')
                   : '<p class="sb-empty">No data</p>'),

    'sb-drops':  '<div class="sb-col-title">Biggest Drops</div>'
               + (drops.length
                   ? drops.map(b => sbCard(b, '−' + Math.abs(b.pct).toFixed(1) + '%', 'sb-card-rank--down')).join('')
                   : '<p class="sb-empty">No data</p>'),
  };
}

function generateWitbLeaderSections(leaders) {
  function modelCard(d) {
    const inner = `<span class="sb-card-name">${esc(d.brand + ' ' + d.model)}</span><span class="witb-ldr-count">${d.count}</span>`;
    return d.dormiedSlug
      ? `<a href="/brands/${esc(d.dormiedSlug)}/" class="sb-card" style="color:var(--text)">${inner}</a>`
      : `<div class="sb-card">${inner}</div>`;
  }

  const rows = (leaders.topPlayers || []).slice(0, 5).map(p => {
    const flag = flagEmoji(p.country_code);
    return `<a href="/witb/players/${esc(p.slug)}/" class="sb-card" style="color:var(--text)">`
         + (flag ? `<span class="witb-ldr-flag">${flag}</span>` : '')
         + `<span class="sb-card-name">${esc(p.name)}</span>`
         + `<span class="witb-ldr-rank">#${p.owgr_rank}</span>`
         + `</a>`;
  }).join('');

  return {
    'witb-leaders-top':     '<div class="sb-col-title">World Ranking</div>' + rows,
    'witb-leaders-drivers': '<div class="sb-col-title">Drivers</div>'
                          + (leaders.topDrivers || []).map(modelCard).join(''),
    'witb-leaders-putters': '<div class="sb-col-title">Putters</div>'
                          + (leaders.topPutters || []).map(modelCard).join(''),
  };
}

/** <link rel="preload"> hint for the hero article's LCP image. */
function generatePreloadLink(h) {
  if (!h || !h.imageUrl) return '';
  const srcset = [400, 800, 1200]
    .map(w => esc(vitUrl(h.imageUrl, w)) + ' ' + w + 'w')
    .join(', ');
  return '<link rel="preload" as="image" fetchpriority="high"\n'
       + '    imagesrcset="' + srcset + '"\n'
       + '    imagesizes="(min-width:1200px) 750px,(min-width:600px) 600px,100vw">';
}

// ── Idempotent marker injection ───────────────────────────────────────────────

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function injectBetweenMarkers(html, key, content) {
  const start = `<!-- PRERENDER-START:${key} -->`;
  const end   = `<!-- PRERENDER-END:${key} -->`;
  const re    = new RegExp(escapeRegExp(start) + '[\\s\\S]*?' + escapeRegExp(end));
  if (!re.test(html)) {
    // A section whose markers were removed when the homepage was restructured
    // (e.g. home-stories / featured now live in baked sidebars) is simply not
    // present to inject. Skip it with a warning rather than aborting the whole
    // prerender, so the sections that DO have markers still bake and the CI
    // step proceeds to refresh-modules.
    console.warn(`[prerender] Markers missing for key "${key}" — skipping (not on this page).`);
    return html;
  }
  // Function replacement so any '$' in content (e.g. "$2,000") is inserted
  // literally rather than treated as a regex backreference.
  return html.replace(re, () => start + content + end);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function run() {
  const data    = loadDataHomeJs();
  const leaders = loadWitbLeadersJs();
  const ranked  = computeHomeRankings(data);

  const sections = {
    ...generateScoreboardSections(ranked),
    ...generateWitbLeaderSections(leaders),
  };

  // LATEST FROM DORMIED: bake the full hero + 5 supporting cards so the painted
  // markup equals feed.js renderLatestFromDormied. This removes the 1->6 card
  // expansion on hydration that caused desktop CLS. Only updates when Supabase
  // env is present; otherwise the existing baked section is left unchanged.
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  let modsHtml = '';
  let topStoriesHtml = '';
  if (url && key) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(url, key);
      const articles = await feedBake.fetchLatestArticles(supabase, 12, null);
      if (articles.length) {
        sections['dormied-latest'] = feedBake.renderHomeLatestHtml(articles, data);
        sections['hero-preload']   = generatePreloadLink(articles[0]);
        console.log('[prerender] LATEST baked: ' + articles.length + ' cards, hero "' + articles[0].title.slice(0, 60) + '"');
      } else {
        console.warn('[prerender] No published articles — hero/preload sections unchanged');
      }
      // Top Stories (most-clicked, last 7 days): baked so crawlers see the links;
      // feed.js refreshes the same 5 on load. Matches renderHomeStories output.
      const topStories = await feedBake.fetchTopStoriesArticles(supabase, data, 5);
      if (topStories && topStories.length) {
        topStoriesHtml = feedBake.renderLatestFeedHtml(topStories, data);
        console.log('[prerender] TOP STORIES baked: ' + topStories.length + ' cards');
      }
      // Sidebar modules (Brands on the Move / Recently Updated Bags), baked below Top Stories.
      modsHtml = await feedBake.fetchSidebarModulesHtml(supabase, data) || '';
    } catch (e) {
      console.warn('[prerender] LATEST bake failed:', e.message, '— hero/preload sections unchanged');
    }
  } else {
    console.warn('[prerender] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — hero/preload sections unchanged');
  }

  if (topStoriesHtml) sections['home-stories'] = topStoriesHtml;

  let html = fs.readFileSync(INDEX_HTML, 'utf8');
  for (const [key, content] of Object.entries(sections)) {
    html = injectBetweenMarkers(html, key, content);
  }
  // Position sidebar modules at the slot marker, keeping the marker so re-bakes
  // stay idempotent (strip any stale block first).
  html = html.replace(/\s*<!-- sidebar-mods:start -->[\s\S]*?<!-- sidebar-mods:end -->/g, '');
  if (modsHtml) html = html.replace('<!-- SIDEBAR_MODS_SLOT -->', `<!-- SIDEBAR_MODS_SLOT -->\n        ${modsHtml}`);
  fs.writeFileSync(INDEX_HTML, html, 'utf8');

  const playerCount = (leaders.topPlayers || []).slice(0, 5).length;
  console.log(
    '[prerender] ✓ index.html patched — '
    + ranked.length + ' brands ranked, top ' + playerCount + ' players, '
    + (leaders.topDrivers || []).length + ' drivers, '
    + (leaders.topPutters || []).length + ' putters'
  );
}

if (require.main === module) {
  run().catch(err => {
    console.error('[prerender] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { run, generatePreloadLink };
