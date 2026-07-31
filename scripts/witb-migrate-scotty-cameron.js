#!/usr/bin/env node
/**
 * scripts/witb-migrate-scotty-cameron.js
 *
 * One-off backfill: reassign Scotty Cameron clubs from Titleist to their own
 * brand, matching the rule the rest of the site already follows (a sub-brand
 * with its own DORMIED brand page gets its own witb_brands row — see
 * scripts/lib/witb-brand-normalize.js, which keeps both write paths in line
 * going forward).
 *
 * Rewrites, for every item whose model carries the "Scotty Cameron" prefix:
 *   raw_brand  "Titleist"                  -> "Scotty Cameron"
 *   raw_model  "Scotty Cameron Phantom 11" -> "Phantom 11"
 *   brand_id   -> the scotty-cameron witb_brands row
 * plus the matching witb_clubheads rows, and maps the brand row to
 * /brands/scotty-cameron/ so the logo and link render.
 *
 * Idempotent: rows already promoted are skipped, so a re-run is a no-op.
 *
 * Usage:
 *   node scripts/witb-migrate-scotty-cameron.js --dry-run
 *   node scripts/witb-migrate-scotty-cameron.js
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');
const { normalizeBrandModel } = require('./lib/witb-brand-normalize');

const DRY = process.argv.includes('--dry-run');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log(`[scotty] ${DRY ? 'DRY RUN' : 'LIVE'}\n`);

  // 1. The destination brand row, mapped to its DORMIED page.
  let brand;
  if (DRY) {
    const { data, error } = await sb.from('witb_brands')
      .select('id, slug, dormied_brand_slug').eq('slug', 'scotty-cameron').maybeSingle();
    if (error) { console.error('brand read failed:', error.message); process.exit(1); }
    brand = data;
    if (!brand) { console.error('no scotty-cameron brand row to migrate into'); process.exit(1); }
    console.log(`[scotty] brand row ${brand.slug}: dormied_brand_slug="${brand.dormied_brand_slug}" -> would set "scotty-cameron"`);
  } else {
    const { data, error } = await sb.from('witb_brands')
      .upsert({ slug: 'scotty-cameron', name: 'Scotty Cameron',
                dormied_brand_slug: 'scotty-cameron',
                last_updated: new Date().toISOString() },
              { onConflict: 'slug' })
      .select('id, slug, dormied_brand_slug').single();
    if (error) { console.error('brand upsert failed:', error.message); process.exit(1); }
    brand = data;
    console.log(`[scotty] brand row ${brand.slug} -> dormied_brand_slug="${brand.dormied_brand_slug}"`);
  }

  // 2. Items still carrying the prefix under the parent brand.
  const { data: items, error: iErr } = await sb.from('witb_bag_items')
    .select('id, raw_brand, raw_model, brand_id')
    .ilike('raw_model', 'Scotty Cameron%');
  if (iErr) { console.error('item fetch failed:', iErr.message); process.exit(1); }

  let itemsChanged = 0, itemsSkipped = 0;
  for (const it of items) {
    const norm = normalizeBrandModel(it.raw_brand, it.raw_model);
    if (!norm.promoted) { itemsSkipped++; continue; }
    if (it.raw_brand === 'Scotty Cameron' && it.brand_id === brand.id) { itemsSkipped++; continue; }
    if (DRY) { itemsChanged++; continue; }
    const { error } = await sb.from('witb_bag_items')
      .update({ raw_brand: norm.raw_brand, raw_model: norm.raw_model, brand_id: brand.id })
      .eq('id', it.id);
    if (error) console.warn(`  item ${it.id}: ${error.message}`); else itemsChanged++;
  }
  console.log(`[scotty] bag items: ${itemsChanged} ${DRY ? 'would be ' : ''}rewritten, ${itemsSkipped} already correct`);

  // 3. Clubheads carry their own brand_id and model, so mirror the change.
  const { data: heads, error: hErr } = await sb.from('witb_clubheads')
    .select('id, model, brand_id').ilike('model', 'Scotty Cameron%');
  if (hErr) { console.error('clubhead fetch failed:', hErr.message); process.exit(1); }

  let headsChanged = 0, headsSkipped = 0;
  for (const h of heads) {
    const model = h.model.replace(/^\s*Scotty Cameron\s*/i, '').trim() || h.model;
    if (h.brand_id === brand.id && model === h.model) { headsSkipped++; continue; }
    if (DRY) { headsChanged++; continue; }
    const { error } = await sb.from('witb_clubheads')
      .update({ model, brand_id: brand.id }).eq('id', h.id);
    if (error) console.warn(`  clubhead ${h.id}: ${error.message}`); else headsChanged++;
  }
  console.log(`[scotty] clubheads: ${headsChanged} ${DRY ? 'would be ' : ''}rewritten, ${headsSkipped} already correct`);

  if (!DRY) {
    console.log('\n[scotty] re-bake so the change propagates:');
    console.log('  node scripts/generate-brand-page.js scotty-cameron --force');
    console.log('  node scripts/generate-brand-page.js titleist --force');
    console.log('  node scripts/generate-witb-page.js');
    console.log('  node scripts/generate-witb-players-page.js');
    console.log('  (plus generate-witb-player-page.js for each affected player)');
  }
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}