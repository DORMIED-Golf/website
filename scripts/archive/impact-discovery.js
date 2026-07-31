#!/usr/bin/env node
/**
 * scripts/impact-discovery.js  —  THROWAWAY discovery probe (Stage 1 only).
 *
 * Read-only exploration of the live Impact Partner API. Creates nothing, writes
 * nothing to Supabase. Prints the raw catalog + item payloads so we can design
 * the schema/sync against reality instead of assumptions.
 *
 * Auth: HTTP Basic, SID as username + token as password, over HTTPS.
 * Credentials come ONLY from env (IMPACT_SID / IMPACT_TOKEN). Never hardcoded,
 * never printed, never written to a file.
 *
 *   IMPACT_SID=... IMPACT_TOKEN=... node scripts/impact-discovery.js
 *   (or add the two keys to .env)
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const SID   = process.env.IMPACT_SID;
const TOKEN = process.env.IMPACT_TOKEN;
if (!SID || !TOKEN) {
  console.error('[discovery] Missing IMPACT_SID / IMPACT_TOKEN. Add them to .env or export them, then re-run.');
  process.exit(1);
}

const BASE = 'https://api.impact.com';
const AUTH = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');

async function apiGet(pathname) {
  const res = await fetch(BASE + pathname, {
    headers: { Authorization: AUTH, Accept: 'application/json' },
  });
  let body;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text; }
  return { res, body };
}

// Impact wraps list payloads under a PascalCase key (Catalogs / Items). Be
// defensive: accept a top-level array or the first array-valued property.
function extractArray(body, preferredKey) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body[preferredKey])) return body[preferredKey];
  if (body && typeof body === 'object') {
    for (const k of Object.keys(body)) if (Array.isArray(body[k])) return body[k];
  }
  return [];
}

const rl = res => ({
  limitHour:     res.headers.get('X-RateLimit-Limit-hour'),
  remainingHour: res.headers.get('X-RateLimit-Remaining-hour'),
});

function distinct(items, key) {
  const s = new Set();
  for (const it of items) s.add(JSON.stringify(it?.[key] ?? null));
  return [...s].map(v => JSON.parse(v));
}
function populatedCount(items, key) {
  return items.filter(it => {
    const v = it?.[key];
    return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;
}

async function main() {
  // ── 1. /Catalogs, try both documented path casings ──────────────────────────
  console.log('=== 1. GET /Catalogs (probing path casing) ===');
  let casing = null, catalogsBody = null, catalogsRes = null;
  for (const seg of ['MediaPartners', 'Mediapartners']) {
    const { res, body } = await apiGet(`/${seg}/${SID}/Catalogs?PageSize=1000`);
    console.log(`  /${seg}/${SID}/Catalogs -> HTTP ${res.status}`);
    if (res.status === 200) { casing = seg; catalogsBody = body; catalogsRes = res; break; }
    else console.log('    body:', typeof body === 'string' ? body.slice(0, 400) : JSON.stringify(body).slice(0, 400));
  }
  if (!casing) { console.error('[discovery] Both path casings failed for /Catalogs. Stopping.'); process.exit(1); }
  console.log(`  WORKING PATH CASING: ${casing}`);
  const catRate = rl(catalogsRes);
  console.log(`  Rate limit (hour): limit=${catRate.limitHour} remaining=${catRate.remainingHour}`);

  const catalogs = extractArray(catalogsBody, 'Catalogs');
  console.log(`  Catalogs returned: ${catalogs.length}`);
  if (catalogs[0]) console.log('  (raw shape of catalog[0] keys):', Object.keys(catalogs[0]).join(', '));

  // ── 2. Print the listed fields for every catalog ────────────────────────────
  console.log('\n=== 2. Catalogs ===');
  for (const c of catalogs) {
    console.log(JSON.stringify({
      Id: c.Id, Name: c.Name, AdvertiserId: c.AdvertiserId, AdvertiserName: c.AdvertiserName,
      CampaignId: c.CampaignId, CampaignName: c.CampaignName, NumberOfItems: c.NumberOfItems,
      DateLastUpdated: c.DateLastUpdated, Currency: c.Currency, ItemsUri: c.ItemsUri,
      Locations_populated: !!(c.Locations && (Array.isArray(c.Locations) ? c.Locations.length : Object.keys(c.Locations).length)),
      FTPLocations_populated: !!(c.FTPLocations && (Array.isArray(c.FTPLocations) ? c.FTPLocations.length : Object.keys(c.FTPLocations).length)),
    }, null, 1));
  }

  // ── Locate the Pins & Aces catalog ──────────────────────────────────────────
  const pa = catalogs.find(c => /pins|aces/i.test(`${c.Name || ''} ${c.AdvertiserName || ''} ${c.CampaignName || ''}`));
  if (!pa) {
    console.log('\n[discovery] No catalog matched /pins|aces/i. Advertiser may have no catalog yet.');
    console.log('  (This is the gate the plan warned about — reporting and stopping.)');
    return;
  }
  console.log(`\n  Matched Pins & Aces catalog: Id=${pa.Id} Name="${pa.Name}" NumberOfItems=${pa.NumberOfItems}`);

  // ── 3/4. Items for that catalog: raw JSON of first 3 + one full Url ──────────
  console.log('\n=== 3. GET /Catalogs/{id}/Items — first 3 items RAW ===');
  const { res: itemsRes, body: itemsBody } = await apiGet(`/${casing}/${SID}/Catalogs/${pa.Id}/Items?PageSize=10000`);
  console.log(`  HTTP ${itemsRes.status}`);
  const itemsRate = rl(itemsRes);
  console.log(`  Rate limit (hour): limit=${itemsRate.limitHour} remaining=${itemsRate.remainingHour}`);
  if (itemsRes.status !== 200) {
    console.log('  body:', typeof itemsBody === 'string' ? itemsBody.slice(0, 600) : JSON.stringify(itemsBody).slice(0, 600));
    return;
  }
  if (itemsBody && typeof itemsBody === 'object' && !Array.isArray(itemsBody)) {
    console.log('  (response wrapper keys):', Object.keys(itemsBody).join(', '));
  }
  const items = extractArray(itemsBody, 'Items');
  for (const it of items.slice(0, 3)) console.log(JSON.stringify(it, null, 2));

  console.log('\n=== 4. Full raw Url of item[0] (confirm it carries our account IDs) ===');
  console.log('  ' + (items[0]?.Url ?? '(no Url field on item[0])'));

  // ── 5. Rate-limit headers (already captured above) ──────────────────────────
  console.log('\n=== 5. Rate-limit headers ===');
  console.log(`  /Catalogs : limit-hour=${catRate.limitHour} remaining-hour=${catRate.remainingHour}`);
  console.log(`  /Items    : limit-hour=${itemsRate.limitHour} remaining-hour=${itemsRate.remainingHour}`);

  // ── 6. Count returned vs NumberOfItems (truncation check) ────────────────────
  console.log('\n=== 6. Item count vs NumberOfItems ===');
  console.log(`  /Items returned: ${items.length}  |  catalog.NumberOfItems: ${pa.NumberOfItems}`);
  if (itemsBody && typeof itemsBody === 'object') {
    const pageMeta = {};
    for (const k of ['@page', '@numpages', '@total', '@pagesize', 'PageSize', 'TotalResults', 'nextPageUri', 'NextPageUri', '@nextpageuri']) {
      if (k in itemsBody) pageMeta[k] = itemsBody[k];
    }
    if (Object.keys(pageMeta).length) console.log('  pagination meta present:', JSON.stringify(pageMeta));
    else console.log('  no pagination metadata keys found on the Items response.');
  }

  // ── 7. Distinct field values / populated checks ─────────────────────────────
  console.log('\n=== 7. Field profile across returned items ===');
  console.log('  StockAvailability distinct:', JSON.stringify(distinct(items, 'StockAvailability')));
  console.log('  IsParent distinct        :', JSON.stringify(distinct(items, 'IsParent')));
  console.log(`  ItemGroupId: populated ${populatedCount(items, 'ItemGroupId')}/${items.length}, distinct sample:`,
    JSON.stringify(distinct(items, 'ItemGroupId').slice(0, 8)));
  console.log('  Category distinct sample :', JSON.stringify(distinct(items, 'Category').slice(0, 15)));
  console.log('  SubCategory distinct sample:', JSON.stringify(distinct(items, 'SubCategory').slice(0, 15)));
  console.log(`  LaunchDate populated     : ${populatedCount(items, 'LaunchDate')}/${items.length}`);
  console.log(`  Promotions populated     : ${populatedCount(items, 'Promotions')}/${items.length}`);
  const withPromo = items.find(it => it.Promotions && (Array.isArray(it.Promotions) ? it.Promotions.length : Object.keys(it.Promotions).length));
  if (withPromo) console.log('  Example Promotions payload:', JSON.stringify(withPromo.Promotions, null, 2));
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(e => { console.error('[discovery] Fatal:', e.message); process.exit(1); });
}