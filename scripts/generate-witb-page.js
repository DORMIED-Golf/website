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

const { dataVersion } = require('./lib/data-version');
const { cssVersion } = require('./lib/css-version.js');
const { js: jsVersion } = require('./lib/asset-version.js');
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
// Shaft brand_name arrives truncated at the first word, so map the fragment to
// the brand's canonical DORMIED name (must match data.js exactly, since
// SHAFT_SLUG_MAP is keyed on the normalized value).
const SHAFT_BRAND_NORMALIZE = {
  'True':         'True Temper',
  'Graphite':     'Graphite Design',
  'UST':          'UST Mamiya',
  'LA':           'LA Golf',
  'Project':      'Project X',
  'Accra':        'ACCRA',
  'TPT':          'TPT Golf',
  'Breakthrough': 'BGT',
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
  'Project X':       'project-x',
  'ACCRA':           'accra',
  'LA Golf':         'la-golf',
  'TPT Golf':        'tpt-golf',
  'PING':            'ping',
  'Aerotech':        'aerotech',
  'Oban':            'oban',
  'Aretera':         'aretera',
  'BGT':             'bgt',
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
      // bag_date is carried for the Brand Momentum windows, which reconstruct
      // each player's bag as of a past date from the historical (non-current) rows.
      .select('club_type, raw_brand, raw_model, raw_shaft, loft_or_number, brand_id, bag_id, witb_brands!brand_id(slug, name, dormied_brand_slug), witb_bags!bag_id(is_current, player_id, bag_date)')
      .range(from, to)
  );
  const currentItems = items.filter(i => i.witb_bags?.is_current === true);
  console.log(`  Items: ${items.length} total, ${currentItems.length} current`);

  // 2. Players (include fields needed for Find A Player section)
  const players = await paginate((from, to) =>
    sb.from('witb_players').select('id, name, slug, owgr_rank, current_bag_id, country_code, nation, headshot_url').range(from, to)
  );
  const playerMap = new Map(players.map(p => [p.id, p]));
  console.log(`  Players: ${players.length}`);

  // 3. Brands
  const brands = await paginate((from, to) =>
    sb.from('witb_brands').select('id, slug, name, dormied_brand_slug').range(from, to)
  );
  console.log(`  Brands: ${brands.length}`);

  // 4. DI scores for the LATEST snapshot.
  //
  // This was pinned to '2026-04-01', so the scatter chart's Y axis silently
  // froze on April while tour usage on the X axis kept moving — the two axes
  // stopped describing the same period, which is the one thing that chart
  // claims. Follow the data instead, and carry the month through to the copy so
  // the page can never again state a month it is not plotting.
  const { data: latestSnap } = await sb.from('dormied_monthly_brand_summary')
    .select('snapshot_month').order('snapshot_month', { ascending: false }).limit(1);
  const snapshotMonth = latestSnap?.[0]?.snapshot_month;
  if (!snapshotMonth) throw new Error('no dormied_monthly_brand_summary rows — cannot date the DI axis');

  const { data: diRows } = await sb.from('dormied_monthly_brand_summary')
    .select('brand_slug, global_rank, di_score, global_searches')
    .eq('snapshot_month', snapshotMonth);
  const diBySlug = new Map((diRows || []).map(d => [d.brand_slug, d]));
  const snapshotLabel = new Date(snapshotMonth + 'T00:00:00Z')
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  console.log(`  DI rows (${snapshotLabel}): ${diRows?.length}`);

  // 5. Recent bag changes (for Widget 3)
  const { data: changes, error: changesErr } = await sb.from('witb_changes')
    .select('player_id, club_type, change_type, old_value, new_value, detected_at')
    .order('detected_at', { ascending: false })
    // 15 was enough for a flat row list but not for six DISTINCT players: a
    // single rebuild can be 5+ changes for one golfer.
    .limit(120);
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

  return { allItems: items, currentItems, players, playerMap, brands, diBySlug, snapshotLabel, changes: changes || [], lastCrawl, shaftItems, bagDateMap };
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
    // Share denominator: the sum across every brand listed in this category, so
    // the column reads as share OF THE CATEGORY. Not totalPlayers, because a
    // player can carry several brands in one category (four wedges, two woods)
    // and the shares would then not sum to 100.
    const totalCount = sorted.reduce((n, b) => n + b.count, 0) || 1;
    return { ...cat, brands: sorted, topCount, totalCount };
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
    // toFixed(1) so it reads 6.0 next to avgLoft's 9.3 — a bare "6" beside a
    // one-decimal figure looks like a different kind of number.
    dyk.minLoft = Math.min(...lofts).toFixed(1);
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
    // Share of the category, one decimal. Leader in green, everyone else dimmed.
    const share = (b.count / (cat.totalCount || 1) * 100).toFixed(1);
    return `<div class="witb-lb-row">
      <span class="witb-lb-rank">${i + 1}</span>
      <span class="witb-lb-name">${nameHtml}</span>
      <span class="witb-lb-count">${b.count}</span>
      <span class="witb-lb-bar-wrap">
        <div class="witb-lb-bar-bg"><div class="witb-lb-bar-fill" style="width:${pct}%"></div></div>
      </span>
      <span class="witb-lb-share${i === 0 ? ' witb-lb-share--lead' : ''}">${share}%</span>
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

/* Vercel image proxy. Widths must be one of vercel.json images.sizes — anything
   else 404s, which is how the homepage ticker logos briefly shipped broken. 80
   covers a 40px avatar at DPR 2. */
function vitUrl(src, w) {
  if (!src) return src;
  return '/_vercel/image?url=' + encodeURIComponent(src) + '&w=' + w + '&q=75';
}

/* Player slugs that have a generated WITB page, so nothing links to a 404.
   Shared by Recent Bag Updates and Freshest Bag. */
function readPlayerPages() {
  try {
    return new Set(
      fs.readdirSync(path.join(ROOT, 'witb', 'players'), { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name)
    );
  } catch { return new Set(); }
}

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

  const playerPages = readPlayerPages();

  // One card per player, six most recent. Was one flat row per change, which
  // meant a player who rebuilt five slots dominated the list and read as five
  // separate events.
  const MOVE_PLAYER_LIMIT = 6;
  const byPlayer = new Map();
  for (const c of changes) {
    if (!byPlayer.has(c.player_id)) byPlayer.set(c.player_id, []);
    byPlayer.get(c.player_id).push(c);
  }
  const picked = [...byPlayer.entries()].slice(0, MOVE_PLAYER_LIMIT);

  const cards = picked.map(([playerId, rows]) => {
    const p    = playerMap?.get(playerId);
    const name = p?.name || 'Unknown player';
    const hasPage = p?.slug && playerPages.has(p.slug);
    const href = hasPage ? `/witb/players/${esc(p.slug)}/` : null;

    const ini = (() => {
      const parts = String(name).trim().split(/\s+/);
      return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : String(name).slice(0, 2)).toUpperCase();
    })();
    const face = p?.headshot_url
      ? `<img class="witb-move-face" src="${esc(vitUrl(p.headshot_url, 80))}" width="40" height="40" loading="lazy" decoding="async" alt=""`
        + ` onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        + `<span class="witb-move-face witb-move-face--ini" style="display:none">${esc(ini)}</span>`
      : `<span class="witb-move-face witb-move-face--ini">${esc(ini)}</span>`;

    const dates = rows.map(r => r.detected_at).filter(Boolean).sort();
    const date  = dates.length
      ? new Date(dates[dates.length - 1]).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : '';

    const rowsHtml = rows.map(c => {
      let moveHtml;
      if (c.change_type === 'added') {
        moveHtml = `<span class="witb-move-tag witb-move-tag--added">Added</span>${linkValue(c.new_value)}`;
      } else if (c.change_type === 'removed') {
        moveHtml = `<span class="witb-move-tag witb-move-tag--removed">Removed</span>${linkValue(c.old_value)}`;
      } else {
        moveHtml = `${linkValue(c.old_value)} <span class="witb-move-arrow">&rarr;</span> ${linkValue(c.new_value)}`;
      }
      return `<div class="witb-move-change">
        <span class="witb-move-club">${esc(c.club_type)}</span>
        <span class="witb-move-detail">${moveHtml}</span>
      </div>`;
    }).join('');

    const rankLine = [
      p?.owgr_rank ? `#${p.owgr_rank}` : null,
      `${rows.length} change${rows.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' \u00b7 ');

    return `<article class="witb-move-card">
      <div class="witb-move-head">
        ${face}
        <span class="witb-move-ident">
          <span class="witb-move-player">${href ? `<a href="${href}">${esc(name)}</a>` : esc(name)}</span>
          <span class="witb-move-meta">${esc(rankLine)}</span>
        </span>
        <span class="witb-move-date">${esc(date)}</span>
      </div>
      ${rowsHtml}
    </article>`;
  }).join('');

  return `<div class="witb-moves-grid">${cards}</div>`;
}

// ── Did You Know HTML ──────────────────────────────────────────────────────

function buildDykHtml(dyk) {
  const cards = [];

  if (dyk.avgLoft) {
    cards.push(`<div class="witb-dyk-card">
      <div class="witb-dyk-stat">${dyk.avgLoft}&deg;</div>
      <div class="witb-dyk-label">Avg Driver Loft</div>
      <div class="witb-dyk-detail">Across ${dyk.loftCount} drivers with parsed loft data</div>
    </div>`);
  }

  if (dyk.minLoft) {
    cards.push(`<div class="witb-dyk-card">
      <div class="witb-dyk-stat">${dyk.minLoft}&deg;</div>
      <div class="witb-dyk-label">Lowest Driver Loft</div>
      <div class="witb-dyk-detail">The flattest driver currently in play on tour</div>
    </div>`);
  }

  if (dyk.threeWoodCount !== undefined) {
    cards.push(`<div class="witb-dyk-card">
      <div class="witb-dyk-stat">${dyk.threeWoodCount} vs ${dyk.miniDriverCount}</div>
      <div class="witb-dyk-label">3-Wood vs Mini-Driver</div>
      <div class="witb-dyk-detail">${dyk.threeWoodCount} players carry a traditional 3-wood; ${dyk.miniDriverCount} carry a mini-driver</div>
    </div>`);
  }

  if (dyk.highWoodCount) {
    cards.push(`<div class="witb-dyk-card">
      <div class="witb-dyk-stat">${dyk.highWoodCount}</div>
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

/* ── Freshest Bag ────────────────────────────────────────────────────────────
   Editorial spotlight on the most recently updated bag. The prototype pairs each
   row with a product photo; we have no licensed source for those, so rows are
   slot / model / spec / status only and the layout is a single column rather than
   an image panel plus list.

   The prototype's intro was hand-written prose about one specific player. That
   cannot be generated honestly for whoever happens to be freshest this week, so
   the intro here states only what the data says: how many slots changed and how. */
function buildFreshestBagHtml({ rankedPlayers, bagDateMap, currentItems, changes, playerPages }) {
  const SLOT_ORDER = ['driver','mini-driver','3-wood','4-wood','5-wood','7-wood','9-wood',
                      'hybrid','utility','utility-iron','driving-iron','iron','wedge','putter','ball','grip'];
  const SLOT_LABEL = {
    'driver':'Driver','mini-driver':'Mini Driver','3-wood':'3-Wood','4-wood':'4-Wood','5-wood':'5-Wood',
    '7-wood':'7-Wood','9-wood':'9-Wood','hybrid':'Hybrid','utility':'Utility','utility-iron':'Utility Iron',
    'driving-iron':'Driving Iron','iron':'Irons','wedge':'Wedges','putter':'Putter','ball':'Ball','grip':'Grip',
  };

  const dated = rankedPlayers.filter(p => p.current_bag_id && bagDateMap.get(p.current_bag_id));
  if (!dated.length) return '';

  /* Prefer the most recently CHANGED bag over the most recently DATED one. A
     player's first crawl gives them the newest bag_date but no change rows, so
     keying on date alone picked a bag with nothing to annotate and printed
     "every slot is unchanged" under a heading that promises the opposite. */
  const changedFirst = (changes || [])
    .map(c => c.player_id)
    .find(id => dated.some(p => p.id === id));
  const player = (changedFirst && dated.find(p => p.id === changedFirst))
    || dated.reduce((best, p) =>
        (bagDateMap.get(p.current_bag_id) || '') > (bagDateMap.get(best.current_bag_id) || '') ? p : best);

  const items = currentItems.filter(i => i.bag_id === player.current_bag_id);
  if (!items.length) return '';

  // Status per slot, from the change log for this player.
  const mine = (changes || []).filter(c => c.player_id === player.id);
  const statusByType = new Map();
  for (const c of mine) {
    const t = c.change_type === 'added' ? 'Added' : c.change_type === 'removed' ? 'Removed' : 'Swapped';
    if (!statusByType.has(c.club_type)) statusByType.set(c.club_type, t);
  }

  /* Removed clubs are gone from the current bag, so there is no item row for
     them. Without synthesising one the intro claims "1 removed" and the list
     shows nothing removed. Add them back as struck-through rows so the bag reads
     as a before-and-after, which is what the section is for. */
  const removedRows = mine
    .filter(c => c.change_type === 'removed' && c.old_value)
    .map(c => ({
      club_type: c.club_type,
      raw_brand: '',
      raw_model: c.old_value,
      // Removal rows come from change-log text, not a joined item, so there is
      // no witb_brands relation to hang a link on. Left as plain text.
      _noLink: true,
      loft_or_number: null,
      raw_shaft: null,
      _removed: true,
    }));

  const ordered = [...items, ...removedRows].sort((a, b) => {
    const ai = SLOT_ORDER.indexOf(a.club_type), bi = SLOT_ORDER.indexOf(b.club_type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const rows = ordered.map(i => {
    const brand = i.witb_brands?.name || i.raw_brand || '';
    const model = (i.raw_model || '').trim();
    const dslug = i._noLink ? null : (i.witb_brands?.dormied_brand_slug || null);
    // Link the brand token only, leaving the model as plain text, so the link
    // target matches what it says. Same rule the leaderboards use.
    const name  = brand
      ? (dslug
          ? `<a href="/brands/${esc(dslug)}/">${esc(brand)}</a>${model ? ' ' + esc(model) : ''}`
          : esc([brand, model].filter(Boolean).join(' ')))
      : (esc(model) || 'Unspecified');
    const spec  = [i.loft_or_number, i.raw_shaft].filter(Boolean).join(' \u00b7 ');
    const st    = i._removed ? 'Removed' : (statusByType.get(i.club_type) === 'Removed' ? '' : (statusByType.get(i.club_type) || ''));
    const cls   = st === 'Removed' ? ' witb-fb-model--out' : '';
    const tag   = st
      ? `<span class="witb-move-tag witb-move-tag--${st === 'Removed' ? 'removed' : 'added'}">${st}</span>`
      : '';
    return `<div class="witb-fb-row">
      <span class="witb-fb-slot">${esc(SLOT_LABEL[i.club_type] || i.club_type)}</span>
      <span class="witb-fb-body">
        <span class="witb-fb-model${cls}">${name}</span>
        ${i._removed ? '<span class="witb-fb-spec">Out of the bag</span>' : (spec ? `<span class="witb-fb-spec">${esc(spec)}</span>` : '')}
      </span>
      ${tag}
    </div>`;
  }).join('');

  const counts = { Added: 0, Removed: 0, Swapped: 0 };
  for (const t of statusByType.values()) counts[t]++;
  const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.toLowerCase()}`);
  // Title case for prose; fmtBagDateShort returns "SEP 2026", which is correct
  // in a table cell and shouty in a sentence.
  const when  = fmtBagDateShort(bagDateMap.get(player.current_bag_id))
    .replace(/^([A-Z])([A-Z]{2})/, (_, a, b) => a + b.toLowerCase());
  const intro = parts.length
    ? `${esc(player.name)}'s bag was last recorded ${esc(when)} with ${esc(parts.join(', '))} across ${statusByType.size} slot${statusByType.size === 1 ? '' : 's'}.`
    : `${esc(player.name)}'s bag was last recorded ${esc(when)}. Every slot is unchanged since the previous snapshot.`;

  const ini = (() => {
    const ps = String(player.name || '').trim().split(/\s+/);
    return (ps.length >= 2 ? ps[0][0] + ps[ps.length - 1][0] : String(player.name || '').slice(0, 2)).toUpperCase();
  })();
  const face = player.headshot_url
    ? `<img class="witb-fb-face" src="${esc(vitUrl(player.headshot_url, 200))}" width="88" height="88" loading="lazy" decoding="async" alt=""`
      + ` onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      + `<span class="witb-fb-face witb-fb-face--ini" style="display:none">${esc(ini)}</span>`
    : `<span class="witb-fb-face witb-fb-face--ini">${esc(ini)}</span>`;

  const hasPage = player.slug && playerPages.has(player.slug);
  const nameHtml = hasPage
    ? `<a href="/witb/players/${esc(player.slug)}/">${esc(player.name)}</a>`
    : esc(player.name);

  return `<section class="witb-section" aria-labelledby="freshest-heading">
  <h2 class="witb-section-title" id="freshest-heading">Freshest Bag</h2>
  <p class="witb-section-sub">The most recently recorded setup on tour</p>
  <div class="witb-fb-card">
    <div class="witb-fb-head">
      ${face}
      <span class="witb-fb-ident">
        <span class="witb-fb-name">${buildFlagHtmlInline(player.country_code, player.nation)} ${nameHtml}</span>
        <span class="witb-fb-meta">#${player.owgr_rank} &middot; ${esc(String(items.length))} items logged</span>
      </span>
    </div>
    <p class="witb-fb-intro">${intro}</p>
    ${rows}
  </div>
</section>`;
}

function buildFindPlayerHtml(rankedPlayers, bagDateMap, searchableCount) {
  // Recent bags: 5 players with the most recent current bag_date
  const withDate = rankedPlayers.filter(p => p.current_bag_id && bagDateMap.has(p.current_bag_id));
  const recentBags = [...withDate]
    .sort((a, b) => (bagDateMap.get(b.current_bag_id) || '').localeCompare(bagDateMap.get(a.current_bag_id) || ''))
    .slice(0, 5);

  // Top ranked: 5 lowest OWGR (ascending)
  const topRanked = [...rankedPlayers]
    .sort((a, b) => a.owgr_rank - b.owgr_rank)
    .slice(0, 5);

  function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/);
    return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : String(name || '').slice(0, 2)).toUpperCase();
  }

  function playerRow(p, showDate) {
    // Flag AND headshot: the design dropped flags, but they carry nationality at
    // a glance and were kept on request.
    const flag    = buildFlagHtmlInline(p.country_code, p.nation);
    const ini     = esc(initialsOf(p.name));
    const face    = p.headshot_url
      ? `<img class="witb-fp-face" src="${esc(vitUrl(p.headshot_url, 80))}" width="34" height="34" loading="lazy" decoding="async" alt=""`
        + ` onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        + `<span class="witb-fp-face witb-fp-face--ini" style="display:none">${ini}</span>`
      : `<span class="witb-fp-face witb-fp-face--ini">${ini}</span>`;
    // #1/#2/#3 take medal colours, everyone else green.
    const rankCls = p.owgr_rank === 1 ? ' witb-fp-rank--gold'
                  : p.owgr_rank === 2 ? ' witb-fp-rank--silver'
                  : p.owgr_rank === 3 ? ' witb-fp-rank--bronze' : '';
    const dateStr = showDate ? fmtBagDateShort(bagDateMap.get(p.current_bag_id)) : '';
    return `<a href="/witb/players/${esc(p.slug)}/" class="witb-fp-row">
        ${face}
        <span class="witb-fp-flag">${flag}</span>
        <span class="witb-fp-name">${esc(p.name)}</span>
        <span class="witb-fp-rank${rankCls}">#${p.owgr_rank}</span>
        ${dateStr ? `<span class="witb-fp-date">${esc(dateStr)}</span>` : ''}
      </a>`;
  }

  const recentHtml = recentBags.map(p => playerRow(p, true)).join('');
  const topHtml    = topRanked.map(p => playerRow(p, false)).join('');
  const countLabel = searchableCount ? `Search ${fmt(searchableCount)} players\u2026` : 'Search players\u2026';

  return `<section class="witb-section witb-find-player" aria-labelledby="find-player-heading">
  <div class="witb-fp-header">
    <h2 class="witb-section-title" id="find-player-heading">Find a Player</h2>
    <a href="/witb/players/" class="btn btn--cta btn--mono">Browse All Players &rarr;</a>
  </div>
  <!-- Drives the existing site-wide search overlay rather than a second search
       implementation: that one already indexes every player, ranked or not. -->
  <form class="witb-fp-search" id="witb-fp-search" role="search" action="/witb/players/" method="get">
    <input type="search" id="witb-fp-q" class="witb-fp-input" placeholder="${esc(countLabel)}"
      autocomplete="off" aria-label="Search players">
    <button type="submit" class="witb-fp-btn" aria-label="Search players">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
      Search
    </button>
  </form>
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

function buildPage({ allItems, currentItems, players, playerMap, brands, diBySlug, snapshotLabel, changes, lastCrawl, shaftItems, bagDateMap, latestFeedHtml, topStoriesHtml, featuredFeedHtml, modsHtml }) {
  // Canonical set: players with a non-null OWGR rank (158 today; sentinel 4990 included)
  const rankedPlayers      = players.filter(p => p.owgr_rank !== null);
  const rankedBagIds       = new Set(rankedPlayers.map(p => p.current_bag_id).filter(Boolean));
  const rankedCurrentItemsAll = currentItems.filter(i => rankedBagIds.has(i.bag_id));

  /* ── Stats window ───────────────────────────────────────────────────────────
     is_current says a bag is a player's latest, NOT that it is recent. 83 of the
     207 current bags are over a year old and one dates to Nov 2020, because a
     player who has not been re-crawled keeps whatever bag was last recorded.
     Those bags were dragging retired equipment into "tour usage": a 2022 setup
     counts a Vokey SM8 as in play today.

     So every aggregate below reads only bags dated within STATS_WINDOW_MONTHS.
     This is a real cut — 207 bags/2,096 items down to roughly 124/1,298 — and
     it deliberately shrinks the headline counts rather than overstating them.
     Player-facing lists (Find a Player, Recent Bags) are NOT windowed: a stale
     bag is still that player's bag and their page should still exist. */
  const STATS_WINDOW_MONTHS = Number(process.env.WITB_STATS_WINDOW_MONTHS || 12);
  const statsCutoff = new Date();
  statsCutoff.setMonth(statsCutoff.getMonth() - STATS_WINDOW_MONTHS);
  const bagIsFresh = bagId => {
    const d = bagDateMap.get(bagId);
    return d ? new Date(d) >= statsCutoff : false;
  };

  const rankedCurrentItems = rankedCurrentItemsAll.filter(i => bagIsFresh(i.bag_id));
  const rankedShaftItems   = shaftItems.filter(i => rankedBagIds.has(i.bag_id) && bagIsFresh(i.bag_id));
  const statsBagIds        = new Set(rankedCurrentItems.map(i => i.bag_id));
  console.log(`  Stats window: last ${STATS_WINDOW_MONTHS} months — `
    + `${statsBagIds.size} of ${new Set(rankedCurrentItemsAll.map(i => i.bag_id)).size} ranked bags, `
    + `${rankedCurrentItems.length} of ${rankedCurrentItemsAll.length} items`);

  // All stats derived from the windowed set so every figure reconciles
  const totalPlayers    = statsBagIds.size;
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

  <link rel="icon" type="image/png" sizes="16x16" href="/images/favicon-16.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32.png">
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
    /* Hero stat block, moved out of the text strip that sat above Find a Player */
    .witb-hero-content{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;flex-wrap:wrap}
    .witb-hero-stats{display:flex;border:1px solid var(--border);border-radius:var(--radius);flex-shrink:0}
    .witb-hero-stat{display:flex;flex-direction:column;align-items:center;gap:2px;padding:12px 18px;border-right:1px solid var(--border)}
    .witb-hero-stat:last-child{border-right:none}
    .witb-hero-stat-val{font-family:var(--font-display);font-size:1.8rem;font-weight:700;font-style:italic;color:var(--green);line-height:1}
    .witb-hero-stat-label{font-family:var(--font-mono);font-size:.6rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted)}
    .witb-hero-updated{font-family:var(--font-mono);font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:10px 0 0}
    @media (max-width:620px){.witb-hero-stats{width:100%}.witb-hero-stat{flex:1;padding:10px 8px}.witb-hero-stat-val{font-size:1.3rem}}

    /* Find a Player is the page's primary action, so it is the only section on a
       raised, green-bordered surface. */
    .witb-find-player{background:var(--bg-raised);border:1px solid var(--green-dim);border-radius:var(--radius);padding:16px 14px 12px}
    .witb-fp-search{display:flex;max-width:520px;margin:0 0 14px}
    .witb-fp-input{flex:1;min-width:0;background:var(--bg-surface);border:1px solid var(--border);border-right:0;border-radius:4px 0 0 4px;padding:9px 12px;font-family:var(--font-mono);font-size:.75rem;color:var(--text)}
    .witb-fp-input::placeholder{color:var(--text-muted)}
    .witb-fp-input:focus{outline:none;border-color:var(--green)}
    .witb-fp-btn{display:inline-flex;align-items:center;gap:6px;background:var(--green);color:#052e0e;border:1px solid var(--green);border-radius:0 4px 4px 0;padding:9px 14px;font-family:var(--font-mono);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;cursor:pointer}
    .witb-fp-btn:hover{background:#1aae52}
    .witb-fp-face{width:34px;height:34px;border-radius:3px;flex-shrink:0;object-fit:cover;object-position:50% 12%;background:var(--bg-surface)}
    .witb-fp-face--ini{display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:.62rem;color:var(--text-muted)}
    .witb-fp-rank--gold{color:var(--gold)}
    .witb-fp-rank--silver{color:var(--silver)}
    .witb-fp-rank--bronze{color:var(--bronze)}

    /* Freshest Bag. Single column, no product images; see the generator note. */
    .witb-fb-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px}
    .witb-fb-head{display:flex;align-items:center;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--border-lite)}
    .witb-fb-face{width:88px;height:88px;border-radius:var(--radius-sm);flex-shrink:0;object-fit:cover;object-position:50% 12%;background:var(--bg-raised)}
    .witb-fb-face--ini{display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:1.3rem;color:var(--text-muted)}
    .witb-fb-ident{display:flex;flex-direction:column;gap:3px;min-width:0}
    .witb-fb-name{font-family:var(--font-display);font-size:1.35rem;font-weight:700;font-style:italic;text-transform:uppercase;letter-spacing:.02em;color:var(--text)}
    .witb-fb-name a{color:var(--text)}
    .witb-fb-name a:hover{color:var(--green)}
    .witb-fb-meta{font-family:var(--font-mono);font-size:.62rem;color:var(--text-muted)}
    .witb-fb-intro{font-size:.875rem;line-height:1.65;color:var(--text-dim);margin:10px 0 4px}
    .witb-fb-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)}
    .witb-fb-row:last-child{border-bottom:none}
    .witb-fb-slot{font-family:var(--font-mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);width:84px;flex-shrink:0}
    .witb-fb-body{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
    .witb-fb-model a{color:var(--text)}
    .witb-fb-model a:hover{color:var(--green)}
    .witb-fb-model{font-size:.8125rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .witb-fb-model--out{color:var(--text-muted);text-decoration:line-through}
    .witb-fb-spec{font-family:var(--font-mono);font-size:.62rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    @media (max-width:520px){.witb-fb-head{flex-wrap:wrap}.witb-fb-slot{width:64px}}
    /* Brand Momentum heat grid */
    .witb-mom-row{display:flex;align-items:center;gap:6px;margin-bottom:3px}
    .witb-mom-row--head{padding-bottom:6px;border-bottom:1px solid var(--border-lite);margin-bottom:6px}
    .witb-mom-name{flex:1;min-width:0;display:flex;align-items:center;gap:6px}
    .witb-mom-head{font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);width:48px;text-align:center;flex-shrink:0}
    .witb-mom-name.witb-mom-head{width:auto;text-align:left}
    .witb-mom-cell{display:flex;align-items:center;justify-content:center;width:48px;height:28px;border-radius:2px;flex-shrink:0;font-family:var(--font-mono);font-size:.72rem;font-weight:700}
    .witb-mom-cell--up{color:var(--green)}
    .witb-mom-cell--down{color:#f87171}
    .witb-mom-cell--flat{background:var(--bg-raised);color:var(--text-muted)}
    @media (max-width:560px){.witb-mom-head,.witb-mom-cell{width:38px}}
    .witb-lb-share{font-family:var(--font-mono);font-size:.72rem;color:var(--text-dim);width:46px;text-align:right;flex-shrink:0}
    .witb-lb-share--lead{color:var(--green)}
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

  <link rel="preload" href="/css/styles.min.css?v=${cssVersion()}" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="/css/styles.min.css?v=${cssVersion()}"></noscript>

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
        <div class="hero-content witb-hero-content">
          <div class="hero-text">
            <h1 id="witb-page-title" class="hero-title">What's In The Bag</h1>
            <p class="hero-subhead">Tour Equipment Data</p>
            <p class="hero-desc">What the tour actually plays, and how it lines up with what the amateur game is paying attention to.</p>
          </div>
          <!-- Summary stats. Moved out of a text strip above Find a Player and
               into the hero so the page opens on the numbers rather than burying
               them above the fold's primary action. -->
          <div class="witb-hero-stats" aria-label="WITB summary stats">
            <div class="witb-hero-stat">
              <span class="witb-hero-stat-val">${fmt(totalPlayers)}</span>
              <span class="witb-hero-stat-label">Players</span>
            </div>
            <div class="witb-hero-stat">
              <span class="witb-hero-stat-val">${fmt(totalItems)}</span>
              <span class="witb-hero-stat-label">Items</span>
            </div>
            <div class="witb-hero-stat">
              <span class="witb-hero-stat-val">${fmt(totalBrands)}</span>
              <span class="witb-hero-stat-label">Brands</span>
            </div>
            <div class="witb-hero-stat">
              <span class="witb-hero-stat-val">${fmt(uniqueClubTypes)}</span>
              <span class="witb-hero-stat-label">Categories</span>
            </div>
          </div>
        </div>
        ${lastUpdatedDisplay ? `<p class="witb-hero-updated">Updated <span class="witb-pulse-val">${esc(lastUpdatedDisplay)}</span></p>` : ''}
      </div>
    </section>

    <div class="witb-layout">
      <!-- ── LEFT / MAIN COLUMN ─────────────────────────────────────────── -->
      <div class="witb-main">

        <!-- FIND A PLAYER -->
        ${buildFindPlayerHtml(rankedPlayers, bagDateMap, players.length)}

        <!-- FRESHEST BAG -->
        ${buildFreshestBagHtml({ rankedPlayers, bagDateMap, currentItems: rankedCurrentItemsAll, changes, playerPages: readPlayerPages() })}

        <!-- WIDGET 3: BAG MOVES -->
        <section class="witb-section" aria-labelledby="moves-heading">
          <h2 class="witb-section-title" id="moves-heading">Recent Bag Updates</h2>
          <p class="witb-section-sub">The last six players to change equipment</p>
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

        <!-- WIDGET 7: DID YOU KNOW -->
        <section class="witb-section" aria-labelledby="dyk-heading">
          <h2 class="witb-section-title" id="dyk-heading">Spec Notes</h2>
          <p class="witb-section-sub">Computed from current bag data</p>
          ${dykHtml}
        </section>

        <!-- WIDGET 8: BRAND MOMENTUM -->
        ${(() => {
          // Momentum change computation.
          // Each column = (brand player count now) - (count as of N days ago).
          //
          // There is no snapshot table; the windows are reconstructed from bag
          // history instead. A player's bag "as of D" is their most recent bag
          // dated on or before D, which is exactly how the site already decides
          // what is current. Only players present in BOTH windows are counted,
          // so adding a player to the dataset reads as 0 rather than a bogus
          // gain for every brand in their bag.
          //
          // Caveat worth remembering: this measures when a bag CHANGE WAS
          // RECORDED, not when the player actually switched. A bag that has not
          // been re-crawled since March still counts as unchanged.
          const momentumHistory = (() => {
            const MOM_CLUB_TYPES = ['driver','3-wood','4-wood','5-wood','7-wood','9-wood','mini-driver','hybrid','utility','utility-iron','driving-iron','iron','wedge','putter'];
            const rankedIds = new Set(rankedPlayers.map(p => p.id));
            const asOf = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

            // player -> bags newest-first, and bag -> its items
            const bagsByPlayer = new Map();
            const itemsByBag   = new Map();
            const seenBag      = new Set();
            for (const it of (allItems || [])) {
              const b = it.witb_bags;
              if (!b?.player_id || !b.bag_date) continue;
              if (!itemsByBag.has(it.bag_id)) itemsByBag.set(it.bag_id, []);
              itemsByBag.get(it.bag_id).push(it);
              if (seenBag.has(it.bag_id)) continue;
              seenBag.add(it.bag_id);
              if (!bagsByPlayer.has(b.player_id)) bagsByPlayer.set(b.player_id, []);
              bagsByPlayer.get(b.player_id).push({ id: it.bag_id, date: b.bag_date });
            }
            for (const arr of bagsByPlayer.values()) arr.sort((a, b) => (a.date < b.date ? 1 : -1));

            // { sets: Map<dormied_slug, Set<player>>, present: Set<player> }
            const snapshot = (date) => {
              const sets = new Map(), present = new Set();
              for (const [pid, arr] of bagsByPlayer) {
                if (!rankedIds.has(pid)) continue;
                const bag = date ? arr.find(b => b.date <= date) : arr[0];
                if (!bag) continue;
                present.add(pid);
                for (const it of (itemsByBag.get(bag.id) || [])) {
                  const d = it.witb_brands?.dormied_brand_slug;
                  if (!d || !MOM_CLUB_TYPES.includes(it.club_type)) continue;
                  if (!sets.has(d)) sets.set(d, new Set());
                  sets.get(d).add(pid);
                }
              }
              return { sets, present };
            };

            const now = snapshot(null);
            // Map<dormied_slug, delta>. Both sides are counted over the players
            // the two windows share, so the delta is a like-for-like comparison.
            const windowDeltas = (days) => {
              const prior  = snapshot(asOf(days));
              const shared = new Set([...now.present].filter(p => prior.present.has(p)));
              if (!shared.size) return null;
              const countIn = (sets, slug) => {
                const s = sets.get(slug);
                return s ? [...s].filter(p => shared.has(p)).length : 0;
              };
              const slugs = new Set([...now.sets.keys(), ...prior.sets.keys()]);
              const out = new Map();
              for (const slug of slugs) out.set(slug, countIn(now.sets, slug) - countIn(prior.sets, slug));
              return out;
            };

            // 1M/3M/6M/12M. Week-over-week was mostly noise: the crawl is weekly,
            // so a 7-day window compares many bags against themselves and reads 0.
            return {
              m1:  windowDeltas(30),
              m3:  windowDeltas(90),
              m6:  windowDeltas(182),
              m12: windowDeltas(365),
            };
          })();

          // Returns inner HTML for a .witb-lb-count cell
          /* Heat cell, so the eye finds where movement is concentrated before it
             reads any number. Fill opacity scales with the size of the move and
             caps at .45 so a large swing stays legible; a dot means no change. */
          function momCell(current, deltaMap) {
            if (!deltaMap) return `<span class="witb-mom-cell witb-mom-cell--flat">&middot;</span>`;
            const v = deltaMap.get(current.dormied_slug) ?? 0;
            if (v === 0) return `<span class="witb-mom-cell witb-mom-cell--flat">&middot;</span>`;
            const alpha = Math.min(0.45, 0.10 + Math.abs(v) * 0.05).toFixed(2);
            const rgb   = v > 0 ? '34,197,94' : '239,68,68';
            const cls   = v > 0 ? 'witb-mom-cell--up' : 'witb-mom-cell--down';
            return `<span class="witb-mom-cell ${cls}" style="background:rgba(${rgb},${alpha})">${v > 0 ? '+' : ''}${v}</span>`;
          }

          const colHdr = (label) => `<span class="witb-mom-head">${label}</span>`;

          const brandRows = topClubBrands.map((b, i) => {
            const initials = (b.name || '').replace(/[^A-Za-z0-9]/g, '').substring(0, 2).toUpperCase();
            const logoHtml = b.dormied_slug
              ? `<img src="/images/logos/${esc(b.dormied_slug)}.jpg" alt="" class="witb-brand-logo" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"><span class="witb-brand-monogram" style="display:none">${esc(initials)}</span>`
              : `<span class="witb-brand-monogram">${esc(initials)}</span>`;
            const nameHtml = b.dormied_slug
              ? `${logoHtml}<a href="/brands/${esc(b.dormied_slug)}/">${esc(b.name)}</a>`
              : `${logoHtml}${esc(b.name)}`;
            return `<div class="witb-mom-row">
              <span class="witb-lb-name witb-mom-name">${nameHtml}</span>
              ${momCell(b, momentumHistory.m1)}
              ${momCell(b, momentumHistory.m3)}
              ${momCell(b, momentumHistory.m6)}
              ${momCell(b, momentumHistory.m12)}
            </div>`;
          }).join('');

          return `<section class="witb-section" aria-labelledby="momentum-heading">
          <h2 class="witb-section-title" id="momentum-heading">Brand Momentum</h2>
          <p class="witb-section-sub">Tour usage changes</p>
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px">
            <div class="witb-mom-row witb-mom-row--head">
              <span class="witb-lb-name witb-mom-name witb-mom-head">Brand</span>
              ${colHdr('1M')}${colHdr('3M')}${colHdr('6M')}${colHdr('12M')}
            </div>
            ${brandRows}
            <p style="font-family:var(--font-mono);font-size:.62rem;color:var(--text-muted);margin-top:10px;text-transform:uppercase;letter-spacing:.05em;line-height:1.6">Change in ranked players carrying the brand vs. their bags 1, 3, 6 and 12 months ago. Fill intensity is the size of the move; a dot means no change. Counts only players tracked in both windows, so new additions do not read as gains.</p>
          </div>
        </section>`;
        })()}

        <!-- WIDGET 2: TOUR USAGE vs AMATEUR ATTENTION (signature) -->
        <section class="witb-section" aria-labelledby="scatter-heading">
          <h2 class="witb-section-title" id="scatter-heading">Tour Usage vs. Amateur Attention</h2>
          <p class="witb-section-sub">Current tour usage vs. the ${esc(snapshotLabel)} DORMIED Index score. Same brands, measured two ways.</p>
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

        <!-- WIDGET 9: METHODOLOGY -->
        <section class="witb-section witb-section--method" aria-labelledby="method-heading">
          <div class="scorecard-intro-body">
            <h2 class="scorecard-intro-h2" id="method-heading">What This Data Is</h2>
            <p class="scorecard-intro-p">The current equipment setup of ${totalPlayers} professional golfers, refreshed weekly and recorded at the item level: driver, fairway woods, hybrids, irons, wedges, putter, ball and grips, with brand, model, shaft and loft where available.</p>

            <p class="scorecard-intro-p">This is equipment in play, not equipment sold. A brand here means a tour professional chose it in competition, which is a different signal from market share or endorsement spend. Some of the most tour-popular brands barely register with amateurs, and that gap is what this page exists to show.</p>

            <h2 class="scorecard-intro-h2">Reading the Tour Usage vs. Amateur Attention Chart</h2>
            <p class="scorecard-intro-p">Two independent signals, plotted against each other. X is tour usage: the share of tracked players carrying at least one product from that brand. Y is the brand's <a href="/rankings/">DORMIED Index</a> score for ${esc(snapshotLabel)}, which measures global search interest relative to the month's top brand.</p>

            <p class="scorecard-intro-p">The dashed diagonal is a reference line, not a regression. Above it are pro favorites the amateur game has not caught up with. Below it are brands commanding more attention than their tour presence suggests, usually heritage names with strong retail reach.</p>

            <h2 class="scorecard-intro-h2">How the Tour-Usage-to-DI Join Works</h2>
            <p class="scorecard-intro-p">Each equipment brand is mapped to its <a href="/rankings/">DORMIED Index</a> entry. Not all have one, particularly grip and shaft makers that do not compete in the retail categories the Index tracks. Those brands still appear in the leaderboards but are excluded from the chart, which needs both figures to plot: ${brandsNoDI} of ${totalBrands} brands in ranked bags currently lack a mapping and render as plain text rather than links.</p>

            <p class="scorecard-intro-p">The Index measures search interest, not sentiment or purchase intent. A low score means a brand is niche or regional rather than disliked. For equipment especially, the distance between tour presence and public awareness can be large, and that distance is often where the market is moving before the mainstream notices.</p>
          </div>
        </section>

        <!-- ══ TAIL FEEDS (moved from sidebar; baked for crawlers) ══ -->
        <div class="tail-feeds">
          <section class="home-stories-section latest-feed-section sf-mobile" aria-labelledby="witb-stories-heading-m">
            <h2 class="latest-feed-heading" id="witb-stories-heading-m">Top Stories</h2>
            <div class="latest-feed-list">
              ${topStoriesHtml || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
            </div>
          </section>
          <div class="bp-latest-see-all sf-mobile"><a href="/news/">See All News</a></div>
          <section class="home-stories-section latest-feed-section" aria-labelledby="witb-latest-heading">
            <h2 class="latest-feed-heading" id="witb-latest-heading">Latest</h2>
            <div id="dormied-latest-list" class="latest-feed-list">
              ${latestFeedHtml || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
            </div>
          </section>
          <section id="featured-widget" class="home-stories-section latest-feed-section" aria-labelledby="witb-featured-heading">
            <h2 class="latest-feed-heading" id="witb-featured-heading">Featured</h2>
            <div id="featured-list" class="latest-feed-list">
              ${featuredFeedHtml || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
            </div>
          </section>
          <div class="bp-latest-see-all"><a href="/news/">See All News</a></div>
        </div>

      </div><!-- /witb-main -->

      <!-- ── RIGHT SIDEBAR ──────────────────────────────────────────────── -->
      <aside class="witb-sidebar sidebar-ad-col">
        <section class="home-stories-section latest-feed-section sf-desktop" aria-labelledby="witb-stories-heading">
          <h2 class="latest-feed-heading" id="witb-stories-heading">Top Stories</h2>
          <div id="home-stories-list" class="latest-feed-list" data-limit="5">
            ${topStoriesHtml || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
          </div>
        </section>
        ${modsHtml || ''}
      </aside>

    </div><!-- /witb-layout -->
  </main>

  <!-- ══ FOOTER ════════════════════════════════════════════════════════════════ -->
  <footer class="site-footer" role="contentinfo">
    <div class="container footer-inner">
      <div class="footer-brand">
        <a href="/" class="footer-logo" aria-label="DORMIED home">DORMIED</a>
          <p class="footer-tagline">Golf's Brand Desk</p>
        <div class="footer-social">
          <a href="https://x.com/DORMIED_GOLF" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on X">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <a href="https://www.instagram.com/dormiedgolf" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on Instagram">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
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
        <div class="footer-signup-header"><p class="footer-signup-label">THE SCORECARD</p><p class="footer-signup-sub">Golf's brand desk in your inbox. The biggest moves of the month, what drove them, and what they mean. Once a month (sometimes more).</p></div>
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

    // Find a Player field hands off to the site-wide search overlay, which
    // already indexes all players with headshots. Falls through to a normal
    // form submit to /witb/players/ if that overlay is not present.
    (function(){
      var form = document.getElementById('witb-fp-search');
      var q    = document.getElementById('witb-fp-q');
      if (!form || !q) return;
      function handoff(){
        var trigger = document.querySelector('.site-search-trigger');
        var input   = document.querySelector('.site-search-input');
        if (!trigger || !input) return false;
        trigger.click();
        input.value = q.value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        return true;
      }
      form.addEventListener('submit', function(e){
        if (!q.value.trim()) return;      // empty submit goes to the browse page
        if (handoff()) e.preventDefault();
      });
    })();

    // Search filters checkbox labels (not chart dots)
    document.getElementById('scatter-brand-search').addEventListener('input', function(){
      var q = this.value.toLowerCase().trim();
      document.querySelectorAll('.witb-scatter-cb-label').forEach(function(lbl){
        lbl.style.display = (q === '' || lbl.getAttribute('data-name').indexOf(q) !== -1) ? '' : 'none';
      });
    });
  })();
  </script>

  <script defer src="/js/utils.min.js?v=${jsVersion('utils.min.js')}"></script>
  <script defer src="/js/data.min.js?v=${dataVersion()}"></script>
  <script defer src="/js/feed.min.js?v=${jsVersion('feed.min.js')}"></script>
  <script defer src="/js/search.min.js?v=${jsVersion('search.min.js')}"></script>
  <!-- Required by the footer signup form below. Without it the form has no
       submit handler and a signup silently reloads the page. -->
  <script defer src="/js/signup.min.js?v=${jsVersion('signup.min.js')}"></script>
</body>
</html>`;
}

// ── WITB Leaders Data ──────────────────────────────────────────────────────
// Writes js/witb-leaders.js so the homepage can render WITB LEADERS and
// Most Viewed WITBs fallback without client-side Supabase aggregation.

function writeWitbLeadersData({ players, currentItems, bagDateMap }) {
  const rankedPlayers = players.filter(p => p.owgr_rank !== null);
  const rankedBagIds  = new Set(rankedPlayers.map(p => p.current_bag_id).filter(Boolean));

  /* Same 12-month window as the page's own stats. Without it the homepage WITB
     LEADERS column and /witb/ Top Model Per Category disagree outright — the
     unwindowed data made PING G430 LST the top driver at 16 players while the
     windowed page said Titleist GTS2 at 12, because bags last recorded in 2022
     still counted. Two surfaces, one stat, one answer. */
  const STATS_WINDOW_MONTHS = Number(process.env.WITB_STATS_WINDOW_MONTHS || 12);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - STATS_WINDOW_MONTHS);
  const fresh = bagId => {
    const d = bagDateMap && bagDateMap.get(bagId);
    return d ? new Date(d) >= cutoff : false;
  };
  const rankedCurrentItems = currentItems.filter(i => rankedBagIds.has(i.bag_id) && fresh(i.bag_id));

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
      // Most Viewed WITBs renders a headshot; carried here so the card needs no
      // second Supabase call (witb_players is RLS-protected from the anon key).
      headshot:     p.headshot_url || null,
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
      if (!counts[key]) counts[key] = { brand, model, dormiedSlug, players: new Set() };
      // Distinct PLAYERS, not item rows. Counting rows disagreed with /witb/ Top
      // Model Per Category by one on the top driver, because a player carrying
      // two of the same head counted twice. Player count is what both surfaces
      // claim to show.
      counts[key].players.add(item.witb_bags?.player_id ?? item.bag_id);
    }
    return Object.values(counts)
      .map(c => ({ brand: c.brand, model: c.model, dormiedSlug: c.dormiedSlug, count: c.players.size }))
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
  let featuredFeedHtml = null;
  let modsHtml = '';
  try {
    const [latestArticles, topStoriesArticles, featuredArticles, modsRes] = await Promise.all([
      feedBake.fetchLatestArticles(sb, 10, null),
      feedBake.fetchTopStoriesArticles(sb, dormiedData, 5),
      feedBake.fetchFeaturedArticles(sb, 10),
      feedBake.fetchSidebarModulesHtml(sb, dormiedData),
    ]);
    latestFeedHtml = latestArticles.length  ? feedBake.renderLatestFeedHtml(latestArticles,    dormiedData) : null;
    topStoriesHtml = topStoriesArticles.length ? feedBake.renderLatestFeedHtml(topStoriesArticles, dormiedData) : null;
    featuredFeedHtml = featuredArticles.length ? feedBake.renderLatestFeedHtml(featuredArticles, dormiedData) : null;
    modsHtml = modsRes || '';
  } catch (e) {
    console.warn('[witb-page] Feed bake failed:', e.message);
  }

  console.log('\nBuilding page HTML...');
  const html = buildPage({ ...data, latestFeedHtml, topStoriesHtml, featuredFeedHtml, modsHtml });
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
    .replace(/(<div[^>]*class="latest-feed-list"[^>]*>)[\s\S]*?(<\/div>\s*<\/section>)/g, '$1$2');
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
    // The data-source paragraph that named pgaclubtracker was removed from the
    // methodology on request, so asserting its presence would now fail forever.
    // Replaced with checks on the sections this page gained instead.
    ['Freshest Bag',        html.includes('freshest-heading')],
    ['Recent Bag Updates',  html.includes('witb-move-card')],
    ['Hero stats',          html.includes('witb-hero-stats')],
    ['Player search field', html.includes('witb-fp-search')],
    ['No Brand Tour Share',!html.includes('share-heading')],
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

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
}