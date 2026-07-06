#!/usr/bin/env node
/**
 * generate-witb-page.js
 *
 * Generates /witb/index.html — the DORMIED WITB data hub.
 * All widget data is server-rendered (baked into HTML) so crawlers read it.
 * Interactive layers (scatter hover, etc.) load on top via witb.js.
 *
 * Usage: node scripts/generate-witb-page.js
 */

'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { createClient } = require('@supabase/supabase-js');
const feedBake = require('./feed-bake');

const ROOT   = path.resolve(__dirname, '..');
const OUT    = path.join(ROOT, 'witb', 'index.html');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_URL = process.env.SUPABASE_URL;

if (!SB_URL || !SB_KEY) { console.error('Missing SUPABASE env vars'); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY);

function loadDormiedData() {
  const raw = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return ctx.window.DORMIED_DATA;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Paginate a Supabase query builder that returns {data, error} */
async function paginate(queryFn, pageSize = 1000) {
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await queryFn(from, from + pageSize - 1);
    if (error) { console.error('Paginate error:', error.message); break; }
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    from += pageSize;
    if (data.length < pageSize) break;
  }
  return rows;
}

/** Format a number with commas */
function fmt(n) { return Number(n).toLocaleString('en-US'); }

/** Parse loft from raw string like "8 degrees", "9.5", "10.5 degrees" */
function parseLoft(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  const v = m ? parseFloat(m[1]) : null;
  return (v && v >= 6 && v <= 16) ? v : null;
}

/** Green color scale for prop bars (index-based) */
const GREEN_SHADES = [
  '#22c55e','#16a34a','#15803d','#166534','#14532d',
  '#4ade80','#86efac','#bbf7d0','#dcfce7','#f0fdf4',
];

/** Normalize truncated shaft brand names (ingestion artifact; fix at render time only) */
const SHAFT_BRAND_NORMALIZE = {
  'True':     'True Temper',
  'Graphite': 'Graphite Design',
  'UST':      'UST Mamiya',
  'LA':       'L.A. Golf',
};

/** Dormied brand slugs for named shaft brands — used for logos + links */
const SHAFT_SLUG_MAP = {
  'True Temper':     'true-temper',
  'Fujikura':        'fujikura',
  'Mitsubishi':      'mitsubishi-golf',
  'Nippon':          'nippon-shaft',
  'Aldila':          'aldila',
  'Graphite Design': 'graphite-design',
  'UST Mamiya':      'ust-mamiya',
  'KBS':             'kbs-golf',
};

/** Category icon paths — used in leaderboard titles and top-model rows */
const CAT_ICONS = {
  driver:  '/images/icons/driver_22px.svg',
  woods:   '/images/icons/fairway_wood_22px.svg',
  hybrids: '/images/icons/hybrid_22px.svg',
  irons:   '/images/icons/golf_iron_icon_22px.svg',
  wedges:  '/images/icons/wedge_22px.svg',
  putters: '/images/icons/putter_22px.svg',
  balls:   '/images/icons/ball.svg',
  grips:   '/images/icons/grip.svg',
  shafts:  '/images/icons/shaft.svg',
};

// ── Data fetching ──────────────────────────────────────────────────────────

async function fetchAllData() {
  console.log('Fetching WITB data from Supabase...');

  // 1. All current bag items with brand info
  const items = await paginate((from, to) =>
    sb.from('witb_bag_items')
      .select('club_type, raw_brand, raw_model, loft_or_number, brand_id, bag_id, witb_brands!brand_id(slug, name, dormied_brand_slug), witb_bags!bag_id(is_current, player_id)')
      .range(from, to)
  );
  const currentItems = items.filter(i => i.witb_bags?.is_current === true);
  console.log(`  Items: ${items.length} total, ${currentItems.length} current`);

  // 2. Players (include fields needed for Find A Player section)
  const players = await paginate((from, to) =>
    sb.from('witb_players').select('id, name, slug, owgr_rank, current_bag_id, country_code, nation').range(from, to)
  );
  const playerMap = new Map(players.map(p => [p.id, p]));
  console.log(`  Players: ${players.length}`);

  // 3. Brands
  const brands = await paginate((from, to) =>
    sb.from('witb_brands').select('id, slug, name, dormied_brand_slug').range(from, to)
  );
  console.log(`  Brands: ${brands.length}`);

  // 4. DI scores for April 2026
  const { data: diRows } = await sb.from('dormied_monthly_brand_summary')
    .select('brand_slug, global_rank, di_score, global_searches')
    .eq('snapshot_month', '2026-04-01');
  const diBySlug = new Map((diRows || []).map(d => [d.brand_slug, d]));
  console.log(`  DI rows (Apr 2026): ${diRows?.length}`);

  // 5. Recent bag changes (for Widget 3)
  const { data: changes, error: changesErr } = await sb.from('witb_changes')
    .select('player_id, club_type, change_type, old_value, new_value, detected_at')
    .order('detected_at', { ascending: false })
    .limit(15);
  if (changesErr) console.error('  witb_changes query error:', changesErr.message);
  console.log(`  Changes: ${changes?.length || 0}`);

  // 6. Latest crawl run timestamp
  const { data: crawlRuns } = await sb.from('witb_crawl_runs')
    .select('finished_at, status, players_scraped')
    .order('finished_at', { ascending: false })
    .limit(1);
  const lastCrawl = crawlRuns?.[0];

  // 7. Shaft items via witb_shafts join (for shafts leaderboard + top model)
  const shaftItemsRaw = await paginate((from, to) =>
    sb.from('witb_bag_items')
      .select('bag_id, shaft_id, witb_shafts!shaft_id(brand_name, model), witb_bags!bag_id(is_current)')
      .not('shaft_id', 'is', null)
      .range(from, to)
  );
  const shaftItems = shaftItemsRaw.filter(i => i.witb_bags?.is_current === true);
  console.log(`  Shaft items (current bags with shaft data): ${shaftItems.length}`);

  // 8. Current bag dates (for Find A Player section recent-bags list)
  const currentBagsRaw = await paginate((from, to) =>
    sb.from('witb_bags').select('id, bag_date').eq('is_current', true).range(from, to)
  );
  const bagDateMap = new Map(currentBagsRaw.map(b => [b.id, b.bag_date]));
  console.log(`  Current bags with dates: ${bagDateMap.size}`);

  return { currentItems, players, playerMap, brands, diBySlug, changes: changes || [], lastCrawl, shaftItems, bagDateMap };
}

// ── Widget computations ────────────────────────────────────────────────────

