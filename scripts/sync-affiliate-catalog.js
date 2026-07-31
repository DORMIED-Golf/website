#!/usr/bin/env node
/**
 * scripts/sync-affiliate-catalog.js
 *
 * Nightly Impact.com catalog sync. Ingests catalog items into affiliate_products,
 * upserting on impact_item_id (Impact's Item.Id). NEVER deletes. NEVER builds
 * affiliate links (Impact's `Url` is already our tracking link). NEVER maps
 * advertiser names to brand slugs (that is a manual affiliate_programs row).
 *
 * Safety contract (see the block above the deactivation sweep):
 *   - /Items is cursor-paginated; we follow @nextpageuri VERBATIM.
 *   - A program's deactivation sweep runs ONLY on a verified-complete fetch.
 *     A partial fetch writes NOTHING for that program and the script exits non-zero.
 *   - first_seen_at is preserved on update and inherited across a catalog
 *     migration (same catalog_item_id, new impact_item_id).
 *
 * Credentials: IMPACT_SID / IMPACT_TOKEN + SUPABASE_URL / SUPABASE_SERVICE_KEY
 * from env only. Never hardcoded, never logged.
 *
 * Usage:
 *   node scripts/sync-affiliate-catalog.js
 *   node scripts/sync-affiliate-catalog.js --dry-run   # fetch + map + report, no writes
 *
 * TEST HOOK (off unless set): AFFILIATE_SYNC_FAIL_ON_PAGE=2 forces the given
 * 1-indexed page to be treated as a failed fetch, to prove the sweep is skipped.
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');

const DRY = process.argv.includes('--dry-run');
// Deactivation ceiling override. Never set in the cron invocation — a run that
// wants to deactivate >20% of a program's active rows must be launched by hand.
const ALLOW_LARGE = process.argv.includes('--allow-large-deactivation');
const FAIL_ON_PAGE = parseInt(process.env.AFFILIATE_SYNC_FAIL_ON_PAGE || '0', 10) || 0;

const SID   = process.env.IMPACT_SID;
const TOKEN = process.env.IMPACT_TOKEN;
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SID || !TOKEN)                         { console.error('[sync] Missing IMPACT_SID / IMPACT_TOKEN'); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('[sync] Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const BASE = 'https://api.impact.com';
const AUTH = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── HTTP with 429 backoff (exp + jitter, honour Retry-After) ──────────────────
async function apiGet(pathname, attempt = 0) {
  const res = await fetch(BASE + pathname, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if (res.status === 429 && attempt < 6) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
    const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(60000, 1000 * 2 ** attempt);
    const wait = backoff + Math.floor(Math.random() * 500);
    console.warn(`[sync] 429 on ${pathname} — backing off ${wait}ms (attempt ${attempt + 1})`);
    await sleep(wait);
    return apiGet(pathname, attempt + 1);
  }
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { res, body };
}

function extractArray(body, key) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body[key])) return body[key];
  if (body && typeof body === 'object') for (const k of Object.keys(body)) if (Array.isArray(body[k])) return body[k];
  return [];
}

const numOrNull = v => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
const strOrNull = v => (v === null || v === undefined || v === '') ? null : String(v);
function boolOrNull(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

// Promotions[0] -> {promo_title, promo_code, promo_expires_at}. Empty -> all null.
function mapPromo(promotions) {
  const p = Array.isArray(promotions) && promotions.length ? promotions[0] : null;
  if (!p) return { promo_title: null, promo_code: null, promo_expires_at: null };
  let expires = null;
  const dates = p.PromotionEffectiveDates;        // ISO 8601 interval "<start>/<end>"
  if (typeof dates === 'string' && dates.includes('/')) {
    const end = dates.split('/')[1];
    if (end) { const d = new Date(end); if (!isNaN(d.getTime())) expires = d.toISOString(); }
  }
  return { promo_title: strOrNull(p.PromotionTitle), promo_code: strOrNull(p.GenericRedemptionCode), promo_expires_at: expires };
}

// ── Fetch strategies ──────────────────────────────────────────────────────────
async function fetchItems_itemsApi(program) {
  let uri = `/Mediapartners/${SID}/Catalogs/${program.catalog_id}/Items?PageSize=1000`;
  const items = [];
  const seenUris = new Set();
  let pagesFetched = 0, numpages = null, total = null, ok = true, stopReason = null, iterCap = 50;

  while (uri) {
    if (seenUris.has(uri)) { stopReason = 'cursor repeated'; break; }
    seenUris.add(uri);

    // Test hook: simulate a failed page fetch to prove the sweep is skipped.
    if (FAIL_ON_PAGE && pagesFetched + 1 === FAIL_ON_PAGE) {
      ok = false; stopReason = `SIMULATED failure on page ${FAIL_ON_PAGE} (AFFILIATE_SYNC_FAIL_ON_PAGE)`; break;
    }

    const { res, body } = await apiGet(uri);
    if (res.status !== 200) { ok = false; stopReason = `HTTP ${res.status} on page ${pagesFetched + 1}`; break; }
    pagesFetched++;
    items.push(...extractArray(body, 'Items'));

    if (numpages === null && body && typeof body === 'object') {
      numpages = parseInt(body['@numpages'], 10) || null;
      total    = body['@total'] !== undefined ? parseInt(body['@total'], 10) : null;
      iterCap  = (numpages || iterCap) + 2;
    }
    if (pagesFetched >= iterCap) { stopReason = `iteration cap (${iterCap})`; break; }

    const next = body && typeof body === 'object' ? body['@nextpageuri'] : null;
    if (!next || next === uri) { stopReason = stopReason || 'no next page'; break; }
    uri = next;                                   // follow VERBATIM — never reconstruct
  }
  return { items, pagesFetched, numpages, total, ok, stopReason };
}

function fetchItems_fileDownload() {
  throw new Error('fetch_strategy "file_download" not implemented');
}

// ── Program discovery: upsert affiliate_programs from /Catalogs ────────────────
async function syncCatalogsToPrograms() {
  const { res, body } = await apiGet(`/Mediapartners/${SID}/Catalogs?PageSize=1000`);
  if (res.status !== 200) throw new Error(`/Catalogs HTTP ${res.status}`);
  const catalogs = extractArray(body, 'Catalogs');
  console.log(`[sync] /Catalogs returned ${catalogs.length} catalog(s).`);

  const byCatalogId = new Map();
  for (const c of catalogs) {
    byCatalogId.set(String(c.Id), c);
    const { data: existing } = await supabase.from('affiliate_programs').select('id, dormied_brand_slug').eq('catalog_id', String(c.Id)).maybeSingle();
    if (existing) {
      if (!DRY) await supabase.from('affiliate_programs').update({
        advertiser_name: c.AdvertiserName, campaign_id: strOrNull(c.CampaignId),
        currency: strOrNull(c.Currency), last_synced_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      // Unmapped catalog — insert with NULL brand slug and shout, so it gets mapped by hand.
      console.warn(`[sync] !! UNMAPPED CATALOG: Id=${c.Id} "${c.Name}" advertiser="${c.AdvertiserName}" — inserted with dormied_brand_slug=NULL. Map it manually.`);
      if (!DRY) await supabase.from('affiliate_programs').insert({
        network: 'impact', advertiser_id: strOrNull(c.AdvertiserId), advertiser_name: c.AdvertiserName || '(unknown)',
        campaign_id: strOrNull(c.CampaignId), catalog_id: String(c.Id), dormied_brand_slug: null,
        status: 'active', currency: strOrNull(c.Currency), fetch_strategy: 'items_api',
        notes: `Auto-discovered ${new Date().toISOString().slice(0,10)}; unmapped.`,
        last_synced_at: new Date().toISOString(),
      });
    }
  }
  return byCatalogId;
}

function mapItem(item, program, feedUpdatedAt) {
  const promo = mapPromo(item.Promotions);
  return {
    program_id:          program.id,
    dormied_brand_slug:  program.dormied_brand_slug,
    impact_item_id:      item.Id,
    catalog_item_id:     strOrNull(item.CatalogItemId),
    item_group_id:       strOrNull(item.ItemGroupId),
    is_parent:           boolOrNull(item.IsParent),
    name:                item.Name,
    description:         strOrNull(item.Description),
    image_url:           strOrNull(item.ImageUrl),
    tracking_url:        item.Url,
    mobile_tracking_url: strOrNull(item.MobileUrl),   // empty string -> null
    current_price:       numOrNull(item.CurrentPrice),
    original_price:      numOrNull(item.OriginalPrice),
    discount_percentage: numOrNull(item.DiscountPercentage),
    currency:            strOrNull(item.Currency) || program.currency || null,
    stock_availability:  strOrNull(item.StockAvailability),
    category:            strOrNull(item.Category),
    sub_category:        strOrNull(item.SubCategory),
    gtin:                strOrNull(item.Gtin),
    mpn:                 strOrNull(item.Mpn),
    labels:              (Array.isArray(item.Labels) && item.Labels.length) ? item.Labels : null,
    promo_title:         promo.promo_title,
    promo_code:          promo.promo_code,
    promo_expires_at:    promo.promo_expires_at,
    feed_updated_at:     feedUpdatedAt,
    is_active:           true,
  };
}

async function chunked(rows, size, fn) {
  let done = 0;
  for (let i = 0; i < rows.length; i += size) { await fn(rows.slice(i, i + size)); done += Math.min(size, rows.length - i); }
  return done;
}

// ── Sync one mapped program ───────────────────────────────────────────────────
async function syncProgram(program, catalog) {
  const label = `${program.dormied_brand_slug} (catalog ${program.catalog_id})`;
  console.log(`\n[sync] === ${label} ===`);

  const numberOfItems = catalog ? numOrNull(catalog.NumberOfItems) : null;   // string in the feed
  const feedUpdatedAt = catalog && catalog.DateLastUpdated ? new Date(catalog.DateLastUpdated).toISOString() : null;

  const fetcher = program.fetch_strategy === 'file_download' ? fetchItems_fileDownload : fetchItems_itemsApi;
  const { items, pagesFetched, numpages, total, ok, stopReason } = await fetcher(program);

  // Completeness = we collected every item the API claims, with no fetch errors.
  // (pagesFetched vs @numpages is NOT part of this: Impact returns a benign
  // trailing empty page, so pagesFetched is normally @numpages + 1. It stays a
  // printed cross-check only.) A real failure sets ok=false; a real truncation
  // makes items.length < total. Both still fail this gate.
  const fetchComplete = ok && total !== null && items.length === total;

  // NumberOfItems (from /Catalogs at run start, daily-updating feed) is a printed
  // cross-check, never a gate. A few items of drift is legitimate; a real gap is not.
  if (numberOfItems !== null && total !== null) {
    const tol = Math.max(10, Math.round(total * 0.01));
    if (Math.abs(numberOfItems - total) > tol)
      console.warn(`[sync] !! NumberOfItems (${numberOfItems}) diverges from @total (${total}) by >${tol} for ${label}. Cross-check only, not a gate — worth a look.`);
  }

  const summary = {
    program: label, pagesFetched, numpages, itemsCollected: items.length, total, numberOfItems,
    fetchComplete, stopReason, inserted: 0, updated: 0, deactivated: 0, inherited: 0, skipped: [],
    activeBefore: 0, wouldDeactivate: 0, sweepPct: 0, sweepBlocked: false, nullPrice: 0,
  };

  if (!fetchComplete) {
    console.error(`[sync] !! INCOMPLETE FETCH for ${label} — NOT writing, NOT sweeping.`);
    console.error(`[sync]    pages ${pagesFetched}/${numpages}, items ${items.length}/${total}, ok=${ok}, stop="${stopReason}"`);
    return summary;                               // no writes; caller exits non-zero
  }

  // Build valid rows, skipping any missing a NOT-NULL field.
  const seenIds = new Set();
  const rows = [];
  for (const it of items) {
    const missing = [];
    if (!it.Id)   missing.push('Id');
    if (!it.Name) missing.push('Name');
    if (!it.Url)  missing.push('Url');
    if (missing.length) { summary.skipped.push({ id: it.Id || '(no id)', name: it.Name || '(no name)', missing }); continue; }
    if (seenIds.has(it.Id)) continue;             // guard against a duplicate Id inside one feed
    seenIds.add(it.Id);
    const mapped = mapItem(it, program, feedUpdatedAt);
    // Visibility guard: api/shop filters with .gte('current_price', ...), which in
    // Postgres also excludes NULLs. Zero today; if a feed ever introduces NULL
    // prices the catalog would silently shrink, so count them here.
    if (mapped.current_price === null) summary.nullPrice++;
    rows.push(mapped);
  }

  if (DRY) { console.log(`[sync] (dry-run) would write ${rows.length} rows for ${label}`); return summary; }

  // Existing rows for this program: for update vs insert, first_seen_at
  // inheritance, and the deactivation ceiling (which counts currently-active rows).
  const existingByItemId = new Map();             // impact_item_id -> id
  const existingActiveIds = new Set();            // impact_item_id where is_active=true
  const firstSeenByCatalogItem = new Map();       // catalog_item_id -> earliest first_seen_at (for migration inheritance)
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('affiliate_products')
      // source='impact' only: a program may ALSO carry rows from a merchant-feed
      // sync (source='shopify'). Those are invisible to Impact's /Items response,
      // so including them here would make the sweep deactivate every one of them.
      .select('id, impact_item_id, catalog_item_id, first_seen_at, is_active')
      .eq('program_id', program.id).eq('source', 'impact').range(from, from + 999);
    if (error) throw new Error(`load existing: ${error.message}`);
    if (!data || !data.length) break;
    for (const r of data) {
      existingByItemId.set(r.impact_item_id, r.id);
      if (r.is_active) existingActiveIds.add(r.impact_item_id);
      if (r.catalog_item_id) {
        const cur = firstSeenByCatalogItem.get(r.catalog_item_id);
        if (!cur || r.first_seen_at < cur) firstSeenByCatalogItem.set(r.catalog_item_id, r.first_seen_at);
      }
    }
    if (data.length < 1000) break;
  }

  const inserts = [], updates = [];
  for (const row of rows) {
    if (existingByItemId.has(row.impact_item_id)) {
      updates.push(row);                          // first_seen_at intentionally NOT in payload -> preserved
    } else {
      const inherited = row.catalog_item_id ? firstSeenByCatalogItem.get(row.catalog_item_id) : null;
      if (inherited) {
        row.first_seen_at = inherited;
        summary.inherited++;
        console.log(`[sync]    first_seen_at inherited for ${row.impact_item_id} via catalog_item_id ${row.catalog_item_id} -> ${inherited}`);
      }
      inserts.push(row);                          // no inherited -> column default now()
    }
  }

  if (inserts.length) summary.inserted = await chunked(inserts, 500, async batch => {
    const { error } = await supabase.from('affiliate_products').insert(batch);
    if (error) throw new Error(`insert batch: ${error.message}`);
  });
  if (updates.length) summary.updated = await chunked(updates, 500, async batch => {
    const { error } = await supabase.from('affiliate_products').upsert(batch, { onConflict: 'impact_item_id' });
    if (error) throw new Error(`update batch: ${error.message}`);
  });

  // ── DEACTIVATION SWEEP — only reached because fetchComplete === true ──────────
  // Any currently-active row NOT seen this run would be marked is_active=false
  // (never a DELETE — click history references these rows).
  //
  // CEILING: never auto-deactivate more than 20% of a program's active rows in a
  // single run, regardless of cause. This catches the outcome (mass deactivation)
  // even for causes no other guard anticipates — e.g. an under-reported @total
  // that satisfies fetchComplete. Override only with --allow-large-deactivation,
  // which the cron never sets. Inert on run one (0 active rows -> 0%).
  const wouldDeactivate = [];
  for (const impactId of existingActiveIds) if (!seenIds.has(impactId)) wouldDeactivate.push(impactId);
  summary.activeBefore    = existingActiveIds.size;
  summary.wouldDeactivate = wouldDeactivate.length;
  summary.sweepPct        = existingActiveIds.size ? (wouldDeactivate.length / existingActiveIds.size) * 100 : 0;

  if (wouldDeactivate.length && summary.sweepPct > 20 && !ALLOW_LARGE) {
    summary.sweepBlocked = true;
    console.error(`[sync] !! DEACTIVATION CEILING TRIPPED for ${label}: would deactivate ${wouldDeactivate.length}/${existingActiveIds.size} active rows (${summary.sweepPct.toFixed(1)}%) > 20%. Sweep SKIPPED, is_active untouched. Re-run with --allow-large-deactivation to override.`);
  } else if (wouldDeactivate.length) {
    summary.deactivated = await chunked(wouldDeactivate, 200, async batch => {
      const { error } = await supabase.from('affiliate_products')
        .update({ is_active: false }).eq('program_id', program.id).eq('source', 'impact')
        .in('impact_item_id', batch).eq('is_active', true);
      if (error) throw new Error(`deactivate batch: ${error.message}`);
    });
  }

  if (!DRY) await supabase.from('affiliate_programs').update({ last_synced_at: new Date().toISOString() }).eq('id', program.id);
  return summary;
}

async function inventoryReport(program) {
  const q = () => supabase.from('affiliate_products').select('*', { count: 'exact', head: true }).eq('program_id', program.id);
  const total   = (await q()).count || 0;
  const inStock = (await q().eq('is_active', true).eq('stock_availability', 'InStock')).count || 0;
  // Distinct in-stock item_group_id (the real displayable count after variant collapse).
  const groups = new Set();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('affiliate_products').select('item_group_id')
      .eq('program_id', program.id).eq('is_active', true).eq('stock_availability', 'InStock').range(from, from + 999);
    if (!data || !data.length) break;
    for (const r of data) groups.add(r.item_group_id ?? `__null_${groups.size}`);
    if (data.length < 1000) break;
  }
  return { total, inStock, distinctInStockGroups: groups.size };
}

async function main() {
  console.log(`[sync] Affiliate catalog sync starting${DRY ? ' (DRY RUN)' : ''}${FAIL_ON_PAGE ? ` [TEST: fail on page ${FAIL_ON_PAGE}]` : ''}`);

  const catalogsById = await syncCatalogsToPrograms();

  const { data: programs, error } = await supabase.from('affiliate_programs')
    .select('*').eq('status', 'active').not('dormied_brand_slug', 'is', null);
  if (error) throw new Error(`load programs: ${error.message}`);
  console.log(`[sync] ${programs.length} mapped active program(s) to sync.`);

  const summaries = [];
  let anyIncomplete = false, anySweepBlocked = false;
  for (const program of programs) {
    const s = await syncProgram(program, catalogsById.get(String(program.catalog_id)) || null);
    summaries.push(s);
    if (!s.fetchComplete) anyIncomplete = true;
    if (s.sweepBlocked)   anySweepBlocked = true;
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n========== SYNC SUMMARY ==========');
  for (const s of summaries) {
    console.log(`\n${s.program}`);
    console.log(`  fetch: pages ${s.pagesFetched}/${s.numpages} (trailing empty page expected), items ${s.itemsCollected}/${s.total}, NumberOfItems=${s.numberOfItems}, fetchComplete=${s.fetchComplete}${s.stopReason ? ` (stop: ${s.stopReason})` : ''}`);
    console.log(`  writes: inserted=${s.inserted}, updated=${s.updated}, deactivated=${s.deactivated}, first_seen_at inherited=${s.inherited}`);
    console.log(`  sweep: activeBefore=${s.activeBefore}, wouldDeactivate=${s.wouldDeactivate} (${s.sweepPct.toFixed(1)}%), ceiling=20%, blocked=${s.sweepBlocked}`);
    console.log(`  NULL current_price: ${s.nullPrice}${s.nullPrice ? '  <- these are EXCLUDED from /api/shop by the price floor' : ''}`);
    if (s.skipped.length) {
      console.log(`  skipped ${s.skipped.length} item(s) for missing required fields:`);
      for (const sk of s.skipped.slice(0, 20)) console.log(`    - ${sk.id} "${sk.name}" missing: ${sk.missing.join(', ')}`);
    } else console.log('  skipped: 0');
  }

  // ── Inventory report (per mapped program) ────────────────────────────────────
  if (!DRY) {
    console.log('\n========== INVENTORY REPORT ==========');
    for (const program of programs) {
      const inv = await inventoryReport(program);
      console.log(`${program.dormied_brand_slug}: total=${inv.total}, in-stock=${inv.inStock}, DISTINCT in-stock item_group_id=${inv.distinctInStockGroups}  <- real displayable count after variant collapse`);
    }
  }

  if (anyIncomplete || anySweepBlocked) {
    console.error(`\n[sync] Exiting non-zero:${anyIncomplete ? ' incomplete fetch' : ''}${anySweepBlocked ? ' deactivation ceiling tripped' : ''} (writes/sweep withheld where flagged, is_active untouched).`);
    process.exit(1);
  }
  console.log('\n[sync] Done.');
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(e => { console.error('[sync] Fatal:', e.message); process.exit(1); });
}