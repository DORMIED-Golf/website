#!/usr/bin/env node
/**
 * scripts/sync-shopify-catalog.js
 *
 * Second catalog ingestion path, for affiliate partners who deep-link but do not
 * expose a product catalog through Impact's /Items API.
 *
 * Reads the merchant's public Shopify products.json, and builds the tracking URL
 * as {tracking_prefix}?u={encoded product url} — Impact deep linking, the same
 * thing Impact's own link generator produces.
 *
 * This DELIBERATELY breaks the rule sync-affiliate-catalog.js holds ("never
 * build affiliate links; Impact's Url is already the tracking link"). That rule
 * is correct where Impact hands us the URL. Here there is no Impact catalog to
 * hand us anything, so the link is constructed — and because a WRONG prefix
 * still redirects perfectly while paying nothing, this script refuses to write
 * anything until it has proven attribution works (see assertTrackingWorks).
 *
 * Rows are written with source='shopify' and are invisible to the Impact sync,
 * whose deactivation sweep is scoped to source='impact'.
 *
 * Safety contract:
 *   - Tracking is VERIFIED per program before any write: one constructed link is
 *     resolved and must land on the merchant's host carrying an Impact click id.
 *   - A partial feed fetch writes NOTHING for that program and exits non-zero.
 *   - The deactivation sweep runs only on a verified-complete fetch and refuses
 *     to deactivate >20% of a program's active rows without --allow-large-deactivation.
 *   - first_seen_at is preserved across updates.
 *   - NEVER deletes.
 *
 * Config lives on affiliate_programs: source='shopify', feed_url, tracking_prefix.
 *
 * Usage:
 *   node scripts/sync-shopify-catalog.js
 *   node scripts/sync-shopify-catalog.js --dry-run
 *   node scripts/sync-shopify-catalog.js --brand=malbon
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');

const DRY         = process.argv.includes('--dry-run');
const ALLOW_LARGE = process.argv.includes('--allow-large-deactivation');
const ONLY_BRAND  = (process.argv.find(a => a.startsWith('--brand=')) || '').replace('--brand=', '') || null;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[shopify-sync] Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const UA        = 'Mozilla/5.0 (compatible; DORMIED/1.0; +https://dormied.com)';
const PAGE_SIZE = 250;              // Shopify's maximum
const MAX_PAGES = 40;               // 10k products; a runaway guard, not a limit we expect to hit
const POLITE_MS = 700;              // between feed pages

const sleep = ms => new Promise(r => setTimeout(r, ms));
const strOrNull = v => (v === undefined || v === null || v === '' ? null : String(v));

// ── Tracking link ────────────────────────────────────────────────────────────
function buildTrackingUrl(prefix, productUrl) {
  return `${prefix}${prefix.includes('?') ? '&' : '?'}u=${encodeURIComponent(productUrl)}`;
}

/**
 * Prove the constructed link actually attributes before writing 800+ of them.
 * Resolves one link and requires BOTH:
 *   - the final URL is on the merchant's own host (deep link honoured), and
 *   - it carries an Impact click id (irclickid), i.e. the click was recorded.
 * A prefix that is merely well-formed fails this.
 */
async function assertTrackingWorks(program, sampleProductUrl) {
  const link = buildTrackingUrl(program.tracking_prefix, sampleProductUrl);
  let res;
  try {
    res = await fetch(link, { redirect: 'follow', headers: { 'User-Agent': UA } });
  } catch (e) {
    throw new Error(`tracking check could not resolve ${program.dormied_brand_slug}: ${e.message}`);
  }
  const finalUrl   = new URL(res.url);
  const expectHost = new URL(sampleProductUrl).host;
  const hasClickId = finalUrl.searchParams.has('irclickid');
  const rightHost  = finalUrl.host === expectHost;
  const rightPath  = finalUrl.pathname === new URL(sampleProductUrl).pathname;

  if (!rightHost || !hasClickId || !rightPath) {
    throw new Error(
      `tracking check FAILED for ${program.dormied_brand_slug} — refusing to write untracked links.\n` +
      `        expected host=${expectHost} path=${new URL(sampleProductUrl).pathname}\n` +
      `        got      host=${finalUrl.host} path=${finalUrl.pathname} irclickid=${hasClickId}`
    );
  }
  console.log(`[shopify-sync]   tracking verified: deep link lands on ${finalUrl.host}${finalUrl.pathname} with irclickid`);
}

