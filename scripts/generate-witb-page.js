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
const { createClient } = require('@supabase/supabase-js');

const ROOT   = path.resolve(__dirname, '..');
const OUT    = path.join(ROOT, 'witb', 'index.html');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_URL = process.env.SUPABASE_URL;

if (!SB_URL || !SB_KEY) { console.error('Missing SUPABASE env vars'); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY);

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

  // 2. Players
  const players = await paginate((from, to) =>
    sb.from('witb_players').select('id, name, slug, owgr_rank').range(from, to)
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
  const { data: changes } = await sb.from('witb_changes')
    .select('player_id, club_type, old_brand, old_model, new_brand, new_model, detected_at, witb_brands!new_brand_id(name, dormied_brand_slug), witb_players!player_id(name)')
    .order('detected_at', { ascending: false })
    .limit(15);
  console.log(`  Changes: ${changes?.length || 0}`);

  // 6. Latest crawl run timestamp
  const { data: crawlRuns } = await sb.from('witb_crawl_runs')
    .select('finished_at, status, players_scraped')
    .order('finished_at', { ascending: false })
    .limit(1);
  const lastCrawl = crawlRuns?.[0];

  return { currentItems, playerMap, brands, diBySlug, changes: changes || [], lastCrawl };
}

// ── Widget computations ────────────────────────────────────────────────────

