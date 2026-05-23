#!/usr/bin/env node
/**
 * scripts/witb-scrape.js
 *
 * What's In The Bag data ingestion pipeline.
 * Source: pgaclubtracker.com (robots.txt: User-agent: * Allow: /)
 *
 * Usage:
 *   node scripts/witb-scrape.js --mode=initial           full scrape with history
 *   node scripts/witb-scrape.js --mode=initial --no-history  skip historical bags
 *   node scripts/witb-scrape.js --mode=weekly            weekly refresh + change detection
 *   node scripts/witb-scrape.js --mode=report            data quality report only
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const fs               = require('fs');
const path             = require('path');
const vm               = require('vm');
const cheerio          = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL       = 'https://www.pgaclubtracker.com';
const USER_AGENT     = 'DORMIED-WITB-Bot/1.0 (+https://dormied.com)';
const RATE_LIMIT_MS  = 4000;   // 4 sec between requests
const MAX_RETRIES    = 3;
const RETRY_DELAY_MS = 10000;  // 10 sec on retry

const SITE_ROOT = path.resolve(__dirname, '..');

// Parse CLI flags
const args       = process.argv.slice(2);
const MODE       = args.find(a => a.startsWith('--mode='))?.replace('--mode=', '') || 'initial';
const NO_HISTORY = args.includes('--no-history');
const PLAYER_LIMIT = (() => {
  const f = args.find(a => a.startsWith('--limit='));
  return f ? parseInt(f.replace('--limit=', ''), 10) : Infinity;
})();

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(text) {
  return String(text || '').toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseDate(str) {
  // "December 9, 2025" or "Mar 30, 2021" -> ISO date string
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
  // Rate limiting
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  lastRequestAt = Date.now();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 404) return null; // Missing page, not an error
      if (res.status === 500 || res.status === 503) return null; // End of pagination or temp down
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

/**
 * Parse the equipment bag table (Club | Brand | Model | Loft/No. | Shaft).
 * Returns array of { club_type, raw_brand, brand_slug, brand_url,
 *                    raw_model, clubhead_slug, clubhead_url,
 *                    raw_shaft, shaft_slug, shaft_url, loft_or_number }
 */
function parseBagTable($) {
  const items = [];
  // Find the bag table by looking for headers containing "Club" and "Brand"
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
    if (cells.length < 4) return; // skip header rows

    const clubType   = cells.eq(0).text().trim();
    const brandCell  = cells.eq(1);
    const modelCell  = cells.eq(2);
    const loftCell   = cells.eq(3);
    const shaftCell  = cells.length >= 5 ? cells.eq(4) : null;

    if (!clubType || clubType.toLowerCase() === 'club') return; // skip re-header

    // Brand
    const brandLink  = brandCell.find('a').first();
    const brandHref  = brandLink.attr('href') || '';
    const brandSlug  = brandHref.replace('/brands/', '').replace(/-tour-players.*$/, '').trim() || null;
    const rawBrand   = brandCell.text().trim();

    // Model / clubhead
    const modelLink  = modelCell.find('a').first();
    const modelHref  = modelLink.attr('href') || '';
    const clubheadSlug = modelHref.startsWith('/clubheads/')
      ? modelHref.replace('/clubheads/', '').replace(/\/$/, '')
      : null;
    const rawModel   = modelCell.text().trim();

    // Shaft
    const rawShaft   = shaftCell ? shaftCell.text().trim() : '';
    const shaftLink  = shaftCell ? shaftCell.find('a').first() : null;
    const shaftHref  = shaftLink ? (shaftLink.attr('href') || '') : '';
    const shaftSlug  = shaftHref.startsWith('/shafts/')
      ? shaftHref.replace('/shafts/', '').replace(/\/$/, '')
      : null;

    // Loft / number
    const loftRaw = loftCell.text().trim();
    const loftOrNumber = (loftRaw && loftRaw !== '-' && loftRaw !== '--') ? loftRaw : null;

    items.push({
      club_type:     clubType,
      raw_brand:     rawBrand !== '-' ? rawBrand : null,
      brand_slug:    brandSlug,
      brand_url:     brandHref ? `${BASE_URL}${brandHref}` : null,
      raw_model:     rawModel !== '-' ? rawModel : null,
      clubhead_slug: clubheadSlug,
      clubhead_url:  modelHref ? `${BASE_URL}${modelHref}` : null,
      raw_shaft:     (rawShaft && rawShaft !== '-' && rawShaft !== '--') ? rawShaft : null,
      shaft_slug:    shaftSlug,
      shaft_url:     shaftHref ? `${BASE_URL}${shaftHref}` : null,
      loft_or_number: loftOrNumber,
      position:      i,
    });
  });

  return items;
}

