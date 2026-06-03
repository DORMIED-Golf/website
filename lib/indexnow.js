#!/usr/bin/env node
/**
 * lib/indexnow.js
 *
 * IndexNow submission helper for dormied.com.
 *
 * Protocol: https://www.indexnow.org/documentation
 * Key file served at: https://dormied.com/<key>.txt  (Option 1 verification)
 *
 * Usage:
 *   const { submitUrls } = require('./lib/indexnow');
 *   await submitUrls(['https://dormied.com/news/some-slug/']);
 *
 * Requires INDEXNOW_KEY in environment (from .env or CI secrets).
 * Never throws — a failed submission must not break a publish flow.
 */

'use strict';

const ENDPOINT  = 'https://api.indexnow.org/indexnow';
const HOST      = 'dormied.com';
const SITE_URL  = 'https://dormied.com';
const CHUNK_MAX = 10_000; // IndexNow protocol maximum per request

// Page-URL filter: absolute https dormied.com URLs, not asset paths.
// Also enforces trailing slash (canonical form for this site).
function isValidPageUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:')           return false;
  if (u.hostname !== HOST)               return false;
  if (u.pathname.startsWith('/images/')) return false;
  // Reject obvious asset extensions
  if (/\.(jpg|jpeg|png|gif|webp|avif|svg|ico|css|js|woff2?|ttf|eot|pdf|txt|xml|json)$/i.test(u.pathname)) return false;
  return true;
}

// Ensure trailing slash (canonical for dormied.com).
function withTrailingSlash(url) {
  try {
    const u = new URL(url);
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Submit an array of absolute dormied.com page URLs to IndexNow.
 * Filters invalid/asset URLs, chunks at 10,000, never throws.
 *
 * @param {string[]} urls  Absolute dormied.com URLs to notify.
 */
async function submitUrls(urls) {
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    console.warn('[indexnow] INDEXNOW_KEY is not set — skipping submission');
    return;
  }

  // Normalise and filter
  const valid = [...new Set(
    urls
      .map(u => withTrailingSlash(String(u || '').trim()))
      .filter(isValidPageUrl)
  )];

  if (valid.length === 0) {
    console.log('[indexnow] No valid page URLs to submit');
    return;
  }

  const keyLocation = `${SITE_URL}/${key}.txt`;

  // Chunk at protocol maximum
  for (let i = 0; i < valid.length; i += CHUNK_MAX) {
    const chunk = valid.slice(i, i + CHUNK_MAX);
    const body  = JSON.stringify({
      host:        HOST,
      key,
      keyLocation,
      urlList:     chunk,
    });

    try {
      const res = await fetch(ENDPOINT, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'User-Agent':   'DORMIED-IndexNow/1.0 (+https://dormied.com)',
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 200 || res.status === 202) {
        console.log(`[indexnow] Submitted ${chunk.length} URL(s) — HTTP ${res.status}`);
        if (process.env.INDEXNOW_DEBUG) {
          chunk.forEach(u => console.log(`  ${u}`));
        }
      } else {
        const text = await res.text().catch(() => '(no body)');
        console.warn(`[indexnow] Unexpected HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn(`[indexnow] Fetch error: ${err.message}`);
    }
  }
}

module.exports = { submitUrls };