function computeWidgetData({ currentItems, playerMap, brands, diBySlug, shaftItems, totalPlayers }) {
  // totalPlayers is passed in from buildPage (count of ranked players with non-null OWGR)

  // Club type groups
  const CLUB_TYPES   = ['driver','3-wood','4-wood','5-wood','7-wood','9-wood','mini-driver','hybrid','utility','utility-iron','driving-iron','iron','wedge','putter'];
  const BALL_TYPES   = ['ball'];
  const GRIP_TYPES   = ['grip'];

  // --- Brand counts per player per category for tour share ---
  // We count unique players per brand (not item count) for usage %
  const brandPlayerSets = {}; // dormied_slug -> Set of player_ids (club items only)
  const ballPlayerSets  = {};
  const gripPlayerSets  = {};

  // Also raw brand counts for internal use
  const brandItemCounts = {}; // for treemap

  for (const item of currentItems) {
    const ct    = item.club_type;
    const dslug = item.witb_brands?.dormied_brand_slug || null;
    const bname = item.witb_brands?.name || item.raw_brand || 'Unknown';
    const pid   = item.witb_bags?.player_id;
    const bslug = item.witb_brands?.slug || bname;

    const isClub = CLUB_TYPES.includes(ct);
    const isBall = BALL_TYPES.includes(ct);
    const isGrip = GRIP_TYPES.includes(ct);

    if (isClub && dslug) {
      if (!brandPlayerSets[dslug]) brandPlayerSets[dslug] = { name: bname, players: new Set() };
      brandPlayerSets[dslug].players.add(pid);
    }
    if (isBall && dslug) {
      if (!ballPlayerSets[dslug]) ballPlayerSets[dslug] = { name: bname, players: new Set() };
      ballPlayerSets[dslug].players.add(pid);
    }
    if (isGrip) {
      if (!gripPlayerSets[bslug]) gripPlayerSets[bslug] = { name: bname, dormied_slug: dslug, players: new Set() };
      gripPlayerSets[bslug].players.add(pid);
    }

    // Item counts for prop bars
    if (!brandItemCounts[ct]) brandItemCounts[ct] = {};
    if (!brandItemCounts[ct][bslug]) brandItemCounts[ct][bslug] = { name: bname, dormied_slug: dslug, count: 0 };
    brandItemCounts[ct][bslug].count++;
  }

  // --- Scatter data: brand tour usage % + DI score ---
  const scatterData = [];
  for (const [dslug, { name, players }] of Object.entries(brandPlayerSets)) {
    const di = diBySlug.get(dslug);
    if (!di) continue;
    scatterData.push({
      slug: dslug,
      name,
      tourPct:  players.size / totalPlayers * 100,
      diScore:  parseFloat(di.di_score),
      diRank:   di.global_rank,
      playerCount: players.size,
    });
  }
  scatterData.sort((a, b) => b.tourPct - a.tourPct);

  // --- Brand leaderboards per category ---
  const LEADERBOARD_CATS = [
    { key: 'driver',    label: 'Drivers',       types: ['driver'] },
    { key: 'woods',     label: 'Fairway Woods',  types: ['3-wood','4-wood','5-wood','7-wood','9-wood','mini-driver'] },
    { key: 'hybrids',   label: 'Hybrids',        types: ['hybrid','utility','utility-iron','driving-iron'] },
    { key: 'irons',     label: 'Irons',          types: ['iron'] },
    { key: 'wedges',    label: 'Wedges',         types: ['wedge'] },
    { key: 'putters',   label: 'Putters',        types: ['putter'] },
    { key: 'balls',     label: 'Balls',          types: ['ball'] },
    { key: 'grips',    label: 'Grips',          types: ['grip'] },
    { key: 'shafts',   label: 'Shafts',         types: ['shaft'] },
  ];

  const leaderboards = LEADERBOARD_CATS.map(cat => {
    const brandCounts = {};
    for (const item of currentItems) {
      if (!cat.types.includes(item.club_type)) continue;
      const bname  = item.witb_brands?.name || item.raw_brand || 'Unknown';
      const bslug  = item.witb_brands?.slug || bname;
      const dslug  = item.witb_brands?.dormied_brand_slug || null;
      const pid    = item.witb_bags?.player_id;
      if (!brandCounts[bslug]) brandCounts[bslug] = { name: bname, dormied_slug: dslug, players: new Set() };
      brandCounts[bslug].players.add(pid);
    }
    const sorted = Object.values(brandCounts)
      .map(b => ({ ...b, count: b.players.size }))
      .sort((a, b) => b.count - a.count);
    const topCount = sorted[0]?.count || 1;
    return { ...cat, brands: sorted, topCount };
  });

  // --- Top model per category ---
  const MODEL_CATS = ['driver','3-wood','hybrid','iron','wedge','putter','ball','grip','shaft'];
  const topModels = {};
  for (const ct of MODEL_CATS) {
    const modelCounts = {};
    for (const item of currentItems) {
      if (item.club_type !== ct) continue;
      const model  = (item.raw_model || 'Unknown').trim();
      const bname  = item.witb_brands?.name || item.raw_brand || '';
      const dslug  = item.witb_brands?.dormied_brand_slug || null;
      const key    = `${bname}||${model}`;
      const pid    = item.witb_bags?.player_id;
      if (!modelCounts[key]) modelCounts[key] = { brand: bname, model, dormied_slug: dslug, players: new Set() };
      modelCounts[key].players.add(pid);
    }
    const sorted = Object.values(modelCounts)
      .map(m => ({ ...m, count: m.players.size }))
      .sort((a, b) => b.count - a.count);
    topModels[ct] = sorted[0] || null;
  }

  // --- Treemap data (proportional bars) ---
  function buildShareData(types) {
    const combined = {};
    for (const item of currentItems) {
      if (!types.includes(item.club_type)) continue;
      const bname = item.witb_brands?.name || item.raw_brand || 'Unknown';
      const bslug = item.witb_brands?.slug || bname;
      const dslug = item.witb_brands?.dormied_brand_slug || null;
      if (!combined[bslug]) combined[bslug] = { name: bname, dormied_slug: dslug, count: 0 };
      combined[bslug].count++;
    }
    const total = Object.values(combined).reduce((s, b) => s + b.count, 0) || 1;
    return Object.values(combined)
      .map(b => ({ ...b, pct: b.count / total * 100 }))
      .sort((a, b) => b.pct - a.pct);
  }

  const treemapClub  = buildShareData(CLUB_TYPES);
  const treemapBall  = buildShareData(BALL_TYPES);
  const treemapGrip  = buildShareData(GRIP_TYPES); // grips only (shafts in separate view below)

  // --- Did You Know ---
  const drivers = currentItems.filter(i => i.club_type === 'driver');
  const lofts   = drivers.map(d => parseLoft(d.loft_or_number)).filter(v => v !== null);
  const dyk = {};
  if (lofts.length >= 20) {
    dyk.avgLoft = (lofts.reduce((s, v) => s + v, 0) / lofts.length).toFixed(1);
    dyk.minLoft = Math.min(...lofts);
    dyk.loftCount = lofts.length;
  }

  // Use distinct bag_ids (5 players carry two 3-woods; row count overstates)
  const threeWoodCount   = new Set(currentItems.filter(i => i.club_type === '3-wood').map(i => i.bag_id)).size;
  const miniDriverCount  = new Set(currentItems.filter(i => i.club_type === 'mini-driver').map(i => i.bag_id)).size;
  dyk.threeWoodCount  = threeWoodCount;
  dyk.miniDriverCount = miniDriverCount;

  const highWoodPlayers = {};
  for (const item of currentItems) {
    if (!['7-wood','9-wood'].includes(item.club_type)) continue;
    const pid = item.witb_bags?.player_id;
    if (!highWoodPlayers[pid]) highWoodPlayers[pid] = [];
    highWoodPlayers[pid].push(item.club_type);
  }
  dyk.highWoodCount = Object.keys(highWoodPlayers).length;

  // --- Ball / grip player coverage (for denominator notes) ---
  const ballPlayerCount = new Set(
    currentItems.filter(i => i.club_type === 'ball' && i.witb_bags?.player_id)
      .map(i => i.witb_bags.player_id)
  ).size;
  const gripPlayerCount = new Set(
    currentItems.filter(i => i.club_type === 'grip' && i.witb_bags?.player_id)
      .map(i => i.witb_bags.player_id)
  ).size;

  // Annotate ball / grip leaderboards with denominator note
  const ballsLb = leaderboards.find(l => l.key === 'balls');
  if (ballsLb) ballsLb.denominatorNote = `${ballPlayerCount} of ${totalPlayers} players in dataset`;
  const gripsLb = leaderboards.find(l => l.key === 'grips');
  if (gripsLb) gripsLb.denominatorNote = `${gripPlayerCount} of ${totalPlayers} players in dataset`;

  // --- Top club brands by unique player count (for Brand Momentum table) ---
  const topClubBrands = Object.entries(brandPlayerSets)
    .map(([dslug, { name, players }]) => ({ name, dormied_slug: dslug, count: players.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // --- Gained / Lost (since first tracked — only current snapshot) ---
  // Since we ran --no-history, we only have one snapshot per player.
  // We'll note "since initial tracking" and show which brands appear most.
  // Widget 8 gracefully labels the window.
  const gainLoss = { window: 'initial tracking only', note: true };

  // --- Shaft leaderboard and top model (from witb_shafts join, not club_type) ---
  const shaftBrandBags = {};
  const shaftModelBags = {};
  for (const item of (shaftItems || [])) {
    const rawBrand = item.witb_shafts?.brand_name;
    const rawModel = item.witb_shafts?.model;
    if (!rawBrand || rawBrand.trim() === '') continue;
    const brand = SHAFT_BRAND_NORMALIZE[rawBrand.trim()] || rawBrand.trim();
    const bagId  = item.bag_id;
    if (!shaftBrandBags[brand]) shaftBrandBags[brand] = new Set();
    shaftBrandBags[brand].add(bagId);
    if (rawModel && rawModel.trim()) {
      const modelKey = `${brand}||${rawModel.trim()}`;
      if (!shaftModelBags[modelKey]) shaftModelBags[modelKey] = { brand, model: rawModel.trim(), bags: new Set() };
      shaftModelBags[modelKey].bags.add(bagId);
    }
  }
  const shaftLeaderboard = Object.entries(shaftBrandBags)
    .map(([name, bags]) => ({ name, dormied_slug: SHAFT_SLUG_MAP[name] || null, count: bags.size }))
    .sort((a, b) => b.count - a.count);
  const shaftTopCount = shaftLeaderboard[0]?.count || 1;

  // Shaft proportional share for Brand Tour Share widget (separate from grips)
  const shaftShareTotal = shaftLeaderboard.reduce((s, b) => s + b.count, 0) || 1;
  const treemapShaft = shaftLeaderboard.map(b => ({ ...b, pct: b.count / shaftShareTotal * 100 }));

  // Inject real shaft data into the leaderboards array in place of the empty stub
  const shaftLb = leaderboards.find(l => l.key === 'shafts');
  if (shaftLb) {
    shaftLb.brands   = shaftLeaderboard;
    shaftLb.topCount = shaftTopCount;
  }

  const topShaftModel = Object.values(shaftModelBags)
    .map(m => ({ ...m, count: m.bags.size }))
    .sort((a, b) => b.count - a.count)[0] || null;

  return { scatterData, leaderboards, topModels, treemapClub, treemapBall, treemapGrip, treemapShaft, dyk, gainLoss, totalPlayers, topShaftModel, topClubBrands };
}

// ── SVG Scatter Plot ───────────────────────────────────────────────────────

function buildScatterSVG(scatterData) {
  const W = 680, H = 420;
  const PAD = { top: 20, right: 20, bottom: 48, left: 52 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Scale
  const maxX = Math.ceil(Math.max(...scatterData.map(d => d.tourPct)) / 5) * 5 + 5;
  const maxY = Math.ceil(Math.max(...scatterData.map(d => d.diScore)) / 10) * 10 + 5;

  function xPx(v) { return PAD.left + (v / maxX) * plotW; }
  function yPx(v) { return PAD.top + plotH - (v / maxY) * plotH; }

  // Grid lines
  const xTicks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].filter(v => v <= maxX);
  const yTicks = [0, 20, 40, 60, 80, 100].filter(v => v <= maxY);

  let gridLines = '';
  xTicks.forEach(v => {
    const x = xPx(v);
    gridLines += `<line class="witb-scatter-grid" x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + plotH}"/>`;
    gridLines += `<text class="witb-scatter-axis-label" x="${x}" y="${PAD.top + plotH + 14}" text-anchor="middle">${v}%</text>`;
  });
  yTicks.forEach(v => {
    const y = yPx(v);
    gridLines += `<line class="witb-scatter-grid" x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}"/>`;
    gridLines += `<text class="witb-scatter-axis-label" x="${PAD.left - 6}" y="${y + 4}" text-anchor="end">${v}</text>`;
  });

  // Diagonal reference line (equal-proportion line)
  const diagX1 = xPx(0), diagY1 = yPx(0);
  const diagX2 = xPx(Math.min(maxX, maxY)), diagY2 = yPx(Math.min(maxX, maxY));
  const diagonal = `<line class="witb-scatter-diagonal" x1="${diagX1}" y1="${diagY1}" x2="${diagX2}" y2="${diagY2}"/>`;

  // Axis labels
  const axisLabels = `
    <text class="witb-scatter-axis-label" x="${PAD.left + plotW / 2}" y="${H - 4}" text-anchor="middle">Tour Usage (%)</text>
    <text class="witb-scatter-axis-label" x="10" y="${PAD.top + plotH / 2}" text-anchor="middle" transform="rotate(-90,10,${PAD.top + plotH / 2})">DI Score</text>
  `;

  // Dots + labels (encode data for JS tooltip)
  let dots = '';
  for (const d of scatterData) {
    const cx = xPx(d.tourPct);
    const cy = yPx(d.diScore);
    const r  = 5 + Math.sqrt(d.playerCount) * 0.8;
    dots += `<circle class="witb-scatter-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"
      data-slug="${esc(d.slug)}" data-name="${esc(d.name)}"
      data-tour="${d.tourPct.toFixed(1)}" data-di="${d.diScore.toFixed(1)}"
      data-rank="${d.diRank}" data-players="${d.playerCount}"
      aria-label="${esc(d.name)}: ${d.tourPct.toFixed(1)}% tour, DI ${d.diScore.toFixed(1)}"></circle>`;
    // Label all dots — data-slug binds each label to its dot for reliable show/hide
    const labelY = cy < PAD.top + 20 ? cy + 14 : cy - 8;
    dots += `<text class="witb-scatter-label" data-slug="${esc(d.slug)}" x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${esc(d.name)}</text>`;
  }

  return `<svg class="witb-scatter-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
    role="img" aria-label="Scatter plot: tour usage vs DORMIED Index score per brand">
    ${gridLines}${diagonal}${dots}${axisLabels}
  </svg>`;
}

// ── Proportional bar (treemap substitute) ─────────────────────────────────

function buildPropBar(shareData, limit = 8) {
  const shown = shareData.slice(0, limit);
  const other = shareData.slice(limit);
  const otherPct = other.reduce((s, b) => s + b.pct, 0);
  if (otherPct > 0.5) shown.push({ name: 'Other', dormied_slug: null, pct: otherPct });

  const segs = shown.map((b, i) => {
    const color = GREEN_SHADES[i % GREEN_SHADES.length];
    const w     = b.pct.toFixed(2);
    const inner = b.dormied_slug
      ? `<a href="/brands/${esc(b.dormied_slug)}/" title="${esc(b.name)} ${b.pct.toFixed(0)}%" style="font-family:var(--font-mono);font-size:.68rem">${b.pct >= 8 ? esc(b.name) : ''}</a>`
      : `<span title="${esc(b.name)} ${b.pct.toFixed(0)}%" style="font-family:var(--font-mono);font-size:.68rem">${b.pct >= 8 ? esc(b.name) : ''}</span>`;
    return `<div class="witb-prop-seg" style="width:${w}%;background:${color}">${inner}</div>`;
  }).join('');

  const legend = shown.map((b, i) => {
    const color = GREEN_SHADES[i % GREEN_SHADES.length];
    const nameHtml = b.dormied_slug
      ? `<a href="/brands/${esc(b.dormied_slug)}/" style="color:inherit">${esc(b.name)}</a>`
      : esc(b.name);
    return `<span class="witb-prop-legend-item">
      <span class="witb-prop-legend-dot" style="background:${color}"></span>
      ${nameHtml} <span style="color:var(--text-muted)">${b.pct.toFixed(0)}%</span>
    </span>`;
  }).join('');

  return `<div class="witb-prop-bar">${segs}</div><div class="witb-prop-legend">${legend}</div>`;
}

// ── Leaderboard HTML ───────────────────────────────────────────────────────

function buildLeaderboard(cat) {
  const iconPath = CAT_ICONS[cat.key];
  const iconHtml = iconPath
    ? `<span class="witb-cat-icon" aria-hidden="true"><img src="${iconPath}" width="16" height="16" alt=""></span>`
    : '';
  const rows = cat.brands.slice(0, 8).map((b, i) => {
    const pct  = (b.count / cat.topCount * 100).toFixed(0);
    const initials = esc(b.name.replace(/[^A-Za-z0-9]/g, '').substring(0, 2).toUpperCase());
    const logoHtml = b.dormied_slug
      ? `<img src="/images/logos/${esc(b.dormied_slug)}.jpg" alt="" class="witb-brand-logo" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'">`
        + `<span class="witb-brand-monogram" style="display:none">${initials}</span>`
      : `<span class="witb-brand-monogram">${initials}</span>`;
    const nameHtml = b.dormied_slug
      ? `${logoHtml}<a href="/brands/${esc(b.dormied_slug)}/">${esc(b.name)}</a>`
      : `${logoHtml}${esc(b.name)}`;
    return `<div class="witb-lb-row">
      <span class="witb-lb-rank">${i + 1}</span>
      <span class="witb-lb-name">${nameHtml}</span>
      <span class="witb-lb-count">${b.count}</span>
      <span class="witb-lb-bar-wrap">
        <div class="witb-lb-bar-bg"><div class="witb-lb-bar-fill" style="width:${pct}%"></div></div>
      </span>
    </div>`;
  }).join('');

  const noteHtml = cat.denominatorNote
    ? `<p style="font-family:var(--font-mono);font-size:.62rem;color:var(--text-muted);margin-top:6px;text-transform:uppercase;letter-spacing:.05em">${esc(cat.denominatorNote)}</p>`
    : '';
  return `<div class="witb-lb-section" id="${esc(cat.key)}">
    <div class="witb-lb-title">${iconHtml}${esc(cat.label)}</div>
    ${rows}${noteHtml}
  </div>`;
}

// ── Changes / Bag Moves HTML ───────────────────────────────────────────────

function buildChangesHtml(changes, brands, playerMap) {
  if (!changes || changes.length === 0) {
    return `<div class="witb-moves-empty">No bag changes recorded yet. Check back after Tuesday's update.</div>`;
  }

  // Brand name -> dormied slug, longest name first so multi-word brands match
  // before a shorter prefix. Values like "Callaway Quantum Triple Diamond" begin
  // with the brand name, so we link the leading brand token (exact match or none).
  const brandList = (brands || [])
    .filter(b => b.name && b.dormied_brand_slug)
    .map(b => ({ name: b.name, slug: b.dormied_brand_slug }))
    .sort((a, b) => b.name.length - a.name.length);

  const linkValue = (val) => {
    if (!val) return '';
    for (const b of brandList) {
      if (val === b.name || val.startsWith(b.name + ' ')) {
        return `<a href="/brands/${esc(b.slug)}/">${esc(b.name)}</a>${esc(val.slice(b.name.length))}`;
      }
    }
    return esc(val);
  };

  // Player slugs that have a generated WITB page, so we never link to a 404.
  let playerPages = new Set();
  try {
    playerPages = new Set(
      fs.readdirSync(path.join(ROOT, 'witb', 'players'), { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name)
    );
  } catch { /* players dir not built yet */ }

  return changes.map(c => {
    const p = playerMap?.get(c.player_id);
    const name = p?.name || 'Unknown player';
    const player = (p?.slug && playerPages.has(p.slug))
      ? `<a href="/witb/players/${esc(p.slug)}/">${esc(name)}</a>`
      : esc(name);
    const date = c.detected_at ? new Date(c.detected_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    let moveHtml;
    if (c.change_type === 'added') {
      moveHtml = `<span class="witb-move-tag witb-move-tag--added">Added</span>${linkValue(c.new_value)}`;
    } else if (c.change_type === 'removed') {
      moveHtml = `<span class="witb-move-tag witb-move-tag--removed">Removed</span>${linkValue(c.old_value)}`;
    } else {
      moveHtml = `${linkValue(c.old_value)} <span class="witb-move-arrow">&rarr;</span> ${linkValue(c.new_value)}`;
    }
    return `<div class="witb-lb-row">
      <span class="witb-move-player">${player}</span>
      <span class="witb-move-club">${esc(c.club_type)}</span>
      <span class="witb-move-detail">${moveHtml}</span>
      <span class="witb-move-date">${date}</span>
    </div>`;
  }).join('');
}

// ── Did You Know HTML ──────────────────────────────────────────────────────

function buildDykHtml(dyk) {
  const cards = [];

  if (dyk.avgLoft) {
    cards.push(`<div class="witb-dyk-card">
      <div class="witb-dyk-stat" style="color:var(--text)">${dyk.avgLoft}&deg;</div>
      <div class="witb-dyk-label">Avg Driver Loft</div>
      <div class="witb-dyk-detail">Across ${dyk.loftCount} drivers with parsed loft data</div>
    </div>`);
  }

  if (dyk.minLoft) {
    cards.push(`<div class="witb-dyk-card">
      <div class="witb-dyk-stat" style="color:var(--text)">${dyk.minLoft}&deg;</div>
      <div class="witb-dyk-label">Lowest Driver Loft</div>
      <div class="witb-dyk-detail">The flattest driver currently in play on tour</div>
    </div>`);
  }

  if (dyk.threeWoodCount !== undefined) {
    cards.push(`<div class="witb-dyk-card">
      <div class="witb-dyk-stat" style="color:var(--text)">${dyk.threeWoodCount} vs ${dyk.miniDriverCount}</div>
      <div class="witb-dyk-label">3-Wood vs Mini-Driver</div>
      <div class="witb-dyk-detail">${dyk.threeWoodCount} players carry a traditional 3-wood; ${dyk.miniDriverCount} carry a mini-driver</div>
    </div>`);
  }

  if (dyk.highWoodCount) {
    cards.push(`<div class="witb-dyk-card">
      <div class="witb-dyk-stat" style="color:var(--text)">${dyk.highWoodCount}</div>
      <div class="witb-dyk-label">Players with 7-Wood+</div>
      <div class="witb-dyk-detail">${dyk.highWoodCount} players carry a 7-wood or higher on tour this season</div>
    </div>`);
  }

  return cards.length > 0
    ? `<div class="witb-dyk-grid">${cards.join('')}</div>`
    : `<p style="color:var(--text-muted);font-size:.85rem">Not enough loft data to compute spec stats yet.</p>`;
}

// ── Find A Player section ──────────────────────────────────────────────────

function buildFlagHtmlInline(countryCode, nation) {
  const HOME = {
    ENG: { file: 'eng', label: 'England' },
    NIR: { file: 'nir', label: 'Northern Ireland' },
    SCO: { file: 'sco', label: 'Scotland' },
    WAL: { file: 'wal', label: 'Wales' },
  };
  if (nation && HOME[nation]) {
    const { file, label } = HOME[nation];
    return `<img src="/images/flags/${file}.svg" alt="${esc(label)}" width="14" height="9" style="display:inline-block;border-radius:1px;vertical-align:middle;flex-shrink:0">`;
  }
  if (countryCode && countryCode.length === 2) {
    const base = 0x1F1E6;
    const c1 = countryCode.charCodeAt(0) - 65;
    const c2 = countryCode.charCodeAt(1) - 65;
    if (c1 >= 0 && c1 <= 25 && c2 >= 0 && c2 <= 25) {
      return `<span aria-label="${esc(countryCode)} flag">${String.fromCodePoint(base + c1)}${String.fromCodePoint(base + c2)}</span>`;
    }
  }
  return '';
}

function fmtBagDateShort(isoDate) {
  if (!isoDate) return '';
  const d   = new Date(isoDate + 'T00:00:00Z');
  const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()];
  return `${mon} ${d.getUTCFullYear()}`;
}

function buildFindPlayerHtml(rankedPlayers, bagDateMap) {
  // Recent bags: 5 players with the most recent current bag_date
  const withDate = rankedPlayers.filter(p => p.current_bag_id && bagDateMap.has(p.current_bag_id));
  const recentBags = [...withDate]
    .sort((a, b) => (bagDateMap.get(b.current_bag_id) || '').localeCompare(bagDateMap.get(a.current_bag_id) || ''))
    .slice(0, 5);

  // Top ranked: 5 lowest OWGR (ascending)
  const topRanked = [...rankedPlayers]
    .sort((a, b) => a.owgr_rank - b.owgr_rank)
    .slice(0, 5);

  function playerRow(p, showDate) {
    const flag    = buildFlagHtmlInline(p.country_code, p.nation);
    const rankStr = `#${p.owgr_rank}`;
    const dateStr = showDate ? fmtBagDateShort(bagDateMap.get(p.current_bag_id)) : '';
    return `<a href="/witb/players/${esc(p.slug)}/" class="witb-fp-row">
        <span class="witb-fp-flag">${flag}</span>
        <span class="witb-fp-name">${esc(p.name)}</span>
        <span class="witb-fp-rank">${esc(rankStr)}</span>
        ${dateStr ? `<span class="witb-fp-date">${esc(dateStr)}</span>` : ''}
      </a>`;
  }

  const recentHtml = recentBags.map(p => playerRow(p, true)).join('');
  const topHtml    = topRanked.map(p => playerRow(p, false)).join('');

  return `<section class="witb-section witb-find-player" aria-labelledby="find-player-heading">
  <div class="witb-fp-header">
    <h2 class="witb-section-title" id="find-player-heading">Find a Player</h2>
    <a href="/witb/players/" class="btn btn--cta btn--mono">Browse All Players &rarr;</a>
  </div>
  <div class="witb-fp-grid">
    <div class="witb-fp-col">
      <div class="witb-fp-col-label">Recent Bags</div>
      ${recentHtml}
    </div>
    <div class="witb-fp-col">
      <div class="witb-fp-col-label">Top Ranked</div>
      ${topHtml}
    </div>
  </div>
</section>`;
}

// ── Full page HTML ─────────────────────────────────────────────────────────

function buildPage({ currentItems, players, playerMap, brands, diBySlug, changes, lastCrawl, shaftItems, bagDateMap, latestFeedHtml, topStoriesHtml, modsHtml }) {
  // Canonical set: players with a non-null OWGR rank (158 today; sentinel 4990 included)
  const rankedPlayers      = players.filter(p => p.owgr_rank !== null);
  const rankedBagIds       = new Set(rankedPlayers.map(p => p.current_bag_id).filter(Boolean));
  const rankedCurrentItems = currentItems.filter(i => rankedBagIds.has(i.bag_id));
  const rankedShaftItems   = shaftItems.filter(i => rankedBagIds.has(i.bag_id));

  // All stats derived from the canonical set so every figure reconciles
  const totalPlayers    = rankedPlayers.length;
  const totalItems      = rankedCurrentItems.length;
  // Canonical brand set: brands appearing in at least one ranked current bag item
  const brandSlugsInRankedBags = new Set(
    rankedCurrentItems.filter(i => i.witb_brands?.slug).map(i => i.witb_brands.slug)
  );
  const totalBrands = brandSlugsInRankedBags.size;
  // For methodology: how many of the represented brands lack a DI mapping
  const brandsNoDI = brands.filter(b => brandSlugsInRankedBags.has(b.slug) && !b.dormied_brand_slug).length;
  const uniqueClubTypes = new Set(rankedCurrentItems.map(i => i.club_type)).size;

  const {
    scatterData, leaderboards, topModels, treemapClub, treemapBall, treemapGrip, treemapShaft,
    dyk, gainLoss, topShaftModel, topClubBrands
  } = computeWidgetData({ currentItems: rankedCurrentItems, playerMap, brands, diBySlug, shaftItems: rankedShaftItems, totalPlayers });

  const scatterSVG     = buildScatterSVG(scatterData);
  const changesHtml    = buildChangesHtml(changes, brands, playerMap);
  const leaderboardsHtml = leaderboards.map(buildLeaderboard).join('\n');
  const dykHtml        = buildDykHtml(dyk);

  const dateModified = lastCrawl?.finished_at
    ? new Date(lastCrawl.finished_at).toISOString()
    : new Date().toISOString();

  // Human-readable last-updated date for pulse strip (1A)
  const lastUpdatedDisplay = lastCrawl?.finished_at
    ? new Date(lastCrawl.finished_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  // Top models table
  const MODEL_LABELS = {
    driver:   'Drivers',
    '3-wood': 'Fairway Woods',
    hybrid:   'Hybrids',
    iron:     'Irons',
    wedge:    'Wedges',
    putter:   'Putters',
    ball:     'Balls',
    grip:     'Grips',
    shaft:    'Shafts',
  };
  // Maps club_type key -> CAT_ICONS key
  const MODEL_ICON_KEY = {
    driver:   'driver',
    '3-wood': 'woods',
    hybrid:   'hybrids',
    iron:     'irons',
    wedge:    'wedges',
    putter:   'putters',
    ball:     'balls',
    grip:     'grips',
    shaft:    'shafts',
  };
  function modelCatIcon(ct) {
    const iconKey  = MODEL_ICON_KEY[ct];
    const iconPath = iconKey ? CAT_ICONS[iconKey] : null;
    if (!iconPath) return '';
    const sz = (ct === 'iron') ? 16 : 14;
    return `<span class="witb-cat-icon" aria-hidden="true"><img src="${iconPath}" width="${sz}" height="${sz}" alt=""></span>`;
  }
  const topModelsHtml = Object.entries(topModels)
    .filter(([ct, m]) => m && ct !== 'shaft')
    .map(([ct, m]) => {
      const initials  = esc((m.brand || '').replace(/[^A-Za-z0-9]/g, '').substring(0, 2).toUpperCase());
      const logoHtml  = m.dormied_slug
        ? `<img src="/images/logos/${esc(m.dormied_slug)}.jpg" alt="" class="witb-brand-logo" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"><span class="witb-brand-monogram" style="display:none">${initials}</span>`
        : `<span class="witb-brand-monogram">${initials}</span>`;
      // Concatenate brand + model inside the link text to avoid CSS flex whitespace-stripping
      const brandModel = `${(m.brand || '').trim()} ${(m.model || '').trim()}`.trim();
      const brandHtml = m.dormied_slug
        ? `${logoHtml}<a href="/brands/${esc(m.dormied_slug)}/">${esc(brandModel)}</a>`
        : `${logoHtml}${esc(brandModel)}`;
      return `<div class="witb-lb-row">
      <span class="witb-lb-name" style="color:var(--text-muted);min-width:90px;max-width:90px;font-size:.75rem;font-family:var(--font-mono);text-transform:uppercase">${modelCatIcon(ct)}${esc(MODEL_LABELS[ct] || ct)}</span>
      <span class="witb-lb-name">${brandHtml}</span>
      <span class="witb-lb-count">${m.count}</span>
    </div>`;
    }).join('');

  // Shaft row in top-model table — populated from witb_shafts join.
  // Many shaft model strings already include the brand name (e.g. "True Temper Dynamic Gold…"),
  // so skip the brand prefix if the model string already starts with it.
  const shaftModelRowHtml = topShaftModel
    ? (() => {
        const modelStr  = topShaftModel.model;
        const brandStr  = topShaftModel.brand;
        const dslug     = SHAFT_SLUG_MAP[brandStr] || null;
        const display   = modelStr.toLowerCase().startsWith(brandStr.toLowerCase())
          ? modelStr
          : `${brandStr} ${modelStr}`;
        const initials  = (brandStr || '').replace(/[^A-Za-z0-9]/g, '').substring(0, 2).toUpperCase();
        const logoHtml  = dslug
          ? `<img src="/images/logos/${esc(dslug)}.jpg" alt="" class="witb-brand-logo" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"><span class="witb-brand-monogram" style="display:none">${esc(initials)}</span>`
          : `<span class="witb-brand-monogram">${esc(initials)}</span>`;
        const shaftModelBrandHtml = dslug
          ? `${logoHtml}<a href="/brands/${esc(dslug)}/">${esc(display)}</a>`
          : `${logoHtml}${esc(display)}`;
        return `<div class="witb-lb-row">
      <span class="witb-lb-name" style="color:var(--text-muted);min-width:90px;max-width:90px;font-size:.75rem;font-family:var(--font-mono);text-transform:uppercase">${modelCatIcon('shaft')}Shafts</span>
      <span class="witb-lb-name">${shaftModelBrandHtml}</span>
      <span class="witb-lb-count">${topShaftModel.count}</span>
    </div>`;
      })()
    : '';

  // Scatter JSON for JS tooltip
  const scatterJSON = JSON.stringify(scatterData.map(d => ({
    slug: d.slug, name: d.name,
    tourPct: parseFloat(d.tourPct.toFixed(1)),
    diScore: parseFloat(d.diScore.toFixed(1)),
    diRank: d.diRank, playerCount: d.playerCount,
  })));

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

  <title>What's In The Bag - Tour Equipment Data | DORMIED</title>
  <meta name="description" content="What the tour actually plays and how it lines up with what the rest of golf pays attention to. DORMIED WITB tracks ${totalPlayers} tour players across ${totalBrands} brands.">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" href="https://dormied.com/witb/">

  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="apple-touch-icon" href="/images/dormied-icon.png">

  <meta property="og:type" content="website">
  <meta property="og:url" content="https://dormied.com/witb/">
  <meta property="og:title" content="What's In The Bag - Tour Equipment Data | DORMIED">
  <meta property="og:description" content="What the tour actually plays vs. what the rest of golf pays attention to. ${totalPlayers} players, ${totalBrands} brands, updated weekly.">
  <meta property="og:image" content="https://dormied.com/images/og-image.jpg">
  <meta property="og:site_name" content="DORMIED">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@DORMIED_GOLF">
  <meta name="twitter:title" content="What's In The Bag - Tour Equipment Data | DORMIED">
  <meta name="twitter:description" content="What the tour actually plays vs. what the rest of golf pays attention to.">
  <meta name="twitter:image" content="https://dormied.com/images/og-image.jpg">

  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
  <link rel="preconnect" href="https://cimmmmnapdthqvtifpzr.supabase.co" crossorigin>

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
    /* Scatter brand filter */
    .witb-scatter-layout{display:grid;grid-template-columns:1fr 2fr;gap:16px;align-items:start}
    @media(max-width:640px){.witb-scatter-layout{grid-template-columns:1fr}}
    .witb-scatter-filter{margin-bottom:0}
    .witb-scatter-filter-bar{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
    .witb-scatter-search{background:var(--bg-surface);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 8px;font-family:var(--font-mono);font-size:.7rem;min-width:0;width:100%;outline:none}
    .witb-scatter-search::placeholder{color:var(--text-muted)}
    .witb-scatter-search:focus{border-color:var(--green)}
    .witb-scatter-btn{background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:4px;padding:4px 10px;font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.05em;cursor:pointer}
    .witb-scatter-btn:hover{border-color:var(--green);color:var(--green)}
    .witb-scatter-checkboxes{display:flex;flex-wrap:wrap;gap:8px 20px}
    .witb-scatter-cb-label{display:inline-flex;align-items:center;gap:4px;font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);cursor:pointer;white-space:nowrap}
    .witb-scatter-cb-label input[type=checkbox]{accent-color:var(--green);cursor:pointer;width:11px;height:11px}
    /* Find A Player section */
    .witb-find-player{background:var(--bg-raised);border:1px solid var(--green-dim);border-radius:var(--radius);padding:16px 14px 12px}
    .witb-fp-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px}
    .witb-fp-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    @media(max-width:500px){.witb-fp-grid{grid-template-columns:1fr}}
    .witb-fp-col-label{font-family:var(--font-mono);font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);padding-bottom:6px;border-bottom:1px solid var(--border);margin-bottom:4px}
    .witb-fp-row{display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--border);text-decoration:none;color:var(--text);transition:color .1s}
    .witb-fp-row:last-child{border-bottom:none}
    .witb-fp-row:hover{color:var(--green)}
    .witb-fp-flag{font-size:.85em;line-height:1;flex-shrink:0;min-width:18px}
    .witb-fp-name{font-family:var(--font-mono);font-size:.75rem;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .witb-fp-rank{font-family:var(--font-mono);font-size:.65rem;color:var(--green);flex-shrink:0}
    .witb-fp-date{font-family:var(--font-mono);font-size:.6rem;color:var(--text-muted);flex-shrink:0}
  </style>

  <link rel="preload" href="/css/styles.min.css?v=20260707" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="/css/styles.min.css?v=20260707"></noscript>

  <!-- JSON-LD: Dataset -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "name": "DORMIED WITB - Tour Equipment Data",
    "description": "What ${totalPlayers} PGA Tour players carry in their bags, updated weekly. Covers ${totalBrands} brands across drivers, irons, wedges, putters, balls, and grips.",
    "url": "https://dormied.com/witb/",
    "dateModified": "${dateModified}",
    "creator": {
      "@type": "Organization",
      "name": "DORMIED",
      "url": "https://dormied.com"
    },
    "publisher": {
      "@type": "Organization",
      "name": "DORMIED",
      "url": "https://dormied.com"
    },
    "license": "https://dormied.com/terms/",
    "includedInDataCatalog": {
      "@type": "DataCatalog",
      "name": "DORMIED Index"
    }
  }
  </script>
  <!-- Grow.me -->
  <script data-grow-initializer="">!(function(){window.growMe||((window.growMe=function(e){window.growMe._.push(e);}),(window.growMe._=[]));var e=document.createElement("script");(e.type="text/javascript"),(e.src="https://faves.grow.me/main.js"),(e.defer=!0),e.setAttribute("data-grow-faves-site-id","U2l0ZTowNjk5NTY3Ny0xMzU0LTQ5M2YtOWEyYi03Y2NkOTlkNWE3YWQ=");var t=document.getElementsByTagName("script")[0];t.parentNode.insertBefore(e,t);})();</script>
  <!-- Mediavine Journey ads -->
  <script type="text/javascript" async="async" data-noptimize="1" data-cfasync="false" src="//scripts.scriptwrapper.com/tags/06995677-1354-493f-9a2b-7ccd99d5a7ad.js"></script>
</head>
<body>
  <!-- GTM noscript -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>

  <!-- ══ HEADER ═══════════════════════════════════════════════════════════════ -->
  <header class="site-header" role="banner">
    <div class="container header-inner">
      <a href="/" class="site-logo" aria-label="DORMIED home">
        <img src="/images/dormied-logo-colour.png" alt="DORMIED" class="logo-img" width="140" height="32"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="logo-text-fallback" style="display:none">DORMIED</span>
      </a>

      <!-- Desktop nav -->
      <nav class="site-nav" aria-label="Main navigation">
        <a href="/rankings/"  class="site-nav-link">Index</a>
        <a href="/witb/"      class="site-nav-link site-nav-link--active">WITB</a>
        <a href="/scorecard/" class="site-nav-link">Scorecard</a>
        <a href="/news/"      class="site-nav-link">News</a>
        <a href="/brands/"    class="site-nav-link">Brands</a>
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

      <!-- Search -->
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

    <!-- Mobile nav panel -->
    <nav class="mobile-nav-panel" id="mobile-nav-panel" aria-label="Mobile navigation" hidden>
      <a href="/rankings/"  class="mobile-nav-link">Index</a>
      <a href="/witb/"      class="mobile-nav-link active">WITB</a>
      <a href="/scorecard/" class="mobile-nav-link">Scorecard</a>
      <a href="/news/"      class="mobile-nav-link">News</a>
      <a href="/brands/"    class="mobile-nav-link">Brands</a>
    </nav>
  </header>

  <!-- ══ MAIN ═════════════════════════════════════════════════════════════════ -->
  <main>
    <section class="hero-section" aria-labelledby="witb-page-title">
      <div class="container">
        <div class="hero-content">
          <div class="hero-text">
            <h1 id="witb-page-title" class="hero-title">What's In The Bag</h1>
            <p class="hero-subhead">Tour Equipment Data</p>
            <p class="hero-desc">What the tour actually plays, and how it lines up with what the amateur game is paying attention to.</p>
          </div>
        </div>
      </div>
    </section>

    <div class="witb-layout">
      <!-- ── LEFT / MAIN COLUMN ─────────────────────────────────────────── -->
      <div class="witb-main">

        <!-- WIDGET 1: TOUR PULSE STRIP -->
        <div class="witb-pulse" aria-label="WITB summary stats">
          <span><span class="witb-pulse-val">${fmt(totalPlayers)}</span> players tracked</span>
          <span class="witb-pulse-sep">&middot;</span>
          <span><span class="witb-pulse-val">${fmt(totalItems)}</span> items logged</span>
          <span class="witb-pulse-sep">&middot;</span>
          <span><span class="witb-pulse-val">${fmt(totalBrands)}</span> brands represented</span>
          <span class="witb-pulse-sep">&middot;</span>
          <span><span class="witb-pulse-val">${fmt(uniqueClubTypes)}</span> club categories</span>
          ${lastUpdatedDisplay ? `<span class="witb-pulse-sep">&middot;</span><span>Updated <span class="witb-pulse-val">${esc(lastUpdatedDisplay)}</span></span>` : ''}
        </div>

        <!-- FIND A PLAYER -->
        ${buildFindPlayerHtml(rankedPlayers, bagDateMap)}

        <!-- WIDGET 2: TOUR USAGE vs AMATEUR ATTENTION (signature) -->
        <section class="witb-section" aria-labelledby="scatter-heading">
          <h2 class="witb-section-title" id="scatter-heading">Tour Usage vs. Amateur Attention</h2>
          <p class="witb-section-sub">April 2026 tour usage vs. April 2026 DORMIED Index score. Same month, same brands, measured two ways.</p>
          <div class="witb-scatter-layout">
            <div class="witb-scatter-filter" id="scatter-filter" aria-label="Filter brands on chart">
              <div class="witb-scatter-filter-bar">
                <input type="search" id="scatter-brand-search" class="witb-scatter-search" placeholder="Search brands&hellip;" autocomplete="off" aria-label="Search brands">
                <button type="button" class="witb-scatter-btn" id="scatter-select-all">Select all</button>
                <button type="button" class="witb-scatter-btn" id="scatter-clear-all">Clear all</button>
              </div>
              <div class="witb-scatter-checkboxes" id="scatter-checkboxes" role="group" aria-label="Brand checkboxes"></div>
            </div>
            <div class="witb-scatter-wrap">
              <div class="witb-scatter-frame">
                <div class="witb-scatter-ytitle" aria-hidden="true">DI Score</div>
                <div class="witb-scatter-inner">${scatterSVG}</div>
              </div>
            </div>
          </div>
          <p style="font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);margin-top:8px;text-transform:uppercase;letter-spacing:.05em">
            Brands above the dashed line are pro favorites the amateur game underrates. Below: more attention than tour usage. Dot size = player count. Click any dot to view brand page.
          </p>
        </section>

        <!-- WIDGET 3: BAG MOVES -->
        <section class="witb-section" aria-labelledby="moves-heading">
          <h2 class="witb-section-title" id="moves-heading">This Week's Bag Moves</h2>
          <p class="witb-section-sub">Equipment changes detected on the most recent update</p>
          ${changesHtml}
        </section>

        <!-- WIDGET 4 + 5: LEADERBOARDS + TOP MODELS -->
        <section class="witb-section" aria-labelledby="lb-heading">
          <h2 class="witb-section-title" id="lb-heading">Most-Used Brand by Category</h2>
          <p class="witb-section-sub">Player count across current bags</p>
          <div class="witb-lb-grid">
            ${leaderboardsHtml}
          </div>
        </section>

        <section class="witb-section" aria-labelledby="model-heading">
          <h2 class="witb-section-title" id="model-heading">Top Model Per Category</h2>
          <p class="witb-section-sub">Most-played specific model across all tracked players</p>
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px">
            ${topModelsHtml}${shaftModelRowHtml}
          </div>
        </section>

        <!-- WIDGET 6: BRAND TOUR SHARE -->
        <section class="witb-section" aria-labelledby="share-heading">
          <h2 class="witb-section-title" id="share-heading">Brand Tour Share</h2>
          <p class="witb-section-sub">Proportional share of bag slots by brand</p>

          <div class="witb-treemap-group">
            <div class="witb-treemap-title">Clubs (drivers, woods, hybrids, irons, wedges, putters)</div>
            ${buildPropBar(treemapClub)}
          </div>
          <div class="witb-treemap-group">
            <div class="witb-treemap-title">Balls</div>
            ${buildPropBar(treemapBall)}
          </div>
          <div class="witb-treemap-group">
            <div class="witb-treemap-title">Grips</div>
            ${buildPropBar(treemapGrip)}
          </div>
          <div class="witb-treemap-group">
            <div class="witb-treemap-title">Shafts</div>
            ${buildPropBar(treemapShaft)}
          </div>
        </section>

        <!-- WIDGET 7: DID YOU KNOW -->
        <section class="witb-section" aria-labelledby="dyk-heading">
          <h2 class="witb-section-title" id="dyk-heading">Spec Notes</h2>
          <p class="witb-section-sub">Computed from current bag data</p>
          ${dykHtml}
        </section>

        <!-- WIDGET 8: BRAND MOMENTUM -->
        ${(() => {
          // Momentum change computation.
          // Each column = (brand player count this period) - (count N weeks ago).
          // Historical player counts: Map<dormied_slug, count> | null.
          // null = no snapshot for that window yet -> show "-" placeholder.
          // W/W  available after 2nd weekly crawl
          // M/M  available after ~4 weekly crawls
          // 3M   available after ~13 weekly crawls
          const momentumHistory = {
            ww:     null, // Map<dormied_slug, playerCount> | null
            mm:     null,
            threeM: null,
          };

          // Returns inner HTML for a .witb-lb-count cell
          function fmtMom(current, priorMap) {
            if (!priorMap) return '-';
            const prior = priorMap.get(current.dormied_slug) ?? 0;
            const delta = current.count - prior;
            const sign  = delta > 0 ? '+' : '';
            const color = delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : '';
            return color
              ? `<span style="color:${color};font-weight:600">${sign}${delta}</span>`
              : `${sign}${delta}`;
          }

          const colHdr = (label) =>
            `<span class="witb-lb-count" style="font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)">${label}</span>`;

          const brandRows = topClubBrands.map((b, i) => {
            const initials = (b.name || '').replace(/[^A-Za-z0-9]/g, '').substring(0, 2).toUpperCase();
            const logoHtml = b.dormied_slug
              ? `<img src="/images/logos/${esc(b.dormied_slug)}.jpg" alt="" class="witb-brand-logo" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"><span class="witb-brand-monogram" style="display:none">${esc(initials)}</span>`
              : `<span class="witb-brand-monogram">${esc(initials)}</span>`;
            const nameHtml = b.dormied_slug
              ? `${logoHtml}<a href="/brands/${esc(b.dormied_slug)}/">${esc(b.name)}</a>`
              : `${logoHtml}${esc(b.name)}`;
            return `<div class="witb-lb-row">
              <span class="witb-lb-rank">${i + 1}</span>
              <span class="witb-lb-name">${nameHtml}</span>
              <span class="witb-lb-count">${fmtMom(b, momentumHistory.ww)}</span>
              <span class="witb-lb-count">${fmtMom(b, momentumHistory.mm)}</span>
              <span class="witb-lb-count">${fmtMom(b, momentumHistory.threeM)}</span>
            </div>`;
          }).join('');

          return `<section class="witb-section" aria-labelledby="momentum-heading">
          <h2 class="witb-section-title" id="momentum-heading">Brand Momentum</h2>
          <p class="witb-section-sub">Tour usage changes</p>
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px">
            <div class="witb-lb-row" style="padding-bottom:4px;border-bottom:1px solid var(--border-lite);margin-bottom:2px">
              <span class="witb-lb-rank" style="visibility:hidden" aria-hidden="true">0</span>
              <span class="witb-lb-name" style="font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)">Brand</span>
              ${colHdr('W/W')}${colHdr('M/M')}${colHdr('3M')}
            </div>
            ${brandRows}
            <p style="font-family:var(--font-mono);font-size:.62rem;color:var(--text-muted);margin-top:10px;text-transform:uppercase;letter-spacing:.05em">Change in players carrying brand across all categories. Builds as weekly snapshots accumulate.</p>
          </div>
        </section>`;
        })()}

        <!-- WIDGET 9: METHODOLOGY -->
        <section class="witb-section" aria-labelledby="method-heading">
          <h2 class="witb-section-title" id="method-heading">Methodology</h2>
          <div class="witb-methodology">
            <h2>What This Data Is</h2>
            <p>The DORMIED WITB dataset tracks the current equipment setup of ${totalPlayers} professional golfers, pulling current bag data on a weekly basis. Each player's bag is recorded at the item level: driver, fairway woods, hybrids, irons, wedges, putter, ball, and grips. Brand, model, shaft, and loft are captured where available. The dataset covers ${totalBrands} distinct equipment brands and is refreshed every Tuesday at 9am ET.</p>

            <p>This is equipment-in-play data, not equipment-sold data. A brand appearing here means a tour-level professional has chosen it in competition - which is a meaningfully different signal than market share, retail velocity, or endorsement deals. Some of the most tour-popular brands barely register in amateur golfers' awareness. That gap is the most interesting thing this page exists to show.</p>

            <h2>Reading the Tour Usage vs. Amateur Attention Chart</h2>
            <p>The signature chart plots two independent signals against each other. The X axis is tour usage share: what percentage of the ${totalPlayers} tracked players carry at least one product from that brand in their bag. The Y axis is the DORMIED Index (DI) score for that brand in April 2026, which measures global search interest relative to the highest-scoring brand in the Index that month. Both axes use the same time period.</p>

            <p>The dashed diagonal is a reference line, not a regression. Brands sitting above the line are pro favorites the amateur game has not yet matched with search attention - either because the brand does not market aggressively, serves a niche the mainstream has not discovered, or benefits from tour contracts that do not translate to retail awareness. Brands sitting below the line command more amateur attention than their tour presence suggests - often large heritage brands with strong retail and marketing footprints even when pros have shifted toward competitors.</p>

            <h2>How the Tour-Usage-to-DI Join Works</h2>
            <p>The WITB brand database maps each equipment brand to its corresponding entry in the <a href="/rankings/">DORMIED Index</a>. Not every tour brand has a DORMIED Index entry - particularly grip companies and shaft manufacturers that do not compete in the retail consumer markets tracked by the Index. Brands without a mapping appear in the leaderboards and share views but are excluded from the scatter chart, which requires both a tour usage figure and a DI score to plot. As of this writing, ${brandsNoDI} of ${totalBrands} tracked equipment brands represented in ranked bags lack a DI mapping; those brands render as plain text throughout this page rather than as hyperlinks to brand pages.</p>

            <p>The DORMIED Index measures consumer search interest, not brand sentiment or purchase intent. A high DI score means many people are searching for a brand globally. A low score means the brand is either niche, regional, or simply not a household name outside the sport. For equipment brands especially, the gap between tour presence and public awareness can be dramatic - and that gap tells you something about where the market might be heading, or where it is already moving without the mainstream noticing yet.</p>

            <p>Data source: equipment data from <a href="https://www.pgaclubtracker.com" rel="noopener noreferrer" target="_blank">PGAClubTracker.com</a>. Consumer search data: <a href="/rankings/">DORMIED Index</a>, April 2026 snapshot. All analysis is DORMIED's independent editorial work.</p>
          </div>
        </section>

      </div><!-- /witb-main -->

      <!-- ── RIGHT SIDEBAR ──────────────────────────────────────────────── -->
      <aside class="witb-sidebar sidebar-ad-col">
        <section class="home-stories-section latest-feed-section" aria-labelledby="witb-stories-heading">
          <h2 class="latest-feed-heading" id="witb-stories-heading">Top Stories</h2>
          <div id="home-stories-list" class="latest-feed-list">
            ${topStoriesHtml || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
          </div>
        </section>
        ${modsHtml || ''}
        <section class="home-stories-section latest-feed-section" aria-labelledby="witb-latest-heading">
          <h2 class="latest-feed-heading" id="witb-latest-heading">Latest</h2>
          <div id="dormied-latest-list" class="latest-feed-list">
            ${latestFeedHtml || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
          </div>
        </section>
      </aside>

    </div><!-- /witb-layout -->
  </main>

  <!-- ══ FOOTER ════════════════════════════════════════════════════════════════ -->
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

  <!-- ══ SCRIPTS ═══════════════════════════════════════════════════════════════ -->
  <script>document.getElementById('footer-year').textContent = new Date().getFullYear();</script>

  <!-- Scatter data for JS tooltip layer -->
  <script>window.__WITB_SCATTER__ = ${scatterJSON};</script>

  <!-- Mobile nav hamburger -->
  <script>
  (function(){
    var btn   = document.getElementById('nav-hamburger');
    var panel = document.getElementById('mobile-nav-panel');
    if (!btn || !panel) return;

    function openNav() {
      btn.setAttribute('aria-expanded', 'true');
      panel.classList.add('open');
      panel.removeAttribute('hidden');
    }
    function closeNav() {
      btn.setAttribute('aria-expanded', 'false');
      panel.classList.remove('open');
      panel.setAttribute('hidden', '');
    }

    btn.addEventListener('click', function() {
      btn.getAttribute('aria-expanded') === 'true' ? closeNav() : openNav();
    });

    // Close on link tap
    panel.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('click', closeNav);
    });

    // Close on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeNav();
    });

    // Close on tap outside
    document.addEventListener('click', function(e) {
      if (!btn.contains(e.target) && !panel.contains(e.target)) closeNav();
    });
  })();
  </script>

  <!-- Scatter tooltip JS -->
  <script>
  (function(){
    var tooltip = document.createElement('div');
    tooltip.className = 'witb-scatter-tooltip';
    document.body.appendChild(tooltip);

    var activeDot = null;

    function buildTooltipHTML(dot, withLink) {
      var name     = dot.dataset.name;
      var slug     = dot.dataset.slug;
      var tour     = dot.dataset.tour;
      var di       = dot.dataset.di;
      var rank     = dot.dataset.rank;
      var players  = dot.dataset.players;
      var gap      = (parseFloat(di) - parseFloat(tour)).toFixed(1);
      var gapLabel = gap > 0 ? 'Underrated by amateurs (+' + gap + ')' : gap < 0 ? 'Over-indexed (' + gap + ')' : 'Balanced';
      var html =
        '<strong>' + name + '</strong><br>' +
        'Tour: ' + tour + '% (' + players + ' players)<br>' +
        'DI score: ' + di + ' (#' + rank + ')<br>' +
        '<span style="color:var(--text-muted)">' + gapLabel + '</span>';
      if (withLink) {
        html += '<a href="/brands/' + slug + '/" class="witb-tt-link">View brand page →</a>';
      }
      return html;
    }

    function posTooltipXY(x, y) {
      if (x + 240 > window.innerWidth) x = x - 240;
      if (x < 8) x = 8;
      tooltip.style.left = x + 'px';
      tooltip.style.top  = y + 'px';
    }

    function posTooltip(e) {
      posTooltipXY(e.clientX + 14, e.clientY - 10);
    }

    function dismissTooltip() {
      tooltip.classList.remove('visible', 'interactive');
      activeDot = null;
    }

    var isTouch = false;

    document.querySelectorAll('.witb-scatter-dot').forEach(function(dot) {
      // Desktop: hover
      dot.addEventListener('mouseenter', function(e) {
        if (isTouch) return;
        tooltip.innerHTML = buildTooltipHTML(dot, false);
        tooltip.classList.add('visible');
        tooltip.classList.remove('interactive');
        posTooltip(e);
      });
      dot.addEventListener('mousemove', function(e) {
        if (isTouch) return;
        posTooltip(e);
      });
      dot.addEventListener('mouseleave', function() {
        if (isTouch) return;
        tooltip.classList.remove('visible', 'interactive');
      });

      // Touch: first tap = show tooltip; second tap on same dot = navigate
      dot.addEventListener('touchstart', function(e) {
        isTouch = true;
        if (activeDot === dot) {
          // second tap - navigate
          window.location = '/brands/' + dot.dataset.slug + '/';
          return;
        }
        e.preventDefault();
        activeDot = dot;
        var rect = dot.getBoundingClientRect();
        tooltip.innerHTML = buildTooltipHTML(dot, true);
        tooltip.classList.add('visible', 'interactive');
        posTooltipXY(rect.left + rect.width / 2 + 14, rect.top - 10);
      }, { passive: false });

      // Desktop click (no touch): navigate
      dot.addEventListener('click', function(e) {
        if (isTouch) return;
        window.location = '/brands/' + dot.dataset.slug + '/';
      });
    });

    // Tap outside dots dismisses tooltip on touch
    document.addEventListener('touchstart', function(e) {
      if (activeDot && !e.target.closest('.witb-scatter-dot') && !e.target.closest('.witb-scatter-tooltip')) {
        dismissTooltip();
      }
    }, { passive: true });
  })();
  </script>

  <!-- Brand filter for scatter chart -->
  <script>
  (function(){
    var svg = document.querySelector('.witb-scatter-svg');
    var container = document.getElementById('scatter-checkboxes');
    if (!svg || !container) return;

    // Build brand list from SVG circles
    var circles = Array.from(svg.querySelectorAll('.witb-scatter-dot'));
    var brands = circles.map(function(c){ return {slug: c.dataset.slug, name: c.dataset.name}; });

    // Sort alphabetically by brand name
    brands.sort(function(a,b){ return a.name.localeCompare(b.name); });

    // Render checkboxes (all checked by default)
    brands.forEach(function(b){
      var lbl = document.createElement('label');
      lbl.className = 'witb-scatter-cb-label';
      lbl.setAttribute('data-name', b.name.toLowerCase());
      lbl.innerHTML = '<input type="checkbox" class="witb-scatter-cb" value="' + b.slug + '" checked> ' + b.name;
      container.appendChild(lbl);
    });

    // Toggle chart dots + labels based on checked state
    // Labels are matched by data-slug (robust - avoids floating-point cx matching)
    function updateChart(){
      var checked = {};
      document.querySelectorAll('.witb-scatter-cb:checked').forEach(function(cb){ checked[cb.value] = true; });
      circles.forEach(function(circle){
        var vis = !!checked[circle.dataset.slug];
        circle.style.display = vis ? '' : 'none';
      });
      svg.querySelectorAll('text.witb-scatter-label[data-slug]').forEach(function(txt){
        var vis = !!checked[txt.dataset.slug];
        txt.style.display = vis ? '' : 'none';
      });
    }

    // Checkbox changes
    container.addEventListener('change', updateChart);

    // Select all / Clear all
    document.getElementById('scatter-select-all').addEventListener('click', function(){
      document.querySelectorAll('.witb-scatter-cb').forEach(function(cb){ cb.checked = true; });
      updateChart();
    });
    document.getElementById('scatter-clear-all').addEventListener('click', function(){
      document.querySelectorAll('.witb-scatter-cb').forEach(function(cb){ cb.checked = false; });
      updateChart();
    });

    // Search filters checkbox labels (not chart dots)
    document.getElementById('scatter-brand-search').addEventListener('input', function(){
      var q = this.value.toLowerCase().trim();
      document.querySelectorAll('.witb-scatter-cb-label').forEach(function(lbl){
        lbl.style.display = (q === '' || lbl.getAttribute('data-name').indexOf(q) !== -1) ? '' : 'none';
      });
    });
  })();
  </script>

  <script defer src="/js/utils.min.js?v=20260318"></script>
  <script defer src="/js/data.min.js?v=20260615"></script>
  <script defer src="/js/feed.min.js?v=20260706"></script>
  <script defer src="/js/search.min.js?v=20260529"></script>
</body>
</html>`;
}

// ── WITB Leaders Data ──────────────────────────────────────────────────────
// Writes js/witb-leaders.js so the homepage can render WITB LEADERS and
// Most Viewed WITBs fallback without client-side Supabase aggregation.

function writeWitbLeadersData({ players, currentItems }) {
  const rankedPlayers = players.filter(p => p.owgr_rank !== null);
  const rankedBagIds  = new Set(rankedPlayers.map(p => p.current_bag_id).filter(Boolean));
  const rankedCurrentItems = currentItems.filter(i => rankedBagIds.has(i.bag_id));

  // Full ranked set sorted by OWGR — used for Most Viewed WITBs in-memory lookup.
  // Includes only the fields the card needs; no second anon-key Supabase fetch required.
  const allPlayersSorted = [...rankedPlayers]
    .sort((a, b) => a.owgr_rank - b.owgr_rank)
    .map(p => ({
      id:           p.id,
      name:         p.name,
      slug:         p.slug,
      owgr_rank:    p.owgr_rank,
      country_code: p.country_code || null,
      nation:       p.nation       || null,
    }));

  // Top 5 for the WITB LEADERS sidebar column
  const topPlayers = allPlayersSorted.slice(0, 5);

  // Helper: compute top 5 models for a given club type
  function topModelsFor(clubType) {
    const items = rankedCurrentItems.filter(i => i.club_type === clubType);
    const counts = {};
    for (const item of items) {
      const brand       = (item.witb_brands?.name || item.raw_brand || '').trim();
      const model       = (item.raw_model || '').trim();
      const dormiedSlug = item.witb_brands?.dormied_brand_slug || null;
      if (!brand) continue;
      const key = `${brand}|||${model}`;
      if (!counts[key]) counts[key] = { brand, model, dormiedSlug, count: 0 };
      counts[key].count++;
    }
    return Object.values(counts)
      .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand))
      .slice(0, 5);
  }

  const topDrivers = topModelsFor('driver');
  const topPutters = topModelsFor('putter');

  const payload = {
    generated_at: new Date().toISOString(),
    topPlayers,                      // top 5 for WITB LEADERS column
    allPlayers:   allPlayersSorted,  // ALL ranked players for Most Viewed WITBs in-memory lookup
    topDrivers,
    topPutters,
  };

  const outPath = path.join(path.dirname(OUT), '..', 'js', 'witb-leaders.js');
  fs.writeFileSync(outPath, `// witb-leaders.js — Pre-computed WITB leader data. Auto-generated by generate-witb-page.js.\nwindow.DORMIED_WITB_LEADERS=${JSON.stringify(payload)};`, 'utf8');
  console.log(`\nWrote: js/witb-leaders.js (${allPlayersSorted.length} allPlayers, ${topPlayers.length} topPlayers, ${topDrivers.length} drivers, ${topPutters.length} putters)`);
}

