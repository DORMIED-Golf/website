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

// Normalized key for tolerant name/slug matching ("Si Woo Kim" == "Siwoo Kim").
const normKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Sub-brands the site stores under a parent brand so the parent's logo + /brands
// link render (e.g. a Scotty Cameron putter is a Titleist item with the model
// carrying "Scotty Cameron ..."). Keeps manual entries consistent with scraped.
const BRAND_PARENT = { 'scotty cameron': 'Titleist' };
function normalizeBrandModel(rawBrand, rawModel) {
  const parent = BRAND_PARENT[(rawBrand || '').toLowerCase().trim()];
  if (!parent) return { raw_brand: rawBrand, raw_model: rawModel };
  const model = (rawModel && normKey(rawModel).includes(normKey(rawBrand)))
    ? rawModel : `${rawBrand} ${rawModel || ''}`.trim();
  return { raw_brand: parent, raw_model: model };
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

// Apply one bag. Returns { status: 'updated'|'skipped'|'error', slug, detail }.
// Never throws for per-bag problems (missing player, regression) so a batch run
// continues; only genuine infra errors bubble up.
async function applyBag(supabase, bag, players) {
  const { player_slug, player_name = null, bag_date, source_credit = null, source_url = null, items = [] } = bag || {};
  if (!player_slug || !bag_date || !items.length) return { status: 'error', slug: player_slug || '(no slug)', detail: 'needs player_slug, bag_date, non-empty items' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bag_date)) return { status: 'error', slug: player_slug, detail: `bag_date must be YYYY-MM-DD, got "${bag_date}"` };

  // Resolve the player tolerantly: exact slug, then normalized slug/name (so
  // "si-woo-kim"/"Si Woo Kim" finds the existing "siwoo-kim"/"Siwoo Kim" instead
  // of creating a duplicate). Only create when there is genuinely no match.
  let player = players.find(p => p.slug === player_slug)
            || players.find(p => normKey(p.slug) === normKey(player_slug))
            || (player_name && players.find(p => normKey(p.name) === normKey(player_name)))
            || null;
  let created = false;
  if (!player) {
    if (!player_name) return { status: 'error', slug: player_slug, detail: 'new player needs player_name to create' };
    if (DRY) return { status: 'created', slug: player_slug, detail: `would CREATE ${player_name}, ${items.length} items` };
    const { data: np, error: npErr } = await supabase.from('witb_players')
      .insert({ slug: player_slug, name: player_name, source_url: source_url || 'manual' })
      .select('id, name, slug, current_bag_id, source_url').single();
    if (npErr) return { status: 'error', slug: player_slug, detail: `create player: ${npErr.message}` };
    player = np; created = true;
    players.push(player);
  }

  const bagSourceUrl = source_url || player.source_url || 'manual';

  let oldBag = null;
  if (player.current_bag_id) {
    const { data } = await supabase.from('witb_bags').select('id, bag_date').eq('id', player.current_bag_id).single();
    oldBag = data || null;
    if (oldBag && oldBag.bag_date && bag_date < oldBag.bag_date) {
      return { status: 'skipped', slug: player_slug, detail: `would regress: ${bag_date} older than current ${oldBag.bag_date}` };
    }
  }

  console.log(`[manual] ${player.name} (${player_slug}) -> ${bag_date}, ${items.length} items${DRY ? '  (DRY RUN)' : ''}`);
  if (DRY) {
    items.forEach((it, i) => console.log(`  ${i + 1}. ${it.club_type}: ${it.raw_brand} ${it.raw_model}${it.loft_or_number ? ' (' + it.loft_or_number + ')' : ''}${it.raw_shaft ? ' / ' + it.raw_shaft : ''}`));
    return { status: 'updated', slug: player_slug, detail: `${items.length} items (dry-run, current ${oldBag ? oldBag.bag_date : 'none'})` };
  }

  // Demote prior current bag(s), upsert on (player_id, bag_date) — never duplicates
  await supabase.from('witb_bags').update({ is_current: false }).eq('player_id', player.id).eq('is_current', true);
  const { data: bagRow, error: bagErr } = await supabase.from('witb_bags')
    .upsert({ player_id: player.id, bag_date, source_url: bagSourceUrl, source_credit, is_current: true, scraped_at: new Date().toISOString() },
            { onConflict: 'player_id,bag_date', ignoreDuplicates: false })
    .select('id').single();
  if (bagErr) return { status: 'error', slug: player_slug, detail: `bag upsert: ${bagErr.message}` };
  const bag_id = bagRow.id;

  await supabase.from('witb_bag_items').delete().eq('bag_id', bag_id);
  let position = 0;
  for (const it of items) {
    position++;
    const club_type = slugify(it.club_type);
    const { raw_brand, raw_model } = normalizeBrandModel(it.raw_brand, it.raw_model);
    const brand_id  = raw_brand ? await upsertBrand(supabase, { slug: slugify(raw_brand), name: raw_brand }) : null;
    const clubhead_id = (raw_brand && raw_model)
      ? await upsertClubhead(supabase, { slug: slugify(`${raw_brand}-${raw_model}`), brand_id, model: raw_model, club_type })
      : null;
    const shaftSlug = inferShaftSlug(it.raw_shaft);
    const shaft_id  = shaftSlug ? await upsertShaft(supabase, { slug: shaftSlug, model: it.raw_shaft }) : null;
    const { error: iErr } = await supabase.from('witb_bag_items').insert({
      bag_id, club_type, brand_id, clubhead_id, shaft_id,
      loft_or_number: it.loft_or_number || null, raw_brand: raw_brand || null,
      raw_model: raw_model || null, raw_shaft: it.raw_shaft || null, position,
    });
    if (iErr) console.warn(`  item ${position} (${club_type}): ${iErr.message}`);
  }

  await supabase.from('witb_players')
    .update({ current_bag_id: bag_id, last_updated: new Date().toISOString() }).eq('id', player.id);

  let changeCount = 0;
  if (oldBag && oldBag.id !== bag_id) {
    const changes = await detectChanges(supabase, player.id, oldBag.id, bag_id, oldBag.bag_date, bag_date);
    changeCount = changes.length;
    changes.forEach(c => console.log(`  ${c.change_type}: ${c.club_type}  ${c.old_value || '-'} -> ${c.new_value || '-'}`));
  }
  return { status: created ? 'created' : 'updated', slug: player.slug, detail: `${items.length} items${created ? ' (new player)' : `, ${changeCount} change(s)`}` };
}