/**
 * Extract OWGR rank from text like "currently ranked #1 in..."
 */
function parseOwgr($) {
  let rank = null;
  $('p, div, span').each((_, el) => {
    const text = $(el).text();
    const m = text.match(/ranked\s+#?(\d+)/i);
    if (m) { rank = parseInt(m[1], 10); return false; }
  });
  return rank;
}

/**
 * Extract bag snapshot date from a heading like "December 9, 2025".
 * Looks for the h2/h3 immediately before the bag table.
 */
function parseBagDate($) {
  // Try headings for a date pattern (Month Day, Year or Month Year).
  // Normalize whitespace first — site uses double spaces like "December  9, 2025".
  let found = null;
  $('h1, h2, h3, h4, h5').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const m = text.match(/([A-Za-z]+ \d{1,2},?\s*\d{4})/);
    if (m) { found = m[1]; return false; }
  });
  return found ? parseDate(found) : null;
}

/**
 * Extract source credit URL and text.
 */
function parseSourceCredit($) {
  let credit = null;
  const sourceText = $('*').filter((_, el) => /source:/i.test($(el).text())).first();
  if (sourceText.length) {
    const link = sourceText.find('a').first();
    if (link.length) {
      credit = link.attr('href') || link.text().trim();
    }
  }
  return credit;
}

/**
 * Extract all historical bag page URLs from the "All Bags" table.
 * Returns array of { url, date_text } where date_text is the raw cell text.
 */
