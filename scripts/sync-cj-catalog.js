#!/usr/bin/env node
/**
 * scripts/sync-cj-catalog.js
 *
 * Third catalog ingestion path: CJ (Commission Junction) GraphQL Product Search.
 *
 *   endpoint  https://ads.api.cj.com/query
 *   auth      Authorization: Bearer <personal access token>
 *   scope     the products/shoppingProducts queries return ONLY advertisers
 *             this publisher account has actually joined
 *
 * Rows land in affiliate_products with source='cj', so they are invisible to
 * both the Impact sweep (source='impact') and the Shopify sweep
 * (source='shopify'). Each source only ever deactivates its own rows.
 *
 * ── ON THE GRAPHQL DOCUMENT ─────────────────────────────────────────────────
 * CJ's developer portal is client-rendered, so the exact field names could not
 * be read from the docs, and a GraphQL query written from memory fails at
 * runtime or, worse, silently returns nulls that look like an empty catalog.
 *
 * So PRODUCT_QUERY below is a starting point, NOT a verified contract, and this
 * script will not let it fail quietly:
 *
 *   --introspect   asks the live API for the real schema — the product query's
 *                  arguments and every field on its result type — and prints
 *                  it. Run this FIRST with a real token; correct PRODUCT_QUERY
 *                  from the output; then sync.
 *   --discover     lists the advertisers this account has joined, with their
 *                  CJ advertiser ids, so affiliate_programs rows can be mapped
 *                  by hand (never automatically — same rule as Impact).
 *
 * A normal run validates the response shape before writing and aborts with the
 * offending payload if it does not match.
 *
 * Safety contract, matching the other two syncs:
 *   - A partial or failed fetch writes NOTHING for that program and exits non-zero.
 *   - The deactivation sweep runs only on a verified-complete fetch, is scoped to
 *     source='cj', and refuses >20% without --allow-large-deactivation.
 *   - first_seen_at preserved. NEVER deletes.
 *   - US storefront + USD only: non-USD rows are skipped, not converted.
 *
 * Credentials from env ONLY: CJ_PAT, CJ_COMPANY_ID. Never hardcoded, never logged.
 *
 * Usage:
 *   node scripts/sync-cj-catalog.js --introspect
 *   node scripts/sync-cj-catalog.js --discover
 *   node scripts/sync-cj-catalog.js --dry-run
 *   node scripts/sync-cj-catalog.js --brand=cobra
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');

const DRY         = process.argv.includes('--dry-run');
const INTROSPECT  = process.argv.includes('--introspect');
const DISCOVER    = process.argv.includes('--discover');
const ALLOW_LARGE = process.argv.includes('--allow-large-deactivation');
const ONLY_BRAND  = (process.argv.find(a => a.startsWith('--brand=')) || '').replace('--brand=', '') || null;

const PAT = process.env.CJ_PAT;
const CID = process.env.CJ_COMPANY_ID;
// Property ID. linkCode(pid:) is what mints the tracking URL, so without this
// there is no sellable link and the sync refuses to run.
const PID = process.env.CJ_PID;
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

const ENDPOINT = 'https://ads.api.cj.com/query';
const REQUIRED_CURRENCY = 'USD';

function need(cond, msg) { if (!cond) { console.error(`[cj-sync] ${msg}`); process.exit(1); } }

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`CJ returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`); }
  if (body.errors && body.errors.length) {
    throw new Error(`CJ GraphQL error: ${body.errors.map(e => e.message).join(' | ')}`);
  }
  if (res.status !== 200) throw new Error(`CJ HTTP ${res.status}: ${text.slice(0, 300)}`);
  return body.data;
}

// ── Schema discovery ─────────────────────────────────────────────────────────
const INTROSPECT_QUERY = `
query {
  __schema {
    queryType {
      fields {
        name
        description
        args { name type { name kind ofType { name kind } } }
        type { name kind ofType { name kind ofType { name kind } } }
      }
    }
  }
}`;

// NON_NULL(LIST(NON_NULL(T))) needs four levels of unwrapping; two was not
// enough and left resultList showing as '?'.
const TYPE_QUERY = `
query TypeFields($name: String!) {
  __type(name: $name) {
    name
    fields {
      name
      type { name kind ofType { name kind ofType { name kind ofType { name kind ofType { name kind } } } } }
    }
  }
}`;

const unwrap = t => (!t ? '?' : t.name || unwrap(t.ofType));

async function runIntrospect() {
  console.log('[cj-sync] Asking CJ for its real schema…\n');
  const data = await gql(INTROSPECT_QUERY);
  const fields = data.__schema.queryType.fields || [];
  console.log(`Root query fields (${fields.length}):\n`);
  for (const f of fields) {
    console.log(`  ${f.name}(${(f.args || []).map(a => `${a.name}: ${unwrap(a.type)}`).join(', ')}) -> ${unwrap(f.type)}`);
    if (f.description) console.log(`      ${f.description.split('\n')[0]}`);
  }

  // Expand whatever looks like the product query so the field names are exact.
  const productish = fields.filter(f => /product/i.test(f.name));
  for (const f of productish) {
    const typeName = unwrap(f.type);
    console.log(`\n── fields on ${typeName} (return of ${f.name}) ──`);
    try {
      const t = await gql(TYPE_QUERY, { name: typeName });
      for (const sub of (t.__type?.fields || [])) {
        const st = unwrap(sub.type);
        console.log(`    ${sub.name}: ${st}`);
        if (/product|result|edge|node|item/i.test(st)) {
          const inner = await gql(TYPE_QUERY, { name: st });
          for (const leaf of (inner.__type?.fields || [])) console.log(`        ${leaf.name}: ${unwrap(leaf.type)}`);
        }
      }
    } catch (e) { console.log(`    (could not expand: ${e.message})`); }
  }
  console.log('\n[cj-sync] Correct PRODUCT_QUERY from the above, then run --dry-run.');
}

// ── Joined-advertiser discovery ──────────────────────────────────────────────
// Advertiser -> dormied brand slug is ALWAYS a manual affiliate_programs row.
// This only reports what the account can see.
const FEEDS_QUERY = `
query Feeds($cid: ID!) {
  productFeeds(companyId: $cid, feedType: ALL, advertiserCountry: "US", limit: 200) {
    totalCount
    resultList {
      adId
      advertiserId
      advertiserName
      advertiserCountry
      currency
      feedName
      productCount
      lastUpdated
    }
  }
}`;

async function runDiscover() {
  console.log('[cj-sync] Listing US product feeds this account can see…\n');
  const data = await gql(FEEDS_QUERY, { cid: CID });
  const list = data?.productFeeds?.resultList || [];
  if (!list.length) { console.log('  (none returned)'); return; }
  const w = Math.max(...list.map(f => (f.advertiserName || '').length), 10);
  console.log(`  ${'ADVERTISER'.padEnd(w)}  ${'ADV ID'.padEnd(9)} ${'ADID'.padEnd(9)} ${'CUR'.padEnd(4)} PRODUCTS  FEED`);
  for (const f of list) {
    console.log(`  ${String(f.advertiserName || '').padEnd(w)}  ${String(f.advertiserId).padEnd(9)} ${String(f.adId).padEnd(9)} ${String(f.currency || '').padEnd(4)} ${String(f.productCount ?? '').padStart(8)}  ${f.feedName || ''}`);
  }
  console.log('\n[cj-sync] Map the ones you want by hand into affiliate_programs (source=\'cj\').');
}

// ── Product query ────────────────────────────────────────────────────────────
// UNVERIFIED until --introspect confirms it. See the header note.
// Verified against the live schema via --introspect on 2026-07-30.
//
// linkCode.clickUrl is the TRACKING link. The plain `link` field is the
// advertiser's own product URL and earns nothing — an easy and completely
// silent way to ship a catalog of working links that never pays.
//
// currency and availability are server-side ARGUMENTS, so USD and in-stock are
// enforced by CJ. The targetCountry ARGUMENT is NOT authorized for this account
// ("You are not authorized to use googleProductCategoryIds or targetCountry
// filter"), so US is enforced per-product in mapProduct against the
// targetCountry FIELD, which the API does return.
const PRODUCT_QUERY = `
query Products($cid: ID!, $pid: ID!, $advertiserIds: [ID!], $limit: Int!, $page: String) {
  products(
    companyId: $cid
    partnerIds: $advertiserIds
    partnerStatus: JOINED
    currency: "USD"
    availability: IN_STOCK
    limit: $limit
    page: $page
  ) {
    totalCount
    count
    nextPage
    resultList {
      id
      title
      description
      brand
      advertiserId
      advertiserName
      targetCountry
      imageLink
      link
      linkCode(pid: $pid) { clickUrl }
      price { amount currency }
      salePrice { amount currency }
      effectiveDerivedPrice { amount currency }
      discountPercentage
      lastUpdated
    }
  }
}`;

const PAGE = 100;

// CJ exposes Cobra and Puma as ONE advertiser ("Puma Golf and Cobra Golf",
// 6530791), so the split onto /brands/cobra/ and /brands/puma-golf/ has to
// happen here. The feed's own `brand` field does it cleanly — a 2,000-product
// sample was 100% either "PUMA Golf" or "COBRA Golf", with links to
// cobragolf.com and pumagolf.com respectively. Config lives in code rather than
// a schema column, matching PLAYER_SHOP_BRAND and SHAFT_BRAND_LINKS.
const BRAND_FIELD_TO_SLUG = {
  'cobra golf': 'cobra',
  'puma golf':  'puma-golf',
};
const brandSlugOf = raw => BRAND_FIELD_TO_SLUG[String(raw || '').trim().toLowerCase()] || null;

/** Fails loudly rather than treating an unexpected shape as an empty catalog. */
function assertShape(payload, program) {
  const node = payload?.products;
  if (!node || !Array.isArray(node.resultList)) {
    throw new Error(
      `unexpected response shape for ${program.dormied_brand_slug} — expected products.resultList[].\n` +
      `        got keys: ${JSON.stringify(Object.keys(payload || {}))}\n` +
      `        Run --introspect and correct PRODUCT_QUERY.`);
  }
  return node;
}

