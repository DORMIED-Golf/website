#!/usr/bin/env node
/**
 * refresh-brand-summary.js
 *
 * Reads dormied_brand_scores and populates two pre-computed summary tables:
 *
 *   dormied_monthly_brand_summary     — one row per brand per month (global)
 *   dormied_monthly_market_leaderboard — one row per rank per market per month
 *
 * All formulas exactly match brand.js (global-only, canonical 3-level tiebreak).
 * Run after every monthly data update:
 *
 *   node scripts/refresh-brand-summary.js
 *   node scripts/refresh-brand-summary.js --dry-run   # print stats, no writes
 *   node scripts/refresh-brand-summary.js --month=2026-04-01  # single month only
 */

'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const DRY_RUN     = process.argv.includes('--dry-run');
const MONTH_ARG   = (process.argv.find(a => a.startsWith('--month=')) || '').replace('--month=', '') || null;
const BATCH_SIZE  = 500;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** "2026-04-01" -> { y: 2026, m: 4 } */
function parseYM(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return { y, m };
}

/** Shift a date string by N months, return "YYYY-MM-01" */
function shiftMonth(dateStr, delta) {
  const { y, m } = parseYM(dateStr);
  const total = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

// ---------------------------------------------------------------------------
// Canonical ranking
// Mirrors computeGlobalRankings() / calculateRankings() in brand.js / app.js.
// Sort order: cur DESC → prev DESC → ago3 DESC → brand_slug ASC (stable fallback)
// Returns Map<brand_slug, rank> where rank is 1..N (unique, no ties)
// ---------------------------------------------------------------------------

function canonicalRank(brands, getSearches) {
  // getSearches(slug, monthOffset) -> integer (0 if no data)
  const withScores = brands.map(slug => ({
    slug,
    cur:  getSearches(slug, 0),
    prev: getSearches(slug, -1),
    ago3: getSearches(slug, -3),
  }));

  withScores.sort((a, b) => {
    if (b.cur  !== a.cur)  return b.cur  - a.cur;
    if (b.prev !== a.prev) return b.prev - a.prev;
    if (b.ago3 !== a.ago3) return b.ago3 - a.ago3;
    return a.slug < b.slug ? -1 : 1;   // stable alpha fallback
  });

  const rankMap = new Map();
  withScores.forEach((item, i) => rankMap.set(item.slug, i + 1));
  return rankMap;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // ── 1. Load all rows from dormied_brand_scores (paginated) ──────────────
  console.log('Loading dormied_brand_scores...');
  const PAGE = 1000;   // Supabase PostgREST max per request
  let rows = [], from = 0;
  while (true) {
    const { data, error: loadErr } = await sb
      .from('dormied_brand_scores')
      .select('brand_slug, market, snapshot_month, monthly_searches')
      .order('snapshot_month')
      .range(from, from + PAGE - 1);
    if (loadErr) throw new Error(`Load failed: ${loadErr.message}`);
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    from += PAGE;
    if (data.length < PAGE) break;
  }
  console.log(`  ${rows.length} rows loaded.`);

  // ── 2. Build in-memory lookup: scores[market][month][brand_slug] = searches ──
  // Also collect sorted month list and brand list per market.

  const scores = {};      // scores[market][month][brand_slug] = searches
  const markets = new Set();
  const brandSet = new Set();
  const monthSet = new Set();

  for (const row of rows) {
    markets.add(row.market);
    brandSet.add(row.brand_slug);
    monthSet.add(row.snapshot_month);
    if (!scores[row.market]) scores[row.market] = {};
    if (!scores[row.market][row.snapshot_month]) scores[row.market][row.snapshot_month] = {};
    scores[row.market][row.snapshot_month][row.brand_slug] = row.monthly_searches;
  }

  const allMonths  = [...monthSet].sort();
  const allBrands  = [...brandSet].sort();
  const allMarkets = [...markets].sort();

  const targetMonths = MONTH_ARG ? [MONTH_ARG] : allMonths;
  console.log(`  Brands: ${allBrands.length}, Markets: ${allMarkets.length}, Months: ${allMonths.length}`);
  if (MONTH_ARG) console.log(`  Processing single month: ${MONTH_ARG}`);

  // Helper: searches for brand in market at a month offset from a base month
  function getS(market, baseMonth, slug, offset = 0) {
    const m = offset === 0 ? baseMonth : shiftMonth(baseMonth, offset);
    return scores[market]?.[m]?.[slug] || 0;
  }

  // ── 3. Pre-compute canonical ranks for every (market, month) ─────────────
  // rankCache[market][month] = Map<brand_slug, rank>
  console.log('\nComputing canonical ranks for all market × month combinations...');
  const rankCache = {};
  for (const market of allMarkets) {
    rankCache[market] = {};
    for (const month of allMonths) {
      rankCache[market][month] = canonicalRank(
        allBrands,
        (slug, offset) => getS(market, month, slug, offset)
      );
    }
  }
  console.log('  Done.');

  // ── 4. Build dormied_monthly_brand_summary rows (global only) ────────────
  console.log('\nBuilding brand summary rows...');
  const summaryRows = [];

  for (const month of targetMonths) {
    const monthScores   = scores['global']?.[month] || {};
    const maxSearches   = Math.max(0, ...Object.values(monthScores));
    const rankMap       = rankCache['global'][month];
    const prevMonthStr  = shiftMonth(month, -1);
    const prevRankMap   = rankCache['global'][prevMonthStr];

    // Sorted list of all actual months up to (and including) current month
    const monthsUpTo    = allMonths.filter(m => m <= month);
    const monthIdx      = monthsUpTo.length - 1;  // index of current month in monthsUpTo

    for (const slug of allBrands) {
      const cur  = getS('global', month,  slug, 0);
      const prev = getS('global', month,  slug, -1);
      const ya   = getS('global', month,  slug, -12);

      const globalRank     = rankMap?.get(slug)     || null;
      const globalRankPrev = prevRankMap?.get(slug) || null;
      const globalRankChange = (globalRank && globalRankPrev)
        ? globalRankPrev - globalRank    // positive = moved up
        : null;

      const diScore = maxSearches > 0
        ? parseFloat((cur / maxSearches * 100).toFixed(1))
        : 0;

      const momChangePct = prev > 0
        ? parseFloat(((cur - prev) / prev * 100).toFixed(1))
        : null;

      const yoyChangePct = ya > 0
        ? parseFloat(((cur - ya) / ya * 100).toFixed(1))
        : null;

      // 3-month trend: avg(last 3 actual months) vs avg(prior 3 actual months)
      // Mirrors computeBrandMetrics() in brand.js exactly
      const last3Months  = monthsUpTo.slice(Math.max(0, monthIdx - 2), monthIdx + 1);
      const prior3Months = monthsUpTo.slice(Math.max(0, monthIdx - 5), Math.max(0, monthIdx - 2));
      const l3avg = last3Months.length  > 0
        ? last3Months.reduce( (s, m) => s + getS('global', m, slug, 0), 0) / last3Months.length
        : 0;
      const p3avg = prior3Months.length > 0
        ? prior3Months.reduce((s, m) => s + getS('global', m, slug, 0), 0) / prior3Months.length
        : 0;
      const threeMonthChangePct = p3avg > 0
        ? parseFloat(((l3avg - p3avg) / p3avg * 100).toFixed(1))
        : null;

      // Best rank ever up to this month (canonical, unique rank 1..N)
      // Uses rankCache so the same tiebreaking applies to every historical month
      let bestRankEver = null;
      let bestRankEverMonth = null;
      for (const m of monthsUpTo) {
        const r = rankCache['global'][m]?.get(slug) || null;
        if (r !== null && (bestRankEver === null || r < bestRankEver)) {
          bestRankEver = r;
          bestRankEverMonth = m;
        }
      }

      // 52-week high: max monthly_searches in trailing 12 actual months
      const trailing12 = monthsUpTo.slice(Math.max(0, monthIdx - 11), monthIdx + 1);
      const w52High = trailing12.length > 0
        ? Math.max(...trailing12.map(m => getS('global', m, slug, 0)))
        : 0;
      const vs52wHighPct = w52High > 0
        ? parseFloat(((cur - w52High) / w52High * 100).toFixed(1))
        : null;
      const at52wPeak = vs52wHighPct !== null && vs52wHighPct >= -0.5;

      summaryRows.push({
        brand_slug:             slug,
        snapshot_month:         month,
        global_searches:        cur,
        global_rank:            globalRank,
        global_rank_prev:       globalRankPrev,
        global_rank_change:     globalRankChange,
        di_score:               diScore,
        mom_change_pct:         momChangePct,
        yoy_change_pct:         yoyChangePct,
        three_month_change_pct: threeMonthChangePct,
        best_rank_ever:         bestRankEver,
        best_rank_ever_month:   bestRankEverMonth,
        w52_high_searches:      w52High,
        vs_52w_high_pct:        vs52wHighPct,
        at_52w_peak:            at52wPeak,
        refreshed_at:           new Date().toISOString(),
      });
    }

    process.stdout.write(`\r  ${month}: ${allBrands.length} brands processed...`);
  }
  console.log(`\n  ${summaryRows.length} summary rows ready.`);

  // ── 5. Build dormied_monthly_market_leaderboard rows ─────────────────────
  console.log('\nBuilding leaderboard rows...');
  const leaderboardRows = [];

  for (const market of allMarkets) {
    for (const month of targetMonths) {
      const rankMap     = rankCache[market][month];
      const prevMonth   = shiftMonth(month, -1);
      const prevRankMap = rankCache[market][prevMonth];

      // rankMap is sorted as a Map (insertion order = rank order from canonicalRank)
      // but we need to look up by rank. Build rank -> slug lookup.
      for (const [slug, rank] of rankMap.entries()) {
        const searches  = getS(market, month, slug, 0);
        const prevRank  = prevRankMap?.get(slug) || null;
        const rankChange = (rank && prevRank) ? prevRank - rank : null;

        leaderboardRows.push({
          snapshot_month:   month,
          market,
          rank,
          brand_slug:       slug,
          monthly_searches: searches,
          rank_change:      rankChange,
          refreshed_at:     new Date().toISOString(),
        });
      }
    }
    process.stdout.write(`\r  Market: ${market}...`);
  }
  console.log(`\n  ${leaderboardRows.length} leaderboard rows ready.`);

  // ── 6. Dry run report ────────────────────────────────────────────────────
  if (DRY_RUN) {
    const latestMonth = targetMonths[targetMonths.length - 1];
    const latestSummary = summaryRows.filter(r => r.snapshot_month === latestMonth);
    const top5 = latestSummary
      .filter(r => r.global_rank <= 5)
      .sort((a, b) => a.global_rank - b.global_rank);

    console.log(`\n═══════════════════════════════════════`);
    console.log(`DRY RUN — no DB writes`);
    console.log(`═══════════════════════════════════════`);
    console.log(`Summary rows:     ${summaryRows.length}`);
    console.log(`Leaderboard rows: ${leaderboardRows.length}`);
    console.log(`\nTop 5 global (${latestMonth}):`);
    for (const r of top5) {
      const chg = r.global_rank_change !== null
        ? (r.global_rank_change > 0 ? `+${r.global_rank_change}` : `${r.global_rank_change}`)
        : '—';
      console.log(`  #${r.global_rank} ${r.brand_slug.padEnd(30)} DI:${r.di_score.toFixed(1).padStart(6)}  MoM:${(r.mom_change_pct ?? '—').toString().padStart(7)}%  YoY:${(r.yoy_change_pct ?? '—').toString().padStart(7)}%  3M:${(r.three_month_change_pct ?? '—').toString().padStart(7)}%  chg:${chg}`);
    }
    return;
  }

  // ── 7. Upsert summary rows ────────────────────────────────────────────────
  console.log(`\nUpserting ${summaryRows.length} brand summary rows...`);
  let done = 0;
  for (let i = 0; i < summaryRows.length; i += BATCH_SIZE) {
    const batch = summaryRows.slice(i, i + BATCH_SIZE);
    const { error } = await sb
      .from('dormied_monthly_brand_summary')
      .upsert(batch, { onConflict: 'brand_slug,snapshot_month' });
    if (error) throw new Error(`Summary upsert failed: ${error.message}`);
    done += batch.length;
    process.stdout.write(`\r  ${done}/${summaryRows.length}...`);
  }
  console.log('\n  Done.');

  // ── 8. Upsert leaderboard rows ────────────────────────────────────────────
  console.log(`\nUpserting ${leaderboardRows.length} leaderboard rows...`);
  done = 0;
  for (let i = 0; i < leaderboardRows.length; i += BATCH_SIZE) {
    const batch = leaderboardRows.slice(i, i + BATCH_SIZE);
    const { error } = await sb
      .from('dormied_monthly_market_leaderboard')
      .upsert(batch, { onConflict: 'snapshot_month,market,rank' });
    if (error) throw new Error(`Leaderboard upsert failed: ${error.message}`);
    done += batch.length;
    process.stdout.write(`\r  ${done}/${leaderboardRows.length}...`);
  }
  console.log('\n  Done.');

  // ── 9. Final report ───────────────────────────────────────────────────────
  const { count: sc } = await sb.from('dormied_monthly_brand_summary').select('*', { count: 'exact', head: true });
  const { count: lc } = await sb.from('dormied_monthly_market_leaderboard').select('*', { count: 'exact', head: true });

  const latestMonth = targetMonths[targetMonths.length - 1];
  const { data: top5 } = await sb
    .from('dormied_monthly_brand_summary')
    .select('brand_slug, global_rank, di_score, mom_change_pct, yoy_change_pct, three_month_change_pct, global_rank_change')
    .eq('snapshot_month', latestMonth)
    .lte('global_rank', 5)
    .order('global_rank');

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`BRAND SUMMARY REFRESH COMPLETE`);
  console.log(`═══════════════════════════════════════════`);
  console.log(`Summary rows in DB:     ${sc}`);
  console.log(`Leaderboard rows in DB: ${lc}`);
  console.log(`\nTop 5 global (${latestMonth}):`);
  for (const r of (top5 || [])) {
    const chg = r.global_rank_change !== null
      ? (r.global_rank_change > 0 ? `+${r.global_rank_change}` : `${r.global_rank_change}`)
      : '—';
    console.log(`  #${r.global_rank} ${r.brand_slug.padEnd(30)} DI:${Number(r.di_score).toFixed(1).padStart(6)}  MoM:${String(r.mom_change_pct ?? '—').padStart(7)}%  YoY:${String(r.yoy_change_pct ?? '—').padStart(7)}%  3M:${String(r.three_month_change_pct ?? '—').padStart(7)}%  chg:${chg}`);
  }
  console.log(`═══════════════════════════════════════════`);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