function parseHistoricalBagLinks($) {
  const links = [];
  // Look for the historical table: first column is "Date" with links to /bags/
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

/**
 * Extract player slug and name from a link href like
 * /players/scottie-scheffler-witb-whats-in-the-bag
 */
function parsePlayerLink(href, text) {
  const m = href.match(/\/players\/(.+)-witb-whats-in-the-bag/);
  if (!m) return null;
  return { slug: m[1], name: text.trim(), source_url: `${BASE_URL}${href}` };
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
  // Infer brand from model text if not set
  if (!brand_name && model) {
    brand_name = model.split(' ')[0]; // first word usually the brand
  }
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

// ── Shaft slug inference (when no link is available) ─────────────────────────

function inferShaftSlug(rawShaft) {
  if (!rawShaft || rawShaft === '-' || rawShaft === '--') return null;
  return 'shaft-' + slugify(rawShaft).slice(0, 80);
}

// ── Player / Bag Ingestion ────────────────────────────────────────────────────

/**
 * Scrape a single bag page (current or historical).
 * Returns { bag_date, items, source_credit } or null on failure.
 */
async function scrapeBagPage(url) {
  const html = await fetchPage(url);
  if (!html) return null;

  const $ = cheerio.load(html);
  const bag_date     = parseBagDate($);
  const items        = parseBagTable($);
  const source_credit = parseSourceCredit($);

  if (!bag_date) { warn(`No bag date found on ${url}`); }
  return { bag_date, items, source_credit };
}

/**
 * Scrape one player's full WITB page.
 * Upserts player, current bag, bag items, and optionally historical bags.
 * Returns { player_id, bags_added, errors } or throws.
 */
async function scrapePlayer(supabase, playerInfo, opts = {}) {
  const { slug, name, source_url } = playerInfo;
  const { fetchHistory = true } = opts;
  const errors    = [];
  let   bags_added = 0;

  log(`  Player: ${name} (${slug})`);

  // Fetch player WITB page
  const html = await fetchPage(source_url);
  if (!html) {
    warn(`Player page not found: ${source_url}`);
    return { player_id: null, bags_added: 0, errors: [{ slug, msg: '404' }] };
  }

  const $         = cheerio.load(html);
  const owgr_rank = parseOwgr($);
  const bag_date  = parseBagDate($);
  const items     = parseBagTable($);
  const source_credit = parseSourceCredit($);
  const histLinks = parseHistoricalBagLinks($);

  if (!bag_date) warn(`No bag date for ${slug}`);
  if (!items.length) warn(`No bag items for ${slug}`);

  // Upsert player (without current_bag_id yet)
  const { data: playerRow, error: pErr } = await supabase
    .from('witb_players')
    .upsert({ slug, name, source_url, owgr_rank, last_updated: new Date().toISOString() },
             { onConflict: 'slug', ignoreDuplicates: false })
    .select('id')
    .single();

  if (pErr) { errors.push({ slug, msg: `upsert player: ${pErr.message}` }); return { player_id: null, bags_added, errors }; }
  const player_id = playerRow.id;

  // Insert current bag (upsert on player_id + bag_date)
  if (bag_date) {
    const bagResult = await insertBag(supabase, {
      player_id, bag_date, source_url, source_credit,
      items, is_current: true,
    });
    if (bagResult.bag_id) {
      bags_added++;
      // Update player.current_bag_id
      await supabase.from('witb_players')
        .update({ current_bag_id: bagResult.bag_id })
        .eq('id', player_id);
    }
    if (bagResult.error) errors.push({ slug, msg: `insert current bag: ${bagResult.error}` });
  }

  // Historical bags
  if (fetchHistory && histLinks.length) {
    // Filter out the current bag (it has the same year-month as source_url)
    const currentBagPath = source_url.replace(BASE_URL, '').replace(/^\/players\//, '/bags/').replace(/-witb-whats-in-the-bag$/, '');
    const toFetch = histLinks.filter(h => !h.url.endsWith(currentBagPath));

    for (const hist of toFetch) {
      try {
        const histData = await scrapeBagPage(hist.url);
        if (!histData || !histData.bag_date) continue;

        const res = await insertBag(supabase, {
          player_id,
          bag_date:      histData.bag_date,
          source_url:    hist.url,
          source_credit: histData.source_credit,
          items:         histData.items,
          is_current:    false,
        });
        if (res.bag_id) bags_added++;
        if (res.error)  errors.push({ slug, url: hist.url, msg: res.error });
      } catch (err) {
        warn(`Historical bag error for ${hist.url}: ${err.message}`);
        errors.push({ slug, url: hist.url, msg: err.message });
      }
    }
  }

  return { player_id, bags_added, errors };
}

/**
 * Insert one bag snapshot and its items.
 * Idempotent: upserts bag on (player_id, bag_date), replaces items.
 * Returns { bag_id, error }.
 */
async function insertBag(supabase, { player_id, bag_date, source_url, source_credit, items, is_current }) {
  // Demote any prior is_current bags if this is the current one
  if (is_current) {
    await supabase.from('witb_bags')
      .update({ is_current: false })
      .eq('player_id', player_id)
      .eq('is_current', true);
  }

  // Upsert the bag row
  const { data: bagRow, error: bagErr } = await supabase
    .from('witb_bags')
    .upsert({ player_id, bag_date, source_url, source_credit: source_credit || null, is_current },
             { onConflict: 'player_id,bag_date', ignoreDuplicates: false })
    .select('id')
    .single();

  if (bagErr) return { bag_id: null, error: bagErr.message };
  const bag_id = bagRow.id;

  // Delete existing items for this bag (full replace on re-scrape)
  await supabase.from('witb_bag_items').delete().eq('bag_id', bag_id);

  // Resolve entities and insert items
  for (const item of items) {
    let brand_id    = null;
    let clubhead_id = null;
    let shaft_id    = null;

    // Brand
    if (item.brand_slug) {
      brand_id = await upsertBrand(supabase, {
        slug:       item.brand_slug,
        name:       item.raw_brand || item.brand_slug,
        source_url: item.brand_url,
      });
    }

    // Clubhead
    if (item.clubhead_slug) {
      clubhead_id = await upsertClubhead(supabase, {
        slug:       item.clubhead_slug,
        brand_id,
        model:      item.raw_model || item.clubhead_slug,
        club_type:  slugify(item.club_type),
        source_url: item.clubhead_url,
      });
    }

    // Shaft
    let shaftSlug = item.shaft_slug;
    if (!shaftSlug && item.raw_shaft) shaftSlug = inferShaftSlug(item.raw_shaft);
    if (shaftSlug) {
      shaft_id = await upsertShaft(supabase, {
        slug:       shaftSlug,
        brand_name: null, // inferred inside upsertShaft
        model:      item.raw_shaft || shaftSlug,
        source_url: item.shaft_url,
      });
    }

    const { error: itemErr } = await supabase.from('witb_bag_items').insert({
      bag_id,
      club_type:     slugify(item.club_type),
      brand_id,
      clubhead_id,
      shaft_id,
      loft_or_number: item.loft_or_number,
      raw_brand:     item.raw_brand,
      raw_model:     item.raw_model,
      raw_shaft:     item.raw_shaft,
      position:      item.position,
    });
    if (itemErr) warn(`bag_item insert error (bag ${bag_id}): ${itemErr.message}`);
  }

  return { bag_id, error: null };
}

// ── Player List ───────────────────────────────────────────────────────────────

async function fetchAllPlayers() {
  const players = [];
  const seen    = new Set();

  for (let page = 1; page <= 10; page++) { // cap at 10 pages
    const url  = `${BASE_URL}/players?page=${page}`;
    const html = await fetchPage(url);
    if (!html) break;

    const $ = cheerio.load(html);
    let found = 0;

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href.includes('-witb-whats-in-the-bag')) return;
      const player = parsePlayerLink(href, $(el).text());
      if (player && !seen.has(player.slug)) {
        seen.add(player.slug);
        players.push(player);
        found++;
      }
    });

    log(`  Page ${page}: ${found} players (total so far: ${players.length})`);
    if (found === 0) break; // No more pages
  }

  return players;
}

