#!/usr/bin/env node
/**
 * scripts/witb-rahm-backfill.js
 *
 * One-time (idempotent) historical bag backfill for Jon Rahm.
 * Fetches every historical WITB snapshot from PGAClubTracker and
 * inserts them into witb_bags / witb_bag_items.
 *
 * Safe to re-run: upserts on (player_id, bag_date) — no duplicates.
 * Does NOT touch Rahm's current bag (is_current=true).
 *
 * Usage:
 *   node scripts/witb-rahm-backfill.js
 *
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const cheerio          = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL          = 'https://www.pgaclubtracker.com';
const RAHM_PLAYER_URL   = `${BASE_URL}/players/jon-rahm-witb-whats-in-the-bag`;
const RAHM_SLUG         = 'jon-rahm';
const USER_AGENT        = 'DORMIED-WITB-Bot/1.0 (+https://dormied.com)';
const RATE_LIMIT_MS     = 4000;
const MAX_RETRIES       = 3;
const RETRY_DELAY_MS    = 10000;

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
    const rawBrand     = brandCell.text().trim();

    const modelLink    = modelCell.find('a').first();
    const modelHref    = modelLink.attr('href') || '';
    const clubheadSlug = modelHref.startsWith('/clubheads/')
      ? modelHref.replace('/clubheads/', '').replace(/\/$/, '')
      : null;
    const rawModel = modelCell.text().trim();

    const rawShaft  = shaftCell ? shaftCell.text().trim() : '';
    const shaftLink = shaftCell ? shaftCell.find('a').first() : null;
    const shaftHref = shaftLink ? (shaftLink.attr('href') || '') : '';
    const shaftSlug = shaftHref.startsWith('/shafts/')
      ? shaftHref.replace('/shafts/', '').replace(/\/$/, '')
      : null;

    const loftRaw       = loftCell.text().trim();
    const loftOrNumber  = (loftRaw && loftRaw !== '-' && loftRaw !== '--') ? loftRaw : null;

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
  const { data, error } = await supabase
    .from('witb_clubheads')
    .upsert({ slug, brand_id, model: model || slug, club_type: club_type || 'unknown',
              source_url, last_updated: new Date().toISOString() },
             { onConflict: 'slug', ignoreDuplicates: false })
    .select('id')
    .single();
  if (error) { warn(`upsertClubhead ${slug}: ${error.message}`); return null; }
  return data?.id || null;
}

async function upsertShaft(supabase, { slug, brand_name, model, source_url }) {
  if (!slug) return null;
  if (!brand_name && model) brand_name = model.split(' ')[0];
  const { data, error } = await supabase
    .from('witb_shafts')
    .upsert({ slug, brand_name, model: model || slug, source_url,
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── 1. Resolve Rahm's player_id ────────────────────────────────────────────

  const { data: rahmRow, error: rahmErr } = await supabase
    .from('witb_players')
    .select('id, name, owgr_rank')
    .eq('slug', RAHM_SLUG)
    .single();

  if (rahmErr || !rahmRow) {
    throw new Error(`Jon Rahm not found in witb_players (slug='${RAHM_SLUG}'): ${rahmErr?.message}`);
  }
  const player_id = rahmRow.id;
  log(`Found Rahm: id=${player_id}, name="${rahmRow.name}", owgr=${rahmRow.owgr_rank}`);

  // ── 2. Load existing bag dates for Rahm (for skip logic) ───────────────────

  const { data: existingBags, error: ebErr } = await supabase
    .from('witb_bags')
    .select('bag_date, is_current, id')
    .eq('player_id', player_id)
    .order('bag_date', { ascending: false });

  if (ebErr) throw new Error(`Could not load existing bags: ${ebErr.message}`);

  const existingDates = new Set((existingBags || []).map(b => b.bag_date));
  const currentBag = (existingBags || []).find(b => b.is_current);
  log(`Existing bags in DB: ${existingBags?.length ?? 0} (current: ${currentBag?.bag_date ?? 'none'})`);

  // ── 3. Fetch Rahm's player page and discover historical links ───────────────

  log(`Fetching player page: ${RAHM_PLAYER_URL}`);
  const playerHtml = await fetchPage(RAHM_PLAYER_URL);
  if (!playerHtml) throw new Error('Player page returned null (404/500)');

  const $player      = cheerio.load(playerHtml);
  const historicals  = parseHistoricalBagLinks($player);
  log(`Discovered ${historicals.length} historical bag link(s) on player page`);

  if (historicals.length === 0) {
    log('No historical bag links found — nothing to do.');
    return;
  }

  // ── 4. Scrape and insert each historical bag ────────────────────────────────

  let inserted = 0;
  let skipped  = 0;
  let failed   = 0;
  const failedUrls = [];

  for (let i = 0; i < historicals.length; i++) {
    const hist = historicals[i];
    log(`[${i + 1}/${historicals.length}] ${hist.url} (date_text: "${hist.date_text}")`);

    // Quick skip: if the date extracted from the link text already exists
    const quickDate = parseDate(hist.date_text);
    if (quickDate && existingDates.has(quickDate)) {
      // Check it's NOT the current bag (we must not demote it)
      if (currentBag && currentBag.bag_date === quickDate) {
        log(`  -> Current bag date ${quickDate} — skipping (do not demote)`);
        skipped++;
        continue;
      }
      log(`  -> Already in DB (${quickDate}) — skipping`);
      skipped++;
      continue;
    }

    // Fetch and parse the historical bag page
    let bagData;
    try {
      const html = await fetchPage(hist.url);
      if (!html) {
        warn(`  -> Page not found (null response)`);
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
      warn(`  -> Fetch error: ${err.message}`);
      failed++;
      failedUrls.push(hist.url);
      continue;
    }

    if (!bagData.bag_date) {
      warn(`  -> No bag_date parsed from page — skipping`);
      failed++;
      failedUrls.push(hist.url);
      continue;
    }

    // Skip if this is the current bag's date (protect is_current)
    if (currentBag && currentBag.bag_date === bagData.bag_date) {
      log(`  -> Date ${bagData.bag_date} matches current bag — skipping (do not demote)`);
      skipped++;
      continue;
    }

    // Skip if already in DB (double-check with parsed date)
    if (existingDates.has(bagData.bag_date)) {
      log(`  -> Already in DB (${bagData.bag_date}) — skipping`);
      skipped++;
      continue;
    }

    log(`  -> Parsed: date=${bagData.bag_date}, items=${bagData.items.length}`);

    const res = await insertHistoricalBag(supabase, {
      player_id,
      bag_date:      bagData.bag_date,
      source_url:    hist.url,
      source_credit: bagData.source_credit,
      items:         bagData.items,
    });

    if (res.error) {
      warn(`  -> Insert failed: ${res.error}`);
      failed++;
      failedUrls.push(hist.url);
    } else {
      log(`  -> Inserted bag_id=${res.bag_id}`);
      existingDates.add(bagData.bag_date); // track so re-scraped duplicates in same run also skip
      inserted++;
    }
  }

  // ── 5. Verification summary ────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Failed:   ${failed}`);
  if (failedUrls.length) {
    console.log('  Failed URLs:');
    failedUrls.forEach(u => console.log(`    ${u}`));
  }

  // Verification query — all of Rahm's bags
  const { data: allBags, error: vErr } = await supabase
    .from('witb_bags')
    .select(`
      id,
      bag_date,
      is_current,
      witb_bag_items ( id )
    `)
    .eq('player_id', player_id)
    .order('bag_date', { ascending: false });

  if (vErr) {
    warn(`Verification query failed: ${vErr.message}`);
  } else {
    console.log(`\nAll bags for Jon Rahm (${allBags?.length ?? 0} total):`);
    console.log(`  ${'bag_date'.padEnd(12)} ${'is_current'.padEnd(12)} items`);
    console.log(`  ${'----------'.padEnd(12)} ${'----------'.padEnd(12)} -----`);
    for (const b of (allBags || [])) {
      const items = b.witb_bag_items?.length ?? 0;
      const curr  = b.is_current ? 'YES' : '';
      console.log(`  ${b.bag_date.padEnd(12)} ${curr.padEnd(12)} ${items}`);
    }
  }

  console.log('='.repeat(60) + '\n');

  if (failed > 0) {
    console.error(`${failed} bag(s) failed to insert. See WARN lines above.`);
    process.exitCode = 1;
  }
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => {
    console.error('[witb-rahm-backfill] Fatal:', err.message);
    process.exit(1);
  });
}