// ── Run ────────────────────────────────────────────────────────────────────

async function main() {
  const dormiedData = loadDormiedData();
  const data = await fetchAllData();

  let latestFeedHtml = null;
  let topStoriesHtml = null;
  let modsHtml = '';
  try {
    const [latestArticles, topStoriesArticles, modsRes] = await Promise.all([
      feedBake.fetchLatestArticles(sb, 10, null),
      feedBake.fetchTopStoriesArticles(sb, dormiedData, 10),
      feedBake.fetchSidebarModulesHtml(sb, dormiedData),
    ]);
    latestFeedHtml = latestArticles.length  ? feedBake.renderLatestFeedHtml(latestArticles,    dormiedData) : null;
    topStoriesHtml = topStoriesArticles.length ? feedBake.renderLatestFeedHtml(topStoriesArticles, dormiedData) : null;
    modsHtml = modsRes || '';
  } catch (e) {
    console.warn('[witb-page] Feed bake failed:', e.message);
  }

  console.log('\nBuilding page HTML...');
  const html = buildPage({ ...data, latestFeedHtml, topStoriesHtml, modsHtml });
  writeWitbLeadersData(data);

  // Ensure /witb directory exists
  const dir = path.dirname(OUT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(OUT, html, 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`\nWritten: ${OUT} (${kb} KB)`);

  // Quick validation — exclude baked feed sections from em-dash check since article
  // titles sourced from the DB may legitimately contain em dashes.
  const htmlNoFeed = html
    .replace(/(<div id="home-stories-list"[^>]*>)[\s\S]*?(<\/div>\s*<\/section>)/, '$1$2')
    .replace(/(<div id="dormied-latest-list"[^>]*>)[\s\S]*?(<\/div>\s*<\/section>)/, '$1$2');
  const checks = [
    ['Titleist in HTML',    html.includes('Titleist')],
    ['TaylorMade in HTML',  html.includes('TaylorMade')],
    ['No em dash',         !htmlNoFeed.includes('—')],
    ['No shaft placeholder',!html.includes('next update')],
    ['Scatter SVG',         html.includes('witb-scatter-svg')],
    ['Leaderboard anchor',  html.includes('id="driver"')],
    ['Shafts leaderboard',  html.includes('id="shafts"')],
    ['Grips leaderboard',   html.includes('id="grips"')],
    ['Scatter filter',      html.includes('scatter-brand-search')],
    ['pgaclubtracker',      html.includes('pgaclubtracker')],
    ['dormied-latest-list', html.includes('dormied-latest-list')],
    ['home-stories-list',   html.includes('home-stories-list')],
    ['Hamburger btn',       html.includes('nav-hamburger')],
  ];
  console.log('\nValidation:');
  let pass = true;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}`);
    if (!ok) pass = false;
  }
  if (!pass) process.exit(1);
  console.log('\nDone.');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
