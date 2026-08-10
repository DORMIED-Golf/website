#!/usr/bin/env node
'use strict';
/**
 * scripts/amazon-manual-import.js
 *
 * Imports hand-curated Amazon Associates products from a CSV into
 * affiliate_products as source='amazon' rows, and self-hosts their images.
 *
 * CSV columns: Brand, Product, Link, Image Link
 *
 * WHY A SCRIPT AND NOT ONE-OFF SQL
 * Until DORMIED clears 10 qualifying sales in a trailing 30 days there is no
 * Creators API, so the catalogue grows a spreadsheet at a time. This makes each
 * of those passes repeatable, idempotent on the affiliate link, and gated on the
 * two rules that actually matter.
 *
 * THE TWO GATES
 * 1. Amazon images are rejected outright. The Associates agreement forbids
 *    storing or caching an Amazon image, and this script's whole job is to
 *    store images. A row whose Image Link points at media-amazon.com or any
 *    Amazon CDN is skipped and reported rather than quietly downloaded.
 * 2. An image that will not download is skipped. A card with a broken thumbnail
 *    is worse than no card, and a dead URL is usually a sign the row is wrong:
 *    the first sheet carried an Eaton electrical-component image against a Golf
 *    Pride grip, which this caught because it also 404'd.
 *
 * Prices are deliberately never set. See the note in api/shop.js shape().
 *
 *   node scripts/amazon-manual-import.js path.csv --dry-run
 *   node scripts/amazon-manual-import.js path.csv
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'images/shop');
const DRY = process.argv.includes('--dry-run');

(function loadDotenv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
})();

// Amazon's own image hosts. Storing these is a licence violation, not a style
// preference, so the check is on the host and not on the file extension.
const AMAZON_IMAGE_HOSTS = /(^|\.)(media-amazon|images-amazon|ssl-images-amazon)\.com$/i;

/** Minimal CSV row parser: handles quoted fields containing commas. */
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// Sheets use the brand name as a shopper says it; data.js uses the registered
// name. Only add an alias where the mapping is unambiguous.
const BRAND_ALIASES = {
  cleveland:      'cleveland-golf',
  odyssey:        'odyssey-golf',
  nike:           'nike-golf',
  ping:           'ping',
  vice:           'vice-golf',
  scottycameron:  'titleist',   // sub-brand, rolls up to the parent
  vokey:          'titleist',
};

function loadBrandIndex() {
  const src = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const byNorm = new Map();
  for (const b of ctx.window.DORMIED_DATA.brands) byNorm.set(norm(b.name), b.id);
  const valid = new Set([...byNorm.values()]);
  for (const [alias, slug] of Object.entries(BRAND_ALIASES)) {
    // Never let an alias introduce a slug that has no brand behind it.
    if (valid.has(slug) && !byNorm.has(alias)) byNorm.set(alias, slug);
  }
  return { byNorm, norm };
}

/** Stable, readable filename and source_item_id from brand + product. */
function slugify(s) {
  return String(s).toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 80);
}

async function download(url, destNoExt) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (DORMIED image import)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!/^image\//.test(ct)) throw new Error(`not an image (${ct || 'no content-type'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`suspiciously small (${buf.length} bytes)`);
  const ext = /webp/.test(ct) ? 'webp' : /png/.test(ct) ? 'png' : 'jpg';
  const rel = `/images/shop/${path.basename(destNoExt)}.${ext}`;
  if (!DRY) fs.writeFileSync(path.join(IMG_DIR, `${path.basename(destNoExt)}.${ext}`), buf);
  return { rel, bytes: buf.length };
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('Usage: node scripts/amazon-manual-import.js <file.csv> [--dry-run]');
    process.exit(1);
  }
  fs.mkdirSync(IMG_DIR, { recursive: true });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { byNorm, norm } = loadBrandIndex();

  const { data: prog, error: progErr } = await sb.from('affiliate_programs')
    .select('id').eq('source', 'amazon').eq('status', 'active').maybeSingle();
  if (progErr || !prog) throw new Error('no active amazon row in affiliate_programs');

  const { data: existing } = await sb.from('affiliate_products')
    .select('tracking_url').eq('source', 'amazon');
  const seen = new Set((existing || []).map(r => r.tracking_url));

  const lines = fs.readFileSync(csvPath, 'utf8').split('\n').slice(1).filter(l => l.trim());
  console.log(`[amazon] ${lines.length} row(s) in sheet, ${seen.size} already imported${DRY ? '  (DRY RUN)' : ''}\n`);

  const added = [], skipped = [];
  for (const line of lines) {
    const [brandRaw, product, link, img] = parseCsvLine(line);
    const label = `${brandRaw} / ${product}`.slice(0, 58);
    const pad = s => s.padEnd(60);

    if (!brandRaw || !product || !link) { skipped.push([label, 'incomplete row']); continue; }
    if (seen.has(link)) { console.log(pad(label) + 'skip  already imported'); skipped.push([label, 'already imported']); continue; }

    const slug = byNorm.get(norm(brandRaw));
    if (!slug) { console.log(pad(label) + 'SKIP  unknown brand'); skipped.push([label, `unknown brand "${brandRaw}"`]); continue; }

    let host = '';
    try { host = new URL(img).hostname; } catch { /* handled below */ }
    if (!host) { console.log(pad(label) + 'SKIP  bad image URL'); skipped.push([label, 'bad image URL']); continue; }
    if (AMAZON_IMAGE_HOSTS.test(host)) {
      console.log(pad(label) + 'SKIP  Amazon-hosted image (cannot be stored)');
      skipped.push([label, 'Amazon-hosted image, needs a non-Amazon source']);
      continue;
    }

    const base = slugify(`${brandRaw}-${product}`);
    let got;
    try { got = await download(img, base); }
    catch (e) { console.log(pad(label) + `SKIP  image ${e.message}`); skipped.push([label, `image ${e.message}`]); continue; }

    const row = {
      program_id: prog.id,
      dormied_brand_slug: slug,
      source: 'amazon',
      source_item_id: base,
      name: `${brandRaw} ${product}`.replace(/\s+/g, ' ').trim(),
      image_url: got.rel,
      tracking_url: link,
      current_price: null,          // never set; see api/shop.js shape()
      currency: 'USD',
      // No feed tells us stock, and these are hand-picked live listings. The
      // column gates the /api/shop query, so it has to be set for the row to
      // be servable at all.
      stock_availability: 'InStock',
      is_active: true,
      item_group_id: base,
      is_parent: true,
      feed_updated_at: new Date().toISOString(),
    };

    if (!DRY) {
      const { error } = await sb.from('affiliate_products').insert(row);
      if (error) { console.log(pad(label) + 'SKIP  db ' + error.message.slice(0, 40)); skipped.push([label, 'db error']); continue; }
    }
    console.log(pad(label) + `ok    ${slug.padEnd(15)} ${String(Math.round(got.bytes / 1024)).padStart(4)}KB`);
    added.push([label, slug]);
    seen.add(link);
  }

  console.log(`\n[amazon] added ${added.length}, skipped ${skipped.length}`);
  const real = skipped.filter(([, why]) => why !== 'already imported');
  if (real.length) {
    console.log('[amazon] needs attention:');
    real.forEach(([l, why]) => console.log(`   ${l.padEnd(58)} ${why}`));
  }
  console.log('\n[amazon] re-bake so the carousels pick these up:');
  console.log('  npm run generate-brands:force');
  console.log('  node scripts/generate-article.js --regenerate-all');
  console.log('  node scripts/generate-all-witb-pages.js');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('[amazon] Fatal:', e.message); process.exit(1); });
}
