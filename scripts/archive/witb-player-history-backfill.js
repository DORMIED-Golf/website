#!/usr/bin/env node
/**
 * scripts/witb-player-history-backfill.js
 *
 * Generalized historical bag backfill for any list of WITB player slugs.
 * Fetches every historical WITB snapshot from PGAClubTracker and
 * inserts them into witb_bags / witb_bag_items.
 *
 * Safe to re-run: upserts on (player_id, bag_date) — no duplicates.
 * Does NOT touch any player's current bag (is_current=true).
 *
 * Usage:
 *   node scripts/witb-player-history-backfill.js                      # runs TARGET_SLUGS
 *   node scripts/witb-player-history-backfill.js scottie-scheffler    # single slug
 *   node scripts/witb-player-history-backfill.js slug1 slug2 slug3    # explicit list
 *
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const cheerio          = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL      = 'https://www.pgaclubtracker.com';
const USER_AGENT    = 'DORMIED-WITB-Bot/1.0 (+https://dormied.com)';
const RATE_LIMIT_MS = 4000;
const MAX_RETRIES   = 3;
const RETRY_DELAY_MS = 10000;

/** Default target slugs when no CLI args are given */
const TARGET_SLUGS = [
  'scottie-scheffler',
  'rory-mcilroy',
  'collin-morikawa',
  'justin-thomas',
  'jordan-spieth',
  'bryson-dechambeau',
  'brooks-koepka',
  'cameron-young',
  'matthew-fitzpatrick',
  'justin-rose',
];

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(text) {
  return String(text || '').toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str.trim());
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function warn(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.warn(`[${ts}] WARN: ${msg}`);
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

let lastRequestAt = 0;

async function fetchPage(url, retries = MAX_RETRIES) {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - elapsed);
  lastRequestAt = Date.now();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 404) return null;
      if (res.status === 500 || res.status === 503) return null;
      if (!res.ok) {
        if (attempt < retries) {
          warn(`HTTP ${res.status} on ${url}, retry ${attempt}/${retries}`);
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (err) {
      if (attempt < retries) {
        warn(`Fetch error on ${url}: ${err.message}, retry ${attempt}/${retries}`);
        await sleep(RETRY_DELAY_MS * attempt);
      } else {
        throw err;
      }
    }
  }
}

// ── HTML Parsing ──────────────────────────────────────────────────────────────

function parseBagTable($) {
  const items = [];
  let bagTable = null;
  $('table').each((_, tbl) => {
    const headers = $(tbl).find('th').map((_, th) => $(th).text().trim().toLowerCase()).get();
    if (headers.includes('club') && headers.includes('brand') && headers.includes('model')) {
      bagTable = tbl;
    }
  });
  if (!bagTable) return items;

  $(bagTable).find('tbody tr, tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) return;

    const clubType  = cells.eq(0).text().trim();
    const brandCell = cells.eq(1);
    const modelCell = cells.eq(2);
    const loftCell  = cells.eq(3);
    const shaftCell = cells.length >= 5 ? cells.eq(4) : null;

    if (!clubType || clubType.toLowerCase() === 'club') return;

    const brandLink    = brandCell.find('a').first();
    const brandHref    = brandLink.attr('href') || '';
    const brandSlug    = brandHref.replace('/brands/', '').replace(/-tour-players.*$/, '').trim() || null;
    const rawBrand     = normalizeEquipmentString(brandCell.text().trim());

    const modelLink    = modelCell.find('a').first();
    const modelHref    = modelLink.attr('href') || '';
    const clubheadSlug = modelHref.startsWith('/clubheads/')
      ? modelHref.replace('/clubheads/', '').replace(/\/$/, '')
      : null;
    const rawModel = normalizeEquipmentString(modelCell.text().trim());

    const rawShaft  = shaftCell ? normalizeEquipmentString(shaftCell.text().trim()) : '';
    const shaftLink = shaftCell ? shaftCell.find('a').first() : null;
    const shaftHref = shaftLink ? (shaftLink.attr('href') || '') : '';
    const shaftSlug = shaftHref.startsWith('/shafts/')
      ? shaftHref.replace('/shafts/', '').replace(/\/$/, '')
      : null;

    const loftRaw      = loftCell.text().trim();
    const loftOrNumber = (loftRaw && loftRaw !== '-' && loftRaw !== '--') ? loftRaw : null;

    items.push({
      club_type:      clubType,
      raw_brand:      rawBrand !== '-' ? rawBrand : null,
      brand_slug:     brandSlug,
      brand_url:      brandHref ? `${BASE_URL}${brandHref}` : null,
      raw_model:      rawModel !== '-' ? rawModel : null,
      clubhead_slug:  clubheadSlug,
      clubhead_url:   modelHref ? `${BASE_URL}${modelHref}` : null,
      raw_shaft:      (rawShaft && rawShaft !== '-' && rawShaft !== '--') ? rawShaft : null,
      shaft_slug:     shaftSlug,
      shaft_url:      shaftHref ? `${BASE_URL}${shaftHref}` : null,
      loft_or_number: loftOrNumber,
      position:       i,
    });
  });

  return items;
}