// ── Feed ─────────────────────────────────────────────────────────────────────
/** Returns { products, complete }. complete=false means DO NOT sweep. */
async function fetchAllProducts(feedUrl) {
  const products = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = feedUrl.includes('?') ? '&' : '?';
    const url = `${feedUrl}${sep}limit=${PAGE_SIZE}&page=${page}`;
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    } catch (e) {
      console.error(`[shopify-sync]   page ${page} fetch threw: ${e.message}`);
      return { products, complete: false };
    }
    if (!res.ok) {
      console.error(`[shopify-sync]   page ${page} HTTP ${res.status}`);
      return { products, complete: false };
    }
    let batch;
    try { batch = (await res.json()).products || []; }
    catch (e) { console.error(`[shopify-sync]   page ${page} bad JSON: ${e.message}`); return { products, complete: false }; }

    products.push(...batch);
    if (batch.length < PAGE_SIZE) return { products, complete: true };  // short page = last page
    await sleep(POLITE_MS);
  }
  console.error(`[shopify-sync]   hit MAX_PAGES (${MAX_PAGES}) without a short page — treating as incomplete`);
  return { products, complete: false };
}

// ── Mapping ──────────────────────────────────────────────────────────────────
/**
 * One row per PRODUCT (not per variant): the carousel shows one card per
 * product, and variants share a page. Price comes from the first available
 * variant so the shown price is one a buyer can actually transact at.
 */
function mapProduct(p, program, origin) {
  const variants  = Array.isArray(p.variants) ? p.variants : [];
  const available = variants.filter(v => v.available);
  const v         = available[0] || variants[0];
  if (!v) return null;

  const productUrl = `${origin}/products/${p.handle}`;
  const price      = v.price != null ? Number(v.price) : null;
  const compareAt  = v.compare_at_price != null ? Number(v.compare_at_price) : null;
  const onSale     = compareAt != null && price != null && compareAt > price;
  const image      = (p.images || []).find(i => i && i.src);

  return {
    program_id:         program.id,
    dormied_brand_slug: program.dormied_brand_slug,
    source:             'shopify',
    source_item_id:     String(p.id),
    impact_item_id:     null,
    item_group_id:      String(p.id),
    is_parent:          true,
    name:               p.title,
    description:        null,   // body_html is marketing HTML; not worth storing
    image_url:          image ? image.src : null,
    tracking_url:       buildTrackingUrl(program.tracking_prefix, productUrl),
    current_price:      price,
    original_price:     onSale ? compareAt : null,
    discount_percentage: onSale ? Math.round(((compareAt - price) / compareAt) * 100) : null,
    currency:           program.currency || 'USD',
    stock_availability: available.length ? 'InStock' : 'OutOfStock',
    category:           strOrNull(p.product_type),
    sub_category:       null,
    gtin:               null,
    mpn:                strOrNull(v.sku),
    labels:             Array.isArray(p.tags) ? p.tags.slice(0, 20) : null,
    // products.json carries no promotions — these stay null by design.
    promo_code:         null,
    promo_title:        null,
    promo_expires_at:   null,
    feed_updated_at:    p.updated_at || null,
    // Merchant publish date. Storing the whole catalog and sorting on this beats
    // ingesting a separate new-arrivals feed: same data, one source, and the
    // back catalogue stays available for anything that wants it.
    source_published_at: p.published_at || p.created_at || null,
    is_active:          true,
  };
}

async function chunked(arr, size, fn) {
  let n = 0;
  for (let i = 0; i < arr.length; i += size) { await fn(arr.slice(i, i + size)); n += Math.min(size, arr.length - i); }
  return n;
}

