'use strict';
/**
 * scripts/lib/share-images.js
 *
 * Builds the images a search result or a shared link shows for a WITB player
 * or a brand: one square and one 16:9 JPEG per headshot or logo, self-hosted
 * under /images/share/.
 *
 * WHY THIS EXISTS
 * Google picks the thumbnail beside a result from the images a page declares
 * (og:image and the structured data `image`), and it ignores anything under
 * 50,000 pixels. Neither page type gave it a usable one:
 *   - every WITB player page declared the generic site card, and the only
 *     headshot on the page is a 200px thumbnail, so Google reached past it and
 *     showed a driver from a news card instead (Zach Johnson, Sep 2026);
 *   - brand pages declared the raw logo, a median of 350x350 and as small as
 *     120x120 (88 of 217 are under the 50,000-pixel floor), while claiming it
 *     was 1200x630, and used a relative URL in the structured data.
 * Google asks for large images in several aspect ratios so it can crop
 * whichever it needs; the square is the one its thumbnail uses, the 16:9 is
 * what social cards and wider placements use.
 *
 * COMPOSITION
 *   players: square = the head-and-shoulders top of the 4:5 headshot;
 *            16:9   = the headshot centred on the site background, so a
 *                     centred square crop still lands on the face.
 *   brands:  the logo centred on its own background colour (sampled from its
 *            corner), so the padding is invisible and the mark stays whole.
 * Nothing is upscaled more than 3x; a soft logo beats an unusable one, but a
 * 120px mark stretched to fill 800px would look broken.
 *
 * NAMING follows lib/thumbs.js (source file name plus its ?v= version), so a
 * re-uploaded headshot gets new file names and every cache sees it as new.
 * Existing files are never rewritten, so a full rebake costs one stat each.
 */

const fs   = require('fs');
const path = require('path');
const { parseSource, loadSource } = require('./thumbs');

let sharp = null;
try { sharp = require('sharp'); } catch { /* unavailable: callers keep their fallback */ }

const ROOT      = path.resolve(__dirname, '..', '..');
const SHARE_DIR = path.join(ROOT, 'images', 'share');
const SITE      = 'https://dormied.com';
const SITE_BG   = { r: 6, g: 11, b: 6 };          // --bg #060b06
const WIDE      = { w: 1200, h: 675 };
const QUALITY   = 82;
const MAX_UP    = 3;

function names(src) {
  const p = parseSource(src);
  if (!p) return null;
  const rel = f => `/images/share/${p.dir}/${f}`;
  const sq = `${p.base}-1x1.jpg`, wd = `${p.base}-16x9.jpg`;
  return {
    dir: path.join(SHARE_DIR, p.dir),
    squareFile: path.join(SHARE_DIR, p.dir, sq), squareUrl: SITE + rel(sq),
    wideFile:   path.join(SHARE_DIR, p.dir, wd), wideUrl:   SITE + rel(wd),
  };
}

const jpeg = img => img.jpeg({ quality: QUALITY, mozjpeg: true });

async function buildPlayer(buf, n) {
  const m = await sharp(buf).metadata();
  const side = Math.min(m.width, m.height);
  const sq = Math.max(400, Math.min(800, side));            // never under the pixel floor
  await jpeg(sharp(buf).extract({ left: Math.round((m.width - side) / 2), top: 0, width: side, height: side })
    .resize(sq, sq)).toFile(n.squareFile);

  const h = Math.min(WIDE.h, Math.round(m.height * MAX_UP));
  const face = await sharp(buf).resize({ height: h }).toBuffer();
  const fm = await sharp(face).metadata();
  await jpeg(sharp({ create: { width: WIDE.w, height: WIDE.h, channels: 3, background: SITE_BG } })
    .composite([{ input: face, left: Math.round((WIDE.w - fm.width) / 2), top: WIDE.h - fm.height }]))
    .toFile(n.wideFile);
  return { square: sq };
}

async function buildLogo(buf, n) {
  // Background = the logo's own corner colour, sampled BEFORE flattening. A
  // logo whose corners are not fully opaque (Bridgestone's rounded, anti-
  // aliased square) was drawn to sit on a background, so it gets white: its
  // half-transparent red corner flattened to pink and put the mark in a pink
  // frame when the colour was sampled after flattening.
  const src = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W0, height: H0 } = src.info;
  const px = (x, y) => { const i = (y * W0 + x) * 4; return src.data.slice(i, i + 4); };
  const corners = [px(0, 0), px(W0 - 1, 0), px(0, H0 - 1), px(W0 - 1, H0 - 1)];
  const opaque = corners.every(c => c[3] >= 250);
  const bg = opaque ? { r: corners[0][0], g: corners[0][1], b: corners[0][2] } : { r: 255, g: 255, b: 255 };
  const flat = await sharp(buf).flatten({ background: bg }).toBuffer();
  const m = await sharp(flat).metadata();

  const place = async (W, H, boxW, boxH) => {
    const scale = Math.min(boxW / m.width, boxH / m.height, MAX_UP);
    const w = Math.max(1, Math.round(m.width * scale)), h = Math.max(1, Math.round(m.height * scale));
    const logo = await sharp(flat).resize(w, h, { kernel: 'lanczos3' }).toBuffer();
    return jpeg(sharp({ create: { width: W, height: H, channels: 3, background: bg } })
      .composite([{ input: logo, left: Math.round((W - w) / 2), top: Math.round((H - h) / 2) }]));
  };
  await (await place(800, 800, 640, 640)).toFile(n.squareFile);
  await (await place(WIDE.w, WIDE.h, 900, 540)).toFile(n.wideFile);
  return { square: 800 };
}

/**
 * Ensure both images exist for a headshot or logo and return their metadata,
 * or null when the source cannot be mapped or loaded (callers keep whatever
 * they declared before, so a failure never removes an image).
 *
 * @param {'player'|'logo'} kind
 * @param {string} src  headshot_url or brand.logo, as stored
 */
async function ensureShareImages(kind, src) {
  const n = names(src);
  if (!n || !sharp) return null;
  if (!(fs.existsSync(n.squareFile) && fs.existsSync(n.wideFile))) {
    const buf = await loadSource(src);
    if (!buf) return null;
    try {
      fs.mkdirSync(n.dir, { recursive: true });
      await (kind === 'player' ? buildPlayer(buf, n) : buildLogo(buf, n));
    } catch { return null; }
  }
  const sm = await sharp(n.squareFile).metadata();
  return {
    square: { url: n.squareUrl, width: sm.width, height: sm.height },
    wide:   { url: n.wideUrl,   width: WIDE.w,   height: WIDE.h },
  };
}

/** schema.org ImageObject list, square first (the thumbnail Google prefers). */
function imageObjects(share) {
  return [share.square, share.wide].map(i => ({ '@type': 'ImageObject', url: i.url, width: i.width, height: i.height }));
}

module.exports = { ensureShareImages, imageObjects };