function parseBagDate($) {
  let found = null;
  $('h1, h2, h3, h4, h5').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const m = text.match(/([A-Za-z]+ \d{1,2},?\s*\d{4})/);
    if (m) { found = m[1]; return false; }
  });
  return found ? parseDate(found) : null;
}

function parseSourceCredit($) {
  let credit = null;
  const sourceText = $('*').filter((_, el) => /source:/i.test($(el).text())).first();
  if (sourceText.length) {
    const link = sourceText.find('a').first();
    if (link.length) credit = link.attr('href') || link.text().trim();
  }
  return credit;
}

function parseHistoricalBagLinks($) {
  const links = [];
  $('table').each((_, tbl) => {
    const firstHeader = $(tbl).find('th').first().text().trim().toLowerCase();
    if (firstHeader !== 'date') return;

    $(tbl).find('tbody tr, tr').each((_, row) => {
      const dateCell = $(row).find('td').first();
      const link     = dateCell.find('a').first();
      const href     = link.attr('href') || '';
      if (href.startsWith('/bags/')) {
        links.push({
          url:       `${BASE_URL}${href}`,
          date_text: dateCell.text().trim(),
        });
      }
    });
  });
  return links;
}

// ── String normalization ──────────────────────────────────────────────────────

/**
 * Normalize a raw equipment string scraped from HTML.
 * Strips trailing whitespace and dangling unmatched "(" characters that appear
 * when source HTML is truncated mid-string (e.g. "LA Golf (" -> "LA Golf").
 * Returns null for empty results so DB columns stay clean.
 */
function normalizeEquipmentString(s) {
  if (!s || typeof s !== 'string') return s;
  let out = s.trim();
  // Strip trailing dangling "(" (may recur after trimming)
  while (out.endsWith('(')) out = out.slice(0, -1).trimEnd();
  return out || null;
}

// ── Shaft slug inference ──────────────────────────────────────────────────────

function inferShaftSlug(rawShaft) {
  if (!rawShaft || rawShaft === '-' || rawShaft === '--') return null;
  return 'shaft-' + slugify(rawShaft).slice(0, 80);
}

// ── Supabase Entity Upserts ───────────────────────────────────────────────────

async function upsertBrand(supabase, { slug, name, source_url }) {
  if (!slug) return null;
  const { data, error } = await supabase
    .from('witb_brands')
    .upsert({ slug, name: name || slug, source_url, last_updated: new Date().toISOString() },
             { onConflict: 'slug', ignoreDuplicates: false })
    .select('id')
    .single();
  if (error) { warn(`upsertBrand ${slug}: ${error.message}`); return null; }
  return data?.id || null;
}

async function upsertClubhead(supabase, { slug, brand_id, model, club_type, source_url }) {
  if (!slug) return null;
  const cleanModel = normalizeEquipmentString(model) || slug;
  const { data, error } = await supabase
    .from('witb_clubheads')
    .upsert({ slug, brand_id, model: cleanModel, club_type: club_type || 'unknown',
              source_url, last_updated: new Date().toISOString() },
             { onConflict: 'slug', ignoreDuplicates: false })
    .select('id')
    .single();
  if (error) { warn(`upsertClubhead ${slug}: ${error.message}`); return null; }
  return data?.id || null;
}

async function upsertShaft(supabase, { slug, brand_name, model, source_url }) {
  if (!slug) return null;
  // Normalize: strip trailing whitespace and dangling "(" from model strings
  const cleanModel = normalizeEquipmentString(model) || slug;
  if (!brand_name && cleanModel) brand_name = cleanModel.split(' ')[0];
  const { data, error } = await supabase
    .from('witb_shafts')
    .upsert({ slug, brand_name, model: cleanModel, source_url,
              last_updated: new Date().toISOString() },
             { onConflict: 'slug', ignoreDuplicates: false })
    .select('id')
    .single();
  if (error) { warn(`upsertShaft ${slug}: ${error.message}`); return null; }
  return data?.id || null;
}

