#!/usr/bin/env node
/**
 * scripts/backfill-debut-changes.js
 *
 * Writes the witb_changes rows for a player's DEBUT bag -- their first, diffed
 * against nothing -- for players who were added before the write paths learned
 * to do it themselves.
 *
 * Both witb-scrape.js and witb-manual-update.js now emit these on insert, so
 * this is only needed for bags already in the database. It exists as a real
 * script rather than a one-off because the situation recurs: any player added
 * before that change has a bag and no debut rows.
 *
 * --only IS MANDATORY, AND THAT IS THE WHOLE POINT.
 * 69 players currently have exactly one bag and no change rows, with bag dates
 * going back to 2020. Every surface that consumes witb_changes orders by
 * detected_at, which is the time the row is WRITTEN, not the bag date. So a
 * blanket run would stamp all 69 with today's timestamp and bury the genuinely
 * recent updates under six years of "debuts" that are news to nobody. Name the
 * players whose debut actually just happened.
 *
 * Safe to re-run: a player who already has any change row is skipped, so this
 * cannot double-write.
 *
 *   node scripts/backfill-debut-changes.js --only=a-player,b-player --dry-run
 *   node scripts/backfill-debut-changes.js --only=a-player,b-player
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2);
const DRY  = args.includes('--dry-run');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '')
               .split(',').map(s => s.trim()).filter(Boolean);

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY required');
  if (!ONLY.length) {
    throw new Error('--only=slug1,slug2 is required. See the header: an unscoped run '
      + 'would stamp every historical debut with today\'s timestamp and bury the real updates.');
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: players, error } = await sb.from('witb_players')
    .select('id, slug, name, current_bag_id').in('slug', ONLY);
  if (error) throw new Error(`witb_players read failed: ${error.message}`);

  const missing = ONLY.filter(s => !players.some(p => p.slug === s));
  if (missing.length) throw new Error(`no such player slug(s): ${missing.join(', ')}`);

  let wrote = 0;
  for (const p of players) {
    if (!p.current_bag_id) { console.log(`  skip ${p.slug}: no current bag`); continue; }

    const { count: existing } = await sb.from('witb_changes')
      .select('player_id', { count: 'exact', head: true }).eq('player_id', p.id);
    if (existing > 0) { console.log(`  skip ${p.slug}: already has ${existing} change row(s)`); continue; }

    // Only a genuine debut. More than one bag means there was something to diff
    // against, and those rows are missing for some other reason this script
    // should not paper over.
    const { data: bags } = await sb.from('witb_bags').select('id, bag_date').eq('player_id', p.id);
    if ((bags || []).length !== 1) {
      console.log(`  skip ${p.slug}: ${bags?.length ?? 0} bags, not a debut`);
      continue;
    }
    const bagDate = bags[0].bag_date;

    const { data: items } = await sb.from('witb_bag_items')
      .select('club_type, raw_brand, raw_model').eq('bag_id', p.current_bag_id);

    // One row per club_type, matching detectChanges: it keys the bag by
    // club_type, so two wedge rows are one 'wedge' slot there and here.
    const byType = new Map();
    for (const i of (items || [])) {
      if (!byType.has(i.club_type)) {
        byType.set(i.club_type, `${i.raw_brand || ''} ${i.raw_model || ''}`.trim());
      }
    }
    const rows = [...byType.entries()].map(([club_type, new_value]) => ({
      player_id: p.id, club_type, change_type: 'added',
      old_value: null, new_value,
      old_bag_date: null,          // the debut marker every renderer reads
      new_bag_date: bagDate,
    }));

    console.log(`  ${p.slug.padEnd(20)} ${rows.length} debut row(s)  [${[...byType.keys()].join(', ')}]`);
    if (DRY) { wrote += rows.length; continue; }

    const { error: insErr } = await sb.from('witb_changes').insert(rows);
    if (insErr) { console.error(`  !! ${p.slug}: ${insErr.message}`); continue; }
    wrote += rows.length;
  }

  console.log(`\n[debut-changes] ${DRY ? 'would write' : 'wrote'} ${wrote} row(s)`);
  if (!DRY && wrote) {
    console.log('\nRe-bake so the rows surface:');
    console.log('  node scripts/generate-witb-page.js');
    console.log('  node scripts/refresh-modules.js');
  }
}

if (require.main === module) {
  main().catch(e => { console.error('[debut-changes] FATAL:', e.message); process.exit(1); });
}
