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
 * "new_player": true  (optional) confirms a new golfer when the duplicate guard
 * flags a near match by name (nickname, typo, name order, hyphenated surname).
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
// Accents are stripped first: without that, "Sami Välimäki" and "Sami Valimaki"
// normalise to different keys and the same player is created twice.
const normKey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

// ── Duplicate guard ──────────────────────────────────────────────────────────
// Exact slug/name matching misses the variants WITB sources actually use:
// "Bob MacIntyre" (our Robert MacIntyre), "Cam Young", "Zachary Bauchou",
// "Eugenio Lopez-Chacarra" vs "Eugenio Chacarra", surname-first "Lee Junghwan",
// and typos like "Miyua Yamashita". Any of those would have created a second
// player with a split bag history. So before CREATING, look for a near match
// and refuse unless the bag says "new_player": true. A false alarm costs one
// confirmation; a missed duplicate costs a merge.
const NICKNAMES = {
  bob: 'robert', rob: 'robert', bobby: 'robert', matt: 'matthew', matty: 'matthew',
  nico: 'nicolas', zach: 'zachary', zack: 'zachary', cam: 'cameron', dan: 'daniel',
  danny: 'daniel', chris: 'christopher', mike: 'michael', tom: 'thomas', tommy: 'thomas',
  nick: 'nicholas', ben: 'benjamin', sam: 'samuel', will: 'william', bill: 'william',
  billy: 'william', jim: 'james', jimmy: 'james', alex: 'alexander', andy: 'andrew',
  drew: 'andrew', joe: 'joseph', jon: 'jonathan', steve: 'steven', stephen: 'steven',
  pat: 'patrick', rick: 'richard', ricky: 'richard', dave: 'david', freddy: 'frederick',
  freddie: 'frederick', fred: 'frederick', ed: 'edward', eddie: 'edward', tony: 'anthony',
  greg: 'gregory', jeff: 'jeffrey', josh: 'joshua', abe: 'abraham', seb: 'sebastian',
  jeeno: 'atthaya',
};
function nameTokens(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\(.*?\)/g, '').replace(/[.']/g, '').split(/\s+/).filter(Boolean);
}
// Initials only count when WRITTEN as initials ("S.H.", "JT", "K.H."). A real
// two-letter name such as "Si" is not an initial, which is what flagged
// Seonghyeon Kim as a possible Si Woo Kim.
function writtenInitials(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  if (/^([A-Za-z]\.){1,3}$/.test(first) || /^[A-Z]{2,3}$/.test(first)) return first.replace(/\./g, '').toLowerCase();
  return null;
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Why `a` might be the same golfer as `b`, or null. */
function nearMatchReason(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return null;
  const lastA = ta[ta.length - 1], lastB = tb[tb.length - 1];
  const sharedSurname = lastA === lastB || lastA.split('-').some(x => lastB.split('-').includes(x));
  if (!sharedSurname) {
    return [...ta].sort().join(' ') === [...tb].sort().join(' ') ? 'same names in a different order' : null;
  }
  // Compare the WHOLE given name ("sei young" vs "si woo"), nickname-mapped.
  const givenA = [NICKNAMES[ta[0]] || ta[0], ...ta.slice(1, -1)].join('');
  const givenB = [NICKNAMES[tb[0]] || tb[0], ...tb.slice(1, -1)].join('');
  if (givenA === givenB) return 'same first name (nicknames resolved)';
  const initialsOf = toks => toks.slice(0, -1).flatMap(t => t.split('-')).map(t => t[0]).join('');
  const ia = writtenInitials(a), ib = writtenInitials(b);
  if ((ia && ia === initialsOf(tb)) || (ib && ib === initialsOf(ta))) return 'initials match';
  if (Math.min(givenA.length, givenB.length) >= 4 && editDistance(givenA, givenB) <= 1) return 'first name one letter apart';
  return null;
}
function nearMatches(name, players) {
  return players.map(p => ({ p, why: nearMatchReason(name, p.name) })).filter(x => x.why);
}

// Sub-brand handling is shared with the crawler so both write paths store a
// club identically. See scripts/lib/witb-brand-normalize.js.
const { normalizeBrandModel } = require('./lib/witb-brand-normalize');

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

/**
 * Mirror of witb-scrape.js detectChanges — records added/removed/swapped clubs.
 *
 * oldBagId may be null: that is a DEBUT, a player's first bag. It used to be
 * skipped entirely, on the reasoning that there is nothing to diff against. The
 * cost was that a new player never appeared in Freshest Bag, Recent Bag Updates
 * or the site-wide Recently Updated Bags module -- arriving with a full bag, the
 * most newsworthy update there is, was the one event that surfaced nowhere.
 *
 * A debut diffs against the empty bag, so every club comes out as 'added' with a
 * null old_bag_date. That null is the discriminator the renderers use to say
 * "new bag" rather than "11 changes": no row from a real diff has ever had one
 * (0 of 386 at the time of writing), because a real diff always knows the date
 * of the bag it replaced.
 */
async function detectChanges(supabase, player_id, oldBagId, newBagId, oldBagDate, newBagDate) {
  const [{ data: oldItems }, { data: newItems }] = await Promise.all([
    oldBagId
      ? supabase.from('witb_bag_items').select('club_type, raw_brand, raw_model').eq('bag_id', oldBagId)
      : Promise.resolve({ data: [] }),
    supabase.from('witb_bag_items').select('club_type, raw_brand, raw_model').eq('bag_id', newBagId),
  ]);
  // Never carry a stale date into a debut row; the discriminator depends on it.
  if (!oldBagId) oldBagDate = null;
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
    const near = nearMatches(player_name, players);
    if (near.length && bag.new_player !== true) {
      return { status: 'error', slug: player_slug,
        detail: `possible duplicate of ${near.map(x => `${x.p.name} (${x.p.slug}; ${x.why})`).join(', ')}. `
              + `Use that player's slug to update them, or set "new_player": true if this is a different golfer.` };
    }
    if (DRY) {
      // Remember the would-be player so a second spelling of the same golfer
      // later in this batch is caught by the guard, exactly as a real run is.
      players.push({ name: player_name, slug: player_slug, current_bag_id: null });
      return { status: 'created', slug: player_slug, detail: `would CREATE ${player_name}, ${items.length} items` };
    }
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

  // A debut (no oldBag) is diffed against the empty bag rather than skipped, so
  // the player reaches the freshness modules. Re-running the same bag_date is
  // still a no-op: oldBag is then this same bag and the id check short-circuits.
  let changeCount = 0;
  const isDebut = !oldBag;
  if (isDebut || oldBag.id !== bag_id) {
    const changes = await detectChanges(
      supabase, player.id,
      isDebut ? null : oldBag.id, bag_id,
      isDebut ? null : oldBag.bag_date, bag_date);
    changeCount = changes.length;
    changes.forEach(c => console.log(`  ${c.change_type}: ${c.club_type}  ${c.old_value || '-'} -> ${c.new_value || '-'}`));
  }
  const detail = created
    ? `${items.length} items (new player, ${changeCount} debut row(s))`
    : `${items.length} items, ${changeCount} change(s)`;
  return { status: created ? 'created' : 'updated', slug: player.slug, detail };
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

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(e => { console.error('[manual] Fatal:', e.message); process.exit(1); });
}