'use strict';
/**
 * scripts/lib/asset-version.js
 *
 * Cache-busting version for any static asset, derived from its CONTENT.
 *
 * Every one of these was a hand-written date scattered across the generators,
 * and that pattern failed three times in a single day:
 *
 *   - data.min.js       31 pages kept requesting the previous month's dataset,
 *                       so returning visitors read June numbers on a page that
 *                       looked current.
 *   - shop-carousel     a bump regex that could not match the real version, and
 *                       a verification grep with the same flaw, so it reported
 *                       success while the live page served the old script.
 *   - styles.css        sat unchanged through three stylesheet edits, so the
 *                       white signup card was invisible to anyone whose browser
 *                       already had the file. Cache-Control is a week.
 *
 * And it had already failed silently before that: signup.min.js was rewritten
 * end to end, popup removed and tracking added, while its URL stayed at
 * 20260718d. Every returning visitor kept running the old script.
 *
 * The common cause is a human being expected to remember. Hashing the file
 * removes the step: change the asset and its URL moves on the next bake.
 *
 * Per file rather than one hash for everything, so editing one script does not
 * needlessly bust the cache for the others.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const cache = new Map();

/**
 * Short content hash for an asset, e.g. assetVersion('js/signup.min.js').
 * @param {string} relPath path relative to the repo root
 * @returns {string} 8 hex chars
 */
function assetVersion(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`[asset-version] ${relPath} does not exist. Refusing to emit a cache-buster for a missing asset.`);
  }
  const v = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 8);
  cache.set(relPath, v);
  return v;
}

/** Convenience for the common case: assetVersion('js/<name>'). */
function js(name) { return assetVersion(`js/${name}`); }

/** Test seam: forget memoised values so changed files re-hash. */
function _resetCache() { cache.clear(); }

module.exports = { assetVersion, js, _resetCache, ROOT };
