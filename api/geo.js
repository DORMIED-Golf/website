'use strict';

/**
 * DORMIED — Visitor country (for the homepage market ticker)
 *
 * GET /api/geo  ->  { "country": "CA" }  |  { "country": null }
 *
 * The homepage is a static file, so it cannot see request headers: the tape is
 * prerendered for Global and js/ticker.js calls this once to find out whether
 * the visitor should be looking at a different market. The client caches the
 * answer for a week, and an explicit pick in the picker skips this entirely, so
 * this runs roughly once per visitor per week.
 *
 * x-vercel-ip-country is set by Vercel's edge on every request and cannot be
 * spoofed by the client: Vercel overwrites whatever the caller sends. Fastly's
 * and Cloudflare's equivalents are read only as a fallback in case the project
 * ever sits behind one of them.
 *
 * PRIVACY
 * Returns a two-letter country and nothing else. No IP address is read, logged
 * or returned, no region or city, no identifier, nothing is persisted server
 * side, and nothing is set as a cookie. The response is deliberately
 * private/no-store: a shared CDN cache would hand one visitor's country to
 * every other visitor hitting the same edge node.
 */

/** The 10 countries with their own market, plus Global for everyone else. */
const KNOWN = new Set(['US', 'CA', 'GB', 'JP', 'KR', 'AU', 'CN', 'DE', 'FR', 'SE']);

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const raw =
       req.headers['x-vercel-ip-country']
    || req.headers['cf-ipcountry']
    || req.headers['fastly-geo-country-code']
    || '';

  const code = String(raw).trim().toUpperCase();

  // Anything we do not have a market for is reported as null, and the client
  // falls back to Global. Returning the raw code instead would invite the
  // client to guess at a market that does not exist.
  res.statusCode = 200;
  res.end(JSON.stringify({ country: KNOWN.has(code) ? code : null }));
};