// ── Change Detection ──────────────────────────────────────────────────────────

/**
 * Diff two bags' items by club_type and write witb_changes rows.
 */
async function detectChanges(supabase, player_id, oldBagId, newBagId, oldBagDate, newBagDate) {
  const [{ data: oldItems }, { data: newItems }] = await Promise.all([
    supabase.from('witb_bag_items').select('club_type, raw_brand, raw_model').eq('bag_id', oldBagId),
    supabase.from('witb_bag_items').select('club_type, raw_brand, raw_model').eq('bag_id', newBagId),
  ]);

  const oldMap = {};
  for (const i of (oldItems || [])) {
    const key = i.club_type;
    oldMap[key] = `${i.raw_brand || ''} ${i.raw_model || ''}`.trim();
  }
  const newMap = {};
  for (const i of (newItems || [])) {
    const key = i.club_type;
    newMap[key] = `${i.raw_brand || ''} ${i.raw_model || ''}`.trim();
  }

  const changes = [];
  const allTypes = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);

  for (const club_type of allTypes) {
    const oldVal = oldMap[club_type];
    const newVal = newMap[club_type];
    if (!oldVal && newVal) {
      changes.push({ player_id, club_type, change_type: 'added', old_value: null, new_value: newVal, old_bag_date: oldBagDate, new_bag_date: newBagDate });
    } else if (oldVal && !newVal) {
      changes.push({ player_id, club_type, change_type: 'removed', old_value: oldVal, new_value: null, old_bag_date: oldBagDate, new_bag_date: newBagDate });
    } else if (oldVal && newVal && oldVal !== newVal) {
      changes.push({ player_id, club_type, change_type: 'swapped', old_value: oldVal, new_value: newVal, old_bag_date: oldBagDate, new_bag_date: newBagDate });
    }
  }

  if (changes.length) {
    const { error } = await supabase.from('witb_changes').insert(changes);
    if (error) warn(`witb_changes insert: ${error.message}`);
  }

  return changes.length;
}

// ── Brand Auto-Mapping ────────────────────────────────────────────────────────

/**
 * Load DORMIED brand slugs from js/data.js and attempt to map witb_brands.
 * Returns { mapped, unmapped } arrays.
 */