async function fetchAll(program) {
  const ids = program.advertiser_id ? [program.advertiser_id] : null;
  const products = [];
  const seen = new Set();
  let page = null, total = null, dupes = 0, pages = 0;

  // Cursor pagination, not offset. An offset walk over a live feed returned a
  // different count on consecutive runs (851 then 907) because the catalog
  // shifts underneath the window, and it also re-served rows already seen.
  // nextPage is passed back VERBATIM, the same contract as Impact's
  // @nextpageuri.
  for (;;) {
    let data;
    try {
      data = await gql(PRODUCT_QUERY, { cid: CID, pid: PID, advertiserIds: ids, limit: PAGE, page });
    } catch (e) {
      console.error(`[cj-sync]   fetch failed on page ${pages + 1}: ${e.message}`);
      return { products, complete: false };
    }
    const node = assertShape(data, program);
    if (total === null) total = node.totalCount ?? null;

    // CJ can repeat a product id across pages; the upsert would then fail with
    // "ON CONFLICT DO UPDATE command cannot affect row a second time".
    for (const p of node.resultList) {
      const id = String(p.id);
      if (seen.has(id)) { dupes++; continue; }
      seen.add(id);
      products.push(p);
    }

    pages++;
    page = node.nextPage || null;
    if (!page || !node.resultList.length) break;
    if (pages > 400) { console.error('[cj-sync]   runaway pagination guard hit'); return { products, complete: false }; }
  }

  if (dupes) console.log(`[cj-sync]   de-duplicated ${dupes} repeated product id(s) across ${pages} page(s)`);

  // Complete when we hold at least as many DISTINCT ids as CJ reported, or when
  // duplicates account for the shortfall.
  const complete = total === null ? true : (products.length + dupes) >= total;
  if (!complete) console.error(`[cj-sync]   incomplete: CJ reported ${total}, collected ${products.length} distinct (+${dupes} dupes)`);
  return { products, complete, total };
}