// ── Per-program sync ─────────────────────────────────────────────────────────
async function syncProgram(program) {
  const label = program.dormied_brand_slug;
  console.log(`\n[shopify-sync] === ${label} ===`);

  if (!program.feed_url || !program.tracking_prefix) {
    console.error(`[shopify-sync]   missing feed_url or tracking_prefix — skipped`);
    return { ok: false };
  }

  const { products, complete } = await fetchAllProducts(program.feed_url);
  console.log(`[shopify-sync]   feed: ${products.length} product(s), complete=${complete}`);
  if (!complete) {
    console.error(`[shopify-sync]   !! INCOMPLETE FEED for ${label} — writing nothing, no sweep.`);
    return { ok: false };
  }
  if (!products.length) {
    console.error(`[shopify-sync]   !! feed returned zero products — writing nothing, no sweep.`);
    return { ok: false };
  }

  const origin = new URL(program.feed_url).origin;

  // Verify attribution on a real product BEFORE any write.
  await assertTrackingWorks(program, `${origin}/products/${products[0].handle}`);

  const rows = products.map(p => mapProduct(p, program, origin)).filter(Boolean);
  console.log(`[shopify-sync]   mapped ${rows.length} row(s)`);

  // Existing rows for this program from THIS source only.
  const existingActive = new Set();
  const firstSeenById  = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('affiliate_products')
      .select('source_item_id, first_seen_at, is_active')
      .eq('program_id', program.id).eq('source', 'shopify').range(from, from + 999);
    if (error) throw new Error(`load existing: ${error.message}`);
    if (!data || !data.length) break;
    for (const r of data) {
      if (r.is_active) existingActive.add(r.source_item_id);
      if (r.first_seen_at) firstSeenById.set(r.source_item_id, r.first_seen_at);
    }
    if (data.length < 1000) break;
  }

  const now = new Date().toISOString();
  for (const r of rows) r.first_seen_at = firstSeenById.get(r.source_item_id) || now;

  if (DRY) {
    console.log(`[shopify-sync]   (dry-run) would upsert ${rows.length} row(s)`);
  } else {
    await chunked(rows, 200, async batch => {
      const { error } = await supabase.from('affiliate_products')
        .upsert(batch, { onConflict: 'program_id,source_item_id' });
      if (error) throw new Error(`upsert batch: ${error.message}`);
    });
    console.log(`[shopify-sync]   upserted ${rows.length} row(s)`);
  }

  // Sweep: anything active we no longer saw in a COMPLETE feed.
  const seen = new Set(rows.map(r => r.source_item_id));
  const gone = [...existingActive].filter(id => !seen.has(id));
  const pct  = existingActive.size ? (gone.length / existingActive.size) * 100 : 0;

  if (gone.length && pct > 20 && !ALLOW_LARGE) {
    console.error(`[shopify-sync]   !! DEACTIVATION CEILING TRIPPED for ${label}: would deactivate ${gone.length}/${existingActive.size} (${pct.toFixed(1)}%) > 20%. Sweep SKIPPED. Re-run with --allow-large-deactivation to override.`);
  } else if (gone.length && !DRY) {
    await chunked(gone, 200, async batch => {
      const { error } = await supabase.from('affiliate_products')
        .update({ is_active: false })
        .eq('program_id', program.id).eq('source', 'shopify')
        .in('source_item_id', batch).eq('is_active', true);
      if (error) throw new Error(`deactivate batch: ${error.message}`);
    });
    console.log(`[shopify-sync]   deactivated ${gone.length} row(s) no longer in the feed`);
  } else if (gone.length) {
    console.log(`[shopify-sync]   (dry-run) would deactivate ${gone.length} row(s)`);
  }

  if (!DRY) {
    await supabase.from('affiliate_programs')
      .update({ last_synced_at: new Date().toISOString() }).eq('id', program.id);
  }
  const inStock = rows.filter(r => r.stock_availability === 'InStock').length;
  console.log(`[shopify-sync]   summary: ${rows.length} products, ${inStock} in stock, ${gone.length} deactivated`);
  return { ok: true };
}

async function main() {
  console.log(`[shopify-sync] Shopify catalog sync starting${DRY ? ' (DRY RUN)' : ''}`);

  let q = supabase.from('affiliate_programs').select('*').eq('source', 'shopify').eq('status', 'active')
    .not('dormied_brand_slug', 'is', null);
  if (ONLY_BRAND) q = q.eq('dormied_brand_slug', ONLY_BRAND);
  const { data: programs, error } = await q;
  if (error) { console.error('[shopify-sync] program fetch failed:', error.message); process.exit(1); }
  if (!programs.length) { console.log('[shopify-sync] no shopify-source programs configured. Nothing to do.'); return; }

  console.log(`[shopify-sync] ${programs.length} program(s) to sync.`);
  let failed = 0;
  for (const p of programs) {
    try { if (!(await syncProgram(p)).ok) failed++; }
    catch (e) { failed++; console.error(`[shopify-sync] ${p.dormied_brand_slug} FAILED: ${e.message}`); }
  }
  if (failed) { console.error(`\n[shopify-sync] ${failed} program(s) failed — exiting non-zero.`); process.exit(1); }
  console.log('\n[shopify-sync] Done.');
}

main().catch(e => { console.error('[shopify-sync] Fatal:', e); process.exit(1); });
