#!/usr/bin/env node
/**
 * scripts/witb-manual-update.js
 *
 * Manually update a player's current WITB bag from a structured JSON file,
 * using the EXACT same storage path as the automated crawler (witb-scrape.js):
 * it demotes the prior current bag, upserts the new bag on (player_id, bag_date)
 * so re-runs never duplicate, fully replaces the bag's items, repoints
 * witb_players.current_bag_id, and records a witb_changes diff so the change
 * shows up in the "Recently Updated Bags" freshness module.
 *
 * This exists so fresh bag details can be published between (or ahead of) the
 * weekly pgaclubtracker crawl. The crawler is "newer-date-wins" (see
 * witb-scrape.js runWeeklyCrawl), so a manual bag dated ahead of the stale
 * source is NOT reverted on the next crawl; automation resumes once the source
 * publishes a genuinely newer bag.
 *
 * Usage:
 *   node scripts/witb-manual-update.js path/to/bag.json
 *   node scripts/witb-manual-update.js path/to/bag.json --dry-run
 *
 * JSON shape:
 *   {
 *     "player_slug": "billy-horschel",
 *     "bag_date": "2026-07-21",           // YYYY-MM-DD, the source's publish date
 *     "source_credit": "Will Schube",      // optional attribution
 *     "source_url": "https://...",         // optional
 *     "items": [
 *       { "club_type": "driver", "raw_brand": "Titleist", "raw_model": "GTS3",
 *         "loft_or_number": "9 degrees", "raw_shaft": "Fujikura Ventus Black TR 6 X" },
 *       ...
 *     ]
 *   }
 * club_type is one of: driver, 3-wood, 5-wood, 7-wood, hybrid, iron, wedge,
 * putter, grip, ball (free text; it is slugified). loft_or_number / raw_shaft
 * may be omitted for putter/grip/ball.
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const fs               = require('fs');
const path             = require('path');
const { createClient } = require('@supabase/supabase-js');

const DRY = process.argv.includes('--dry-run');

function slugify(text) {
  return String(text || '').toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferShaftSlug(rawShaft) {
  if (!rawShaft || rawShaft === '-' || rawShaft === '--') return null;
  return 'shaft-' + slugify(rawShaft).slice(0, 80);
}

// Upsert a brand on slug, never clobbering its existing dormied_brand_slug
// mapping (that column is not in the payload, so ON CONFLICT leaves it intact).
async function upsertBrand(supabase, { slug, name }) {
  if (!slug) return null;
  const { data, error } = await supabase.from('witb_brands')
    .upsert({ slug, name: name || slug, last_updated: new Date().toISOString() },
            { onConflict: 'slug', ignoreDuplicates: false })
    .select('id').single();
  if (error) { console.warn(`  upsertBrand ${slug}: ${error.message}`); return null; }
  return data?.id || null;
}

async function upsertClubhead(supabase, { slug, brand_id, model, club_type }) {
  if (!slug) return null;
  const { data, error } = await supabase.from('witb_clubheads')
    .upsert({ slug, brand_id, model: model || slug, club_type: club_type || 'unknown',
              last_updated: new Date().toISOString() },
            { onConflict: 'slug', ignoreDuplicates: false })
    .select('id').single();
  if (error) { console.warn(`  upsertClubhead ${slug}: ${error.message}`); return null; }
  return data?.id || null;
}

async function upsertShaft(supabase, { slug, model }) {
  if (!slug) return null;
  const brand_name = model ? model.split(' ')[0] : null;
  const { data, error } = await supabase.from('witb_shafts')
    .upsert({ slug, brand_name, model: model || slug, last_updated: new Date().toISOString() },
            { onConflict: 'slug', ignoreDuplicates: false })
    .select('id').single();
  if (error) { console.warn(`  upsertShaft ${slug}: ${error.message}`); return null; }
  return data?.id || null;
}

// Mirror of witb-scrape.js detectChanges — records added/removed/swapped clubs.
async function detectChanges(supabase, player_id, oldBagId, newBagId, oldBagDate, newBagDate) {
  const [{ data: oldItems }, { data: newItems }] = await Promise.all([
    supabase.from('witb_bag_items').select('club_type, raw_brand, raw_model').eq('bag_id', oldBagId),
    supabase.from('witb_bag_items').select('club_type, raw_brand, raw_model').eq('bag_id', newBagId),
  ]);
  const toMap = rows => {
    const m = {};
    for (const i of (rows || [])) m[i.club_type] = `${i.raw_brand || ''} ${i.raw_model || ''}`.trim();
    return m;
  };
  const oldMap = toMap(oldItems), newMap = toMap(newItems);
  const changes = [];
  for (const club_type of new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
    const o = oldMap[club_type], n = newMap[club_type];
    if (!o && n)       changes.push({ player_id, club_type, change_type: 'added',   old_value: null, new_value: n,    old_bag_date: oldBagDate, new_bag_date: newBagDate });
    else if (o && !n)  changes.push({ player_id, club_type, change_type: 'removed', old_value: o,    new_value: null, old_bag_date: oldBagDate, new_bag_date: newBagDate });
    else if (o && n && o !== n) changes.push({ player_id, club_type, change_type: 'swapped', old_value: o, new_value: n, old_bag_date: oldBagDate, new_bag_date: newBagDate });
  }
  if (changes.length && !DRY) {
    const { error } = await supabase.from('witb_changes').insert(changes);
    if (error) console.warn(`  witb_changes insert: ${error.message}`);
  }
  return changes;
}

async function main() {
  const jsonPath = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!jsonPath) { console.error('Usage: node scripts/witb-manual-update.js path/to/bag.json [--dry-run]'); process.exit(1); }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const bag = JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
  const { player_slug, bag_date, source_credit = null, source_url = null, items = [] } = bag;
  if (!player_slug || !bag_date || !items.length) throw new Error('JSON needs player_slug, bag_date, and non-empty items');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bag_date)) throw new Error(`bag_date must be YYYY-MM-DD, got "${bag_date}"`);

  // Resolve player
  const { data: player, error: pErr } = await supabase.from('witb_players')
    .select('id, name, current_bag_id, source_url').eq('slug', player_slug).single();
  if (pErr || !player) throw new Error(`Player not found for slug "${player_slug}"${pErr ? ': ' + pErr.message : ''}`);

  // witb_bags.source_url is NOT NULL; fall back to the player's source page.
  const bagSourceUrl = source_url || player.source_url || 'manual';

  // Guard against regressing to an older bag than what is stored.
  let oldBag = null;
  if (player.current_bag_id) {
    const { data } = await supabase.from('witb_bags').select('id, bag_date').eq('id', player.current_bag_id).single();
    oldBag = data || null;
    if (oldBag && oldBag.bag_date && bag_date < oldBag.bag_date) {
      throw new Error(`Refusing to regress: new bag_date ${bag_date} is older than current ${oldBag.bag_date}. Use a newer date or delete the newer bag first.`);
    }
  }

  console.log(`[manual] ${player.name} (${player_slug}) -> bag_date ${bag_date}, ${items.length} items${DRY ? '  (DRY RUN)' : ''}`);
  if (oldBag) console.log(`[manual] current bag: ${oldBag.bag_date} (${oldBag.id})`);

  if (DRY) {
    items.forEach((it, i) => console.log(`  ${i + 1}. ${it.club_type}: ${it.raw_brand} ${it.raw_model}${it.loft_or_number ? ' (' + it.loft_or_number + ')' : ''}${it.raw_shaft ? ' / ' + it.raw_shaft : ''}`));
    if (oldBag) console.log('[manual] (dry-run) would diff against current bag for witb_changes');
    return;
  }

  // Demote prior current bag(s)
  await supabase.from('witb_bags').update({ is_current: false })
    .eq('player_id', player.id).eq('is_current', true);

  // Upsert the bag on (player_id, bag_date) — idempotent, never duplicates
  const { data: bagRow, error: bagErr } = await supabase.from('witb_bags')
    .upsert({ player_id: player.id, bag_date, source_url: bagSourceUrl, source_credit, is_current: true,
              scraped_at: new Date().toISOString() },
            { onConflict: 'player_id,bag_date', ignoreDuplicates: false })
    .select('id').single();
  if (bagErr) throw new Error(`bag upsert: ${bagErr.message}`);
  const bag_id = bagRow.id;

  // Full replace of items
  await supabase.from('witb_bag_items').delete().eq('bag_id', bag_id);

  let position = 0;
  for (const it of items) {
    position++;
    const club_type = slugify(it.club_type);
    const brand_id  = it.raw_brand ? await upsertBrand(supabase, { slug: slugify(it.raw_brand), name: it.raw_brand }) : null;
    const clubhead_id = (it.raw_brand && it.raw_model)
      ? await upsertClubhead(supabase, { slug: slugify(`${it.raw_brand}-${it.raw_model}`), brand_id, model: it.raw_model, club_type })
      : null;
    const shaftSlug = inferShaftSlug(it.raw_shaft);
    const shaft_id  = shaftSlug ? await upsertShaft(supabase, { slug: shaftSlug, model: it.raw_shaft }) : null;

    const { error: iErr } = await supabase.from('witb_bag_items').insert({
      bag_id, club_type, brand_id, clubhead_id, shaft_id,
      loft_or_number: it.loft_or_number || null,
      raw_brand: it.raw_brand || null,
      raw_model: it.raw_model || null,
      raw_shaft: it.raw_shaft || null,
      position,
    });
    if (iErr) console.warn(`  item ${position} (${club_type}): ${iErr.message}`);
  }

  // Repoint current bag + freshness timestamp
  await supabase.from('witb_players')
    .update({ current_bag_id: bag_id, last_updated: new Date().toISOString() })
    .eq('id', player.id);

  // Record the diff for the "Recently Updated Bags" module (skip if same bag row)
  let changeCount = 0;
  if (oldBag && oldBag.id !== bag_id) {
    const changes = await detectChanges(supabase, player.id, oldBag.id, bag_id, oldBag.bag_date, bag_date);
    changeCount = changes.length;
    changes.forEach(c => console.log(`  ${c.change_type}: ${c.club_type}  ${c.old_value || '-'} -> ${c.new_value || '-'}`));
  }

  console.log(`[manual] done: bag ${bag_id} is now current for ${player.name}; ${changeCount} change(s) recorded.`);
  console.log(`[manual] next: re-bake the page ->  node scripts/generate-witb-player-page.js ${player_slug}`);
}

main().catch(e => { console.error('[manual] Fatal:', e.message); process.exit(1); });