async function autoMapBrands(supabase) {
  // Load data.js
  const raw = fs.readFileSync(path.join(SITE_ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  const dormiedBrands = ctx.window.DORMIED_DATA.brands.map(b => ({ id: b.id, name: b.name }));

  // Build lookup maps from DORMIED slugs
  const dormiedBySlug = {}; // exact slug match
  const dormiedByNorm = {}; // normalized (strip hyphens) match
  for (const b of dormiedBrands) {
    dormiedBySlug[b.id] = b.id;
    dormiedByNorm[b.id.replace(/-/g, '')] = b.id;
    // Also index by normalized name
    const nameSlug = slugify(b.name).replace(/-/g, '');
    dormiedByNorm[nameSlug] = b.id;
  }

  // Fetch all witb_brands
  const { data: witbBrands, error } = await supabase
    .from('witb_brands')
    .select('id, slug, name, dormied_brand_slug')
    .order('name');
  if (error) { warn(`autoMapBrands fetch: ${error.message}`); return { mapped: [], unmapped: [] }; }

  const mapped   = [];
  const unmapped = [];

  for (const wb of witbBrands) {
    if (wb.dormied_brand_slug) { mapped.push(wb); continue; } // already mapped

    // Try: exact slug match
    let dormiedSlug = dormiedBySlug[wb.slug] || null;

    // Try: normalized slug
    if (!dormiedSlug) {
      const norm = wb.slug.replace(/-/g, '');
      dormiedSlug = dormiedByNorm[norm] || null;
    }

    // Try: normalized name
    if (!dormiedSlug) {
      const nameNorm = slugify(wb.name).replace(/-/g, '');
      dormiedSlug = dormiedByNorm[nameNorm] || null;
    }

    // Try: partial match (witb slug is prefix/suffix of dormied slug)
    if (!dormiedSlug) {
      for (const b of dormiedBrands) {
        if (b.id.startsWith(wb.slug) || wb.slug.startsWith(b.id.split('-')[0])) {
          dormiedSlug = b.id;
          break;
        }
      }
    }

    if (dormiedSlug) {
      const { error: updErr } = await supabase
        .from('witb_brands')
        .update({ dormied_brand_slug: dormiedSlug })
        .eq('id', wb.id);
      if (updErr) warn(`map brand ${wb.slug}: ${updErr.message}`);
      else mapped.push({ ...wb, dormied_brand_slug: dormiedSlug });
    } else {
      unmapped.push(wb);
    }
  }

  return { mapped, unmapped };
}

// ── Data Quality Report ───────────────────────────────────────────────────────

async function dataQualityReport(supabase) {
  const q = sql => supabase.rpc ? supabase.rpc('exec_sql', { query: sql }) : null;

  const [
    { count: players   } = {},
    { count: bags      } = {},
    { count: items     } = {},
    { count: brands    } = {},
    { count: clubheads } = {},
    { count: shafts    } = {},
  ] = await Promise.all([
    supabase.from('witb_players').select('*', { count: 'exact', head: true }),
    supabase.from('witb_bags').select('*', { count: 'exact', head: true }),
    supabase.from('witb_bag_items').select('*', { count: 'exact', head: true }),
    supabase.from('witb_brands').select('*', { count: 'exact', head: true }),
    supabase.from('witb_clubheads').select('*', { count: 'exact', head: true }),
    supabase.from('witb_shafts').select('*', { count: 'exact', head: true }),
  ]);

  // Mapped vs unmapped brands
  const { count: mapped   } = await supabase.from('witb_brands').select('*', { count: 'exact', head: true }).not('dormied_brand_slug', 'is', null);
  const { count: unmapped } = await supabase.from('witb_brands').select('*', { count: 'exact', head: true }).is('dormied_brand_slug', null);

  // Players with zero items in their current bag
  const { data: emptyPlayers } = await supabase
    .from('witb_players')
    .select('name, slug')
    .is('current_bag_id', null);

  // Club type distribution
  const { data: typeDist } = await supabase
    .from('witb_bag_items')
    .select('club_type')
    .order('club_type');

  const typeCount = {};
  for (const r of (typeDist || [])) {
    typeCount[r.club_type] = (typeCount[r.club_type] || 0) + 1;
  }
  const topTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1]).slice(0, 15);

  // Unmapped brands list
  const { data: unmappedList } = await supabase
    .from('witb_brands')
    .select('slug, name')
    .is('dormied_brand_slug', null)
    .order('name');

  console.log('\n' + '='.repeat(60));
  console.log('DATA QUALITY REPORT');
  console.log('='.repeat(60));
  console.log(`Players:    ${players ?? '?'}`);
  console.log(`Bags:       ${bags ?? '?'}`);
  console.log(`Bag items:  ${items ?? '?'}`);
  console.log(`Brands:     ${brands ?? '?'} (${mapped ?? '?'} mapped to DORMIED, ${unmapped ?? '?'} unmapped)`);
  console.log(`Clubheads:  ${clubheads ?? '?'}`);
  console.log(`Shafts:     ${shafts ?? '?'}`);
  console.log('');
  console.log('Club type distribution (current bags):');
  topTypes.forEach(([type, n]) => console.log(`  ${type.padEnd(20)} ${n}`));

  if (emptyPlayers?.length) {
    console.log(`\nPlayers with no current bag (${emptyPlayers.length}):`);
    emptyPlayers.slice(0, 20).forEach(p => console.log(`  ${p.name} (${p.slug})`));
  }

  if (unmappedList?.length) {
    console.log(`\nBrands not mapped to DORMIED slug (${unmappedList.length}) -- review manually:`);
    unmappedList.forEach(b => console.log(`  ${b.name.padEnd(30)} [${b.slug}]`));
  }

  console.log('='.repeat(60) + '\n');
}