/**
 * CJ's feed contains UTF-8 that was decoded as Latin-1 somewhere upstream, so
 * "48°" arrives as "48Â°" and apostrophes as "â€™". 65 of 8,158 rows on the
 * first sync. Verified byte-identical coming out of their API, so this is their
 * data, not our transport — but it renders as visible garbage on the page.
 *
 * The double-encoding is losslessly reversible. Only attempted when the
 * signature is present AND the round-trip is clean, so text that is genuinely
 * Latin-1 is left alone.
 */
function repairMojibake(str) {
  if (typeof str !== 'string' || !/[ÂÃ]|â€/.test(str)) return str;
  try {
    const fixed = Buffer.from(str, 'latin1').toString('utf8');
    if (fixed.includes('\uFFFD')) return str;                 // lossy — leave it
    if (Buffer.from(fixed, 'utf8').toString('latin1') !== str) return str;
    return fixed;
  } catch { return str; }
}

function mapProduct(p, program, syncedAt) {
  // clickUrl is the tracking link; `link` is the advertiser's plain product URL
  // and earns nothing. A row without a clickUrl is dropped rather than shipped
  // untracked — a working link that pays no commission is the worst outcome,
  // because nothing downstream can detect it.
  const tracking = p.linkCode && p.linkCode.clickUrl;
  if (!tracking || !p.id || !p.title) return null;

  const sale = p.salePrice?.amount != null ? Number(p.salePrice.amount) : null;
  const list = p.price?.amount != null ? Number(p.price.amount) : null;
  const eff  = p.effectiveDerivedPrice?.amount != null ? Number(p.effectiveDerivedPrice.amount) : null;
  const price = [eff, sale, list].find(v => Number.isFinite(v) && v > 0);
  if (!Number.isFinite(price)) return null;

  const cur = (p.effectiveDerivedPrice?.currency || p.salePrice?.currency || p.price?.currency || '').toUpperCase();
  if (cur !== REQUIRED_CURRENCY) return null;      // never converted, only skipped
  if (p.targetCountry && String(p.targetCountry).toUpperCase() !== 'US') return null;

  const onSale = Number.isFinite(list) && list > price;
  return {
    program_id:          program.id,
    dormied_brand_slug:  program.dormied_brand_slug,
    source:              'cj',
    source_item_id:      String(p.id),
    impact_item_id:      null,
    item_group_id:       String(p.id),
    is_parent:           true,
    name:                repairMojibake(p.title),
    description:         null,
    image_url:           p.imageLink || null,
    tracking_url:        tracking,
    current_price:       price,
    original_price:      onSale ? list : null,
    discount_percentage: onSale
      ? (Number.isFinite(Number(p.discountPercentage)) && Number(p.discountPercentage) > 0
          ? Math.round(Number(p.discountPercentage))
          : Math.round(((list - price) / list) * 100))
      : null,
    currency:            cur,
    // The query already filters availability: IN_STOCK server-side, so anything
    // returned is in stock — Product carries no availability field to read.
    stock_availability:  'InStock',
    category:            null,
    sub_category:        null,
    gtin:                null,
    mpn:                 null,
    labels:              p.brand ? [p.brand] : null,
    promo_code:          null,
    promo_title:         null,
    promo_expires_at:    null,
    // When WE last verified this price, which is what the carousel's staleness
    // guard actually means — it hides prices if the sync stops running.
    // CJ's own lastUpdated is the merchant's last product EDIT (often years
    // ago: the Cobra irons above read 2025-10), so using it made 100% of CJ
    // rows look stale and suppressed every price. Impact and Shopify are
    // unaffected because their feed timestamps move daily.
    feed_updated_at:     syncedAt,
    source_published_at: null,
    is_active:           true,
  };
}

