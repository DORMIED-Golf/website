#!/usr/bin/env node
/**
 * scripts/generate-all-witb-pages.js
 *
 * Batch generator: builds /witb/players/{slug}/index.html for every player in the DB.
 * Calls generate-witb-player-page.js per player (sequential, includes Opus lede caching).
 *
 * Usage:
 *   node scripts/generate-all-witb-pages.js          # all 158 ranked players ordered by owgr_rank
 *   node scripts/generate-all-witb-pages.js --dry-run # list slugs, no generation
 *   node scripts/generate-all-witb-pages.js --from scottie-scheffler  # resume from slug
 *
 * Lede cache: generate-witb-player-page.js caches per slug:bag_date.
 * Pages are only regenerated with a fresh Opus call when the player's current bag changes.
 *
 * Requires .env with SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { execFileSync } = require('child_process');
const path             = require('path');
const fs               = require('fs');
const { createClient } = require('@supabase/supabase-js');

const GENERATOR = path.join(__dirname, 'generate-witb-player-page.js');
const ROOT      = path.resolve(__dirname, '..');

function log(msg)  { console.log(`[generate-all] ${msg}`); }
function warn(msg) { console.warn(`[generate-all] WARN: ${msg}`); }

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE env vars');

  const args    = process.argv.slice(2);
  const dryRun  = args.includes('--dry-run');
  const fromIdx = args.indexOf('--from');
  const fromSlug = fromIdx >= 0 ? args[fromIdx + 1] : null;

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Load ranked players only (owgr_rank IS NOT NULL).
  // Unranked players (Grayson Murray, Scott Stallings) have owgr_rank = null and must be skipped.
  // Tiger Woods and Ian Poulter carry sentinel rank 4990 — they are NOT null and are included.
  const { data: players, error } = await sb
    .from('witb_players')
    .select('slug, name, owgr_rank')
    .not('owgr_rank', 'is', null)
    .order('owgr_rank', { ascending: true });
  if (error) throw new Error(`Could not load witb_players: ${error.message}`);

  // Visible skips: unranked players (owgr_rank IS NULL) are intentionally not
  // generated, but a page that exists on disk then FREEZES silently (this froze
  // ben-griffin and phil-mickelson before their ranks were restored). Announce
  // each skipped player, its reason, and whether a stale HTML page is live.
  const { data: unranked } = await sb
    .from('witb_players')
    .select('slug, name')
    .is('owgr_rank', null)
    .order('slug', { ascending: true });
  if (unranked && unranked.length) {
    warn(`Skipping ${unranked.length} unranked player(s) (owgr_rank IS NULL). Run witb-owgr-refresh.js if a rank is missing:`);
    for (const p of unranked) {
      const hasPage = fs.existsSync(path.join(__dirname, '..', 'witb', 'players', p.slug, 'index.html'));
      warn(`  SKIP ${p.slug.padEnd(24)} (${p.name}) — owgr_rank null${hasPage ? '  [STALE PAGE LIVE: witb/players/' + p.slug + '/ is frozen]' : '  (no page on disk)'}`);
    }
  } else {
    log('No unranked players to skip.');
  }

  let slugs = players.map(p => p.slug);

  // --from: resume from a specific slug
  if (fromSlug) {
    const idx = slugs.indexOf(fromSlug);
    if (idx < 0) { warn(`--from slug "${fromSlug}" not found, starting from beginning`); }
    else { slugs = slugs.slice(idx); log(`Resuming from ${fromSlug} (${slugs.length} remaining)`); }
  }

  log(`Batch generating ${slugs.length} player pages${dryRun ? ' (DRY RUN)' : ''}...`);

  if (dryRun) {
    slugs.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    return;
  }

  const results    = [];
  const errors     = [];
  const noindexed  = [];
  let opusCalls    = 0;

  const start = Date.now();

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const num  = `[${i + 1}/${slugs.length}]`;
    process.stdout.write(`${num} ${slug} ... `);

    try {
      const out = execFileSync('node', [GENERATOR, slug], {
        cwd:      ROOT,
        encoding: 'utf8',
        timeout:  120000, // 2-minute timeout per page
        stdio:    ['ignore', 'pipe', 'pipe'],
      });

      const stderr = ''; // execFileSync merges stderr into throw on error
      const combined = out;

      const isNoindex = /noindex.*word count|noindex.*missing/i.test(combined) ||
                        combined.includes('Page has noindex');
      const hadOpus   = combined.includes('Generating lede') ||
                        combined.includes('Opus tokens');

      if (hadOpus) opusCalls++;
      if (isNoindex) noindexed.push(slug);

      results.push({ slug, ok: true, noindex: isNoindex });
      console.log(isNoindex ? 'NOINDEX' : (hadOpus ? 'OK (Opus)' : 'OK (cached)'));

    } catch (err) {
      const msg = (err.stderr || err.message || '').slice(0, 200);
      warn(`FAILED: ${slug}: ${msg}`);
      errors.push({ slug, msg });
      results.push({ slug, ok: false, noindex: false });
      console.log('FAILED');
    }
  }

  const elapsed = Math.round((Date.now() - start) / 1000);

  // ── Report ─────────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log('GENERATE-ALL COMPLETE');
  console.log('='.repeat(70));
  console.log(`  Total players:      ${slugs.length}`);
  console.log(`  Pages built OK:     ${results.filter(r => r.ok && !r.noindex).length}`);
  console.log(`  Pages noindexed:    ${noindexed.length}`);
  console.log(`  Opus calls made:    ${opusCalls}`);
  console.log(`  Errors:             ${errors.length}`);
  console.log(`  Elapsed:            ${elapsed}s`);

  if (noindexed.length > 0) {
    console.log('\nNoindexed (thin) pages:');
    noindexed.forEach(s => console.log(`  ${s}`));
  }

  if (errors.length > 0) {
    console.log('\nFailed pages:');
    errors.forEach(e => console.log(`  ${e.slug}: ${e.msg}`));
  }

  // Build-time mapping report: brands with live pages but null dormied_brand_slug
  console.log('\n--- Brand mapping report ---');
  const { data: unmappedBrands } = await sb
    .from('witb_brands')
    .select('slug, name')
    .is('dormied_brand_slug', null);
  const brandsDir = path.join(ROOT, 'brands');
  const { readdirSync } = require('fs');
  const liveBrandSlugs = new Set(readdirSync(brandsDir).filter(d => {
    try { require('fs').statSync(path.join(brandsDir, d, 'index.html')); return true; } catch { return false; }
  }));
  const unlinkedBrands = (unmappedBrands || []).filter(b => liveBrandSlugs.has(b.slug));
  if (unlinkedBrands.length === 0) {
    console.log('  Equipment brands: all brands with live pages are wired up. ✓');
  } else {
    console.log(`  Equipment brands with live pages but null mapping (${unlinkedBrands.length}):`);
    unlinkedBrands.forEach(b => console.log(`    witb_brands.slug="${b.slug}" name="${b.name}"`));
  }

  // Shaft brand mapping report
  const { data: unmappedShafts } = await sb
    .from('witb_shafts')
    .select('brand_name')
    .is('dormied_brand_slug', null);
  const distinctUnmapped = [...new Set((unmappedShafts || []).map(s => s.brand_name).filter(Boolean))];
  const KNOWN_SHAFT_BRAND_MAP = {
    'True': 'true-temper', 'Fujikura': 'fujikura', 'Mitsubishi': 'mitsubishi-golf',
    'Nippon': 'nippon-shaft', 'Aldila': 'aldila', 'Graphite': 'graphite-design',
    'UST': 'ust-mamiya', 'KBS': 'kbs-golf', 'PING': 'ping', 'Accra': 'accra',
    'LA': 'la-golf', 'Aerotech': 'aerotech', 'TPT': 'tpt-golf',
    'Odyssey': 'odyssey-golf', 'Aretera': 'aretera',
  };
  const shaftsWithPage = distinctUnmapped.filter(bn => {
    const slug = KNOWN_SHAFT_BRAND_MAP[bn];
    if (!slug) return false;
    try { require('fs').statSync(path.join(brandsDir, slug, 'index.html')); return true; } catch { return false; }
  });
  if (shaftsWithPage.length === 0 && distinctUnmapped.length > 0) {
    const unknown = distinctUnmapped.filter(bn => !KNOWN_SHAFT_BRAND_MAP[bn]);
    if (unknown.length > 0) {
      console.log(`  Shaft brands with null slug (no live page): ${unknown.join(', ')}`);
    } else {
      console.log('  Shaft brands: all mapped. ✓');
    }
  } else if (shaftsWithPage.length > 0) {
    console.log(`  Shaft brands with live page but null mapping: ${shaftsWithPage.join(', ')}`);
  } else {
    console.log('  Shaft brands: all mapped. ✓');
  }

  console.log('='.repeat(70) + '\n');

  if (errors.length > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('[generate-all] Fatal:', err.message);
  process.exit(1);
});
