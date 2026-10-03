#!/usr/bin/env node
'use strict';
/**
 * scripts/snapshot-shop.js
 *
 * Static fallback for every shop carousel on the site.
 *
 * The carousels read /api/shop, which reads Supabase. On 3 Oct 2026 the
 * database ran out of disk IO for most of a day, every request timed out, and
 * every carousel on the site removed itself (Grow ads then filled the space).
 * This writes what /api/shop would return for each carousel to plain JSON under
 * shop-snapshot/, served by the CDN with no function and no database behind
 * it. js/shop-carousel.js loads it whenever the API fails.
 *
 *   shop-snapshot/brand/<brand-slug>.json   brand / article / feature carousels
 *   shop-snapshot/bag/<player-slug>.json    WITB "Shop This Bag" (ids=)
 *
 * Output is produced by the API's own brandFeed / idsFeed / shape, so a
 * snapshot is exactly what the API would have served: no tracking_url except
 * Amazon's public amzn.to link, which the API also returns.
 *
 * Rules
 *   - A carousel whose read fails keeps its previous file. A failure never
 *     replaces a good snapshot with an empty one.
 *   - Exits non-zero if any read failed, after writing every success.
 *   - One request at a time with a pause, to stay inside the disk IO budget.
 *
 * Usage: node scripts/snapshot-shop.js [--pace-ms 400] [--only <brand-slug>]
 */
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { brandFeed, idsFeed, shape, MAX_LIMIT } = require('../api/shop.js');

const ROOT    = path.resolve(__dirname, '..');
const OUT     = path.join(ROOT, 'shop-snapshot');
const MAX_CARDS = 60;   // js/shop-carousel.js never shows more than this
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const PACE_MS = Number(arg('--pace-ms', 400));
const ONLY    = arg('--only', null);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Every carousel mount in the built site. Brand carousels key on the brand
// slug; Shop This Bag keys on the player slug and carries its own id list.
function findMounts() {
  const brands = new Set(), bags = new Map();
  const skip = new Set(['node_modules', '.git', 'shop-snapshot', 'data', 'scripts', 'api', 'images', 'js', 'css']);
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(path.join(dir, e.name)); continue; }
      if (!e.name.endsWith('.html')) continue;
      const html = fs.readFileSync(path.join(dir, e.name), 'utf8');
      for (const m of html.matchAll(/<section[^>]*id="bp-shop-section"[^>]*>/g)) {
        const tag = m[0], attr = n => (tag.match(new RegExp(`${n}="([^"]*)"`)) || [])[1] || '';
        const ids = attr('data-product-ids');
        if (ids) bags.set(attr('data-click-slug'), ids.split(',').map(Number).filter(Number.isInteger).slice(0, MAX_LIMIT));
        else if (attr('data-brand-slug')) brands.add(attr('data-brand-slug'));
      }
    }
  };
  walk(ROOT);
  return { brands: [...brands].sort(), bags };
}

let written = 0;
function write(rel, obj) {
  written++;
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY required'); process.exit(1); }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const { brands, bags } = findMounts();
  const brandList = ONLY ? brands.filter(b => b === ONLY) : brands;
  const bagList   = ONLY ? [] : [...bags];
  console.log(`[snapshot] ${brandList.length} brand carousel(s), ${bagList.length} Shop This Bag list(s)`);
  const failed = [];

  for (const brand of brandList) {
    try {
      const { ordered, retailerNames } = await brandFeed(sb, brand);
      const products = ordered.slice(0, MAX_CARDS).map(r => shape(r, retailerNames));
      write(`brand/${brand}.json`, { brand, count: products.length, products });
    } catch (e) { failed.push(`brand ${brand}: ${e.message}`); }
    await sleep(PACE_MS);
  }

  // Shop This Bag: the union of every bag's ids in a few batched reads rather
  // than one read per player page (289 of them), then each bag's file is cut
  // from it in the bag's own order, exactly as idsFeed orders a single bag.
  const allIds = [...new Set(bagList.flatMap(([, ids]) => ids))];
  const byId = new Map();
  let bagReadOk = true;
  for (let i = 0; i < allIds.length; i += 250) {
    try {
      const chunk = allIds.slice(i, i + 250);
      const { products } = await idsFeed(sb, chunk);
      for (const p of products) byId.set(p.id, p);
    } catch (e) { bagReadOk = false; failed.push(`bag ids ${i}-${i + 249}: ${e.message}`); }
    await sleep(PACE_MS);
  }
  // A partial read would publish bags with clubs silently missing, so bag
  // files are only rewritten when every batch succeeded.
  if (bagReadOk) {
    for (const [slug, ids] of bagList) {
      const products = ids.map(id => byId.get(id)).filter(Boolean);
      write(`bag/${slug}.json`, { slug, ids, count: products.length, products });
    }
  }

  // A carousel that no longer exists on the site should not leave a stale file.
  if (!ONLY && !failed.length) {
    const keep = { brand: new Set(brandList.map(b => `${b}.json`)), bag: new Set(bagList.map(([s]) => `${s}.json`)) };
    for (const dir of ['brand', 'bag']) {
      const d = path.join(OUT, dir);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) if (!keep[dir].has(f)) fs.unlinkSync(path.join(d, f));
    }
  }

  console.log(`[snapshot] wrote ${written} of ${brandList.length + bagList.length} file(s)`);
  if (failed.length) { for (const f of failed) console.error(`[snapshot] FAILED ${f}`); process.exit(1); }
}

main().catch(e => { console.error('[snapshot]', e.message); process.exit(1); });