async function chunked(arr, size, fn) {
  for (let i = 0; i < arr.length; i += size) await fn(arr.slice(i, i + size));
  return arr.length;
}

async function syncProgram(supabase, program) {
  const label = program.dormied_brand_slug;
  console.log(`\n[cj-sync] === ${label} (advertiser ${program.advertiser_id || 'ALL'}) ===`);

  const { products, complete, total } = await fetchAll(program);
  console.log(`[cj-sync]   fetched ${products.length} product(s), complete=${complete}${total != null ? ` (CJ total ${total})` : ''}`);
  if (!complete) { console.error(`[cj-sync]   !! INCOMPLETE — writing nothing, no sweep.`); return { ok: false }; }
  if (!products.length) { console.error(`[cj-sync]   !! zero products — writing nothing, no sweep.`); return { ok: false }; }

  // Keep only the products whose feed brand maps to THIS program's brand.
  const mine = products.filter(p => brandSlugOf(p.brand) === program.dormied_brand_slug);
  const unmapped = products.filter(p => !brandSlugOf(p.brand));
  if (unmapped.length) {
    const names = [...new Set(unmapped.map(p => p.brand))].slice(0, 5);
    console.warn(`[cj-sync]   !! ${unmapped.length} product(s) carry an unmapped brand — add to BRAND_FIELD_TO_SLUG: ${JSON.stringify(names)}`);
  }
  console.log(`[cj-sync]   ${mine.length} of ${products.length} match brand "${program.dormied_brand_slug}"`);
  const syncedAt = new Date().toISOString();
  const rows = mine.map(p => mapProduct(p, program, syncedAt)).filter(Boolean);
  const dropped = mine.length - rows.length;
  console.log(`[cj-sync]   mapped ${rows.length} row(s)${dropped ? ` (${dropped} skipped: non-USD or missing id/link/price)` : ''}`);
  if (!rows.length) { console.error(`[cj-sync]   !! nothing mappable in ${REQUIRED_CURRENCY} — writing nothing.`); return { ok: false }; }

  const existingActive = new Set();
  const firstSeenById  = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('affiliate_products')
      .select('source_item_id, first_seen_at, is_active')
      .eq('program_id', program.id).eq('source', 'cj').range(from, from + 999);
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
    console.log(`[cj-sync]   (dry-run) would upsert ${rows.length} row(s)`);
  } else {
    await chunked(rows, 200, async batch => {
      const { error } = await supabase.from('affiliate_products')
        .upsert(batch, { onConflict: 'program_id,source_item_id' });
      if (error) throw new Error(`upsert batch: ${error.message}`);
    });
    console.log(`[cj-sync]   upserted ${rows.length} row(s)`);
  }

  const seen = new Set(rows.map(r => r.source_item_id));
  const gone = [...existingActive].filter(id => !seen.has(id));
  const pct  = existingActive.size ? (gone.length / existingActive.size) * 100 : 0;

  if (gone.length && pct > 20 && !ALLOW_LARGE) {
    console.error(`[cj-sync]   !! DEACTIVATION CEILING TRIPPED for ${label}: ${gone.length}/${existingActive.size} (${pct.toFixed(1)}%) > 20%. Sweep SKIPPED.`);
  } else if (gone.length && !DRY) {
    await chunked(gone, 200, async batch => {
      const { error } = await supabase.from('affiliate_products')
        .update({ is_active: false })
        .eq('program_id', program.id).eq('source', 'cj')
        .in('source_item_id', batch).eq('is_active', true);
      if (error) throw new Error(`deactivate batch: ${error.message}`);
    });
    console.log(`[cj-sync]   deactivated ${gone.length} row(s) no longer in the feed`);
  }

  if (!DRY) await supabase.from('affiliate_programs').update({ last_synced_at: new Date().toISOString() }).eq('id', program.id);
  const inStock = rows.filter(r => r.stock_availability === 'InStock').length;
  console.log(`[cj-sync]   summary: ${rows.length} products, ${inStock} in stock, ${gone.length} deactivated`);
  return { ok: true };
}