function computeWidgetData({ currentItems, playerMap, brands, diBySlug }) {
  const totalPlayers = 160;

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
  const MODEL_CATS = ['driver','3-wood','hybrid','iron','wedge','putter','ball'];
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
  const treemapGrip  = buildShareData([...GRIP_TYPES, 'shaft']);

  // --- Did You Know ---
  const drivers = currentItems.filter(i => i.club_type === 'driver');
  const lofts   = drivers.map(d => parseLoft(d.loft_or_number)).filter(v => v !== null);
  const dyk = {};
  if (lofts.length >= 20) {
    dyk.avgLoft = (lofts.reduce((s, v) => s + v, 0) / lofts.length).toFixed(1);
    dyk.minLoft = Math.min(...lofts);
    dyk.loftCount = lofts.length;
  }

  const threeWoodCount   = currentItems.filter(i => i.club_type === '3-wood').length;
  const miniDriverCount  = currentItems.filter(i => i.club_type === 'mini-driver').length;
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

  // --- Gained / Lost (since first tracked — only current snapshot) ---
  // Since we ran --no-history, we only have one snapshot per player.
  // We'll note "since initial tracking" and show which brands appear most.
  // Widget 8 gracefully labels the window.
  const gainLoss = { window: 'initial tracking only', note: true };

  return { scatterData, leaderboards, topModels, treemapClub, treemapBall, treemapGrip, dyk, gainLoss, totalPlayers };
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
      onclick="window.location='/brands/${esc(d.slug)}/'">
      <title>${esc(d.name)}: ${d.tourPct.toFixed(1)}% tour, DI ${d.diScore.toFixed(1)}</title>
    </circle>`;
    // Label for large dots only
    if (d.playerCount >= 20 || d.tourPct >= 15) {
      const labelY = cy < PAD.top + 20 ? cy + 14 : cy - 8;
      dots += `<text class="witb-scatter-label" x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${esc(d.name)}</text>`;
    }
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
      ? `<a href="/brands/${esc(b.dormied_slug)}/" title="${esc(b.name)} ${b.pct.toFixed(0)}%">${b.pct >= 8 ? esc(b.name) : ''}</a>`
      : `<span title="${esc(b.name)} ${b.pct.toFixed(0)}%">${b.pct >= 8 ? esc(b.name) : ''}</span>`;
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
  const rows = cat.brands.slice(0, 8).map((b, i) => {
    const pct  = (b.count / cat.topCount * 100).toFixed(0);
    const nameHtml = b.dormied_slug
      ? `<a href="/brands/${esc(b.dormied_slug)}/">${esc(b.name)}</a>`
      : esc(b.name);
    return `<div class="witb-lb-row">
      <span class="witb-lb-rank">${i + 1}</span>
      <span class="witb-lb-name">${nameHtml}</span>
      <span class="witb-lb-count">${b.count}</span>
      <span class="witb-lb-bar-wrap">
        <div class="witb-lb-bar-bg"><div class="witb-lb-bar-fill" style="width:${pct}%"></div></div>
      </span>
    </div>`;
  }).join('');

  return `<div class="witb-lb-section" id="${esc(cat.key)}">
    <div class="witb-lb-title">${esc(cat.label)}</div>
    ${rows}
  </div>`;
}

// ── Changes / Bag Moves HTML ───────────────────────────────────────────────

function buildChangesHtml(changes) {
  if (!changes || changes.length === 0) {
    return `<div class="witb-moves-empty">No bag changes recorded yet. Check back after Tuesday's update.</div>`;
  }

  return changes.map(c => {
    const player  = c.witb_players?.name || 'Unknown player';
    const brand   = c.witb_brands?.name  || c.new_brand || '';
    const dslug   = c.witb_brands?.dormied_brand_slug || null;
    const brandHtml = dslug
      ? `<a href="/brands/${esc(dslug)}/">${esc(brand)}</a>`
      : esc(brand);
    const date = c.detected_at ? new Date(c.detected_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return `<div class="witb-lb-row">
      <span style="flex:1;font-size:.85rem">${esc(player)}</span>
      <span style="font-size:.78rem;color:var(--text-muted)">${esc(c.club_type)}</span>
      <span style="font-size:.78rem">${brandHtml} ${esc(c.new_model || '')}</span>
      <span style="font-size:.72rem;color:var(--text-muted);white-space:nowrap">${date}</span>
    </div>`;
  }).join('');
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
      <div class="witb-dyk-stat">${dyk.threeWoodCount}<span style="font-size:1rem">v</span>${dyk.miniDriverCount}</div>
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

// ── Full page HTML ─────────────────────────────────────────────────────────

function buildPage({ currentItems, playerMap, brands, diBySlug, changes, lastCrawl }) {
  const {
    scatterData, leaderboards, topModels, treemapClub, treemapBall, treemapGrip,
    dyk, gainLoss, totalPlayers
  } = computeWidgetData({ currentItems, playerMap, brands, diBySlug });

  const totalItems  = currentItems.length;
  const totalBrands = brands.length;
  const uniqueClubTypes = [...new Set(currentItems.map(i => i.club_type))].length;

  const scatterSVG     = buildScatterSVG(scatterData);
  const changesHtml    = buildChangesHtml(changes);
  const leaderboardsHtml = leaderboards.map(buildLeaderboard).join('\n');
  const dykHtml        = buildDykHtml(dyk);

  const dateModified = lastCrawl?.finished_at
    ? new Date(lastCrawl.finished_at).toISOString()
    : new Date().toISOString();

  // Top models table
  const MODEL_LABELS = { driver: 'Drivers', '3-wood': 'Fairway Woods', hybrid: 'Hybrids', iron: 'Irons', wedge: 'Wedges', putter: 'Putters', ball: 'Balls' };
  const topModelsHtml = Object.entries(topModels).filter(([, m]) => m).map(([ct, m]) => {
    const brandHtml = m.dormied_slug
      ? `<a href="/brands/${esc(m.dormied_slug)}/">${esc(m.brand)}</a>`
      : esc(m.brand);
    return `<div class="witb-lb-row">
      <span class="witb-lb-name" style="color:var(--text-muted);min-width:90px;max-width:90px;font-size:.75rem;font-family:var(--font-mono);text-transform:uppercase">${esc(MODEL_LABELS[ct] || ct)}</span>
      <span class="witb-lb-name">${brandHtml} ${esc(m.model)}</span>
      <span class="witb-lb-count">${m.count}</span>
    </div>`;
  }).join('');

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
  </style>

  <link rel="preload" href="/css/styles.min.css?v=20260523" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="/css/styles.min.css?v=20260523"></noscript>

  <!-- JSON-LD: Dataset -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "name": "DORMIED WITB - Tour Equipment Data",
    "description": "What ${totalPlayers} PGA Tour players carry in their bags, updated weekly. Covers ${totalBrands} brands across drivers, irons, wedges, putters, balls, and grips.",
    "url": "https://dormied.com/witb/",
    "dateModified": "${dateModified}",
    "publisher": {
      "@type": "Organization",
      "name": "DORMIED",
      "url": "https://dormied.com"
    },
    "includedInDataCatalog": {
      "@type": "DataCatalog",
      "name": "DORMIED Index"
    }
  }
  </script>
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
    <div class="container" style="padding-top:28px;padding-bottom:0">
      <nav class="witb-breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a> &rsaquo; WITB
      </nav>

      <div class="witb-hero">
        <h1 class="witb-hero-h1">What's In The Bag</h1>
        <p class="witb-hero-dek">What the tour actually plays, and how it lines up with what the rest of golf is paying attention to.</p>
      </div>
    </div>

    <div class="witb-layout">
      <!-- ── LEFT / MAIN COLUMN ─────────────────────────────────────────── -->
      <div class="witb-main">

        <!-- WIDGET 1: TOUR PULSE STRIP -->
        <div class="witb-pulse" aria-label="WITB summary stats">
          <span><span class="witb-pulse-val">${fmt(totalPlayers)}</span> players tracked</span>
          <span class="witb-pulse-sep">&middot;</span>
          <span><span class="witb-pulse-val">${fmt(totalItems)}</span> clubs logged</span>
          <span class="witb-pulse-sep">&middot;</span>
          <span><span class="witb-pulse-val">${fmt(totalBrands)}</span> brands represented</span>
          <span class="witb-pulse-sep">&middot;</span>
          <span><span class="witb-pulse-val">${fmt(uniqueClubTypes)}</span> club categories</span>
        </div>

        <!-- WIDGET 2: TOUR USAGE vs PUBLIC ATTENTION (signature) -->
        <section class="witb-section" aria-labelledby="scatter-heading">
          <h2 class="witb-section-title" id="scatter-heading">Tour Usage vs. Public Attention</h2>
          <p class="witb-section-sub">April 2026 tour usage vs. April 2026 DORMIED Index score &mdash; solid data, like-for-like comparison</p>
          <div class="witb-scatter-wrap">
            ${scatterSVG}
          </div>
          <p style="font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);margin-top:8px;text-transform:uppercase;letter-spacing:.05em">
            Brands above the dashed line are pro favorites the public underrates. Below: more attention than tour usage. Dot size = player count. Click any dot to view brand page.
          </p>
        </section>

        <!-- WIDGET 3: BAG MOVES -->
        <section class="witb-section" aria-labelledby="moves-heading">
          <h2 class="witb-section-title" id="moves-heading">This Week's Bag Moves</h2>
          <p class="witb-section-sub">Equipment changes detected on most recent crawl</p>
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
            ${topModelsHtml}
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
            <div class="witb-treemap-title">Grips and Shafts</div>
            ${buildPropBar(treemapGrip)}
          </div>
        </section>

        <!-- WIDGET 7: DID YOU KNOW -->
        <section class="witb-section" aria-labelledby="dyk-heading">
          <h2 class="witb-section-title" id="dyk-heading">Spec Notes</h2>
          <p class="witb-section-sub">Computed from current bag data</p>
          ${dykHtml}
        </section>

        <!-- WIDGET 8: GAINED / LOST -->
        <section class="witb-section" aria-labelledby="momentum-heading">
          <h2 class="witb-section-title" id="momentum-heading">Brand Momentum</h2>
          <p class="witb-section-sub">Tour usage as of initial tracking snapshot${gainLoss.note ? ' &mdash; historical comparison available after the second weekly crawl' : ''}</p>
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 16px">
            <div class="witb-momentum-grid">
              <div>
                <div class="witb-momentum-col-title gained">Most Players (Clubs)</div>
                ${leaderboards.find(l => l.key === 'driver')?.brands.slice(0,5).map((b, i) => {
                  const html = b.dormied_slug
                    ? `<a href="/brands/${esc(b.dormied_slug)}/">${esc(b.name)}</a>`
                    : esc(b.name);
                  return `<div class="witb-lb-row">
                    <span class="witb-lb-rank">${i+1}</span>
                    <span class="witb-lb-name">${html}</span>
                    <span class="witb-lb-count">${b.count}</span>
                  </div>`;
                }).join('') || ''}
              </div>
              <div>
                <div class="witb-momentum-col-title gained">Most Players (Putters)</div>
                ${leaderboards.find(l => l.key === 'putters')?.brands.slice(0,5).map((b, i) => {
                  const html = b.dormied_slug
                    ? `<a href="/brands/${esc(b.dormied_slug)}/">${esc(b.name)}</a>`
                    : esc(b.name);
                  return `<div class="witb-lb-row">
                    <span class="witb-lb-rank">${i+1}</span>
                    <span class="witb-lb-name">${html}</span>
                    <span class="witb-lb-count">${b.count}</span>
                  </div>`;
                }).join('') || ''}
              </div>
            </div>
            <p style="font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);margin-top:16px;text-transform:uppercase;letter-spacing:.05em">Full quarter-over-quarter comparison available after additional weekly crawls accumulate</p>
          </div>
        </section>

        <!-- WIDGET 9: METHODOLOGY -->
        <section class="witb-section" aria-labelledby="method-heading">
          <h2 class="witb-section-title" id="method-heading">Methodology</h2>
          <div class="witb-methodology">
            <h2>What This Data Is</h2>
            <p>The DORMIED WITB dataset tracks the current equipment setup of ${totalPlayers} professional golfers, pulling bag data from <a href="https://www.pgaclubtracker.com" rel="noopener noreferrer" target="_blank">PGAClubTracker.com</a> on a weekly basis. Each player's bag is recorded at the item level: driver, fairway woods, hybrids, irons, wedges, putter, ball, and grips. Brand, model, shaft, and loft are captured where available. The dataset covers ${totalBrands} distinct equipment brands and is refreshed every Tuesday at 9am ET.</p>

            <p>This is equipment-in-play data, not equipment-sold data. A brand appearing here means a tour-level professional has chosen it in competition - which is a meaningfully different signal than market share, retail velocity, or endorsement deals. Some of the most tour-popular brands barely register in the general golf public's awareness. That gap is the most interesting thing this page exists to show.</p>

            <h2>Reading the Tour Usage vs. Public Attention Chart</h2>
            <p>The signature chart plots two independent signals against each other. The X axis is tour usage share: what percentage of the ${totalPlayers} tracked players carry at least one product from that brand in their bag. The Y axis is the DORMIED Index (DI) score for that brand in April 2026, which measures global search interest relative to the highest-scoring brand in the Index that month. Both axes use the same time period for a like-for-like comparison.</p>

            <p>The dashed diagonal is a reference line, not a regression. Brands sitting above the line are pro favorites the general golf public has not yet matched with search attention - either because the brand does not market aggressively, serves a niche the mainstream has not discovered, or benefits from tour contracts that do not translate to retail awareness. Brands sitting below the line command more public attention than their tour presence suggests - often large heritage brands with strong retail and marketing footprints even when pros have shifted toward competitors.</p>

            <h2>How the Tour-Usage-to-DI Join Works</h2>
            <p>The WITB brand database maps each equipment brand to its corresponding entry in the <a href="/rankings/">DORMIED Index</a>. Not every tour brand has a DORMIED Index entry - particularly grip companies and shaft manufacturers that do not compete in the retail consumer markets tracked by the Index. Brands without a mapping appear in the leaderboards and share views but are excluded from the scatter chart, which requires both a tour usage figure and a DI score to plot. As of this writing, ${brands.filter(b => !b.dormied_brand_slug).length} of ${totalBrands} tracked equipment brands lack a DI mapping; those brands render as plain text throughout this page rather than as hyperlinks to brand pages.</p>

            <p>The DORMIED Index measures consumer search interest, not brand sentiment or purchase intent. A high DI score means many people are searching for a brand globally. A low score means the brand is either niche, regional, or simply not a household name outside the sport. For equipment brands especially, the gap between tour presence and public awareness can be dramatic - and that gap tells you something about where the market might be heading, or where it is already moving without the mainstream noticing yet.</p>

            <p>Data source: equipment data from <a href="https://www.pgaclubtracker.com" rel="noopener noreferrer" target="_blank">PGAClubTracker.com</a>. Consumer search data: <a href="/rankings/">DORMIED Index</a>, April 2026 snapshot. All analysis is DORMIED's independent editorial work.</p>
          </div>
        </section>

      </div><!-- /witb-main -->

      <!-- ── RIGHT SIDEBAR ──────────────────────────────────────────────── -->
      <aside class="witb-sidebar sidebar-ad-col">
        <section class="home-stories-section latest-feed-section" aria-labelledby="witb-latest-heading">
          <h2 class="latest-feed-heading" id="witb-latest-heading">Latest</h2>
          <div id="dormied-latest-list" class="latest-feed-list">
            <p class="latest-feed-loading">Loading&#x2026;</p>
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

    document.querySelectorAll('.witb-scatter-dot').forEach(function(dot) {
      dot.addEventListener('mouseenter', function(e) {
        var name     = dot.dataset.name;
        var tour     = dot.dataset.tour;
        var di       = dot.dataset.di;
        var rank     = dot.dataset.rank;
        var players  = dot.dataset.players;
        var gap      = (parseFloat(di) - parseFloat(tour)).toFixed(1);
        var gapLabel = gap > 0 ? 'Underrated by public (+' + gap + ')' : gap < 0 ? 'Over-indexed (' + gap + ')' : 'Balanced';
        tooltip.innerHTML =
          '<strong>' + name + '</strong><br>' +
          'Tour: ' + tour + '% (' + players + ' players)<br>' +
          'DI score: ' + di + ' (#' + rank + ')<br>' +
          '<span style="color:var(--text-muted)">' + gapLabel + '</span>';
        tooltip.classList.add('visible');
        posTooltip(e);
      });
      dot.addEventListener('mousemove', posTooltip);
      dot.addEventListener('mouseleave', function() {
        tooltip.classList.remove('visible');
      });
    });

    function posTooltip(e) {
      var x = e.clientX + 14, y = e.clientY - 10;
      if (x + 230 > window.innerWidth) x = e.clientX - 230;
      tooltip.style.left = x + 'px';
      tooltip.style.top  = y + 'px';
    }
  })();
  </script>

  <script defer src="/js/utils.min.js?v=20260318"></script>
  <script defer src="/js/feed.min.js?v=20260522"></script>
  <script defer src="/js/search.min.js?v=20260508"></script>
</body>
</html>`;
}

// ── Run ────────────────────────────────────────────────────────────────────

async function main() {
  const data = await fetchAllData();
  console.log('\nBuilding page HTML...');
  const html = buildPage(data);

  // Ensure /witb directory exists
  const dir = path.dirname(OUT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(OUT, html, 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`\nWritten: ${OUT} (${kb} KB)`);

  // Quick validation
  const checks = [
    ['Titleist in HTML',    html.includes('Titleist')],
    ['TaylorMade in HTML',  html.includes('TaylorMade')],
    ['No em dash',         !html.includes('—')],
    ['Scatter SVG',         html.includes('witb-scatter-svg')],
    ['Leaderboard anchor',  html.includes('id="driver"')],
    ['pgaclubtracker',      html.includes('pgaclubtracker')],
    ['dormied-latest-list', html.includes('dormied-latest-list')],
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