async function main() {
  const jsonPath = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!jsonPath) { console.error('Usage: node scripts/witb-manual-update.js path/to/bags.json [--dry-run]'); process.exit(1); }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Accept a single bag object, a top-level array, or { bags: [...] }.
  const parsed = JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
  const bags = Array.isArray(parsed) ? parsed : Array.isArray(parsed.bags) ? parsed.bags : [parsed];
  console.log(`[manual] ${bags.length} bag(s) to process${DRY ? '  (DRY RUN)' : ''}\n`);

  // One fetch of every player for tolerant slug/name resolution + de-dup.
  const { data: players, error: plErr } = await supabase.from('witb_players')
    .select('id, name, slug, current_bag_id, source_url');
  if (plErr) throw new Error(`load players: ${plErr.message}`);

  const results = [];
  for (const bag of bags) results.push(await applyBag(supabase, bag, players));

  const by = s => results.filter(r => r.status === s);
  console.log(`\n[manual] summary: ${by('updated').length} updated, ${by('created').length} created, ${by('skipped').length} skipped, ${by('error').length} error`);
  for (const r of results) console.log(`  ${r.status.toUpperCase().padEnd(7)} ${r.slug}${r.detail ? ' — ' + r.detail : ''}`);

  const touched = [...by('updated'), ...by('created')].map(r => r.slug);
  if (!DRY && touched.length) {
    console.log('\n[manual] next, re-bake so the changes propagate everywhere:');
    if (by('created').length) console.log('  node scripts/witb-owgr-refresh.js           # ranks/country for new players (page-gen skips unranked)');
    touched.forEach(s => console.log(`  node scripts/generate-witb-player-page.js ${s}`));
    console.log('  node scripts/generate-witb-page.js          # /witb: This Week\'s Bag Moves + stats');
    console.log('  node scripts/generate-witb-players-page.js  # /witb/players: Find a Player grid');
    console.log('  node scripts/refresh-modules.js             # Recently Updated Bags sidebar, site-wide');
  }
}

main().catch(e => { console.error('[manual] Fatal:', e.message); process.exit(1); });