async function main() {
  need(PAT, 'Missing CJ_PAT (personal access token from members.cj.com > Account > Personal Access Tokens).');
  need(CID, 'Missing CJ_COMPANY_ID (members.cj.com > Account > Account Information).');
  if (!INTROSPECT && !DISCOVER) {
    need(PID, 'Missing CJ_PID (members.cj.com > Account > Websites — the Property/Website ID). ' +
              'linkCode(pid:) needs it; without it every product would be untracked.');
  }

  if (INTROSPECT) return runIntrospect();
  if (DISCOVER)   return runDiscover();

  need(SUPABASE_URL && SUPABASE_SERVICE_KEY, 'Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log(`[cj-sync] CJ catalog sync starting${DRY ? ' (DRY RUN)' : ''}`);
  let q = supabase.from('affiliate_programs').select('*').eq('source', 'cj').eq('status', 'active')
    .not('dormied_brand_slug', 'is', null);
  if (ONLY_BRAND) q = q.eq('dormied_brand_slug', ONLY_BRAND);
  const { data: programs, error } = await q;
  if (error) { console.error('[cj-sync] program fetch failed:', error.message); process.exit(1); }
  if (!programs.length) { console.log('[cj-sync] no cj-source programs configured. Run --discover, then add rows by hand.'); return; }

  let failed = 0;
  for (const p of programs) {
    try { if (!(await syncProgram(supabase, p)).ok) failed++; }
    catch (e) { failed++; console.error(`[cj-sync] ${p.dormied_brand_slug} FAILED: ${e.message}`); }
  }
  if (failed) { console.error(`\n[cj-sync] ${failed} program(s) failed — exiting non-zero.`); process.exit(1); }
  console.log('\n[cj-sync] Done.');
}

main().catch(e => { console.error('[cj-sync] Fatal:', e.message); process.exit(1); });