// ── Weekly Crawl ──────────────────────────────────────────────────────────────

async function runWeeklyCrawl(supabase) {
  const startedAt = new Date().toISOString();
  const { data: runRow } = await supabase
    .from('witb_crawl_runs')
    .insert({ run_type: 'weekly', status: 'running', started_at: startedAt })
    .select('id').single();
  const run_id = runRow?.id;

  let players_scraped  = 0;
  let bags_added       = 0;
  let changes_detected = 0;
  const errors         = [];

  log('Weekly crawl starting...');
  const allPlayers = await fetchAllPlayers();
  log(`Found ${allPlayers.length} players`);

  for (const playerInfo of allPlayers.slice(0, PLAYER_LIMIT)) {
    try {
      // Fetch current WITB page for bag date only
      const html = await fetchPage(playerInfo.source_url);
      if (!html) continue;

      const $         = cheerio.load(html);
      const bag_date  = parseBagDate($);
      const owgr_rank = parseOwgr($);

      // Look up existing player
      const { data: existing } = await supabase
        .from('witb_players')
        .select('id, current_bag_id')
        .eq('slug', playerInfo.slug)
        .single();

      if (!existing) {
        // New player: do a full scrape
        log(`  New player found: ${playerInfo.name}`);
        const res = await scrapePlayer(supabase, playerInfo, { fetchHistory: false });
        if (res.player_id) players_scraped++;
        bags_added += res.bags_added;
        errors.push(...res.errors);
        continue;
      }

      // Update OWGR rank
      await supabase.from('witb_players')
        .update({ owgr_rank, last_updated: new Date().toISOString() })
        .eq('id', existing.id);

      // Check if bag date changed
      if (bag_date && existing.current_bag_id) {
        const { data: currentBag } = await supabase
          .from('witb_bags')
          .select('id, bag_date')
          .eq('id', existing.current_bag_id)
          .single();

        if (currentBag && currentBag.bag_date === bag_date) {
          // No change
          continue;
        }

        // New bag detected
        log(`  Bag change: ${playerInfo.name} ${currentBag?.bag_date} -> ${bag_date}`);
        const items         = parseBagTable($);
        const source_credit = parseSourceCredit($);

        const bagRes = await insertBag(supabase, {
          player_id:     existing.id,
          bag_date,
          source_url:    playerInfo.source_url,
          source_credit,
          items,
          is_current:    true,
        });

        if (bagRes.bag_id) {
          bags_added++;
          await supabase.from('witb_players')
            .update({ current_bag_id: bagRes.bag_id })
            .eq('id', existing.id);

          // Detect changes vs old bag
          if (currentBag) {
            const n = await detectChanges(supabase, existing.id,
              currentBag.id, bagRes.bag_id,
              currentBag.bag_date, bag_date);
            changes_detected += n;
          }
        }
        players_scraped++;
      }
    } catch (err) {
      warn(`Weekly scrape error for ${playerInfo.slug}: ${err.message}`);
      errors.push({ slug: playerInfo.slug, msg: err.message });
    }
  }

  // Re-run brand mapping for any new brands
  const { mapped, unmapped } = await autoMapBrands(supabase);

  const finishedAt = new Date().toISOString();
  const status = errors.length === 0 ? 'success' : errors.length < 5 ? 'partial' : 'failed';

  if (run_id) {
    await supabase.from('witb_crawl_runs').update({
      finished_at: finishedAt,
      players_scraped,
      bags_added,
      changes_detected,
      errors: errors.length ? errors : null,
      status,
    }).eq('id', run_id);
  }

  log(`\nWeekly crawl complete: ${players_scraped} updated, ${bags_added} new bags, ${changes_detected} changes, ${errors.length} errors`);
  if (unmapped.length) {
    log(`Unmapped brands (${unmapped.length}): ${unmapped.map(b => b.slug).join(', ')}`);
  }

  // Alert on failure
  if (status === 'failed') {
    console.error(`\n!! CRAWL FAILED: ${errors.length} errors. Check witb_crawl_runs for details.`);
    process.exitCode = 1;
  }
}

