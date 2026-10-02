'use strict';
/**
 * scripts/lib/witb-product-thumbs.js
 *
 * Product thumbnails for the WITB "Current Bag" rows.
 *
 * The image comes from the affiliate product the Shop This Bag matcher already
 * accepted for that row (scripts/lib/witb-shop-match.js), so it is never
 * looser than what we sell against the row. A thumbnail beside a player's club
 * reads as "this is his club", which is a stronger claim than a shop card, so
 * two extra checks apply on top of the match:
 *
 *   - finish: a product whose head name carries a finish or edition the bag
 *     does not state ("S259 Midnight", "Spider ZT Black", "Limited Edition")
 *     shows the wrong-looking club, so it gets no image.
 *   - generation: a model year older than two seasons ("T200 2019") in a
 *     current bag is probably a different generation of the head.
 *
 * Images are self-hosted. Global Golf's resizer (image.globalgolf.com ?s=)
 * returns 503 for any size it has not already cached, so hotlinking at a
 * thumbnail size is not reliable; the feed URL is fetched once at build time
 * and written to /images/thumbs/products/<key>.webp.
 *
 * The file is keyed by the bag row's brand, club type, model and loft, not by
 * product id, so the same club in many bags shares one file and a thumbnail
 * that exists is kept when its product later leaves the feed. Delete the file
 * to refresh it.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT     = path.resolve(__dirname, '..', '..');
const DIR      = path.join(ROOT, 'images', 'thumbs', 'products');
const BASE     = '/images/thumbs/products';
const SIZE     = 112;     // 2x the 56px tile
const PAD      = 6;       // breathing room inside the tile after trimming
const QUALITY  = 78;
const FETCH_MS = 15000;

let sharp = null;
try { sharp = require('sharp'); } catch { /* no resizing: rows fall back to the icon */ }

const norm = s => String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9.]+/g, ' ').trim();

// Head name only: drop "Used", the condition clause and the spec tail
// (" - 10° Loft - Stiff Flex", Cobra's " | Right 9.0 / graphite ..."), which
// names shaft colours that are not the head's finish.
function productHead(name) {
  return String(name || '')
    .replace(/^used\s+/i, '')
    .split(/\s+-\s+|\s*\|\s*|\s+in\s+(?:mint|very good|good|value|fair|average)\s+condition/i)[0]
    .toLowerCase();
}

const FINISH = /\b(black|midnight|chrome|jailbird|raw|copper|slate|dark|blue|red|green|gold|silver|satin|brushed|nickel|bronze|limited|xtreme|white)\b/g;
const YEAR   = /\b20(\d\d)\b|'(\d\d)\b/g;

/** Why this product's image should not stand in for the bag row, or null. */
function imageRefusal(item, product, now = new Date()) {
  if (item.club_type === 'ball') return null;   // a box of balls is the ball
  const model = norm(`${item.raw_brand || ''} ${item.raw_model || ''}`);
  const head  = productHead(product.name);
  const finish = (head.match(FINISH) || []).filter(w => !model.includes(w) && !(w === 'white' && /white hot/.test(head)));
  if (finish.length) return `finish "${finish[0]}" not in bag`;
  const minYY = (now.getUTCFullYear() - 2) % 100;
  for (const m of head.matchAll(YEAR)) {
    const yy = Number(m[1] || m[2]);
    if (yy < minYY && !model.includes(String(yy))) return `model year '${m[1] || m[2]} too old`;
  }
  return null;
}

/** Stable file key for a bag row. */
function rowKey(item) {
  const sig = [item.dormied_brand_slug, item.club_type, norm(item.raw_model), norm(item.loft_or_number)].join('|');
  return crypto.createHash('sha1').update(sig).digest('hex').slice(0, 16);
}

const fileFor = key => path.join(DIR, `${key}.webp`);
const urlFor  = key => `${BASE}/${key}.webp`;

async function loadImage(src) {
  if (src.startsWith('/')) {
    const p = path.join(ROOT, src.split('?')[0]);
    if (!p.startsWith(ROOT)) throw new Error('path escapes repo');
    return fs.readFileSync(p);
  }
  if (!/^https:\/\//.test(src)) throw new Error('not https');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const r = await fetch(src, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!/^image\//.test(r.headers.get('content-type') || '')) throw new Error('not an image');
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

async function writeThumb(src, file) {
  const buf = await loadImage(src);
  const out = await sharp(buf)
    .flatten({ background: '#ffffff' })
    .trim({ background: '#ffffff', threshold: 10 })   // studio shots carry wide white margins
    .resize(SIZE - 2 * PAD, SIZE - 2 * PAD, { fit: 'contain', background: '#ffffff' })
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: '#ffffff' })
    .webp({ quality: QUALITY })
    .toBuffer();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, out);
}

/**
 * Resolve thumbnails for a bag.
 *
 * @param {Array} items     current bag rows (club_type, raw_brand, raw_model, loft_or_number, dormied_brand_slug)
 * @param {Array} matches   matchBagToProducts() matches; product needs id, name, image_url
 * @param {Function} log
 * @returns {Promise<Map<object, {src: string, productId: (number|null)}>>} keyed by the item object
 */
async function resolveBagThumbs(items, matches, log = () => {}) {
  const out = new Map();
  const byItem = new Map(matches.map(m => [m.item, m.product]));
  for (const item of items) {
    if (!item.dormied_brand_slug) continue;
    const key = rowKey(item), file = fileFor(key);
    const product = byItem.get(item) || null;
    const usable = product && product.image_url && !imageRefusal(item, product) ? product : null;
    if (product && !usable && product.image_url) log(`  (thumb skipped) ${item.club_type} "${item.raw_model}": ${imageRefusal(item, product)}`);
    if (!fs.existsSync(file) && usable && sharp) {
      try { await writeThumb(usable.image_url, file); log(`  thumb: ${item.club_type} "${item.raw_model}" <- ${usable.name}`); }
      catch (e) { log(`  WARN thumb ${item.club_type} "${item.raw_model}": ${e.message}`); }
    }
    // A thumbnail written by an earlier build stays even when today's match
    // is gone (sold out, delisted). It only links out when today's match is live.
    if (fs.existsSync(file)) out.set(item, { src: urlFor(key), productId: usable ? usable.id : null });
  }
  return out;
}

module.exports = { resolveBagThumbs, imageRefusal, productHead, rowKey, _internals: { norm, fileFor, urlFor } };
