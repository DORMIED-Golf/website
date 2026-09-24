'use strict';
/**
 * scripts/lib/thumbs.js
 *
 * Self-hosted responsive thumbnails, replacing /_vercel/image.
 *
 * Vercel's optimizer bills per TRANSFORMATION: one per unique source+width+
 * quality, cached 31 days. The free tier allows 5,000 a month and this site
 * publishes ~27 articles a day, each appearing in feeds at five widths, so the
 * allowance is spent in well under a month. Once it is, EVERY new transformation
 * returns HTTP 402 and the card falls back to a grey placeholder — the site
 * quietly loses its thumbnails until the cycle resets.
 *
 * So we resize at bake time with sharp and serve the results as ordinary static
 * files. Static assets are free and unmetered where transformations are neither.
 *
 * The URL is derived from the source path, not a manifest or a hash, so the
 * browser can compute the same string: the client copies of this rule live in
 * js/feed.js, js/home.js and js/ticker.js (thumbUrl) and MUST stay in step.
 *
 *   .../dormied-articles/articles/foo-hero.jpg      -> /images/thumbs/articles/foo-hero-400.webp
 *   .../dormied-articles/articles/foo-hero.jpg?v=2  -> /images/thumbs/articles/foo-hero-v2-400.webp
 *   .../dormied-articles/players/bar.png            -> /images/thumbs/players/bar-80.webp
 *   /images/logos/baz.jpg                           -> /images/thumbs/logos/baz-40.webp
 *
 * The ?v= marker is carried into the filename because re-uploading a hero keeps
 * the same path: without it a corrected image would keep serving the old thumb.
 *
 * A source this cannot map, or a resize that fails, returns null and every
 * caller falls back to the original URL. A missing thumbnail must degrade to a
 * heavier image, never to a broken one.
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..', '..');
const THUMB_DIR  = path.join(ROOT, 'images', 'thumbs');
const THUMB_BASE = '/images/thumbs';
// Matches the widths the markup asks for. Anything else resizes on demand.
const WIDTHS     = [40, 80, 160, 200, 400, 600, 800];
const QUALITY    = 72;

let sharp = null;
try { sharp = require('sharp'); } catch { /* resizing unavailable; callers fall back */ }

/** Source URL (Supabase public object or local /images path) -> { dir, base } or null. */
function parseSource(src) {
  if (!src || typeof src !== 'string') return null;
  let pathname, version = '';
  try {
    const u = new URL(src, 'https://dormied.com');
    pathname = decodeURIComponent(u.pathname);
    const v = u.searchParams.get('v');
    if (v && /^[0-9]{1,4}$/.test(v)) version = `-v${v}`;
  } catch { return null; }

  let m = pathname.match(/\/storage\/v1\/object\/public\/dormied-articles\/([^/]+)\/([^/]+)$/);
  if (!m) m = pathname.match(/^\/images\/(logos|articles|players|scorecard)\/([^/]+)$/);
  if (!m) return null;

  const dir  = m[1];
  const file = m[2];
  const base = file.replace(/\.[a-z0-9]+$/i, '');
  // Keep the name to what a filesystem and a URL both handle plainly.
  if (!/^[A-Za-z0-9._-]+$/.test(base) || !/^[A-Za-z0-9-]+$/.test(dir)) return null;
  return { dir, base: base + version };
}

/** Public URL for the thumbnail, or null when the source cannot be mapped. */
function thumbUrl(src, w) {
  const p = parseSource(src);
  if (!p) return null;
  return `${THUMB_BASE}/${p.dir}/${p.base}-${w}.webp`;
}

function thumbFile(src, w) {
  const p = parseSource(src);
  if (!p) return null;
  return path.join(THUMB_DIR, p.dir, `${p.base}-${w}.webp`);
}

/** True when the thumbnail already exists on disk. */
function thumbExists(src, w) {
  const f = thumbFile(src, w);
  return !!f && fs.existsSync(f);
}

const sourceCache = new Map();   // src -> Buffer | null, so one bake fetches once

async function loadSource(src) {
  if (sourceCache.has(src)) return sourceCache.get(src);
  let buf = null;
  try {
    if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src, { signal: AbortSignal.timeout(20000) });
      if (res.ok) buf = Buffer.from(await res.arrayBuffer());
    } else {
      const local = path.join(ROOT, src.replace(/^\//, '').split('?')[0]);
      if (fs.existsSync(local)) buf = fs.readFileSync(local);
    }
  } catch { buf = null; }
  sourceCache.set(src, buf);
  return buf;
}

/**
 * Make sure every requested width exists on disk, then return the widths that
 * do. Existing files are never rewritten, so a rebake of 1,100 pages costs one
 * stat per image rather than a resize.
 */
async function ensureThumbs(src, widths) {
  const out = [];
  if (!sharp) return out;
  const missing = widths.filter(w => !thumbExists(src, w));
  if (!missing.length) return widths.slice();

  const buf = await loadSource(src);
  if (!buf) return widths.filter(w => thumbExists(src, w));

  for (const w of widths) {
    const file = thumbFile(src, w);
    if (!file) continue;
    if (fs.existsSync(file)) { out.push(w); continue; }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await sharp(buf).resize({ width: w, withoutEnlargement: true })
        .webp({ quality: QUALITY }).toFile(file);
      out.push(w);
    } catch { /* leave it out; the caller falls back to the source URL */ }
  }
  return out;
}

/**
 * srcset string over the widths that exist, or '' when none do.
 * Callers pair this with the original URL as `src`, so a card with no
 * thumbnails still shows the real image.
 */
function thumbSrcset(src, widths) {
  const have = widths.filter(w => thumbExists(src, w));
  if (!have.length) return '';
  return have.map(w => `${thumbUrl(src, w)} ${w}w`).join(',');
}

/** Smallest existing thumbnail at or above w, else the original source. */
function thumbSrcOr(src, w) {
  if (thumbExists(src, w)) return thumbUrl(src, w);
  const bigger = WIDTHS.filter(x => x > w).find(x => thumbExists(src, x));
  return bigger ? thumbUrl(src, bigger) : src;
}

/**
 * Write thumbnails straight from a buffer already in hand, naming them for the
 * URL the page will reference. Used at publish time, where the hero bytes are
 * in memory: it saves a round trip and means a new article has thumbnails
 * before any bake looks for them.
 */
async function writeThumbsFromBuffer(srcUrl, buf, widths) {
  if (!sharp || !buf) return [];
  const out = [];
  for (const w of widths) {
    const file = thumbFile(srcUrl, w);
    if (!file) continue;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await sharp(buf).resize({ width: w, withoutEnlargement: true })
        .webp({ quality: QUALITY }).toFile(file);
      out.push(w);
    } catch { /* the bake will retry via ensureThumbs */ }
  }
  return out;
}

module.exports = {
  WIDTHS, THUMB_DIR, THUMB_BASE,
  parseSource, thumbUrl, thumbFile, thumbExists,
  ensureThumbs, writeThumbsFromBuffer, thumbSrcset, thumbSrcOr,
  loadSource,
};