// ── Initial Full Scrape ───────────────────────────────────────────────────────

async function runInitialScrape(supabase) {
  const startedAt = new Date().toISOString();
  const { data: runRow } = await supabase
    .from('witb_crawl_runs')
    .insert({ run_type: 'initial', status: 'running', started_at: startedAt })
    .select('id').single();
  const run_id = runRow?.id;

  log('Initial scrape starting...');
  log(`  fetchHistory: ${!NO_HISTORY}`);
  if (PLAYER_LIMIT < Infinity) log(`  Player limit: ${PLAYER_LIMIT}`);

  const allPlayers = await fetchAllPlayers();
  log(`Found ${allPlayers.length} players total`);

  let players_scraped  = 0;
  let bags_added       = 0;
  const errors         = [];

  const toScrape = allPlayers.slice(0, PLAYER_LIMIT);

  for (let i = 0; i < toScrape.length; i++) {
    const playerInfo = toScrape[i];
    log(`[${i + 1}/${toScrape.length}] ${playerInfo.name}`);
    try {
      const res = await scrapePlayer(supabase, playerInfo, { fetchHistory: !NO_HISTORY });
      if (res.player_id) players_scraped++;
      bags_added += res.bags_added;
      errors.push(...res.errors);
    } catch (err) {
      warn(`Player scrape failed: ${playerInfo.slug}: ${err.message}`);
      errors.push({ slug: playerInfo.slug, msg: err.message });
    }
  }

  log('\nRunning brand auto-mapping...');
  const { mapped, unmapped } = await autoMapBrands(supabase);
  log(`  Mapped: ${mapped.length}, Unmapped: ${unmapped.length}`);

  const finishedAt = new Date().toISOString();
  const status = errors.filter(e => e.slug && !e.url).length === 0 ? 'success'
    : errors.length < 5 ? 'partial' : 'failed';

  if (run_id) {
    await supabase.from('witb_crawl_runs').update({
      finished_at:     finishedAt,
      players_scraped,
      bags_added,
      changes_detected: 0,
      errors:          errors.length ? errors.slice(0, 100) : null,
      status,
    }).eq('id', run_id);
  }

  log(`\nInitial scrape complete:`);
  log(`  Players: ${players_scraped}`);
  log(`  Bags: ${bags_added}`);
  log(`  Errors: ${errors.length}`);

  await dataQualityReport(supabase);

  if (unmapped.length) {
    log('Brands needing manual DORMIED slug mapping:');
    unmapped.forEach(b => log(`  ${b.name} -> witb slug: ${b.slug}`));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  log(`Mode: ${MODE}`);

  if (MODE === 'report') {
    await dataQualityReport(supabase);
    return;
  }

  if (MODE === 'weekly') {
    await runWeeklyCrawl(supabase);
    return;
  }

  // Default: initial
  await runInitialScrape(supabase);
}

main().catch(err => {
  console.error('[witb-scrape] Fatal:', err.message);
  process.exit(1);
});
