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

const TYPE_QUERY = `
query TypeFields($name: String!) {
  __type(name: $name) {
    name
    fields { name type { name kind ofType { name kind ofType { name kind } } } }
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
const ADVERTISER_QUERY = `
query Advertisers($cid: ID!) {
  advertiserLookup(companyId: $cid, relationshipStatus: joined) {
    resultList { advertiserId advertiserName networkRank }
  }
}`;

async function runDiscover() {
  console.log('[cj-sync] Listing joined advertisers…\n');
  try {
    const data = await gql(ADVERTISER_QUERY, { cid: CID });
    const list = data?.advertiserLookup?.resultList || [];
    if (!list.length) { console.log('  (none returned)'); return; }
    for (const a of list) console.log(`  ${String(a.advertiserId).padEnd(10)} ${a.advertiserName}`);
    console.log('\n[cj-sync] Map the ones you want by hand into affiliate_programs (source=\'cj\').');
  } catch (e) {
    console.error(`[cj-sync] advertiser lookup failed: ${e.message}`);
    console.error('[cj-sync] The field name likely differs — run --introspect and correct ADVERTISER_QUERY.');
    process.exit(1);
  }
}

// ── Product query ────────────────────────────────────────────────────────────
// UNVERIFIED until --introspect confirms it. See the header note.
const PRODUCT_QUERY = `
query Products($cid: ID!, $advertiserIds: [ID!], $limit: Int!, $offset: Int!) {
  products(companyId: $cid, partnerIds: $advertiserIds, limit: $limit, offset: $offset) {
    totalCount
    count
    resultList {
      id
      title
      description
      price { amount currency }
      salePrice { amount currency }
      link
      imageLink
      availability
      brand
      gtin
      mpn
      advertiserId
      advertiserName
      productType
    }
  }
}`;

const PAGE = 100;

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
  let offset = 0, total = null;

  for (;;) {
    let data;
    try {
      data = await gql(PRODUCT_QUERY, { cid: CID, advertiserIds: ids, limit: PAGE, offset });
    } catch (e) {
      console.error(`[cj-sync]   fetch failed at offset ${offset}: ${e.message}`);
      return { products, complete: false };
    }
    const node = assertShape(data, program);
    if (total === null) total = node.totalCount ?? null;
    products.push(...node.resultList);
    if (node.resultList.length < PAGE) break;
    offset += PAGE;
    if (offset > 50000) { console.error('[cj-sync]   runaway pagination guard hit'); return { products, complete: false }; }
  }

  // Complete only if the count CJ reported matches what we hold.
  const complete = total === null ? true : products.length >= total;
  if (!complete) console.error(`[cj-sync]   incomplete: CJ reported ${total}, collected ${products.length}`);
  return { products, complete, total };
}

function mapProduct(p, program) {
  const price = Number(p.salePrice?.amount ?? p.price?.amount ?? NaN);
  const orig  = Number(p.price?.amount ?? NaN);
  const cur   = (p.salePrice?.currency || p.price?.currency || '').toUpperCase();
  if (!Number.isFinite(price) || !p.id || !p.link) return null;
  if (cur !== REQUIRED_CURRENCY) return null;         // US/USD only — never converted

  const onSale = Number.isFinite(orig) && orig > price;
  return {
    program_id:          program.id,
    dormied_brand_slug:  program.dormied_brand_slug,
    source:              'cj',
    source_item_id:      String(p.id),
    impact_item_id:      null,
    item_group_id:       String(p.id),
    is_parent:           true,
    name:                p.title,
    description:         null,
    image_url:           p.imageLink || null,
    tracking_url:        p.link,                       // CJ returns the tracking link
    current_price:       price,
    original_price:      onSale ? orig : null,
    discount_percentage: onSale ? Math.round(((orig - price) / orig) * 100) : null,
    currency:            cur,
    stock_availability:  /in.?stock|available/i.test(p.availability || '') ? 'InStock' : 'OutOfStock',
    category:            p.productType || null,
    sub_category:        null,
    gtin:                p.gtin || null,
    mpn:                 p.mpn || null,
    labels:              null,
    promo_code:          null,
    promo_title:         null,
    promo_expires_at:    null,
    feed_updated_at:     null,
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

  const rows = products.map(p => mapProduct(p, program)).filter(Boolean);
  const dropped = products.length - rows.length;
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
