#!/usr/bin/env node
'use strict';
/**
 * scripts/refresh-witb-ranks.js
 *
 * Rewrites the ranking line (flag, OWGR or Rolex rank, "UPDATED" date) in
 * every baked WITB player page from ONE database read.
 *
 * Ranks change every week, but a player page is only rebuilt when the
 * player's bag changes. The weekly job used to rebuild all ~300 pages to
 * carry new ranks; on 6 Oct 2026 that step failed and 194 pages kept the
 * 29 Sep ranks, some 1,000 places out. A full rebuild is also the heaviest
 * database job the site runs. This touches only the one line that depends
 * on the ranking, using the generator's own buildOwgrLine(), so the result is
 * identical to a rebuild.
 *
 * Usage: node scripts/refresh-witb-ranks.js [--dry-run]
 */
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { buildOwgrLine } = require('./generate-witb-player-page.js');

const ROOT    = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const LINE_RE = /(<p class="witb-player-rank">)([\s\S]*?)(<\/p>)/;

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY required'); process.exit(1); }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const { data: players, error } = await sb.from('witb_players')
    .select('slug, owgr_rank, rolex_rank, owgr_rank_updated_at, data_golf_rank, country_code, nation');
  if (error) { console.error('[ranks] player read failed:', error.message); process.exit(1); }

  let changed = 0, same = 0, missing = 0, noLine = 0;
  for (const p of players) {
    const file = path.join(ROOT, 'witb', 'players', p.slug, 'index.html');
    if (!fs.existsSync(file)) { missing++; continue; }
    const html = fs.readFileSync(file, 'utf8');
    if (!LINE_RE.test(html)) { noLine++; console.warn(`[ranks] no rank line in ${p.slug}`); continue; }
    const next = html.replace(LINE_RE, (_, open, _old, close) => open + buildOwgrLine(p) + close);
    if (next === html) { same++; continue; }
    changed++;
    if (!DRY_RUN) fs.writeFileSync(file, next);
  }
  console.log(`[ranks] ${changed} page(s) ${DRY_RUN ? 'would change' : 'updated'}, ${same} already current, ${missing} without a page${noLine ? `, ${noLine} WITHOUT a rank line` : ''}`);
  if (noLine) process.exit(1);
}

main().catch(e => { console.error('[ranks]', e.message); process.exit(1); });
