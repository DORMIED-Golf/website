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

// ── Shaft brand slug map ──────────────────────────────────────────────────────

const SHAFT_BRAND_LINKS = {
  'True Temper':    'true-temper',
  'Fujikura':       'fujikura',
  'Mitsubishi':     'mitsubishi-golf',
  'Nippon':         'nippon-shaft',
  'Aldila':         'aldila',
  'Graphite Design':'graphite-design',
  'UST Mamiya':     'ust-mamiya',
  'KBS':            'kbs-golf',
};

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

/** Count words in a prose string (rough) */
function wordCount(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

// ── Shaft rendering ───────────────────────────────────────────────────────────

/**
 * Deduplicate a leading repeated brand token in a shaft string.
 * e.g. "Fujikura Fujikura Ventus Black 7 X" -> "Fujikura Ventus Black 7 X"
 */
function dedupeShaft(raw) {
  for (const brand of Object.keys(SHAFT_BRAND_LINKS)) {
    const doubled = brand + ' ' + brand;
    if (raw.startsWith(doubled)) {
      // Remove the first "Brand " prefix
      return raw.slice(brand.length + 1);
    }
  }
  return raw;
}

/**
 * Return HTML for shaft display.
 * - Prefers witb_shafts.model (already contains brand), falls back to raw_shaft.
 * - Deduplicates a doubled leading brand token.
 * - Links the brand portion to /brands/{slug} for the eight mapped shaft brands.
 * Returns plain '-' string (not HTML) when no shaft data.
 */
function shaftCell(item) {
  let raw = ((item.witb_shafts?.model) || item.raw_shaft || '').trim();
  if (!raw || raw === '-') return '-';

  raw = dedupeShaft(raw);

  for (const [brand, slug] of Object.entries(SHAFT_BRAND_LINKS)) {
    if (raw === brand) {
      return `<a href="/brands/${slug}/">${esc(brand)}</a>`;
    }
    if (raw.startsWith(brand + ' ')) {
      const rest = raw.slice(brand.length + 1);
      return `<a href="/brands/${slug}/">${esc(brand)}</a> ${esc(rest)}`;
    }
  }

  return esc(raw);
}

// ── Brand cell ────────────────────────────────────────────────────────────────

/** Render brand logo + link component (exact-match-or-null: no fuzzy) */
function brandCell(rawBrand, dormiedSlug) {
  const name = esc(rawBrand || '');
  if (!dormiedSlug) {
    const mono = (rawBrand || '??').slice(0, 2).toUpperCase();
    return `<span class="witb-brand-monogram">${mono}</span>${name}`;
  }
  const logo = `/images/logos/${dormiedSlug}.jpg`;
  const mono = (rawBrand || '??').slice(0, 2).toUpperCase();
  return `<img src="${logo}" alt="" class="witb-brand-logo" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"><span class="witb-brand-monogram" style="display:none">${mono}</span><a href="/brands/${dormiedSlug}/">${name}</a>`;
}

// ── Category icon ─────────────────────────────────────────────────────────────

/** Category icon img tag */
function catIcon(clubType) {
  const icons = {
    'driver':     '/images/icons/driver_22px.svg',
    '3-wood':     '/images/icons/fairway_wood_22px.svg',
    '4-wood':     '/images/icons/fairway_wood_22px.svg',
    '5-wood':     '/images/icons/fairway_wood_22px.svg',
    '7-wood':     '/images/icons/fairway_wood_22px.svg',
    'mini-driver':'/images/icons/fairway_wood_22px.svg',
    'hybrid':     '/images/icons/hybrid_22px.svg',
    'iron':       '/images/icons/golf_iron_icon_22px.svg',
    'wedge':      '/images/icons/wedge_22px.svg',
    'putter':     '/images/icons/putter_22px.svg',
    'ball':       '/images/icons/ball.svg',
    'grip':       '/images/icons/grip.svg',
  };
  const src = icons[clubType] || '/images/icons/golf_iron_icon_22px.svg';
  return `<img src="${src}" width="16" height="16" alt="" style="display:inline;vertical-align:middle;opacity:.7">`;
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

// ── History item formatter ────────────────────────────────────────────────────

/**
 * Format a single bag item for the history timeline table.
 * @param {object|null} item  - bag item with witb_shafts join
 * @param {boolean} showDetail - if true, add loft + shaft sub-line
 */
function fmtHistItem(item, showDetail = false) {
  if (!item) return '<span style="color:var(--text-muted)">-</span>';
  const model = (item.raw_model || '').split(' ').slice(0, 5).join(' ');
  let html = `<strong>${esc(item.raw_brand)}</strong> ${esc(model)}`;

  if (showDetail) {
    const parts = [];
    if (item.loft_or_number) parts.push(esc(item.loft_or_number));
    const sc = shaftCell(item);
    if (sc && sc !== '-') parts.push(sc);
    if (parts.length) {
      html += `<br><span class="witb-hist-detail">${parts.join(' &middot; ')}</span>`;
    }
  }

  return html;
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

  const keyItems = currentItems
    .filter(i => ['driver', 'iron', 'putter', 'ball'].includes(i.club_type))
    .map(i => {
      const loft  = i.loft_or_number ? ` (${i.loft_or_number})` : '';
      const shaft = (i.witb_shafts?.model || i.raw_shaft) ? ` / shaft: ${dedupeShaft(i.witb_shafts?.model || i.raw_shaft)}` : '';
      return `${clubLabel(i.club_type)}: ${i.raw_brand} ${i.raw_model}${loft}${shaft}`;
    })
    .join('\n');

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
- No hyphens used as em dashes (do not write " - " as a pause; use commas or period breaks).

Player: Jon Rahm
OWGR rank: #${player.owgr_rank}

CURRENT BAG (${currentBag.bag_date}):
${keyItems}

HISTORICAL BAGS (newest first, data-verified):
${histSummary}

DATA CONSTRAINT: The snapshot record goes from June 2020 (TaylorMade) directly to March 2021 (Callaway). Do not claim a specific switch date -- say only what the data shows (e.g. "by early 2021 his bag was full Callaway").

TASK 1 -- LEDE (130-180 words total):

Write one cohesive opening paragraph. It has two parts that should flow naturally together -- do NOT separate them with a line break or section break:

Part A -- Bio context (2-3 sentences): Establish who Rahm is for readers who need grounding. Accurate facts only: Spanish professional golfer, former world number one, two-time major champion (2021 U.S. Open at Torrey Pines, 2023 Masters Tournament). Moved to LIV Golf in December 2023. State these facts plainly without editorializing or framing them as transitions.

Part B -- Equipment narrative (continues from Part A): Narrate from the real data. Observe what is notable about the current Callaway bag. What has been stable? What changed from earlier snapshots? Start Part B by pivoting directly to equipment -- a specific detail, not a transition phrase.

The result should read as a single unified paragraph, not two separate sections.

TASK 2 -- HISTORY NARRATIVE (2-4 sentences):
A concise prose summary of the equipment arc across the 10 bag snapshots. Capture the TaylorMade era (2019-2020), the Callaway transition, and the current state. Accuracy to snapshots only -- no invented details between data points.

Return valid JSON only:
{
  "lede": "...",
  "history_narrative": "..."
}`;

  const res = await anthropic.messages.create({
    model:      'claude-opus-4-7',
    max_tokens: 1200,
    thinking:   { type: 'adaptive' },
    messages:   [{ role: 'user', content: prompt }],
  });

  const u    = res.usage || {};
  const cost = ((u.input_tokens ?? 0) / 1e6 * 5) + ((u.output_tokens ?? 0) / 1e6 * 25);
  log(`Opus tokens: input=${u.input_tokens}, output=${u.output_tokens}, cost=$${cost.toFixed(4)}`);

  const textBlocks = (res.content || []).filter(b => b.type === 'text' && b.text?.trim());
  const raw = (textBlocks[textBlocks.length - 1]?.text || '').trim();

  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    warn('Failed to parse Opus JSON response. Raw:\n' + raw.slice(0, 500));
    return { lede: raw.slice(0, 500), history_narrative: '' };
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

async function fetchTourComparison(sb) {
  const catGroups = {
    driver: ['driver'],
    irons:  ['iron'],
    putter: ['putter'],
    ball:   ['ball'],
  };

  const result = {};

  for (const [cat, types] of Object.entries(catGroups)) {
    const { data: items } = await sb
      .from('witb_bag_items')
      .select('raw_brand, witb_brands!brand_id(name, dormied_brand_slug), witb_bags!bag_id(is_current, player_id)')
      .in('club_type', types);

    const currentItems = (items || []).filter(i => i.witb_bags?.is_current);

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

// ── Tour comparison rows ──────────────────────────────────────────────────────

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
    const playerBrand = playerBrandsByCategory[cat];
    if (!playerBrand) continue;

    const playerEntry = all.find(b => b.name === playerBrand.name);
    const playerCount = playerEntry?.count || 0;
    const rank1 = all[0];

    rows.push({
      cat,
      label,
      icon,
      playerBrand:      playerBrand.name,
      playerDormiedSlug:playerBrand.dormied_slug,
      playerCount,
      rank1Name:        rank1?.name,
      rank1Count:       rank1?.count,
    });
  }

  return rows;
}

// ── HTML page builder ─────────────────────────────────────────────────────────

function buildPage({ player, bags, currentBag, currentItems, tourComp, ledes, today }) {
  const { name, slug, owgr_rank, owgr_rank_updated_at, data_golf_rank } = player;
  const owgrDate    = fmtOwgrDate(owgr_rank_updated_at);
  const currentDate = fmtDate(currentBag.bag_date);

  // ── OWGR rank line with logo ───────────────────────────────────────────────

  const owgrLogoHtml = `<a href="https://www.owgr.com" rel="noopener noreferrer" target="_blank" class="owgr-logo-link" aria-label="Official World Golf Ranking"><img src="/images/owgr-logo.svg" alt="OWGR" class="owgr-logo" width="44" height="15" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="owgr-logo-fallback" style="display:none;font-family:var(--font-mono);font-size:.65rem;font-weight:700;letter-spacing:.1em">OWGR</span></a>`;

  const owgrLine = owgr_rank
    ? `${owgrLogoHtml} <span class="witb-rank-num">#${owgr_rank}</span>${owgrDate ? ` &middot; <span class="witb-rank-updated">updated ${owgrDate}</span>` : ''}${data_golf_rank ? ` &middot; DG #${data_golf_rank}` : ''}`
    : `Unranked${data_golf_rank ? ` &middot; DG #${data_golf_rank}` : ''}`;

  // ── Player brands per category (for comparison) ───────────────────────────

  const playerBrandsByCategory = {};
  for (const item of currentItems) {
    const cat = item.club_type === 'iron' ? 'irons' : item.club_type;
    if (['driver', 'irons', 'putter', 'ball'].includes(cat)) {
      if (!playerBrandsByCategory[cat]) {
        playerBrandsByCategory[cat] = {
          name:         item.witb_brands?.name || item.raw_brand,
          dormied_slug: item.witb_brands?.dormied_brand_slug || null,
        };
      }
    }
  }

  const compRows = buildComparisonRows(tourComp, playerBrandsByCategory);

  // ── SEO ───────────────────────────────────────────────────────────────────

  const pageTitle    = `${esc(name)} WITB: What's In The Bag 2026 | DORMIED`;
  const metaDesc     = `${esc(name)} WITB 2026: Callaway Elyte driver, Odyssey putter, and a full Callaway bag from driver to ball. Equipment breakdown and gear history across 10 snapshots.`;
  const canonicalUrl = `https://dormied.com/witb/players/${slug}/`;

  // ── Current bag table ─────────────────────────────────────────────────────

  const tableRows = currentItems.map(item => {
    const dslug = item.witb_brands?.dormied_brand_slug || null;
    const loft  = item.loft_or_number || '';
    const sc    = shaftCell(item); // returns HTML (may contain <a> tags)

    return `
    <tr>
      <td class="witb-bag-type-cell"><div class="witb-cell-flex">${catIcon(item.club_type)}<span>${esc(clubLabel(item.club_type))}</span></div></td>
      <td class="witb-bag-brand-cell"><div class="witb-cell-flex">${brandCell(item.witb_brands?.name || item.raw_brand, dslug)}</div></td>
      <td class="witb-bag-model-cell">${esc(item.raw_model || '')}</td>
      <td class="witb-bag-loft-cell">${esc(loft)}</td>
      <td class="witb-bag-shaft-cell">${sc}</td>
    </tr>`;
  }).join('');

  // ── Tour comparison HTML ──────────────────────────────────────────────────

  const compHtml = compRows.map(row => {
    const barPct   = row.rank1Count ? Math.round(row.playerCount / row.rank1Count * 100) : 0;
    const isLeader = row.rank1Name === row.playerBrand;

    let ctxNote = '';
    if (isLeader) {
      ctxNote = `<span class="witb-comp-leader">Tour leader</span>`;
    } else if (row.rank1Name) {
      ctxNote = `<span class="witb-comp-note">${esc(row.rank1Name)} leads (${row.rank1Count})</span>`;
    }

    return `
    <div class="witb-comp-row">
      <div class="witb-comp-cat">${catIcon(row.icon)}${esc(row.label)}</div>
      <div class="witb-comp-brand"><div class="witb-cell-flex">${brandCell(row.playerBrand, row.playerDormiedSlug)}</div></div>
      <div class="witb-comp-stat">
        <span class="witb-comp-count">${row.playerCount} of ${TOTAL_TOUR_PLAYERS}</span>
        <div class="witb-lb-bar-bg" style="margin-top:4px"><div class="witb-lb-bar-fill" style="width:${barPct}%"></div></div>
      </div>
      <div class="witb-comp-context">${ctxNote}</div>
    </div>`;
  }).join('');

  // ── History timeline ──────────────────────────────────────────────────────

  // Club types that get shaft+loft detail in history
  const DETAIL_TYPES = new Set(['driver', '3-wood', '4-wood', '5-wood', '7-wood', 'mini-driver', 'iron', 'wedge']);

  const histBags = [...bags].sort((a, b) => b.bag_date.localeCompare(a.bag_date));

  const timelineRows = histBags.map(bag => {
    const label   = fmtDate(bag.bag_date) + (bag.is_current ? ' (current)' : '');
    const driver  = bag._items.find(i => i.club_type === 'driver');
    const iron    = bag._items.find(i => i.club_type === 'iron');
    const putter  = bag._items.find(i => i.club_type === 'putter');
    const ball    = bag._items.find(i => i.club_type === 'ball');

    return `
    <tr${bag.is_current ? ' class="witb-hist-current"' : ''}>
      <td class="witb-hist-date">${esc(label)}</td>
      <td>${fmtHistItem(driver, true)}</td>
      <td>${fmtHistItem(iron, true)}</td>
      <td>${fmtHistItem(putter, false)}</td>
      <td>${fmtHistItem(ball, false)}</td>
    </tr>`;
  }).join('');

  // ── Word count for robots decision ────────────────────────────────────────

  const bagItemWords  = currentItems.reduce((s, i) => s + wordCount(`${i.raw_brand} ${i.raw_model} ${i.raw_shaft || ''} ${i.loft_or_number || ''}`), 0);
  const histItemWords = bags.reduce((s, b) => s + b._items.reduce((s2, i) => s2 + wordCount(`${i.raw_brand} ${i.raw_model}`), 0), 0);
  const compWords     = compRows.reduce((s, r) => s + wordCount(`${r.label} ${r.playerBrand} ${r.playerCount} of ${TOTAL_TOUR_PLAYERS} ${r.rank1Name || ''}`), 0);
  const proseWords    = wordCount(ledes.lede)
                      + wordCount(ledes.history_narrative)
                      + compWords
                      + bagItemWords
                      + histItemWords;
  const hasCore = currentItems.some(i => i.club_type === 'driver') &&
                  currentItems.some(i => i.club_type === 'putter');
  const noindex = proseWords < 500 || !hasCore;
  if (noindex) warn(`Page for ${slug} will be noindex (words=${proseWords}, hasCore=${hasCore})`);
  else         log(`Word count: ~${proseWords} (threshold 500, hasCore=${hasCore})`);

  // ── JSON-LD ───────────────────────────────────────────────────────────────

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
        '@type':       'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home',    item: 'https://dormied.com/' },
          { '@type': 'ListItem', position: 2, name: 'WITB',    item: 'https://dormied.com/witb/' },
          { '@type': 'ListItem', position: 3, name: 'Players', item: 'https://dormied.com/witb/' },
          { '@type': 'ListItem', position: 4, name: name,      item: canonicalUrl },
        ],
      },
      {
        '@type':      'Person',
        name:         name,
        description:  `${name} tour equipment bag, tracked across ${bags.length} snapshots by DORMIED.`,
        url:          canonicalUrl,
      },
      {
        '@type':         'ItemList',
        name:            `${name} What's In The Bag - Current Equipment`,
        description:     `${name} current bag as of ${currentDate}`,
        url:             canonicalUrl,
        numberOfItems:   currentItems.length,
        itemListElement: bagItemsLd,
      },
    ],
  }, null, 2);

  // ── Full HTML ─────────────────────────────────────────────────────────────

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
    .witb-player-title{font-family:var(--font-display);font-size:clamp(2rem,5vw,3.5rem);font-weight:700;font-style:italic;color:var(--text);text-transform:uppercase;letter-spacing:.02em;line-height:1.05;margin-bottom:4px}
    .witb-player-rank{font-family:var(--font-mono);font-size:.78rem;color:var(--text-muted);margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .witb-player-rank .witb-rank-num{color:var(--green);font-weight:700}
    .witb-player-rank .witb-rank-updated{color:var(--text-muted)}
    .witb-player-underline{width:56px;height:3px;background:var(--green);margin:12px 0 0}
    .witb-player-lede{font-size:1rem;line-height:1.7;color:var(--text-dim);max-width:72ch}
    .owgr-logo-link{display:inline-flex;align-items:center;opacity:.85}
    .owgr-logo-link:hover{opacity:1}
    .owgr-logo{display:inline;vertical-align:middle}
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

  <!-- SITE HEADER -->
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
  <main id="main-content">

    <!-- BREADCRUMB -- above the header band, full width -->
    <nav class="breadcrumb container" aria-label="Breadcrumb">
      <a href="/" class="breadcrumb-link">Home</a>
      <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
      <a href="/witb/" class="breadcrumb-link">WITB</a>
      <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
      <a href="/witb/" class="breadcrumb-link">Players</a>
      <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
      <span class="breadcrumb-item--current" aria-current="page">${esc(name)}</span>
    </nav>

    <!-- FULL-WIDTH HEADER BAND -->
    <section class="bp-header-section" aria-labelledby="player-title">
      <div class="container">
        <p class="witb-player-eyebrow">Tour Equipment</p>
        <h1 class="witb-player-title" id="player-title">${esc(name)}</h1>
        <p class="witb-player-rank">${owgrLine}</p>
        <div class="witb-player-underline" aria-hidden="true"></div>
      </div>
    </section>

    <!-- TWO-COLUMN CONTENT: main sections + sidebar -->
    <div class="container">
      <div class="table-layout">

        <!-- MAIN CONTENT COLUMN -->
        <div class="bp-sections-col">

          <!-- 1. LEDE -->
          <section class="witb-section" style="padding-top:24px;border-bottom:none" aria-label="Equipment overview">
            <p class="witb-player-lede">${esc(ledes.lede)}</p>
          </section>

          <!-- 2. CURRENT BAG -->
          <section class="witb-section" aria-labelledby="current-bag-heading">
            <h2 class="witb-section-title" id="current-bag-heading">Current Bag</h2>
            <p class="witb-section-sub">Snapshot: ${esc(currentDate)}</p>
            <div style="overflow-x:auto">
              <table class="witb-player-bag-table" style="width:100%;border-collapse:collapse;table-layout:fixed">
                <colgroup>
                  <col style="width:110px">
                  <col style="width:160px">
                  <col>
                  <col style="width:80px">
                  <col style="width:210px">
                </colgroup>
                <thead>
                  <tr class="witb-bag-thead-row">
                    <th class="witb-bag-th">Club</th>
                    <th class="witb-bag-th">Brand</th>
                    <th class="witb-bag-th">Model</th>
                    <th class="witb-bag-th">Loft / No.</th>
                    <th class="witb-bag-th">Shaft</th>
                  </tr>
                </thead>
                <tbody>${tableRows}
                </tbody>
              </table>
            </div>
          </section>

          <!-- 3. HOW THIS BAG COMPARES -->
          <section class="witb-section" aria-labelledby="compare-heading">
            <h2 class="witb-section-title" id="compare-heading">How This Bag Compares to the Tour</h2>
            <p class="witb-section-sub">Brand usage across ${TOTAL_TOUR_PLAYERS} current bags</p>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${compHtml}
            </div>
            <p class="witb-footnote">Player counts reflect unique players carrying at least one item from that brand in the relevant category. Computed from current bags.</p>
          </section>

          <!-- 4. BAG HISTORY -->
          <section class="witb-section" aria-labelledby="history-heading">
            <h2 class="witb-section-title" id="history-heading">Bag History</h2>
            <p class="witb-section-sub">${bags.length} snapshots tracked, 2019-2025</p>

            ${ledes.history_narrative ? `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:16px">
              <p style="font-size:.9375rem;line-height:1.65;color:var(--text-dim)">${esc(ledes.history_narrative)}</p>
            </div>` : ''}

            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:.875rem">
                <thead>
                  <tr class="witb-bag-thead-row">
                    <th class="witb-bag-th" style="white-space:nowrap;width:110px">Snapshot</th>
                    <th class="witb-bag-th">Driver</th>
                    <th class="witb-bag-th">Irons</th>
                    <th class="witb-bag-th">Putter</th>
                    <th class="witb-bag-th">Ball</th>
                  </tr>
                </thead>
                <tbody>${timelineRows}
                </tbody>
              </table>
            </div>

            <p class="witb-footnote">Data from <a href="https://www.pgaclubtracker.com" rel="noopener noreferrer" target="_blank">PGAClubTracker</a>. OWGR from <a href="https://www.owgr.com" rel="noopener noreferrer" target="_blank">owgr.com</a>, updated weekly. All data is DORMIED's independent editorial compilation.</p>
          </section>

        </div><!-- /bp-sections-col -->

        <!-- SIDEBAR: Latest only -->
        <aside class="sidebar-ad-col">
          <section class="home-stories-section latest-feed-section" aria-labelledby="player-latest-heading">
            <h2 class="latest-feed-heading" id="player-latest-heading">Latest</h2>
            <div id="dormied-latest-list" class="latest-feed-list">
              <p class="latest-feed-loading">Loading&hellip;</p>
            </div>
          </section>
        </aside>

      </div><!-- /table-layout -->
    </div><!-- /container -->

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

  <!-- Page-specific styles -->
  <style>
    /* Bag table */
    .witb-bag-th{text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 8px 8px;white-space:nowrap}
    .witb-bag-thead-row{border-bottom:1px solid var(--border)}
    .witb-player-bag-table td{padding:8px;border-bottom:1px solid var(--border-lite);vertical-align:middle;font-size:.875rem}
    .witb-player-bag-table tr:hover td{background:var(--bg-hover)}
    .witb-bag-type-cell{color:var(--text-dim);white-space:nowrap}
    .witb-bag-brand-cell{white-space:nowrap}
    .witb-bag-loft-cell{color:var(--text-muted);font-size:.8125rem;white-space:nowrap}
    .witb-bag-shaft-cell{color:var(--text-muted);font-size:.8125rem;overflow:hidden;text-overflow:ellipsis}
    .witb-bag-shaft-cell a{color:var(--text-muted)}
    .witb-bag-shaft-cell a:hover{color:var(--green)}
    .witb-bag-model-cell{font-size:.875rem;overflow:hidden;text-overflow:ellipsis}
    .witb-cell-flex{display:flex;align-items:center;gap:6px}
    /* Comparison grid -- fixed columns so all rows align */
    .witb-comp-row{display:grid;grid-template-columns:90px 170px 150px 1fr;gap:8px;align-items:center;padding:10px 12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius)}
    .witb-comp-cat{display:flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)}
    .witb-comp-brand{min-width:0;overflow:hidden}
    .witb-comp-stat{min-width:0}
    .witb-comp-count{font-family:var(--font-mono);font-size:.78rem;color:var(--text-dim);display:block}
    .witb-comp-leader{font-family:var(--font-mono);font-size:.65rem;color:var(--green);text-transform:uppercase;letter-spacing:.06em}
    .witb-comp-note{font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted)}
    @media(max-width:640px){.witb-comp-row{grid-template-columns:80px 1fr}.witb-comp-stat,.witb-comp-context{display:none}}
    /* History table */
    .witb-hist-current td{background:var(--bg-surface)}
    .witb-hist-date{white-space:nowrap;color:var(--text-dim);font-family:var(--font-mono);font-size:.72rem;padding-right:12px;vertical-align:top}
    .witb-hist-detail{font-size:.72rem;color:var(--text-muted);font-weight:400}
    .witb-hist-detail a{color:var(--text-muted)}
    .witb-hist-detail a:hover{color:var(--green)}
    tbody tr td{padding:7px 8px;border-bottom:1px solid var(--border-lite);vertical-align:top}
    /* Brand cells */
    .witb-brand-logo{width:20px;height:20px;object-fit:contain;border-radius:3px;display:inline;vertical-align:middle}
    .witb-brand-monogram{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:var(--bg-raised);border:1px solid var(--border);border-radius:3px;font-family:var(--font-mono);font-size:.6rem;font-weight:700;color:var(--text-muted);vertical-align:middle;flex-shrink:0}
    /* Misc */
    .witb-footnote{font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);margin-top:12px;text-transform:uppercase;letter-spacing:.05em}
    .witb-footnote a{color:var(--text-muted)}
    .witb-footnote a:hover{color:var(--green)}
  </style>

  <script defer src="/js/utils.min.js?v=20260318"></script>
  <script defer src="/js/feed.min.js?v=20260522"></script>
