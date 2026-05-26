#!/usr/bin/env node
/**
 * scripts/generate-witb-player-page.js
 *
 * Generates /witb/players/[slug]/index.html for WITB player pages.
 * Generator is the source of truth -- never hand-edit the built HTML.
 *
 * Usage:
 *   node scripts/generate-witb-player-page.js              # defaults to jon-rahm
 *   node scripts/generate-witb-player-page.js jon-rahm
 *
 * Lede + history narrative: generated once via Opus 4.7, cached in
 * scripts/cache/witb-player-ledes.json keyed by slug:bag_date.
 * Regenerates only when the player's current bag date changes.
 *
 * Requires .env with SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const fs              = require('fs');
const path            = require('path');
const { createClient } = require('@supabase/supabase-js');
const Anthropic        = require('@anthropic-ai/sdk');

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT       = path.resolve(__dirname, '..');
const CACHE_FILE = path.join(__dirname, 'cache', 'witb-player-ledes.json');
const TOTAL_TOUR_PLAYERS = 160;

const PLAYER_SLUG = process.argv[2] || 'jon-rahm';

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function log(msg)  { console.log(`[generate-player] ${msg}`); }
function warn(msg) { console.warn(`[generate-player] WARN: ${msg}`); }

/** Format date string (YYYY-MM-DD) as "Month YYYY" */
function fmtDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** Format OWGR updated_at timestamp to "Mon DD, YYYY" */
function fmtOwgrDate(isoTs) {
  if (!isoTs) return null;
  const d = new Date(isoTs);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Render brand logo + link component (exact-match-or-null: no fuzzy) */
function brandCell(rawBrand, dormiedSlug) {
  const name = esc(rawBrand || '');
  if (!dormiedSlug) {
    // No DORMIED mapping -- monogram fallback, plain text
    const mono = (rawBrand || '??').slice(0, 2).toUpperCase();
    return `<span class="witb-brand-monogram">${mono}</span>${name}`;
  }
  const logo = `/images/logos/${dormiedSlug}.jpg`;
  const mono  = (rawBrand || '??').slice(0, 2).toUpperCase();
  return `<img src="${logo}" alt="" class="witb-brand-logo" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"><span class="witb-brand-monogram" style="display:none">${mono}</span><a href="/brands/${dormiedSlug}/">${name}</a>`;
}

/** Category icon img tag */
function catIcon(clubType) {
  const icons = {
    'driver':    '/images/icons/driver_22px.svg',
    '3-wood':    '/images/icons/fairway_wood_22px.svg',
    '4-wood':    '/images/icons/fairway_wood_22px.svg',
    '5-wood':    '/images/icons/fairway_wood_22px.svg',
    '7-wood':    '/images/icons/fairway_wood_22px.svg',
    'mini-driver':'/images/icons/fairway_wood_22px.svg',
    'hybrid':    '/images/icons/hybrid_22px.svg',
    'iron':      '/images/icons/golf_iron_icon_22px.svg',
    'wedge':     '/images/icons/wedge_22px.svg',
    'putter':    '/images/icons/putter_22px.svg',
    'ball':      '/images/icons/ball.svg',
    'grip':      '/images/icons/grip.svg',
  };
  const src = icons[clubType] || '/images/icons/golf_iron_icon_22px.svg';
  return `<span class="witb-cat-icon" aria-hidden="true"><img src="${src}" width="16" height="16" alt=""></span>`;
}

/** Human-readable club type label */
function clubLabel(ct) {
  const labels = {
    'driver':     'Driver',
    '3-wood':     '3-Wood',
    '4-wood':     '4-Wood',
    '5-wood':     '5-Wood',
    '7-wood':     '7-Wood',
    'mini-driver':'Mini-Driver',
    'hybrid':     'Hybrid',
    'iron':       'Iron',
    'wedge':      'Wedge',
    'putter':     'Putter',
    'ball':       'Ball',
    'grip':       'Grip',
  };
  return labels[ct] || ct.charAt(0).toUpperCase() + ct.slice(1);
}

/** Count words in a prose string (rough) */
function wordCount(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

// ── Lede cache ────────────────────────────────────────────────────────────────

function loadLedeCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveLedeCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

// ── Opus 4.7 call ─────────────────────────────────────────────────────────────

async function generateLede(anthropic, player, bags, currentBag, currentItems) {
  log('Generating lede + history narrative via Opus 4.7...');

  // Build a concise equipment summary for the prompt
  const keyItems = currentItems
    .filter(i => ['driver', 'iron', 'putter', 'ball'].includes(i.club_type))
    .map(i => {
      const loft = i.loft_or_number ? ` (${i.loft_or_number})` : '';
      return `${clubLabel(i.club_type)}: ${i.raw_brand} ${i.raw_model}${loft}`;
    })
    .join('\n');

  // Build historical bag summary (newest first, skip current)
  const histBags = bags
    .filter(b => !b.is_current)
    .sort((a, b) => b.bag_date.localeCompare(a.bag_date));

  const histSummary = histBags.map(b => {
    const headlines = (b._items || [])
      .filter(i => ['driver', 'iron', 'putter', 'ball'].includes(i.club_type))
      .map(i => `${clubLabel(i.club_type)}: ${i.raw_brand} ${i.raw_model}`);
    return `${b.bag_date}: ${headlines.join(', ')}`;
  }).join('\n');

  const prompt = `You are Travis, DORMIED's equipment desk. Generate two pieces of copy for the Jon Rahm WITB player page.

DORMIED voice rules (non-negotiable):
- Dry, direct, insider. No em dashes anywhere. No exclamation points. No marketing language.
- No first-person. Observational third-person throughout.
- Do not assert precise switch dates the data does not support.
- Do not use hedging phrases like "it seems" or "appears to".

Player: Jon Rahm
OWGR rank: #${player.owgr_rank}

CURRENT BAG (${currentBag.bag_date}):
${keyItems}

HISTORICAL BAGS (newest first, data-verified):
${histSummary}

DATA CONSTRAINT: The snapshot record goes from June 2020 (TaylorMade) directly to March 2021 (Callaway). Do not claim a specific switch date -- say only what the data shows (e.g. "by early 2021 his bag was full Callaway").

TASK 1 -- LEDE (60-100 words):
Write an opening paragraph for the player page. Must narrate from the real data: the TaylorMade-to-Callaway equipment arc, and something specific about the current bag. Start with a data observation or distinctive detail, not the player's name. No recap of his resume. The reader knows who Rahm is.

TASK 2 -- HISTORY NARRATIVE (2-4 sentences):
A concise prose summary of the equipment arc across the 10 bag snapshots. Capture the TaylorMade era (2019-2020), the Callaway transition, and the current state. Accuracy to snapshots only -- no invented details between data points.

Return valid JSON only:
{
  "lede": "...",
  "history_narrative": "..."
}`;

  const res = await anthropic.messages.create({
    model:      'claude-opus-4-7',
    max_tokens: 1000,
    thinking:   { type: 'adaptive' },
    messages:   [{ role: 'user', content: prompt }],
  });

  const u = res.usage || {};
  const cost = ((u.input_tokens ?? 0) / 1e6 * 5) + ((u.output_tokens ?? 0) / 1e6 * 25);
  log(`Opus tokens: input=${u.input_tokens}, output=${u.output_tokens}, cost=$${cost.toFixed(4)}`);

  // Extract text from response (thinking blocks are opaque; get last text block)
  const textBlocks = (res.content || []).filter(b => b.type === 'text' && b.text?.trim());
  const raw = (textBlocks[textBlocks.length - 1]?.text || '').trim();

  // Parse JSON
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    warn('Failed to parse Opus JSON response. Raw:\n' + raw.slice(0, 500));
    // Fallback: return raw as lede
    return { lede: raw.slice(0, 400), history_narrative: '' };
  }
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchPlayerData(sb, slug) {
  const { data: player, error } = await sb
    .from('witb_players')
    .select('id, name, slug, owgr_rank, owgr_rank_updated_at, data_golf_rank')
    .eq('slug', slug)
    .single();
  if (error) throw new Error(`Player not found (slug="${slug}"): ${error.message}`);
  return player;
}

async function fetchBagsWithItems(sb, playerId) {
  const { data: bags, error } = await sb
    .from('witb_bags')
    .select('id, bag_date, is_current, source_url, source_credit')
    .eq('player_id', playerId)
    .order('bag_date', { ascending: false });
  if (error) throw new Error(`Bags fetch failed: ${error.message}`);

  // Fetch items for each bag
  for (const bag of bags) {
    const { data: items } = await sb
      .from('witb_bag_items')
      .select(`
        club_type, raw_brand, raw_model, raw_shaft, loft_or_number, position,
        witb_brands!brand_id(slug, name, dormied_brand_slug),
        witb_shafts!shaft_id(slug, brand_name, model)
      `)
      .eq('bag_id', bag.id)
      .order('position');
    bag._items = items || [];
  }

  return bags;
}

async function fetchTourComparison(sb, brandNames) {
  // For key club categories, count how many current-bag players use each brand.
  // Returns per-category brand counts: { driver: [{brand, count},...], ... }

  const catGroups = {
    driver:  ['driver'],
    irons:   ['iron'],
    putter:  ['putter'],
    ball:    ['ball'],
  };

  const result = {};

  for (const [cat, types] of Object.entries(catGroups)) {
    const { data: items } = await sb
      .from('witb_bag_items')
      .select('raw_brand, witb_brands!brand_id(name, dormied_brand_slug), witb_bags!bag_id(is_current, player_id)')
      .in('club_type', types);

    const currentItems = (items || []).filter(i => i.witb_bags?.is_current);

    // Count unique players per brand (for irons/putter/ball)
    // For driver, count items (since there's only one driver per player)
    const brandMap = {};
    currentItems.forEach(i => {
      const name  = i.witb_brands?.name || i.raw_brand || 'Unknown';
      const dslug = i.witb_brands?.dormied_brand_slug || null;
      const pid   = i.witb_bags.player_id;
      if (!brandMap[name]) brandMap[name] = { name, dormied_slug: dslug, players: new Set() };
      brandMap[name].players.add(pid);
    });

    result[cat] = Object.values(brandMap)
      .map(({ name, dormied_slug, players }) => ({ name, dormied_slug, count: players.size }))
      .sort((a, b) => b.count - a.count);
  }

  return result;
}

async function fetchDiData(sb, slugs) {
  const { data } = await sb
    .from('dormied_monthly_brand_summary')
    .select('brand_slug, global_rank, di_score')
    .in('brand_slug', slugs)
    .eq('snapshot_month', '2026-04-01');
  return new Map((data || []).map(d => [d.brand_slug, d]));
}

// ── Tour comparison prose ─────────────────────────────────────────────────────

function buildComparisonRows(tourComp, playerBrandsByCategory) {
  const rows = [];

  const catConfig = [
    { cat: 'driver', label: 'Driver', icon: 'driver' },
    { cat: 'irons',  label: 'Irons',  icon: 'iron' },
    { cat: 'putter', label: 'Putter', icon: 'putter' },
    { cat: 'ball',   label: 'Ball',   icon: 'ball' },
  ];

  for (const { cat, label, icon } of catConfig) {
    const all = tourComp[cat] || [];
    const total = all.reduce((s, b) => s + b.count, 0);
    const playerBrand = playerBrandsByCategory[cat];
    if (!playerBrand) continue;

    const playerEntry = all.find(b => b.name === playerBrand.name);
    const playerCount = playerEntry?.count || 0;
    const rank1 = all[0];

    // Build prose
    let context = '';
    if (rank1 && rank1.name !== playerBrand.name) {
      context = ` (${esc(rank1.name)} leads with ${rank1.count})`;
    } else if (rank1 && rank1.name === playerBrand.name) {
      context = ` -- tour's most-used ${label.toLowerCase()} brand`;
    }

    rows.push({
      cat,
      label,
      icon,
      playerBrand: playerBrand.name,
      playerDormiedSlug: playerBrand.dormied_slug,
      playerModel: playerBrand.model,
      playerCount,
      total,
      context,
      rank1Name: rank1?.name,
      rank1Count: rank1?.count,
    });
  }

  return rows;
}

// ── HTML page builder ─────────────────────────────────────────────────────────

function buildPage({ player, bags, currentBag, currentItems, tourComp, diMap, ledes, today }) {
  const { name, slug, owgr_rank, owgr_rank_updated_at, data_golf_rank } = player;
  const owgrDate    = fmtOwgrDate(owgr_rank_updated_at);
  const currentDate = fmtDate(currentBag.bag_date);

  const owgrLine = owgr_rank
    ? `OWGR #${owgr_rank}${owgrDate ? ` &middot; updated ${owgrDate}` : ''}${data_golf_rank ? ` &middot; DG #${data_golf_rank}` : ''}`
    : `OWGR: Unranked${data_golf_rank ? ` &middot; DG #${data_golf_rank}` : ''}`;

  // Player's brand per category (for comparison)
  const playerBrandsByCategory = {};
  for (const item of currentItems) {
    if (['driver', 'iron', 'putter', 'ball'].includes(item.club_type)) {
      if (!playerBrandsByCategory[item.club_type === 'iron' ? 'irons' : item.club_type]) {
        playerBrandsByCategory[item.club_type === 'iron' ? 'irons' : item.club_type] = {
          name:         item.witb_brands?.name || item.raw_brand,
          dormied_slug: item.witb_brands?.dormied_brand_slug || null,
          model:        item.raw_model,
        };
      }
    }
  }

  const compRows = buildComparisonRows(tourComp, playerBrandsByCategory);

  // SEO
  const pageTitle       = `${esc(name)} WITB: What's In The Bag 2026 | DORMIED`;
  const metaDesc        = `${esc(name)} WITB 2026: Callaway Elyte driver, Odyssey putter, and a full Callaway bag from driver to ball. Equipment breakdown and gear history across 10 snapshots.`;
  const canonicalUrl    = `https://dormied.com/witb/players/${slug}/`;
  const dateModified    = today;

  // ── Current bag table ────────────────────────────────────────────────────────

  // Group iron entries: condense iron rows
  const tableRows = currentItems.map(item => {
    const dslug = item.witb_brands?.dormied_brand_slug || null;
    const loft  = item.loft_or_number || '';
    // Shaft display: prefer linked shaft, then raw_shaft, then '-'
    let shaftDisplay = item.witb_shafts?.model || item.raw_shaft || '-';
    if (shaftDisplay.length > 40) shaftDisplay = shaftDisplay.slice(0, 40) + '...';

    return `
    <tr>
      <td class="witb-player-bag-type">${catIcon(item.club_type)}${esc(clubLabel(item.club_type))}</td>
      <td class="witb-player-bag-brand">${brandCell(item.witb_brands?.name || item.raw_brand, dslug)}</td>
      <td class="witb-player-bag-model">${esc(item.raw_model || '')}</td>
      <td class="witb-player-bag-loft">${esc(loft)}</td>
      <td class="witb-player-bag-shaft">${esc(shaftDisplay)}</td>
    </tr>`;
  }).join('');

  // ── Tour comparison section ───────────────────────────────────────────────────

  const compHtml = compRows.map(row => {
    const pct     = row.total > 0 ? Math.round(row.playerCount / TOTAL_TOUR_PLAYERS * 100) : 0;
    const barPct  = row.rank1Count ? Math.round(row.playerCount / row.rank1Count * 100) : 0;
    const isLeader = row.rank1Name === row.playerBrand;

    let ctxNote = '';
    if (isLeader) {
      ctxNote = `<span class="witb-comp-leader">Tour leader</span>`;
    } else if (row.rank1Name) {
      ctxNote = `<span class="witb-comp-note">${esc(row.rank1Name)} leads (${row.rank1Count})</span>`;
    }

    return `
    <div class="witb-comp-row">
      <div class="witb-comp-cat">${catIcon(row.cat)}${esc(row.label)}</div>
      <div class="witb-comp-brand">${brandCell(row.playerBrand, row.playerDormiedSlug)}</div>
      <div class="witb-comp-stat">
        <span class="witb-comp-count">${row.playerCount} of ${TOTAL_TOUR_PLAYERS}</span>
        <div class="witb-lb-bar-bg" style="margin-top:4px"><div class="witb-lb-bar-fill" style="width:${barPct}%"></div></div>
      </div>
      <div class="witb-comp-context">${ctxNote}</div>
    </div>`;
  }).join('');

  // ── DI attention angle section ────────────────────────────────────────────────

  const callawayDi  = diMap.get('callaway');
  const odysseyDi   = diMap.get('odyssey-golf');
  let diAngle = '';
  if (callawayDi && odysseyDi) {
    diAngle = `Callaway ranks ${ordinal(callawayDi.global_rank)} globally on the DORMIED Index (DI score ${callawayDi.di_score}/100) -- significant amateur awareness for a brand that also commands top-3 tour driver usage. Odyssey, the tour's most-used putter brand by a wide margin, sits at DI rank ${ordinal(odysseyDi.global_rank)} (score ${odysseyDi.di_score}/100). Tour ubiquity and consumer attention are not the same thing; Odyssey's putting dominance has almost no echo in public search behavior, which is the exact gap the DORMIED Index was built to surface.`;
  } else if (callawayDi) {
    diAngle = `Callaway ranks ${ordinal(callawayDi.global_rank)} globally on the DORMIED Index (DI score ${callawayDi.di_score}/100), with genuine consumer awareness to match its tour presence.`;
  }

  function ordinal(n) {
    if (!n) return '?th';
    const s = ['th','st','nd','rd'];
    const v = n % 100;
    return n + (s[(v-20)%10] || s[v] || s[0]);
  }

  // Word count for robots decision (computed after diAngle is available)
  const bagItemWords  = currentItems.reduce((s, i) => s + wordCount(`${i.raw_brand} ${i.raw_model} ${i.raw_shaft || ''} ${i.loft_or_number || ''}`), 0);
  const histItemWords = bags.reduce((s, b) => s + b._items.reduce((s2, i) => s2 + wordCount(`${i.raw_brand} ${i.raw_model}`), 0), 0);
  const compWords     = compRows.reduce((s, r) => s + wordCount(`${r.label} ${r.playerBrand} ${r.playerCount} of ${TOTAL_TOUR_PLAYERS} ${r.rank1Name || ''}`), 0);
  const proseWords    = wordCount(ledes.lede)
                      + wordCount(ledes.history_narrative)
                      + wordCount(diAngle)
                      + compWords
                      + bagItemWords
                      + histItemWords;
  const hasCore = currentItems.some(i => i.club_type === 'driver') &&
                  currentItems.some(i => i.club_type === 'putter');
  const noindex = proseWords < 500 || !hasCore;
  if (noindex) warn(`Page for ${slug} will be noindex (words=${proseWords}, hasCore=${hasCore})`);

  // ── History timeline ─────────────────────────────────────────────────────────

  const histBags = [...bags].sort((a, b) => b.bag_date.localeCompare(a.bag_date));
  const timelineRows = histBags.map(bag => {
    const label  = fmtDate(bag.bag_date) + (bag.is_current ? ' (current)' : '');
    const driver = bag._items.find(i => i.club_type === 'driver');
    const iron   = bag._items.find(i => i.club_type === 'iron');
    const putter = bag._items.find(i => i.club_type === 'putter');
    const ball   = bag._items.find(i => i.club_type === 'ball');

    const fmt = (item) => item
      ? `<strong>${esc(item.raw_brand)}</strong> ${esc((item.raw_model || '').split(' ').slice(0, 4).join(' '))}`
      : '<span style="color:var(--text-muted)">-</span>';

    return `
    <tr${bag.is_current ? ' class="witb-hist-current"' : ''}>
      <td class="witb-hist-date">${esc(label)}</td>
      <td>${fmt(driver)}</td>
      <td>${fmt(iron)}</td>
      <td>${fmt(putter)}</td>
      <td>${fmt(ball)}</td>
    </tr>`;
  }).join('');

  // ── JSON-LD ───────────────────────────────────────────────────────────────────

  const bagItemsLd = currentItems.map((item, i) => ({
    '@type':    'ListItem',
    position:   i + 1,
    name:       `${item.raw_brand} ${item.raw_model}`.trim(),
    description: clubLabel(item.club_type),
  }));

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type':      'Person',
        name:         name,
        description:  `${name} tour equipment bag, tracked across ${bags.length} snapshots by DORMIED.`,
        url:          canonicalUrl,
      },
      {
        '@type':       'ItemList',
        name:          `${name} What's In The Bag - Current Equipment`,
        description:   `${name} current bag as of ${currentDate}`,
        url:           canonicalUrl,
        numberOfItems: currentItems.length,
        itemListElement: bagItemsLd,
      },
    ],
  }, null, 2);

  // ── Full HTML ─────────────────────────────────────────────────────────────────

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

  <title>${pageTitle}</title>
  <meta name="description" content="${esc(metaDesc)}">
  <meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}">
  <link rel="canonical" href="${canonicalUrl}">

  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="apple-touch-icon" href="/images/dormied-icon.png">

  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${esc(pageTitle)}">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:image" content="https://dormied.com/images/og-image.jpg">
  <meta property="og:site_name" content="DORMIED">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@DORMIED_GOLF">
  <meta name="twitter:title" content="${esc(pageTitle)}">
  <meta name="twitter:description" content="${esc(metaDesc)}">
  <meta name="twitter:image" content="https://dormied.com/images/og-image.jpg">

  <link rel="sitemap" type="application/xml" href="/sitemap.xml">

  <!-- Fonts -->
  <link rel="preload" href="/fonts/inter-400-normal-6.woff2"            as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/barlow-condensed-700-italic-2.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/jetbrains-mono-500-normal-5.woff2"   as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/css/fonts.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="/css/fonts.css"></noscript>

  <!-- Critical CSS -->
  <style>
    :root{--bg:#060b06;--bg-surface:#0c140c;--bg-raised:#111d11;--bg-hover:#162316;--bg-active:#1e311e;--border:#1a2e1a;--border-lite:#243824;--text:#e2f0de;--text-dim:#8aa88a;--text-muted:#6b8f6b;--green:#22c55e;--green-dim:#16a34a;--green-dark:#14532d;--green-glow:rgba(34,197,94,0.15);--red:#ef4444;--red-dim:rgba(239,68,68,0.12);--amber:#f59e0b;--gold:#fbbf24;--silver:#d1d5db;--bronze:#cd7f32;--font-display:'Barlow Condensed',system-ui,sans-serif;--font-body:'Inter',system-ui,sans-serif;--font-mono:'JetBrains Mono','Courier New',monospace;--radius:6px;--radius-sm:4px;--radius-lg:10px;--content-max:1440px;--sidebar-w:180px;--gap:24px}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    [hidden]{display:none!important}
    html{font-size:16px;-webkit-font-smoothing:antialiased}
    body{background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:.9375rem;line-height:1.5;min-height:100vh}
    a{color:var(--green);text-decoration:none}
    img{display:block;max-width:100%}
    .container{width:100%;max-width:var(--content-max);margin:0 auto;padding:0 16px}
    .site-header{background:var(--bg-surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
    .header-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;height:56px}
    .site-logo{display:flex;align-items:center;flex-shrink:0}
    .logo-img{height:32px;width:auto;flex-shrink:0}
    .logo-text-fallback{font-family:var(--font-display);font-size:1.75rem;font-weight:700;font-style:italic;color:var(--green);letter-spacing:.04em;text-transform:uppercase}
    .site-nav{display:flex;align-items:center;gap:20px}
    .site-nav-link{font-family:var(--font-mono);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text);text-decoration:none}
    .site-nav-link--active,.site-nav-link:hover{color:var(--green)}
    .nav-hamburger{display:none;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;padding:6px;color:var(--text);border-radius:var(--radius-sm);flex-shrink:0}
    @media(max-width:768px){.nav-hamburger{display:flex}.site-nav{display:none}}
    .mobile-nav-panel{display:none;position:fixed;top:56px;left:0;right:0;background:var(--bg-surface);border-bottom:1px solid var(--border);z-index:99;padding:8px 16px 16px;flex-direction:column;box-shadow:0 8px 24px rgba(0,0,0,.4)}
    .mobile-nav-panel.open{display:flex}
    .mobile-nav-link{display:block;font-family:var(--font-mono);font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text);text-decoration:none;padding:12px 4px;border-bottom:1px solid var(--border)}
    .mobile-nav-link:last-child{border-bottom:none}
    .mobile-nav-link:hover,.mobile-nav-link.active{color:var(--green)}
    .site-search{display:flex;align-items:center;position:relative;flex-shrink:0}
    .site-search-trigger{display:flex;align-items:center;gap:6px;background:none;border:none;cursor:pointer;color:var(--text-muted);font-family:var(--font-mono);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:6px 8px;border-radius:var(--radius-sm)}
    .site-search-trigger:hover{color:var(--text)}
    .site-search-trigger-label{display:none}
    @media(min-width:600px){.site-search-trigger-label{display:inline}}
    /* Player page specific */
    .witb-player-eyebrow{font-family:var(--font-mono);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--green);margin-bottom:6px}
    .witb-player-breadcrumb{font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);margin-bottom:16px}
    .witb-player-breadcrumb a{color:var(--text-muted)}
    .witb-player-breadcrumb a:hover{color:var(--green)}
    .witb-player-title{font-family:var(--font-display);font-size:clamp(2rem,5vw,3.5rem);font-weight:700;font-style:italic;color:var(--text);text-transform:uppercase;letter-spacing:.02em;line-height:1.05;margin-bottom:4px}
    .witb-player-rank{font-family:var(--font-mono);font-size:.78rem;color:var(--text-muted);margin-bottom:6px}
    .witb-player-rank span{color:var(--green)}
    .witb-player-underline{width:56px;height:3px;background:var(--green);margin:12px 0 20px}
    .witb-player-lede{font-size:1rem;line-height:1.65;color:var(--text-dim);margin-bottom:0;max-width:68ch}
  </style>

  <link rel="preload" href="/css/styles.min.css?v=20260523" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="/css/styles.min.css?v=20260523"></noscript>

  <!-- JSON-LD -->
  <script type="application/ld+json">
  ${jsonLd}
  </script>