// ── Bag Insertion ─────────────────────────────────────────────────────────────

/**
 * Upsert one historical bag + its items.
 * Never touches is_current; all historical bags go in with is_current=false.
 */
async function insertHistoricalBag(supabase, { player_id, bag_date, source_url, source_credit, items }) {
  const { data: bagRow, error: bagErr } = await supabase
    .from('witb_bags')
    .upsert(
      { player_id, bag_date, source_url, source_credit: source_credit || null, is_current: false },
      { onConflict: 'player_id,bag_date', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (bagErr) return { bag_id: null, error: bagErr.message };
  const bag_id = bagRow.id;

  // Full replace of items on re-run (idempotent)
  await supabase.from('witb_bag_items').delete().eq('bag_id', bag_id);

  for (const item of items) {
    let brand_id    = null;
    let clubhead_id = null;
    let shaft_id    = null;

    if (item.brand_slug) {
      brand_id = await upsertBrand(supabase, {
        slug:       item.brand_slug,
        name:       item.raw_brand || item.brand_slug,
        source_url: item.brand_url,
      });
    }

    if (item.clubhead_slug) {
      clubhead_id = await upsertClubhead(supabase, {
        slug:       item.clubhead_slug,
        brand_id,
        model:      item.raw_model || item.clubhead_slug,
        club_type:  slugify(item.club_type),
        source_url: item.clubhead_url,
      });
    }

    let shaftSlug = item.shaft_slug;
    if (!shaftSlug && item.raw_shaft) shaftSlug = inferShaftSlug(item.raw_shaft);
    if (shaftSlug) {
      shaft_id = await upsertShaft(supabase, {
        slug:       shaftSlug,
        brand_name: null,
        model:      item.raw_shaft || shaftSlug,
        source_url: item.shaft_url,
      });
    }

    const { error: itemErr } = await supabase.from('witb_bag_items').insert({
      bag_id,
      club_type:      slugify(item.club_type),
      brand_id,
      clubhead_id,
      shaft_id,
      loft_or_number: item.loft_or_number,
      raw_brand:      item.raw_brand,
      raw_model:      item.raw_model,
      raw_shaft:      item.raw_shaft,
      position:       item.position,
    });
    if (itemErr) warn(`bag_item insert error (bag ${bag_id}): ${itemErr.message}`);
  }

  return { bag_id, error: null };
}

// ── Per-Player Backfill ───────────────────────────────────────────────────────

/**
 * Build the PGAClubTracker player URL from a slug.
 * Pattern: /players/{slug}-witb-whats-in-the-bag
 */
function playerTrackerUrl(slug) {
  return `${BASE_URL}/players/${slug}-witb-whats-in-the-bag`;
}

async function backfillPlayer(supabase, slug) {
  log(`\n${'='.repeat(60)}`);
  log(`PLAYER: ${slug}`);
  log('='.repeat(60));

  // 1. Resolve player row
  const { data: playerRow, error: playerErr } = await supabase
    .from('witb_players')
    .select('id, name, owgr_rank')
    .eq('slug', slug)
    .maybeSingle();

  if (playerErr) {
    warn(`DB error looking up ${slug}: ${playerErr.message}`);
    return { slug, inserted: 0, skipped: 0, failed: 0, error: playerErr.message };
  }
  if (!playerRow) {
    warn(`Player not found in witb_players: slug='${slug}' — skipping`);
    return { slug, inserted: 0, skipped: 0, failed: 0, error: 'player not found in DB' };
  }

  const { id: player_id, name } = playerRow;
  log(`Found: id=${player_id}, name="${name}", owgr=${playerRow.owgr_rank}`);

  // 2. Load existing bag dates (for idempotency)
  const { data: existingBags, error: ebErr } = await supabase
    .from('witb_bags')
    .select('bag_date, is_current, id')
    .eq('player_id', player_id)
    .order('bag_date', { ascending: false });

  if (ebErr) {
    warn(`Could not load existing bags for ${slug}: ${ebErr.message}`);
    return { slug, inserted: 0, skipped: 0, failed: 0, error: ebErr.message };
  }

  const existingDates = new Set((existingBags || []).map(b => b.bag_date));
  const currentBag    = (existingBags || []).find(b => b.is_current);
  log(`Existing bags in DB: ${existingBags?.length ?? 0} (current bag date: ${currentBag?.bag_date ?? 'none'})`);

  // 3. Fetch player page and discover historical bag links
  const playerUrl = playerTrackerUrl(slug);
  log(`Fetching player page: ${playerUrl}`);

  let playerHtml;
  try {
    playerHtml = await fetchPage(playerUrl);
  } catch (err) {
    warn(`Failed to fetch player page for ${slug}: ${err.message}`);
    return { slug, inserted: 0, skipped: 0, failed: 0, error: err.message };
  }

  if (!playerHtml) {
    warn(`Player page not found (404/null) for ${slug}`);
    return { slug, inserted: 0, skipped: 0, failed: 0, error: '404 on player page' };
  }

  const $player     = cheerio.load(playerHtml);
  const historicals = parseHistoricalBagLinks($player);
  log(`Discovered ${historicals.length} historical bag link(s)`);

  if (historicals.length === 0) {
    log(`No historical bag links found for ${slug} — nothing to backfill`);
    return { slug, inserted: 0, skipped: 0, failed: 0, error: null };
  }

  // 4. Scrape and insert each historical bag
  let inserted = 0;
  let skipped  = 0;
  let failed   = 0;
  const failedUrls = [];

  for (let i = 0; i < historicals.length; i++) {
    const hist = historicals[i];
    log(`  [${i + 1}/${historicals.length}] ${hist.url} (date_text: "${hist.date_text}")`);

    // Quick skip: date from link text already in DB
    const quickDate = parseDate(hist.date_text);
    if (quickDate && existingDates.has(quickDate)) {
      if (currentBag && currentBag.bag_date === quickDate) {
        log(`    -> Current bag date ${quickDate} — skipping (do not demote)`);
      } else {
        log(`    -> Already in DB (${quickDate}) — skipping`);
      }
      skipped++;
      continue;
    }

    // Fetch and parse bag page
    let bagData;
    try {
      const html = await fetchPage(hist.url);
      if (!html) {
        warn(`    -> Page not found (null response)`);
        failed++;
        failedUrls.push(hist.url);
        continue;
      }
      const $ = cheerio.load(html);
      const bag_date      = parseBagDate($);
      const items         = parseBagTable($);
      const source_credit = parseSourceCredit($);
      bagData = { bag_date, items, source_credit };
    } catch (err) {
      warn(`    -> Fetch error: ${err.message}`);
      failed++;
      failedUrls.push(hist.url);
      continue;
    }

    if (!bagData.bag_date) {
      warn(`    -> No bag_date parsed — skipping`);
      failed++;
      failedUrls.push(hist.url);
      continue;
    }

    // Protect current bag by date
    if (currentBag && currentBag.bag_date === bagData.bag_date) {
      log(`    -> Date ${bagData.bag_date} matches current bag — skipping (do not demote)`);
      skipped++;
      continue;
    }

    // Double-check for duplicates using parsed date
    if (existingDates.has(bagData.bag_date)) {
      log(`    -> Already in DB (${bagData.bag_date}) — skipping`);
      skipped++;
      continue;
    }

    log(`    -> Parsed: date=${bagData.bag_date}, items=${bagData.items.length}`);

    const res = await insertHistoricalBag(supabase, {
      player_id,
      bag_date:      bagData.bag_date,
      source_url:    hist.url,
      source_credit: bagData.source_credit,
      items:         bagData.items,
    });

    if (res.error) {
      warn(`    -> Insert failed: ${res.error}`);
      failed++;
      failedUrls.push(hist.url);
    } else {
      log(`    -> Inserted bag_id=${res.bag_id} (${bagData.items.length} items)`);
      existingDates.add(bagData.bag_date);
      inserted++;
    }
  }

  // 5. Per-player summary
  log(`\n  ${slug}: inserted=${inserted}, skipped=${skipped}, failed=${failed}`);
  if (failedUrls.length) {
    failedUrls.forEach(u => warn(`    Failed URL: ${u}`));
  }

  return { slug, inserted, skipped, failed, error: null };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── Resolve target slugs ───────────────────────────────────────────────────
  const flags    = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
  const cliSlugs = process.argv.slice(2).filter(a => !a.startsWith('--'));

  let slugs;
  if (flags.has('--all') || cliSlugs.length === 0 && flags.size === 0 && TARGET_SLUGS.length === 0) {
    // Read all players from DB ordered by OWGR rank
    const { data: allPlayers, error: allErr } = await supabase
      .from('witb_players')
      .select('slug')
      .order('owgr_rank', { ascending: true });
    if (allErr) throw new Error(`Could not load witb_players: ${allErr.message}`);
    slugs = allPlayers.map(p => p.slug);
    log(`--all: targeting ${slugs.length} players from DB`);
  } else if (cliSlugs.length > 0) {
    slugs = cliSlugs;
  } else {
    slugs = TARGET_SLUGS;
  }

  // --skip-backfilled: skip players who already have at least one historical bag
  if (flags.has('--skip-backfilled')) {
    const { data: withHist } = await supabase
      .from('witb_bags')
      .select('player_id')
      .eq('is_current', false);
    const { data: playerRows } = await supabase
      .from('witb_players')
      .select('id, slug')
      .in('slug', slugs);
    const backfilledIds = new Set((withHist || []).map(b => b.player_id));
    const skipSlugs = new Set(
      (playerRows || []).filter(p => backfilledIds.has(p.id)).map(p => p.slug)
    );
    const before = slugs.length;
    slugs = slugs.filter(s => !skipSlugs.has(s));
    log(`--skip-backfilled: skipped ${before - slugs.length} already-backfilled players`);
  }

  log(`Running historical backfill for ${slugs.length} player(s): ${slugs.join(', ')}`);

  const results = [];

  for (const slug of slugs) {
    try {
      const result = await backfillPlayer(supabase, slug);
      results.push(result);
    } catch (err) {
      warn(`Unhandled error for ${slug}: ${err.message}`);
      results.push({ slug, inserted: 0, skipped: 0, failed: 1, error: err.message });
    }
  }

  // ── Final summary ────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log('BACKFILL COMPLETE — SUMMARY');
  console.log('='.repeat(70));
  console.log(`  ${'SLUG'.padEnd(26)} ${'INSERTED'.padEnd(10)} ${'SKIPPED'.padEnd(10)} ${'FAILED'.padEnd(8)} STATUS`);
  console.log(`  ${'----'.padEnd(26)} ${'--------'.padEnd(10)} ${'-------'.padEnd(10)} ${'------'.padEnd(8)} ------`);

  let totalInserted = 0;
  let totalFailed   = 0;

  for (const r of results) {
    totalInserted += r.inserted;
    totalFailed   += r.failed;
    const status = r.error && r.inserted === 0 ? `ERROR: ${r.error}` : 'ok';
    console.log(
      `  ${r.slug.padEnd(26)} ${String(r.inserted).padEnd(10)} ${String(r.skipped).padEnd(10)} ${String(r.failed).padEnd(8)} ${status}`,
    );
  }

  console.log('='.repeat(70));
  console.log(`  Total inserted: ${totalInserted}   Total failed: ${totalFailed}`);
  console.log('='.repeat(70) + '\n');

  // ── Verification query ───────────────────────────────────────────────────────

  const allPlayerIds = [];
  const playerMap = {};
  for (const r of results) {
    const { data } = await supabase
      .from('witb_players')
      .select('id, slug, name, owgr_rank')
      .eq('slug', r.slug)
      .maybeSingle();
    if (data) {
      allPlayerIds.push(data.id);
      playerMap[data.id] = data;
    }
  }

  if (allPlayerIds.length) {
    console.log('VERIFICATION — bags per player:');
    console.log(`  ${'SLUG'.padEnd(26)} ${'NAME'.padEnd(22)} ${'TOTAL_BAGS'.padEnd(12)} HISTORICAL`);
    console.log(`  ${'----'.padEnd(26)} ${'----'.padEnd(22)} ${'----------'.padEnd(12)} ----------`);

    for (const pid of allPlayerIds) {
      const p = playerMap[pid];
      const { data: bags } = await supabase
        .from('witb_bags')
        .select('is_current')
        .eq('player_id', pid);

      const total    = bags?.length ?? 0;
      const hist     = (bags || []).filter(b => !b.is_current).length;
      console.log(
        `  ${p.slug.padEnd(26)} ${p.name.padEnd(22)} ${String(total).padEnd(12)} ${hist}`,
      );
    }
    console.log('');
  }

  if (totalFailed > 0) {
    process.exitCode = 1;
  }
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => {
    console.error('[witb-player-history-backfill] Fatal:', err.message);
    process.exit(1);
  });
}