</body>
</html>`;
}

// ── Sitemap update ────────────────────────────────────────────────────────────

function updateSitemap(slug, today, noindex) {
  if (noindex) return;

  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  let sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const url   = `https://dormied.com/witb/players/${slug}/`;

  if (sitemap.includes(url)) {
    sitemap = sitemap.replace(
      new RegExp(`(<loc>${url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}</loc>\\s*<lastmod>)[^<]+(</lastmod>)`),
      `$1${today}$2`
    );
    log('Sitemap: updated lastmod for existing entry');
  } else {
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
  if (noindex) return;

  const siPath = path.join(ROOT, 'search-index.json');
  const si     = JSON.parse(fs.readFileSync(siPath, 'utf8'));

  const url = `/witb/players/${player.slug}/`;
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

  // 1. Fetch all data
  const player = await fetchPlayerData(sb, PLAYER_SLUG);
  log(`Player: ${player.name}, OWGR #${player.owgr_rank}`);

  const bags = await fetchBagsWithItems(sb, player.id);
  const currentBag = bags.find(b => b.is_current);
  if (!currentBag) throw new Error(`No current bag found for ${PLAYER_SLUG}`);
  log(`Bags: ${bags.length} total, current: ${currentBag.bag_date}`);

  const currentItems = currentBag._items;
  log(`Current bag items: ${currentItems.length}`);

  // 2. Tour comparison
  log('Fetching tour comparison data...');
  const tourComp = await fetchTourComparison(sb);

  // 3. Lede generation (cached by slug:bag_date)
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

  log(`Lede (${wordCount(ledes.lede)} words): ${ledes.lede?.slice(0, 100)}...`);

  // 4. Build HTML
  const html = buildPage({ player, bags, currentBag, currentItems, tourComp, ledes, today });

  const noindex = html.includes('noindex');

  // 5. Write output
  const outDir = path.join(ROOT, 'witb', 'players', PLAYER_SLUG);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');
  log(`Wrote: ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);

  // 6. Update sitemap + search index
  updateSitemap(PLAYER_SLUG, today, noindex);
  updateSearchIndex(player, currentItems, noindex);

  log(`Done. Page: /witb/players/${PLAYER_SLUG}/`);
  if (!noindex) log('Page is indexable.');
  else          warn('Page has noindex (prose word count or missing core clubs).');
}

main().catch(err => {
  console.error('[generate-player] Fatal:', err.message);
  process.exit(1);
});
