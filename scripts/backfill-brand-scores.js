#!/usr/bin/env node
/**
 * backfill-brand-scores.js
 *
 * Reads every js/brand-data/{slug}.js file, extracts the focal brand's full
 * searchesByMarket history, and upserts rows into dormied_brand_scores.
 *
 * After all rows are inserted, recomputes ranks via SQL window function so
 * every (market, snapshot_month) slice is ranked 1..N by monthly_searches DESC.
 *
 * Usage:
 *   node scripts/backfill-brand-scores.js            # full backfill
 *   node scripts/backfill-brand-scores.js --dry-run  # count rows, no DB writes
 *   node scripts/backfill-brand-scores.js --ranks-only  # skip inserts, just recompute ranks
 */

'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BRAND_DATA_DIR = path.resolve(__dirname, '../js/brand-data');
const BATCH_SIZE     = 500;   // rows per upsert batch

const DRY_RUN    = process.argv.includes('--dry-run');
const RANKS_ONLY = process.argv.includes('--ranks-only');

const MONTH_MAP = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04',
  May: '05', Jun: '06', Jul: '07', Aug: '08',
  Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "Apr 2026" -> "2026-04-01" */
function monthLabelToDate(label) {
  const [mon, yr] = label.trim().split(' ');
  const mm = MONTH_MAP[mon];
  if (!mm || !yr) throw new Error(`Unparseable month label: "${label}"`);
  return `${yr}-${mm}-01`;
}

/** Strip window.DORMIED_DATA= wrapper and parse JSON */
function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const json = raw.replace(/^window\.DORMIED_DATA\s*=\s*/, '').replace(/;?\s*$/, '');
  return JSON.parse(json);
}

/** Derive brand slug from filename (e.g. "titleist.js" -> "titleist") */
function slugFromFile(file) {
  return path.basename(file, '.js');
}

// ---------------------------------------------------------------------------
// Extract rows for one brand file
// ---------------------------------------------------------------------------

function extractRows(filePath) {
  const slug = slugFromFile(filePath);
  let data;
  try {
    data = parseFile(filePath);
  } catch (err) {
    console.error(`  PARSE ERROR ${slug}: ${err.message}`);
    return [];
  }

  const focal = data.brands.find(b => b.id === slug);
  if (!focal) {
    console.warn(`  WARN: no brand entry found for slug "${slug}" in ${path.basename(filePath)}`);
    return [];
  }

  const rows = [];
  const sbm = focal.searchesByMarket || {};

  for (const [market, monthData] of Object.entries(sbm)) {
    for (const [label, searches] of Object.entries(monthData)) {
      let snapshot_month;
      try {
        snapshot_month = monthLabelToDate(label);
      } catch (err) {
        console.warn(`  WARN ${slug}/${market}: ${err.message} -- skipping`);
        continue;
      }
      rows.push({
        brand_slug: slug,
        market,
        snapshot_month,
        monthly_searches: searches,
        rank: null,   // computed after all inserts
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Batch upsert
// ---------------------------------------------------------------------------

async function upsertBatch(sb, rows) {
  const { error } = await sb
    .from('dormied_brand_scores')
    .upsert(rows, { onConflict: 'brand_slug,market,snapshot_month' });
  if (error) throw new Error(`Upsert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Rank computation (single SQL window function via RPC, one round-trip)
// ---------------------------------------------------------------------------

async function computeRanks(sb) {
  process.stdout.write('\nComputing ranks via SQL window function... ');
  const { error } = await sb.rpc('compute_brand_score_ranks');
  if (error) throw new Error(`Rank computation failed: ${error.message}`);
  console.log('done.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Collect all brand-data files
  const files = fs.readdirSync(BRAND_DATA_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(BRAND_DATA_DIR, f))
    .sort();

  console.log(`Found ${files.length} brand-data files in ${BRAND_DATA_DIR}`);

  if (RANKS_ONLY) {
    await computeRanks(sb);
    return;
  }

  // Extract all rows
  let allRows = [];
  let parseErrors = 0;

  for (const file of files) {
    const rows = extractRows(file);
    if (rows.length === 0) { parseErrors++; continue; }
    allRows = allRows.concat(rows);
    process.stdout.write(`\r  Extracted ${allRows.length} rows from ${allRows.length > 0 ? path.basename(file) : '...'}...`);
  }

  console.log(`\n\nTotal rows to insert: ${allRows.length}`);
  console.log(`Parse errors: ${parseErrors}`);

  if (DRY_RUN) {
    // Summary by market
    const byMarket = {};
    for (const r of allRows) {
      byMarket[r.market] = (byMarket[r.market] || 0) + 1;
    }
    console.log('\nRows by market:');
    for (const [m, c] of Object.entries(byMarket).sort()) {
      console.log(`  ${m.padEnd(8)} ${c}`);
    }
    const months = [...new Set(allRows.map(r => r.snapshot_month))].sort();
    console.log(`\nMonth range: ${months[0]} to ${months[months.length - 1]} (${months.length} months)`);
    console.log('\nDry run complete -- no DB writes.');
    return;
  }

  // Upsert in batches
  console.log(`\nUpserting in batches of ${BATCH_SIZE}...`);
  let inserted = 0;

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    await upsertBatch(sb, batch);
    inserted += batch.length;
    process.stdout.write(`\r  ${inserted}/${allRows.length} rows upserted...`);
  }

  console.log(`\n  All rows upserted.`);

  // Compute ranks
  await computeRanksFallback(sb);

  // Final counts
  const { count } = await sb
    .from('dormied_brand_scores')
    .select('*', { count: 'exact', head: true });

  console.log(`\n============================================================`);
  console.log(`DORMIED BRAND SCORES -- BACKFILL COMPLETE`);
  console.log(`============================================================`);
  console.log(`Total rows in DB: ${count}`);
  console.log(`Brands:          ${files.length}`);
  const months = [...new Set(allRows.map(r => r.snapshot_month))].sort();
  console.log(`Month range:     ${months[0]} to ${months[months.length - 1]}`);
  console.log(`Months:          ${months.length}`);
  console.log(`Markets:         11`);
  console.log(`============================================================`);
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => {
    console.error('\nFATAL:', err.message);
    process.exit(1);
  });
}