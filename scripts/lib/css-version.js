'use strict';
/**
 * scripts/lib/css-version.js
 *
 * Cache-busting version for the two stylesheets, derived from their CONTENT.
 *
 * The version used to be a hand-written date in nine generators. It sat at
 * 20260804 through three separate stylesheet changes, so the signup card
 * shipped its dark first draft to every returning visitor: the file on the
 * server was correct, but Cache-Control is public, max-age=604800, and the URL
 * never changed, so browsers kept the copy they already had for a week. The
 * white card was only visible to someone with a cold cache.
 *
 * Hashing the files removes the human step. Edit either stylesheet and the
 * version moves on the next bake, whether or not anyone remembered.
 *
 * Both files feed one hash on purpose. They are hand-maintained twins and a
 * page loads exactly one of them, so a single version keeps every page
 * consistent and is simpler than tracking two.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const FILES = [
  path.join(ROOT, 'css', 'styles.css'),
  path.join(ROOT, 'css', 'styles.min.css'),
];

let cached = null;

/** Short content hash of both stylesheets, e.g. "a1b2c3d4". */
function cssVersion() {
  if (cached) return cached;
  const h = crypto.createHash('sha1');
  for (const f of FILES) h.update(fs.readFileSync(f));
  cached = h.digest('hex').slice(0, 8);
  return cached;
}

/** Test seam: forget the memoised value so a changed file re-hashes. */
function _resetCache() { cached = null; }

module.exports = { cssVersion, _resetCache, FILES };
