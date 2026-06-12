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
const vm              = require('vm');
const { createClient } = require('@supabase/supabase-js');
const Anthropic        = require('@anthropic-ai/sdk');
const feedBake         = require('./feed-bake');

function loadDormiedData() {
  const raw = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return ctx.window.DORMIED_DATA;
}

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT       = path.resolve(__dirname, '..');
const CACHE_FILE = path.join(__dirname, 'cache', 'witb-player-ledes.json');
// TOTAL_TOUR_PLAYERS is now dynamic — derived from ranked players at build time.

const PLAYER_SLUG = process.argv[2] || 'jon-rahm';

// ── Shaft brand slug map ──────────────────────────────────────────────────────

// Keys are full brand names as they appear in witb_shafts.model strings.
// Values are DORMIED brand slugs for /brands/{slug}/ links.
// Used for both brand-name display text and legacy raw_shaft fallback.
const SHAFT_BRAND_LINKS = {
  'True Temper':    'true-temper',
  'Fujikura':       'fujikura',
  'Mitsubishi':     'mitsubishi-golf',
  'Nippon':         'nippon-shaft',
  'Aldila':         'aldila',
  'Graphite Design':'graphite-design',
  'UST Mamiya':     'ust-mamiya',
  'KBS':            'kbs-golf',
  'PING':           'ping',
  'Accra':          'accra',
  'LA Golf':        'la-golf',
  'Aerotech':       'aerotech',
  'TPT Golf':       'tpt-golf',
  'Odyssey':        'odyssey-golf',
  'Aretera':        'aretera',
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

/** Format date string (YYYY-MM-DD) as "Month D, YYYY" — includes day for disambiguation */
function fmtDateWithDay(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** Format OWGR updated_at timestamp to "Mon DD, YYYY" */
function fmtOwgrDate(isoTs) {
  if (!isoTs) return null;
  const d = new Date(isoTs);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Count the number of individual irons represented by a loft_or_number string.
 * "5-PW" = 6 clubs, "3, 4" = 2 clubs, "5" = 1 club.
 * Used for most-clubs-per-brand iron category logic.
 */
function countIronsInSet(loftStr) {
  if (!loftStr) return 1;
  const s = loftStr.trim();
  // Numeric comparables for named clubs
  const named = {
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'PW': 10, 'AW': 10, 'GW': 10, 'UW': 11, 'SW': 12, 'LW': 13,
  };
  // Range notation: "5-PW", "4-9", "3-GW"
  const rangeM = s.match(/^(\d+|[A-Z]{2})-(\d+|[A-Z]{2})$/i);
  if (rangeM) {
    const a = named[rangeM[1].toUpperCase()] ?? parseInt(rangeM[1], 10);
    const b = named[rangeM[2].toUpperCase()] ?? parseInt(rangeM[2], 10);
    if (!isNaN(a) && !isNaN(b) && b >= a) return b - a + 1;
  }
  // List notation: "3, 4" or "3,4" -- count each number
  const nums = s.match(/\d+/g);
  if (nums && nums.length > 1) return nums.length;
  return 1;
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
      return raw.slice(brand.length + 1);
    }
  }
  return raw;
}

/**
 * Return HTML for shaft display.
 * Prefers witb_shafts.model (already contains brand), falls back to raw_shaft.
 * Deduplicates doubled leading brand token.
 * Links the brand portion using witb_shafts.dormied_brand_slug (DB column, primary)
 * or SHAFT_BRAND_LINKS (legacy fallback for raw_shaft strings not in DB).
 */
function shaftCell(item) {
  const shaft = item.witb_shafts;
  let raw = (shaft?.model || item.raw_shaft || '').trim();
  if (!raw || raw === '-') return '-';

  raw = dedupeShaft(raw);

  // Primary path: DB dormied_brand_slug is available -- use SHAFT_BRAND_LINKS for the
  // display brand name (full multi-word names like "True Temper", "LA Golf") and the
  // DB slug for the href. Falls back to brand_name token for brands not in the map.
  const dslug = shaft?.dormied_brand_slug || null;
  if (dslug) {
    for (const [brand] of Object.entries(SHAFT_BRAND_LINKS)) {
      if (raw === brand) {
        return `<a href="/brands/${dslug}/">${esc(brand)}</a>`;
      }
      if (raw.startsWith(brand + ' ')) {
        const rest = raw.slice(brand.length + 1);
        return `<a href="/brands/${dslug}/">${esc(brand)}</a> ${esc(rest)}`;
      }
    }
    // Brand not in SHAFT_BRAND_LINKS -- link the brand_name token (first word)
    const brandTok = shaft?.brand_name || null;
    if (brandTok && raw.startsWith(brandTok)) {
      const rest = raw.slice(brandTok.length).trimStart();
      return rest
        ? `<a href="/brands/${dslug}/">${esc(brandTok)}</a> ${esc(rest)}`
        : `<a href="/brands/${dslug}/">${esc(brandTok)}</a>`;
    }
  }

  // Legacy fallback: match full brand name against SHAFT_BRAND_LINKS (for raw_shaft strings)
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

/** Render brand logo + link. Exact-match-or-null only -- no fuzzy. */
function brandCell(rawBrand, dormiedSlug) {
  const name = esc(rawBrand || '');
  if (!dormiedSlug) {
    const mono = (rawBrand || '??').slice(0, 2).toUpperCase();
    return `<span class="witb-brand-monogram">${mono}</span><span>${name}</span>`;
  }
  const logo = `/images/logos/${dormiedSlug}.jpg`;
  const mono = (rawBrand || '??').slice(0, 2).toUpperCase();
  return `<img src="${logo}" alt="" class="witb-brand-logo" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"><span class="witb-brand-monogram" style="display:none">${mono}</span><a href="/brands/${dormiedSlug}/">${name}</a>`;
}

// ── Category icon ─────────────────────────────────────────────────────────────

/**
 * Category icon img tag.
 * filter: brightness(0)invert(1) converts any icon (dark-on-white SVG) to
 * white-on-transparent, suitable for DORMIED's dark background.
 */
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
  return `<img src="${src}" width="16" height="16" alt="" class="witb-cat-icon" style="filter:brightness(0)invert(1);opacity:.45;display:block;flex-shrink:0">`;
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

// ── Mobile bag card layout ────────────────────────────────────────────────────

/**
 * Build mobile card HTML for a list of bag items.
 * Shown below 641px; the desktop table is hidden at that breakpoint.
 */
function buildBagCards(items) {
  return items.map(item => {
    const dslug = item.witb_brands?.dormied_brand_slug || null;
    const loft  = item.loft_or_number || '';
    const sc    = shaftCell(item);
    const model = item.raw_model || '';

    return `<div class="witb-mobile-card">
  <div class="witb-mc-header">
    ${catIcon(item.club_type)}<span class="witb-mc-type">${esc(clubLabel(item.club_type))}</span>
  </div>
  <div class="witb-mc-brand witb-cell-flex">${brandCell(item.witb_brands?.name || item.raw_brand, dslug)}</div>
  <div class="witb-mc-model">${esc(model)}</div>
  ${loft ? `<div class="witb-mc-loft">${esc(loft)}</div>` : ''}
  ${sc !== '-' ? `<div class="witb-mc-shaft">${sc}</div>` : ''}
</div>`;
  }).join('\n');
}

// ── Bag history snapshots ─────────────────────────────────────────────────────

/**
 * Build the full-bag history section HTML.
 * Each snapshot is a <details> block (server-rendered, crawlable).
 * First/newest snapshot is open by default; older ones are collapsed.
 * Items use the same compact row format as the current bag but without
 * the mobile/desktop split (rows work at any width).
 */
function buildHistorySnapshots(bags) {
  // Exclude the current bag -- it is already shown in full in the Current Bag
  // section above. History shows only the non-current historical snapshots.
  const sorted = [...bags]
    .filter(b => !b.is_current)
    .sort((a, b) => b.bag_date.localeCompare(a.bag_date));

  // Count bags per YYYY-MM across ALL bags (including current) to detect collisions.
  // When two bags share a calendar month, show the full day to disambiguate.
  const monthCounts = {};
  bags.forEach(b => {
    const m = b.bag_date.slice(0, 7);
    monthCounts[m] = (monthCounts[m] || 0) + 1;
  });

  return sorted.map((bag, idx) => {
    const isOpen       = idx === 0;
    const hasConflict  = (monthCounts[bag.bag_date.slice(0, 7)] || 0) > 1;
    const label        = hasConflict ? fmtDateWithDay(bag.bag_date) : fmtDate(bag.bag_date);
    const tagHtml = bag.is_current
      ? ' <span class="witb-snap-tag">current</span>'
      : '';

    const itemRows = (bag._items || []).map(item => {
      const dslug = item.witb_brands?.dormied_brand_slug || null;
      const loft  = item.loft_or_number || '';
      const sc    = shaftCell(item);
      const specs = [
        loft ? esc(loft) : '',
        sc !== '-' ? sc : '',
      ].filter(Boolean).join(' &middot; ');

      return `<div class="witb-snap-item">
  <div class="witb-snap-item-type">${catIcon(item.club_type)}<span class="witb-snap-item-label">${esc(clubLabel(item.club_type))}</span></div>
  <div class="witb-snap-item-right">
    <div class="witb-snap-item-brand-model">
      <div class="witb-cell-flex witb-snap-brand-wrap">${brandCell(item.witb_brands?.name || item.raw_brand, dslug)}</div>
      <span class="witb-snap-item-model">${esc(item.raw_model || '')}</span>
    </div>
    ${specs ? `<div class="witb-snap-item-specs">${specs}</div>` : ''}
  </div>
</div>`;
    }).join('\n');

    return `<details class="witb-snapshot"${isOpen ? ' open' : ''}>
  <summary class="witb-snap-summary">
    <span class="witb-snap-date">${esc(label)}${tagHtml}</span>
    <span class="witb-snap-count">${(bag._items || []).length} clubs</span>
    <span class="witb-snap-chevron" aria-hidden="true"></span>
  </summary>
  <div class="witb-snap-body">${itemRows}</div>
</details>`;
  }).join('\n');
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

  // Derive a data-driven brand arc summary for the DATA CONSTRAINT hint
  const allBrands = new Set();
  const allBagsSorted = [...bags].sort((a, b) => a.bag_date.localeCompare(b.bag_date));
  allBagsSorted.forEach(b => {
    (b._items || []).filter(i => i.club_type === 'driver').forEach(i => {
      if (i.raw_brand) allBrands.add(i.raw_brand);
    });
  });
  const brandArc = allBrands.size > 0
    ? `Driver brands observed across snapshots (oldest to newest): ${[...allBrands].join(', ')}.`
    : 'No multi-brand driver arc in data.';

  const histCount = histBags.length;
  const hasHistory = histCount > 0;

  const prompt = `You are Travis, DORMIED's equipment desk. Generate two pieces of copy for the ${player.name} WITB player page.

DORMIED voice rules (non-negotiable):
- Dry, direct, insider. No em dashes anywhere. No exclamation points. No marketing language.
- No first-person. Observational third-person throughout.
- Do not assert precise switch dates the data does not support.
- Do not use hedging phrases like "it seems" or "appears to".
- No hyphens used as em dashes (do not write " - " as a pause; use commas or period breaks).
- Do NOT include the player's current OWGR rank number in the lede. The rank appears in the live page header and changes weekly -- naming it in the lede text will go stale. The bio should establish the player's career without citing a live ranking.

PLAYER: ${player.name}

CURRENT BAG (${currentBag.bag_date}):
${keyItems}

HISTORICAL BAGS (newest first, data-verified, ${histCount} snapshot${histCount !== 1 ? 's' : ''}):
${hasHistory ? histSummary : '(No historical snapshots -- only current bag is on record)'}

BRAND ARC NOTE (from data only): ${brandArc}

TASK 1 -- LEDE (130-180 words total):

Write one cohesive opening paragraph. It has two parts that should flow naturally together:

Part A -- Bio context (2-3 sentences): Establish who ${player.name} is for readers who need grounding. Use only accurate, verifiable facts about this specific player's career (majors won, notable achievements, tour affiliation). Do not invent or guess facts. State plainly without editorializing.

Part B -- Equipment narrative (continues from Part A): Narrate from the real snapshot data above. Observe what is notable about the current bag. What has been stable across snapshots? What changed? If there is a clear brand arc in the historical data, name it specifically. If the player has used one brand throughout, note that consistency. Start Part B by pivoting directly to equipment -- a specific detail, not a generic transition phrase.

TASK 2 -- HISTORY NARRATIVE (2-4 sentences):
${hasHistory
  ? `A concise prose summary of the equipment arc across the ${histCount + 1} bag snapshots (including current). Describe the brand changes and consistency patterns visible in the data. Accuracy to snapshots only -- no speculation beyond what the data shows.`
  : `A 1-2 sentence note that the current bag represents the only recorded snapshot in the database, and briefly describe what is notable about it.`
}

Return valid JSON only, no markdown fences:
{
  "lede": "...",
  "history_narrative": "..."
}`;

  const res = await anthropic.messages.create({
    model:      'claude-opus-4-7',
    max_tokens: 3000,
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
    .select('id, name, slug, owgr_rank, owgr_rank_updated_at, data_golf_rank, country_code, nation')
    .eq('slug', slug)
    .single();
  if (error) throw new Error(`Player not found (slug="${slug}"): ${error.message}`);
  return player;
}

/**
 * Build the full flag HTML for a player.
 * GB home nations (ENG, NIR, SCO, WAL) use SVG image assets at /images/flags/{code}.svg
 * to avoid unreliable subdivision emoji sequences.
 * All other countries use ISO 3166-1 alpha-2 regional-indicator emoji (🇺🇸, 🇪🇸, etc.).
 * Returns empty string if no valid code is available.
 */
function buildFlagHtml(countryCode, nation) {
  const HOME_NATIONS = {
    ENG: { file: 'eng', label: 'England' },
    NIR: { file: 'nir', label: 'Northern Ireland' },
    SCO: { file: 'sco', label: 'Scotland' },
    WAL: { file: 'wal', label: 'Wales' },
  };

  if (nation && HOME_NATIONS[nation]) {
    const { file, label } = HOME_NATIONS[nation];
    return `<span class="witb-player-flag" aria-label="${esc(label)} flag" style="line-height:1;display:inline-flex;align-items:center"><img src="/images/flags/${file}.svg" alt="${esc(label)} flag" width="20" height="12" style="display:inline-block;border-radius:1px;vertical-align:middle"></span>`;
  }

  if (countryCode && countryCode.length === 2) {
    const base = 0x1F1E6;
    const c1 = countryCode.charCodeAt(0) - 65;
    const c2 = countryCode.charCodeAt(1) - 65;
    if (c1 >= 0 && c1 <= 25 && c2 >= 0 && c2 <= 25) {
      const emoji = String.fromCodePoint(base + c1) + String.fromCodePoint(base + c2);
      return `<span class="witb-player-flag" aria-label="${esc(countryCode)} flag">${emoji}</span>`;
    }
  }

  return '';
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
        witb_shafts!shaft_id(slug, brand_name, model, dormied_brand_slug)
      `)
      .eq('bag_id', bag.id)
      .order('position');
    bag._items = items || [];
  }

  return bags;
}

/**
 * Returns the Set of player IDs for all players with a current bag and a world ranking.
 * This is the canonical denominator for tour comparison ("N of 158", not 160).
 */
async function fetchRankedPlayerIds(sb) {
  const { data: players } = await sb
    .from('witb_players')
    .select('id')
    .not('owgr_rank', 'is', null);
  return new Set((players || []).map(p => p.id));
}

/**
 * Fetches brand usage counts across current bags, restricted to ranked players.
 * Returns { data: result, rankedCount } where rankedCount is the size of rankedPlayerIds.
 */
async function fetchTourComparison(sb, rankedPlayerIds) {
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

    // Only count items from current bags belonging to ranked players
    const currentItems = (items || []).filter(i =>
      i.witb_bags?.is_current && rankedPlayerIds.has(i.witb_bags.player_id)
    );

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

  return { data: result, rankedCount: rankedPlayerIds.size };
}

// ── Tour comparison rows ──────────────────────────────────────────────────────

function buildComparisonRows(tourComp, playerBrandsByCategory) {
  const rows = [];
  const catConfig = [
    { cat: 'driver', label: 'Driver' },
    { cat: 'irons',  label: 'Irons' },
    { cat: 'putter', label: 'Putter' },
    { cat: 'ball',   label: 'Ball' },
  ];

  for (const { cat, label } of catConfig) {
    const all = tourComp[cat] || [];
    const playerBrand = playerBrandsByCategory[cat];
    if (!playerBrand) continue;

    const playerIdx   = all.findIndex(b => b.name === playerBrand.name);
    const playerEntry = playerIdx >= 0 ? all[playerIdx] : null;
    const playerCount = playerEntry?.count || 0;
    const playerRank  = playerIdx >= 0 ? playerIdx + 1 : null;
    const rank1 = all[0];

    rows.push({
      cat, label,
      playerBrand:       playerBrand.name,
      playerDormiedSlug: playerBrand.dormied_slug,
      playerCount,
      playerRank,
      rank1Name:         rank1?.name,
      rank1Count:        rank1?.count,
    });
  }

  return rows;
}

// ── HTML page builder ─────────────────────────────────────────────────────────

function buildPage({ player, bags, currentBag, currentItems, tourComp, rankedCount, ledes, today, latestFeedHtml }) {
  const { name, slug, owgr_rank, owgr_rank_updated_at, data_golf_rank, country_code, nation } = player;
  const owgrDate    = fmtOwgrDate(owgr_rank_updated_at);
  const currentDate = fmtDate(currentBag.bag_date);

  // ── Snapshot year range (Fix 1: compute from actual bag dates, not hardcoded) ──
  const bagYears = bags.map(b => parseInt(b.bag_date.slice(0, 4), 10)).filter(y => !isNaN(y));
  const minYear  = bagYears.length ? Math.min(...bagYears) : new Date().getFullYear();
  const maxYear  = bagYears.length ? Math.max(...bagYears) : new Date().getFullYear();
  const yearRange = minYear === maxYear ? String(minYear) : `${minYear}-${maxYear}`;

  // ── Nationality flag ───────────────────────────────────────────────────────
  const flagHtml = buildFlagHtml(country_code, nation);

  // ── OWGR rank line with official logo ─────────────────────────────────────
  // Logo is the official OWGR "WGR / Official World Golf Ranking" mark (PNG).
  // Do not restyle or recolor it (trademark).
  const owgrLogoHtml = `<a href="https://www.owgr.com" rel="noopener noreferrer" target="_blank" class="owgr-logo-link" aria-label="Official World Golf Ranking"><img src="/images/owgr-logo.png" alt="Official World Golf Ranking" class="owgr-logo" height="22"></a>`;

  const owgrLine = owgr_rank
    ? `${flagHtml}${owgrLogoHtml}<span class="witb-rank-num">#${owgr_rank}</span>${owgrDate ? `<span class="witb-rank-sep">&middot;</span><span class="witb-rank-updated">UPDATED ${owgrDate}</span>` : ''}${data_golf_rank ? `<span class="witb-rank-sep">&middot;</span>DG #${data_golf_rank}` : ''}`
    : `${flagHtml}${owgrLogoHtml}<span class="witb-rank-num">Unranked</span>${data_golf_rank ? `<span class="witb-rank-sep">&middot;</span>DG #${data_golf_rank}` : ''}`;

  // ── Player brands per category (for comparison) ───────────────────────────
  // Driver / putter / ball: first item wins (only one in a bag).
  // Irons: most physical clubs per brand wins; tiebreak to the set containing PW.
  const playerBrandsByCategory = {};
  for (const item of currentItems) {
    const cat = item.club_type === 'iron' ? 'irons' : item.club_type;
    if (['driver', 'putter', 'ball'].includes(cat) && !playerBrandsByCategory[cat]) {
      playerBrandsByCategory[cat] = {
        name:         item.witb_brands?.name || item.raw_brand,
        dormied_slug: item.witb_brands?.dormied_brand_slug || null,
      };
    }
  }

  // Iron brand: count physical clubs per brand via loft expansion (Fix 2)
  const ironsByBrand = {};
  for (const item of currentItems) {
    if (item.club_type !== 'iron') continue;
    const brandName = item.witb_brands?.name || item.raw_brand || 'Unknown';
    const dslug     = item.witb_brands?.dormied_brand_slug || null;
    const count     = countIronsInSet(item.loft_or_number);
    const hasPW     = /\bPW\b/i.test(item.loft_or_number || '');
    if (!ironsByBrand[brandName]) {
      ironsByBrand[brandName] = { name: brandName, dormied_slug: dslug, count: 0, hasPW: false };
    }
    ironsByBrand[brandName].count += count;
    ironsByBrand[brandName].hasPW  = ironsByBrand[brandName].hasPW || hasPW;
  }
  const ironWinner = Object.values(ironsByBrand)
    .sort((a, b) => b.count !== a.count ? b.count - a.count : (b.hasPW ? 1 : 0) - (a.hasPW ? 1 : 0))[0];
  if (ironWinner) {
    playerBrandsByCategory['irons'] = { name: ironWinner.name, dormied_slug: ironWinner.dormied_slug };
  }

  const compRows = buildComparisonRows(tourComp, playerBrandsByCategory);

  // ── SEO ───────────────────────────────────────────────────────────────────
  // Title and description are PER-PLAYER: composed from real bag data so no
  // two player pages share the same meta text. This is the uniqueness gate
  // that must hold before scaling to 160 players.
  const currentYear = new Date().getFullYear();
  const pageTitle   = `${esc(name)} WITB: What's In The Bag ${currentYear} | DORMIED`;

  // Build description from this player's actual bag items (unique per player)
  const _descDriver = currentItems.find(i => i.club_type === 'driver');
  const _descIrons  = currentItems.find(i => i.club_type === 'iron');
  const _descPutter = currentItems.find(i => i.club_type === 'putter');
  const _descBall   = currentItems.find(i => i.club_type === 'ball');
  const _descParts  = [
    _descDriver ? `${_descDriver.raw_brand} ${_descDriver.raw_model} driver` : null,
    _descIrons  ? `${_descIrons.raw_brand} ${_descIrons.raw_model} irons`   : null,
    _descPutter ? `${_descPutter.witb_brands?.name || _descPutter.raw_brand} putter` : null,
    _descBall   ? `${_descBall.raw_brand} ball`                              : null,
  ].filter(Boolean);
  const _descGear   = _descParts.length ? _descParts.join(', ') : 'full bag';
  const metaDesc    = `${name} WITB ${currentYear}: ${_descGear}. Full equipment breakdown and bag history across ${bags.length} snapshots.`;

  const canonicalUrl = `https://dormied.com/witb/players/${slug}/`;

  // ── Current bag: desktop table rows ──────────────────────────────────────
  const tableRows = currentItems.map(item => {
    const dslug = item.witb_brands?.dormied_brand_slug || null;
    const loft  = item.loft_or_number || '';
    const sc    = shaftCell(item);

    return `<tr>
      <td class="witb-bag-type-cell"><div class="witb-cell-flex">${catIcon(item.club_type)}<span>${esc(clubLabel(item.club_type))}</span></div></td>
      <td class="witb-bag-brand-cell"><div class="witb-cell-flex">${brandCell(item.witb_brands?.name || item.raw_brand, dslug)}</div></td>
      <td class="witb-bag-model-cell">${esc(item.raw_model || '')}</td>
      <td class="witb-bag-loft-cell">${esc(loft)}</td>
      <td class="witb-bag-shaft-cell">${sc}</td>
    </tr>`;
  }).join('\n');

  // ── Current bag: mobile cards ─────────────────────────────────────────────
  const mobileCards = buildBagCards(currentItems);

  // ── Tour comparison HTML ──────────────────────────────────────────────────
  const compHtml = compRows.map(row => {
    // Bar fill is proportional to ranked bag count, not relative to leader.
    // A tour leader at 58/158 fills ~37%, not 100%. This gives honest visual weight.
    const barPct   = Math.round(row.playerCount / rankedCount * 100);
    const isLeader = row.playerRank === 1;

    // Rank badge: TOUR LEADER for #1, Ranked #N for others
    const rankBadge = isLeader
      ? `<span class="witb-comp-leader">TOUR LEADER</span>`
      : row.playerRank
        ? `<span class="witb-comp-rank">Ranked #${row.playerRank}</span>`
        : '';

    // Context note: who leads (when player is not #1)
    const ctxNote = !isLeader && row.rank1Name
      ? `<span class="witb-comp-note">${esc(row.rank1Name)} leads (${row.rank1Count})</span>`
      : '';

    return `<div class="witb-comp-row">
  <div class="witb-comp-cat">${catIcon(row.cat)}<span>${esc(row.label)}</span></div>
  <div class="witb-comp-brand"><div class="witb-cell-flex">${brandCell(row.playerBrand, row.playerDormiedSlug)}</div></div>
  <div class="witb-comp-stat">
    <span class="witb-comp-count">${row.playerCount} of ${rankedCount}</span>
    <div class="witb-lb-bar-bg"><div class="witb-lb-bar-fill" style="width:${barPct}%"></div></div>
  </div>
  <div class="witb-comp-context">${rankBadge}${ctxNote ? `<span class="witb-comp-context-sep"></span>${ctxNote}` : ''}</div>
</div>`;
  }).join('\n');

  // ── History snapshots (full bag per snapshot, details/summary) ────────────
  const historySnapshotsHtml = buildHistorySnapshots(bags);

  // ── Word count for robots decision ────────────────────────────────────────
  const bagItemWords  = currentItems.reduce((s, i) => s + wordCount(`${i.raw_brand} ${i.raw_model} ${i.raw_shaft || ''} ${i.loft_or_number || ''}`), 0);
  const histItemWords = bags.reduce((s, b) => s + (b._items || []).reduce((s2, i) => s2 + wordCount(`${i.raw_brand} ${i.raw_model}`), 0), 0);
  const compWords     = compRows.reduce((s, r) => s + wordCount(`${r.label} ${r.playerBrand} ${r.playerCount} of ${rankedCount} ${r.rank1Name || ''}`), 0);
  const proseWords    = wordCount(ledes.lede)
                      + wordCount(ledes.history_narrative)
                      + compWords
                      + bagItemWords
                      + histItemWords;
  // Index gate: driver (or mini-driver) + at least one iron + putter.
  // Ball is intentionally excluded — it is frequently not logged for otherwise-complete bags.
  // Word-count floor is dropped: generated ledes satisfy it and it was silently
  // noindexing valid ranked pages when the lede cache hadn't been seeded yet.
  // Players that fail this gate get noindex, not deletion (empty stubs, not bad data).
  const hasDriver = currentItems.some(i => i.club_type === 'driver' || i.club_type === 'mini-driver');
  const hasIron   = currentItems.some(i => ['iron', 'utility-iron', 'driving-iron', 'utility'].includes(i.club_type));
  const hasPutter = currentItems.some(i => i.club_type === 'putter');
  const hasCore   = hasDriver && hasIron && hasPutter;
  const noindex   = !hasCore;
  if (noindex) warn(`Page for ${slug} will be noindex (driver=${hasDriver}, iron=${hasIron}, putter=${hasPutter})`);
  else         log(`Bag items: ${currentItems.length} — page is indexable (driver=${hasDriver}, iron=${hasIron}, putter=${hasPutter})`);

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
        '@type': 'Person',
        name:    name,
        url:     canonicalUrl,
        description: `${name} tour equipment bag, tracked across ${bags.length} snapshots by DORMIED.`,
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
    :root{--bg:#060b06;--bg-surface:#0c140c;--bg-raised:#111d11;--bg-hover:#162316;--bg-active:#1e311e;--border:#1a2e1a;--border-lite:#243824;--text:#e2f0de;--text-dim:#8aa88a;--text-muted:#6b8f6b;--green:#22c55e;--green-dim:#16a34a;--green-dark:#14532d;--green-glow:rgba(34,197,94,0.15);--red:#ef4444;--font-display:'Barlow Condensed',system-ui,sans-serif;--font-body:'Inter',system-ui,sans-serif;--font-mono:'JetBrains Mono','Courier New',monospace;--radius:6px;--radius-sm:4px;--content-max:1440px;--sidebar-w:180px;--gap:24px}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    [hidden]{display:none!important}
    html{font-size:16px;-webkit-font-smoothing:antialiased}
    body{background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:.9375rem;line-height:1.5;min-height:100vh}
    a{color:var(--green);text-decoration:none}
    a:hover{text-decoration:underline}
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
    /* Player page */
    .witb-player-eyebrow{font-family:var(--font-mono);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--green);margin-bottom:6px}
    .witb-player-title{font-family:var(--font-display);font-size:clamp(2rem,5vw,3.5rem);font-weight:700;font-style:italic;color:var(--text);text-transform:uppercase;letter-spacing:.02em;line-height:1.05;margin-bottom:8px}
    .witb-player-rank{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:var(--font-mono);font-size:.78rem;color:var(--text-muted);margin-bottom:6px}
    .witb-player-flag{font-size:1.2em;line-height:1;flex-shrink:0}
    .witb-rank-num{color:var(--green);font-weight:700;font-size:.9rem}
    .witb-rank-sep{color:var(--border-lite)}
    .witb-rank-updated{color:var(--text-muted)}
    .witb-player-underline{width:56px;height:3px;background:var(--green);margin:12px 0 0}
    .witb-player-lede{font-size:1rem;line-height:1.7;color:var(--text-dim)}
    .owgr-logo-link{display:inline-flex;align-items:center;opacity:.9;flex-shrink:0}
    .owgr-logo-link:hover{opacity:1;text-decoration:none}
    .owgr-logo{display:block;height:22px;width:auto}
  </style>

  <link rel="preload" href="/css/styles.min.css?v=20260523" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="/css/styles.min.css?v=20260523"></noscript>

  <!-- JSON-LD -->
  <script type="application/ld+json">
  ${jsonLd}
  </script>
  <!-- Grow.me -->
  <script data-grow-initializer="">!(function(){window.growMe||((window.growMe=function(e){window.growMe._.push(e);}),(window.growMe._=[]));var e=document.createElement("script");(e.type="text/javascript"),(e.src="https://faves.grow.me/main.js"),(e.defer=!0),e.setAttribute("data-grow-faves-site-id","U2l0ZTowNjk5NTY3Ny0xMzU0LTQ5M2YtOWEyYi03Y2NkOTlkNWE3YWQ=");var t=document.getElementsByTagName("script")[0];t.parentNode.insertBefore(e,t);})();</script>
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

    <!-- BREADCRUMB -- full width, above header band -->
    <nav class="breadcrumb container" aria-label="Breadcrumb">
      <a href="/" class="breadcrumb-link">Home</a>
      <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
      <a href="/witb/" class="breadcrumb-link">WITB</a>
      <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
      <a href="/witb/players/" class="breadcrumb-link">Players</a>
      <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
      <span class="breadcrumb-item--current" aria-current="page">${esc(name)}</span>
    </nav>

    <!-- FULL-WIDTH PLAYER HEADER BAND -->
    <section class="bp-header-section" aria-labelledby="player-title">
      <div class="container">
        <p class="witb-player-eyebrow">Tour Equipment</p>
        <h1 class="witb-player-title" id="player-title">${esc(name)}</h1>
        <p class="witb-player-rank">${owgrLine}</p>
        <div class="witb-player-underline" aria-hidden="true"></div>
      </div>
    </section>

    <!-- TWO-COLUMN LAYOUT: main content + sidebar -->
    <div class="container">
      <div class="table-layout">

        <!-- MAIN CONTENT COLUMN -->
        <div class="bp-sections-col">

          <!-- 1. LEDE -- full content width, no max-width cap -->
          <section class="witb-section" style="padding-top:24px;border-bottom:none" aria-label="Equipment overview">
            <p class="witb-player-lede">${esc(ledes.lede)}</p>
          </section>

          <!-- 2. CURRENT BAG -->
          <section class="witb-section" aria-labelledby="current-bag-heading">
            <h2 class="witb-section-title" id="current-bag-heading">Current Bag</h2>
            <p class="witb-section-sub">Snapshot: ${esc(currentDate)}</p>

            <!-- Desktop table (hidden on mobile) -->
            <div class="witb-bag-table-wrap">
              <table class="witb-player-bag-table">
                <colgroup>
                  <col class="witb-col-club">
                  <col class="witb-col-brand">
                  <col class="witb-col-model">
                  <col class="witb-col-loft">
                  <col class="witb-col-shaft">
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
                <tbody>
                  ${tableRows}
                </tbody>
              </table>
            </div>

            <!-- Mobile stacked cards (hidden on desktop) -->
            <div class="witb-bag-mobile-cards">
              ${mobileCards}
            </div>
          </section>

          <!-- 3. HOW THIS BAG COMPARES -->
          <section class="witb-section" aria-labelledby="compare-heading">
            <h2 class="witb-section-title" id="compare-heading">How This Bag Compares to the Tour</h2>
            <p class="witb-section-sub">Brand usage across ${rankedCount} current bags</p>
            <div class="witb-comp-grid">
              ${compHtml}
            </div>
            <p class="witb-footnote">Player counts reflect unique players carrying at least one item from that brand in the relevant category. Computed from current bags.</p>
          </section>

          <!-- 4. BAG HISTORY -->
          <section class="witb-section" aria-labelledby="history-heading">
            <h2 class="witb-section-title" id="history-heading">Bag History</h2>
            <p class="witb-section-sub">${bags.length} snapshots tracked, ${yearRange}</p>

            ${ledes.history_narrative ? `<div class="witb-hist-narrative">
              <p>${esc(ledes.history_narrative)}</p>
            </div>` : ''}

            <div class="witb-snapshots">
              ${historySnapshotsHtml}
            </div>

            <p class="witb-footnote">Data from <a href="https://www.pgaclubtracker.com" rel="noopener noreferrer" target="_blank">PGAClubTracker</a>. OWGR from <a href="https://www.owgr.com" rel="noopener noreferrer" target="_blank">owgr.com</a>, updated weekly. All data is DORMIED's independent editorial compilation.</p>
          </section>

        </div><!-- /bp-sections-col -->

        <!-- SIDEBAR: Latest only -->
        <aside class="sidebar-ad-col">
          <section class="home-stories-section latest-feed-section" aria-labelledby="player-latest-heading">
            <h2 class="latest-feed-heading" id="player-latest-heading">Latest</h2>
            <div id="dormied-latest-list" class="latest-feed-list">
              ${latestFeedHtml || '<p class="latest-feed-loading">Loading&hellip;</p>'}
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
  <script>
  (function(){
    var btn=document.getElementById('nav-hamburger'),panel=document.getElementById('mobile-nav-panel');
    if(!btn||!panel)return;
    function openNav(){btn.setAttribute('aria-expanded','true');panel.classList.add('open');panel.removeAttribute('hidden')}
    function closeNav(){btn.setAttribute('aria-expanded','false');panel.classList.remove('open');panel.setAttribute('hidden','')}
    btn.addEventListener('click',function(){btn.getAttribute('aria-expanded')==='true'?closeNav():openNav()});
    panel.querySelectorAll('a').forEach(function(a){a.addEventListener('click',closeNav)});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closeNav()});
    document.addEventListener('click',function(e){if(!btn.contains(e.target)&&!panel.contains(e.target))closeNav()});
  })();
  </script>

  <!-- Page-specific styles -->
  <style>
    /* ── Layout helpers ── */
    .witb-cell-flex{display:flex;align-items:center;gap:6px}

    /* ── Brand cells ── */
    .witb-brand-logo{width:20px;height:20px;object-fit:contain;border-radius:3px;display:block;flex-shrink:0}
    .witb-brand-monogram{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:var(--bg-raised);border:1px solid var(--border);border-radius:3px;font-family:var(--font-mono);font-size:.6rem;font-weight:700;color:var(--text-muted);flex-shrink:0}

    /* ── BAG TABLE (desktop) ── */
    /* table-layout:fixed + overflow:hidden on every td is what keeps columns
       from bleeding into each other. Long shaft strings wrap within the cell. */
    .witb-bag-table-wrap{overflow-x:auto}
    .witb-player-bag-table{width:100%;border-collapse:collapse;table-layout:fixed;min-width:960px;max-width:1120px}
    .witb-col-club {width:110px}
    .witb-col-brand{width:145px}
    .witb-col-model{width:auto}
    .witb-col-loft {width:175px}
    .witb-col-shaft{width:240px}
    .witb-bag-th{text-align:left;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:6px 12px 8px;white-space:nowrap}
    .witb-bag-thead-row{border-bottom:1px solid var(--border)}
    .witb-player-bag-table td{padding:8px 12px;border-bottom:1px solid var(--border-lite);vertical-align:top;font-size:.875rem;line-height:1.5;overflow:hidden}
    .witb-player-bag-table tr:hover td{background:var(--bg-hover)}
    .witb-bag-type-cell{color:var(--text-dim);white-space:nowrap;vertical-align:middle}
    .witb-bag-brand-cell{white-space:nowrap;overflow:hidden;vertical-align:middle}
    .witb-bag-model-cell{overflow:hidden;word-break:break-word;vertical-align:middle}
    .witb-bag-loft-cell{color:var(--text-muted);font-size:.8125rem;word-break:break-word;font-family:var(--font-mono);padding-right:14px}
    .witb-bag-shaft-cell{color:var(--text-muted);font-size:.8125rem;overflow:hidden;word-break:break-word}
    .witb-bag-shaft-cell a{color:var(--text-muted)}
    .witb-bag-shaft-cell a:hover{color:var(--green)}

    /* ── BAG MOBILE CARDS ── */
    .witb-bag-mobile-cards{display:none}
    @media(max-width:960px){
      .witb-bag-table-wrap{display:none}
      .witb-bag-mobile-cards{display:flex;flex-direction:column;gap:8px}
    }
    .witb-mobile-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px}
    .witb-mc-header{display:flex;align-items:center;gap:7px;margin-bottom:7px}
    .witb-mc-type{font-family:var(--font-mono);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-dim)}
    .witb-mc-brand{margin-bottom:4px}
    .witb-mc-model{font-size:.9375rem;color:var(--text);margin-bottom:3px}
    .witb-mc-loft{font-size:.8125rem;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:2px}
    .witb-mc-shaft{font-size:.8125rem;color:var(--text-muted)}
    .witb-mc-shaft a{color:var(--text-muted)}
    .witb-mc-shaft a:hover{color:var(--green)}

    /* ── COMPARISON ROWS (desktop: fixed 4-col grid; mobile: stacked) ── */
    .witb-comp-grid{display:flex;flex-direction:column;gap:8px}
    .witb-comp-row{display:grid;grid-template-columns:90px 170px 150px 1fr;gap:8px;align-items:center;padding:10px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius)}
    .witb-comp-cat{display:flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)}
    .witb-comp-brand{min-width:0;overflow:hidden}
    .witb-comp-stat{min-width:0}
    .witb-comp-count{font-family:var(--font-mono);font-size:.78rem;color:var(--text-dim);display:block;margin-bottom:4px}
    .witb-lb-bar-bg{background:var(--bg-raised);border-radius:2px;height:4px;overflow:hidden}
    .witb-lb-bar-fill{background:var(--green);height:100%;border-radius:2px}
    .witb-comp-leader{font-family:var(--font-mono);font-size:.65rem;color:var(--green);text-transform:uppercase;letter-spacing:.06em}
    .witb-comp-rank{font-family:var(--font-mono);font-size:.65rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em}
    .witb-comp-context-sep{display:block;height:3px}
    .witb-comp-note{font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted)}
    @media(max-width:640px){
      .witb-comp-row{display:block;padding:12px 14px}
      .witb-comp-cat{margin-bottom:6px}
      .witb-comp-brand{margin-bottom:8px;font-size:.9375rem}
      .witb-comp-stat{margin-bottom:6px}
    }

    /* ── BAG HISTORY SNAPSHOTS ── */
    .witb-hist-narrative{background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:16px;font-size:.9375rem;line-height:1.65;color:var(--text-dim)}
    .witb-snapshots{display:flex;flex-direction:column;gap:6px}
    .witb-snapshot{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--bg-surface)}
    .witb-snap-summary{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;list-style:none;user-select:none}
    .witb-snap-summary::-webkit-details-marker{display:none}
    .witb-snap-summary::marker{display:none}
    .witb-snap-summary:hover{background:var(--bg-hover)}
    .witb-snap-date{font-family:var(--font-mono);font-size:.78rem;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em;flex:1;display:flex;align-items:center;gap:8px}
    .witb-snap-tag{font-family:var(--font-mono);font-size:.65rem;color:var(--green);background:var(--green-dark);padding:2px 6px;border-radius:3px;letter-spacing:.06em;font-weight:700}
    .witb-snap-count{font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;flex-shrink:0}
    .witb-snap-chevron{flex-shrink:0;font-size:.55rem;color:var(--text-muted);width:14px;text-align:center}
    .witb-snap-chevron::before{content:'\\25BC'}
    .witb-snapshot[open] .witb-snap-chevron::before{content:'\\25B2'}
    .witb-snap-body{padding:4px 14px 12px;display:flex;flex-direction:column}
    .witb-snap-item{display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-lite)}
    .witb-snap-item:last-child{border-bottom:none}
    .witb-snap-item-type{display:flex;align-items:center;gap:5px;width:88px;flex-shrink:0;padding-top:2px}
    .witb-snap-item-label{font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
    .witb-snap-item-right{flex:1;min-width:0}
    .witb-snap-item-brand-model{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:2px}
    .witb-snap-brand-wrap{flex-shrink:0}
    .witb-snap-item-model{font-size:.875rem;color:var(--text-dim)}
    .witb-snap-item-specs{font-size:.75rem;color:var(--text-muted);font-family:var(--font-mono)}
    .witb-snap-item-specs a{color:var(--text-muted)}
    .witb-snap-item-specs a:hover{color:var(--green)}

    /* ── Misc ── */
    .witb-footnote{font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);margin-top:12px;text-transform:uppercase;letter-spacing:.05em}
    .witb-footnote a{color:var(--text-muted)}
    .witb-footnote a:hover{color:var(--green)}
  </style>

  <script defer src="/js/utils.min.js?v=20260318"></script>
  <script defer src="/js/feed.min.js?v=20260522"></script>
  <script defer src="/js/search.min.js?v=20260529"></script>
  <script>
  // Player page view tracking — fire-and-forget, mirrors brand_page_views
  (function(pid){
    var SB='https://cimmmmnapdthqvtifpzr.supabase.co';
    var KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpbW1tbW5hcGR0aHF2dGlmcHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NzE3NTksImV4cCI6MjA4OTM0Nzc1OX0.yejRXgvODw3bMr3oA9IiNA-MIZsHHkxmDZouJmEgDfI';
    fetch(SB+'/rest/v1/player_page_views',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','apikey':KEY,'Authorization':'Bearer '+KEY,'Prefer':'return=minimal'},body:JSON.stringify({player_id:pid})}).catch(function(){});
  })('${esc(player.id)}');
  </script>
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
  const url    = `/witb/players/${player.slug}/`;

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

  const player = await fetchPlayerData(sb, PLAYER_SLUG);
  log(`Player: ${player.name}, OWGR #${player.owgr_rank}`);

  // Guard: skip unranked players (owgr_rank IS NULL).
  // These players have no active world ranking and must not have pages on the site.
  // Tiger Woods and Ian Poulter use sentinel value 4990 — they are NOT null and are kept.
  if (player.owgr_rank === null) {
    warn(`Skipping ${player.name} (${PLAYER_SLUG}) — owgr_rank is null. If an HTML file exists, delete it manually.`);
    process.exit(0);
  }

  const bags = await fetchBagsWithItems(sb, player.id);
  const currentBag = bags.find(b => b.is_current);
  if (!currentBag) throw new Error(`No current bag found for ${PLAYER_SLUG}`);
  log(`Bags: ${bags.length} total, current: ${currentBag.bag_date}`);

  const currentItems = currentBag._items;
  log(`Current bag items: ${currentItems.length}`);

  log('Fetching ranked player IDs...');
  const rankedPlayerIds = await fetchRankedPlayerIds(sb);
  log(`Ranked players: ${rankedPlayerIds.size}`);

  log('Fetching tour comparison data...');
  const { data: tourComp, rankedCount } = await fetchTourComparison(sb, rankedPlayerIds);

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

  const dormiedData = loadDormiedData();
  let latestFeedHtml = null;
  try {
    const latestArticles = await feedBake.fetchLatestArticles(sb, 10, null);
    if (latestArticles.length) latestFeedHtml = feedBake.renderLatestFeedHtml(latestArticles, dormiedData);
  } catch (e) {
    console.warn('[witb-player-page] Feed bake failed:', e.message);
  }

  const html = buildPage({ player, bags, currentBag, currentItems, tourComp, rankedCount, ledes, today, latestFeedHtml });

  const noindex = html.includes('noindex');

  const outDir = path.join(ROOT, 'witb', 'players', PLAYER_SLUG);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');
  log(`Wrote: ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);

  updateSitemap(PLAYER_SLUG, today, noindex);
  updateSearchIndex(player, currentItems, noindex);

  log(`Done. Page: /witb/players/${PLAYER_SLUG}/`);
  if (!noindex) log('Page is indexable.');
  else          warn('Page has noindex (prose word count or missing core clubs).');

  // ── Fix 4: Unlinked brand report ──────────────────────────────────────────
  // List witb_brands that appear in the current bags of our 10 players but
  // have dormied_brand_slug=null while a /brands/{slug}/ page exists on site.
  const { data: allBrands } = await sb
    .from('witb_brands')
    .select('slug, name, dormied_brand_slug')
    .is('dormied_brand_slug', null);
  if (allBrands && allBrands.length > 0) {
    const brandsDir = path.join(ROOT, 'brands');
    const unlinked  = allBrands.filter(b => {
      try { fs.statSync(path.join(brandsDir, b.slug, 'index.html')); return true; }
      catch { return false; }
    });
    if (unlinked.length > 0) {
      warn('Brands with DORMIED page but no dormied_brand_slug in DB:');
      unlinked.forEach(b => warn(`  witb_brands.slug="${b.slug}" name="${b.name}" -- UPDATE witb_brands SET dormied_brand_slug='${b.slug}' WHERE slug='${b.slug}';`));
    } else {
      log('Unlinked brand check: all brands with /brands/ pages are wired up.');
    }
  }
}

main().catch(err => {
  console.error('[generate-player] Fatal:', err.message);
  process.exit(1);
});