</head>
<body>
  <!-- GTM noscript -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>

  <!-- HEADER -->
  <header class="site-header" role="banner">
    <div class="container header-inner">
      <a href="/" class="site-logo" aria-label="DORMIED home">
        <img src="/images/dormied-logo-colour.png" alt="DORMIED" class="logo-img" width="140" height="32"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="logo-text-fallback" style="display:none">DORMIED</span>
      </a>

      <nav class="site-nav" aria-label="Main navigation">
        <a href="/rankings/"  class="site-nav-link">Index</a>
        <a href="/witb/"      class="site-nav-link site-nav-link--active">WITB</a>
        <a href="/scorecard/" class="site-nav-link">Scorecard</a>
        <a href="/news/"      class="site-nav-link">News</a>
        <a href="/brands/"    class="site-nav-link">Brands</a>
      </nav>

      <button class="nav-hamburger" id="nav-hamburger" aria-label="Open navigation menu"
        aria-expanded="false" aria-controls="mobile-nav-panel">
        <span class="bars" aria-hidden="true">
          <span class="bar"></span><span class="bar"></span><span class="bar"></span>
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
            <input class="site-search-input" type="search" placeholder="Search brands, articles..." autocomplete="off" aria-label="Search">
          </div>
          <div id="site-search-results" class="site-search-results"></div>
        </div>
      </div>
    </div>

    <nav class="mobile-nav-panel" id="mobile-nav-panel" aria-label="Mobile navigation" hidden>
      <a href="/rankings/"  class="mobile-nav-link">Index</a>
      <a href="/witb/"      class="mobile-nav-link active">WITB</a>
      <a href="/scorecard/" class="mobile-nav-link">Scorecard</a>
      <a href="/news/"      class="mobile-nav-link">News</a>
      <a href="/brands/"    class="mobile-nav-link">Brands</a>
    </nav>
  </header>

  <!-- MAIN -->
  <main>
    <div class="witb-layout">

      <!-- MAIN COLUMN -->
      <div class="witb-main">

        <!-- 1. PLAYER HEADER -->
        <section class="hero-section" aria-labelledby="player-title">
          <div class="container" style="padding-top:24px;padding-bottom:0">
            <nav class="witb-player-breadcrumb" aria-label="Breadcrumb">
              <a href="/">Home</a> &rsaquo; <a href="/witb/">WITB</a> &rsaquo; Players &rsaquo; ${esc(name)}
            </nav>
            <p class="witb-player-eyebrow">Tour Equipment</p>
            <h1 class="witb-player-title" id="player-title">${esc(name)}</h1>
            <p class="witb-player-rank">${owgrLine}</p>
            <div class="witb-player-underline" aria-hidden="true"></div>
          </div>
        </section>

        <div class="container">

          <!-- 2. LEDE -->
          <section class="witb-section" style="padding-top:0" aria-label="Equipment overview">
            <p class="witb-player-lede">${esc(ledes.lede)}</p>
          </section>

          <!-- 3. CURRENT BAG -->
          <section class="witb-section" aria-labelledby="current-bag-heading">
            <h2 class="witb-section-title" id="current-bag-heading">Current Bag</h2>
            <p class="witb-section-sub">Snapshot: ${esc(currentDate)} &middot; Source: <a href="https://www.pgaclubtracker.com" rel="noopener noreferrer" target="_blank">PGAClubTracker</a></p>
            <div style="overflow-x:auto">
              <table class="witb-player-bag-table" style="width:100%;border-collapse:collapse">
                <thead>
                  <tr style="border-bottom:1px solid var(--border)">
                    <th style="text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px">Club</th>
                    <th style="text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px">Brand</th>
                    <th style="text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px">Model</th>
                    <th style="text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px">Loft / No.</th>
                    <th style="text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px">Shaft</th>
                  </tr>
                </thead>
                <tbody>${tableRows}
                </tbody>
              </table>
            </div>
          </section>

          <!-- 4. HOW THIS BAG COMPARES -->
          <section class="witb-section" aria-labelledby="compare-heading">
            <h2 class="witb-section-title" id="compare-heading">How This Bag Compares to the Tour</h2>
            <p class="witb-section-sub">Brand usage across ${TOTAL_TOUR_PLAYERS} current bags</p>
            <div class="witb-comp-grid" style="display:grid;gap:12px">
              ${compHtml}
            </div>
            <p style="font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);margin-top:12px;text-transform:uppercase;letter-spacing:.05em">Player counts reflect unique players carrying at least one item from that brand in the relevant category. Computed from current bags.</p>
          </section>

          <!-- 5. DORMIED INDEX ANGLE -->
          ${diAngle ? `<section class="witb-section" aria-labelledby="di-heading">
            <h2 class="witb-section-title" id="di-heading">The Attention Angle</h2>
            <p class="witb-section-sub">Rahm's brands on the DORMIED Index</p>
            <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px">
              <p style="font-size:.9375rem;line-height:1.65;color:var(--text-dim)">${esc(diAngle)}</p>
              <p style="font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);margin-top:10px;text-transform:uppercase;letter-spacing:.05em">DI scores: <a href="/rankings/">DORMIED Index</a>, April 2026 snapshot.</p>
            </div>
          </section>` : ''}

          <!-- 6. BAG HISTORY -->
          <section class="witb-section" aria-labelledby="history-heading">
            <h2 class="witb-section-title" id="history-heading">Bag History</h2>
            <p class="witb-section-sub">${bags.length} snapshots tracked, 2019-2025</p>

            ${ledes.history_narrative ? `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:16px">
              <p style="font-size:.9375rem;line-height:1.65;color:var(--text-dim)">${esc(ledes.history_narrative)}</p>
            </div>` : ''}

            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:.875rem">
                <thead>
                  <tr style="border-bottom:1px solid var(--border)">
                    <th style="text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px;white-space:nowrap">Snapshot</th>
                    <th style="text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px">Driver</th>
                    <th style="text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px">Irons</th>
                    <th style="text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px">Putter</th>
                    <th style="text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px">Ball</th>
                  </tr>
                </thead>
                <tbody>${timelineRows}
                </tbody>
              </table>
            </div>

            <p style="font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);margin-top:10px;text-transform:uppercase;letter-spacing:.05em">Data from <a href="https://www.pgaclubtracker.com" rel="noopener noreferrer" target="_blank">PGAClubTracker</a>. OWGR from <a href="https://www.owgr.com" rel="noopener noreferrer" target="_blank">owgr.com</a>, updated weekly. All data is DORMIED's independent editorial compilation.</p>
          </section>

        </div><!-- /container -->
      </div><!-- /witb-main -->

      <!-- RIGHT SIDEBAR -->
      <aside class="witb-sidebar sidebar-ad-col">
        <section class="home-stories-section latest-feed-section" aria-labelledby="player-stories-heading">
          <h2 class="latest-feed-heading" id="player-stories-heading">Top Stories</h2>
          <div id="home-stories-list" class="latest-feed-list">
            <p class="latest-feed-loading">Loading&hellip;</p>
          </div>
        </section>
        <section class="home-stories-section latest-feed-section" aria-labelledby="player-latest-heading">
          <h2 class="latest-feed-heading" id="player-latest-heading">Latest</h2>
          <div id="dormied-latest-list" class="latest-feed-list">
            <p class="latest-feed-loading">Loading&hellip;</p>
          </div>
        </section>
      </aside>

    </div><!-- /witb-layout -->
  </main>

  <!-- FOOTER -->
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
      <p class="footer-legal">
        &copy; <span id="footer-year"></span> DORMIED. Rankings are independent editorial content. No brand pays for placement or improved position on the DORMIED Index. All brand names and logos are property of their respective owners.
      </p>
    </div>
  </footer>

  <!-- SCRIPTS -->
  <script>document.getElementById('footer-year').textContent = new Date().getFullYear();</script>

  <!-- Mobile nav -->
  <script>
  (function(){
    var btn   = document.getElementById('nav-hamburger');
    var panel = document.getElementById('mobile-nav-panel');
    if (!btn || !panel) return;
    function openNav()  { btn.setAttribute('aria-expanded','true');  panel.classList.add('open');    panel.removeAttribute('hidden'); }
    function closeNav() { btn.setAttribute('aria-expanded','false'); panel.classList.remove('open'); panel.setAttribute('hidden',''); }
    btn.addEventListener('click', function(){ btn.getAttribute('aria-expanded')==='true' ? closeNav() : openNav(); });
    panel.querySelectorAll('a').forEach(function(a){ a.addEventListener('click', closeNav); });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeNav(); });
    document.addEventListener('click',   function(e){ if(!btn.contains(e.target) && !panel.contains(e.target)) closeNav(); });
  })();
  </script>

  <!-- Bag table row highlight on hover -->
  <style>
    .witb-player-bag-table tr:hover td { background: var(--bg-hover); }
    .witb-player-bag-table td { padding: 8px 8px; border-bottom: 1px solid var(--border-lite); vertical-align: middle; font-size: .875rem; }
    .witb-player-bag-type { white-space: nowrap; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
    .witb-player-bag-brand { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .witb-player-bag-loft, .witb-player-bag-shaft { color: var(--text-muted); font-size: .8125rem; }
    .witb-hist-current td { background: var(--bg-surface); }
    .witb-hist-date { white-space: nowrap; color: var(--text-dim); font-family: var(--font-mono); font-size: .72rem; padding-right: 12px; }
    tbody tr td { padding: 7px 8px; border-bottom: 1px solid var(--border-lite); vertical-align: top; }
    .witb-comp-row { display: grid; grid-template-columns: 100px 1fr 120px auto; gap: 8px; align-items: center; padding: 10px 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius); }
    .witb-comp-cat { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
    .witb-comp-brand { display: flex; align-items: center; gap: 6px; font-size: .875rem; }
    .witb-comp-count { font-family: var(--font-mono); font-size: .78rem; color: var(--text-dim); }
    .witb-comp-leader { font-family: var(--font-mono); font-size: .65rem; color: var(--green); text-transform: uppercase; letter-spacing: .06em; }
    .witb-comp-note { font-family: var(--font-mono); font-size: .65rem; color: var(--text-muted); }
    @media(max-width:600px){ .witb-comp-row { grid-template-columns: 1fr 1fr; } .witb-comp-stat, .witb-comp-context { display: none; } }
  </style>

  <script defer src="/js/utils.min.js?v=20260318"></script>
  <script defer src="/js/feed.min.js?v=20260522"></script>
</body>
</html>`;
}

// ── Sitemap update ────────────────────────────────────────────────────────────

function updateSitemap(slug, today, noindex) {
  if (noindex) return; // Don't add noindex pages to sitemap

  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  let sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const url   = `https://dormied.com/witb/players/${slug}/`;

  if (sitemap.includes(url)) {
    // Update lastmod
    sitemap = sitemap.replace(
      new RegExp(`(<loc>${url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}</loc>\\s*<lastmod>)[^<]+(</lastmod>)`),
      `$1${today}$2`
    );
    log('Sitemap: updated lastmod for existing entry');
  } else {
    // Insert before </urlset>
    const entry = `
  <url>
    <loc>${url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
    sitemap = sitemap.replace('</urlset>', entry + '\n</urlset>');
    log('Sitemap: added new entry');
  }

  fs.writeFileSync(sitemapPath, sitemap, 'utf8');
}

// ── Search index update ───────────────────────────────────────────────────────

function updateSearchIndex(player, currentItems, noindex) {
  if (noindex) return; // Don't add noindex pages to search index

  const siPath = path.join(ROOT, 'search-index.json');
  const si     = JSON.parse(fs.readFileSync(siPath, 'utf8'));

  const url = `/witb/players/${player.slug}/`;

  // Remove any existing entry for this player
  si.entries = si.entries.filter(e => !(e.type === 'witb-player' && e.url === url));

  const brands = [...new Set(currentItems.map(i => i.witb_brands?.name || i.raw_brand).filter(Boolean))];
  const models  = currentItems.map(i => i.raw_model).filter(Boolean).join(' ');

  si.entries.push({
    type:        'witb-player',
    slug:        player.slug,
    title:       player.name,
    subtitle:    `WITB ${new Date().getFullYear()} - ${brands.join(', ')}`,
    url,
    thumbnail:   null,
    search_text: `${player.name} witb what's in the bag ${brands.join(' ')} ${models}`.toLowerCase(),
  });

  si.generated_at = new Date().toISOString();
  fs.writeFileSync(siPath, JSON.stringify(si), 'utf8');
  log('Search index: updated');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE env vars');
  if (!ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  const sb        = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const today     = new Date().toISOString().slice(0, 10);

  log(`Building player page for: ${PLAYER_SLUG}`);

  // ── 1. Fetch all data ───────────────────────────────────────────────────────

  const player = await fetchPlayerData(sb, PLAYER_SLUG);
  log(`Player: ${player.name}, OWGR #${player.owgr_rank}`);

  const bags = await fetchBagsWithItems(sb, player.id);
  const currentBag = bags.find(b => b.is_current);
  if (!currentBag) throw new Error(`No current bag found for ${PLAYER_SLUG}`);
  log(`Bags: ${bags.length} total, current: ${currentBag.bag_date}`);

  const currentItems = currentBag._items;
  log(`Current bag items: ${currentItems.length}`);

  // ── 2. Tour comparison ──────────────────────────────────────────────────────

  log('Fetching tour comparison data...');
  const tourComp = await fetchTourComparison(sb, []);

  // ── 3. DI data ──────────────────────────────────────────────────────────────

  const dormiedSlugs = [...new Set(currentItems.map(i => i.witb_brands?.dormied_brand_slug).filter(Boolean))];
  const diMap = await fetchDiData(sb, dormiedSlugs);
  log(`DI data fetched for ${diMap.size} brands`);

  // ── 4. Lede generation (cached) ─────────────────────────────────────────────

  const cacheKey = `${PLAYER_SLUG}:${currentBag.bag_date}`;
  const cache    = loadLedeCache();
  let ledes      = cache[cacheKey];

  if (ledes) {
    log(`Lede loaded from cache (key: ${cacheKey})`);
  } else {
    log(`Lede not in cache -- calling Opus 4.7 (key: ${cacheKey})`);
    ledes = await generateLede(anthropic, player, bags, currentBag, currentItems);
    cache[cacheKey] = ledes;
    saveLedeCache(cache);
    log('Lede generated and cached');
  }

  log(`Lede (${wordCount(ledes.lede)} words): ${ledes.lede?.slice(0, 80)}...`);

  // ── 5. Build HTML ───────────────────────────────────────────────────────────

  const html = buildPage({ player, bags, currentBag, currentItems, tourComp, diMap, ledes, today });

  // Determine noindex status (buildPage handles the detailed calculation)
  const hasCore = currentItems.some(i => i.club_type === 'driver') && currentItems.some(i => i.club_type === 'putter');
  const noindex = html.includes('noindex');

  // ── 6. Write output ─────────────────────────────────────────────────────────

  const outDir = path.join(ROOT, 'witb', 'players', PLAYER_SLUG);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');
  log(`Wrote: ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);

  // ── 7. Update sitemap + search index ────────────────────────────────────────

  updateSitemap(PLAYER_SLUG, today, noindex);
  updateSearchIndex(player, currentItems, noindex);

  log(`Done. Page: /witb/players/${PLAYER_SLUG}/`);
  if (!noindex) log('Page is indexable.');
  else          log('Page has noindex (prose word count or missing core clubs).');
}

main().catch(err => {
  console.error('[generate-player] Fatal:', err.message);
  process.exit(1);
});
