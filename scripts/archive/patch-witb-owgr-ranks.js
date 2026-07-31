#!/usr/bin/env node
/**
 * scripts/patch-witb-owgr-ranks.js
 *
 * Lightweight weekly patch: updates the OWGR rank + updated date in all
 * existing player page HTML files without full page regeneration.
 *
 * Run after witb-owgr-refresh.js so the DB has fresh ranks. Much faster
 * than re-running generate-all-witb-pages.js (no Supabase item queries,
 * no Anthropic lede calls) -- just reads each file, regex-patches two spans.
 *
 * Patches:
 *   <span class="witb-rank-num">#OLD</span>
 *     -> <span class="witb-rank-num">#NEW</span>
 *   <span class="witb-rank-updated">UPDATED OLD_DATE</span>
 *     -> <span class="witb-rank-updated">UPDATED NEW_DATE</span>
 *
 * Also handles the case where a player was previously "Unranked" but now
 * has a rank (replaces <span class="witb-rank-num">Unranked</span>).
 *
 * Usage:
 *   node scripts/patch-witb-owgr-ranks.js
 *   node scripts/patch-witb-owgr-ranks.js --dry-run   # log changes, no writes
 *
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const PLAYERS_DIR = path.resolve(__dirname, '../witb/players');

function log(msg)  { const ts = new Date().toISOString().slice(11, 19); console.log(`[${ts}] ${msg}`); }
function warn(msg) { const ts = new Date().toISOString().slice(11, 19); console.warn(`[${ts}] WARN: ${msg}`); }

/** Format OWGR updated_at timestamp to "Mon DD, YYYY" -- must match generate-witb-player-page.js */
function fmtOwgrDate(isoTs) {
  if (!isoTs) return null;
  const d = new Date(isoTs);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');

  const args   = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  if (dryRun) log('DRY RUN — no files will be written');

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Load all ranked players with current OWGR rank and update timestamp
  const { data: players, error } = await sb
    .from('witb_players')
    .select('slug, name, owgr_rank, owgr_rank_updated_at')
    .not('owgr_rank', 'is', null)
    .order('owgr_rank', { ascending: true });

  if (error) throw new Error(`Could not load witb_players: ${error.message}`);
  log(`Loaded ${players.length} ranked players from DB`);

  let patched   = 0;
  let unchanged = 0;
  let missing   = 0;

  for (const player of players) {
    const filePath = path.join(PLAYERS_DIR, player.slug, 'index.html');

    if (!fs.existsSync(filePath)) {
      warn(`No HTML file: witb/players/${player.slug}/index.html — skipping`);
      missing++;
      continue;
    }

    let html = fs.readFileSync(filePath, 'utf8');
    const original = html;

    // Patch rank number (handles both ranked and Unranked variants)
    const newRankSpan = `<span class="witb-rank-num">#${player.owgr_rank}</span>`;
    html = html
      .replace(/<span class="witb-rank-num">#\d+<\/span>/, newRankSpan)
      .replace(/<span class="witb-rank-num">Unranked<\/span>/, newRankSpan);

    // Patch updated date
    const newDate = fmtOwgrDate(player.owgr_rank_updated_at);
    if (newDate) {
      html = html.replace(
        /<span class="witb-rank-updated">UPDATED [^<]+<\/span>/,
        `<span class="witb-rank-updated">UPDATED ${newDate}</span>`
      );
    }

    if (html !== original) {
      if (!dryRun) fs.writeFileSync(filePath, html, 'utf8');
      log(`  ${dryRun ? '[DRY]' : 'Patched'}: ${player.name.padEnd(28)} #${player.owgr_rank} | ${newDate || '(no date)'}`);
      patched++;
    } else {
      unchanged++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`OWGR PLAYER PAGE PATCH ${dryRun ? '(DRY RUN) ' : ''}COMPLETE`);
  console.log('='.repeat(60));
  console.log(`  Players patched:     ${patched}`);
  console.log(`  Already current:     ${unchanged}`);
  console.log(`  Missing HTML file:   ${missing}`);
  console.log('='.repeat(60) + '\n');

  if (missing > 0) {
    console.log(`Note: ${missing} player(s) have no HTML file.`);
    console.log('Run generate-witb-player-page.js {slug} to build their page.\n');
  }
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => {
    console.error('[patch-witb-owgr-ranks] Fatal:', err.message);
    process.exit(1);
  });
}