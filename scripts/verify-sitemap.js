#!/usr/bin/env node
/**
 * scripts/verify-sitemap.js
 *
 * CI check: every <loc> in sitemap.xml that starts with https://dormied.com
 * must resolve to a real, non-empty local file. Exits non-zero if any fail.
 *
 * Usage:
 *   node scripts/verify-sitemap.js
 *   npm run verify:sitemap
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const SITE_ROOT  = path.resolve(__dirname, '..');
const SITE_BASE  = 'https://dormied.com';
const MIN_BYTES  = 1000;
const sitemapPath = path.join(SITE_ROOT, 'sitemap.xml');

const sitemap = fs.readFileSync(sitemapPath, 'utf8');
const locs    = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());

let failures  = 0;
let checked   = 0;
let skipped   = 0;

for (const url of locs) {
  if (!url.startsWith(SITE_BASE)) {
    skipped++;
    continue;
  }

  const urlPath  = url.slice(SITE_BASE.length); // e.g. /news/some-slug/
  const filePath = urlPath.endsWith('/')
    ? path.join(SITE_ROOT, urlPath, 'index.html')
    : path.join(SITE_ROOT, urlPath);

  checked++;

  if (!fs.existsSync(filePath)) {
    console.error(`  MISSING  ${url}`);
    console.error(`           → ${path.relative(SITE_ROOT, filePath)}`);
    failures++;
    continue;
  }

  const size = fs.statSync(filePath).size;
  if (size < MIN_BYTES) {
    console.error(`  TOO SMALL  ${url} (${size} bytes < ${MIN_BYTES})`);
    console.error(`             → ${path.relative(SITE_ROOT, filePath)}`);
    failures++;
  }
}

/* ── No lastmod may be in the future ──────────────────────────────────────────
 *
 * Every lastmod is supposed to come from CONTENT -- a bag_date, a published_at,
 * a hand-kept manifest -- never from the clock. A date ahead of today proves
 * something fabricated one, and crawlers discount a sitemap that claims the
 * future.
 *
 * What prompted it: generate-witb-player-page.js patched sitemap.xml in place
 * with `today` computed in UTC, so an evening run stamped the NEXT local day on
 * 33 URLs, one of them a player whose bag had not changed since April 2025. The
 * real fix was structural -- that generator now delegates to
 * generate-sitemap.js like every other one.
 *
 * Be clear about what this check can and cannot see. It catches a date ahead of
 * UTC today. It cannot catch a clock-stamped date that happens to equal today,
 * which is exactly what those 33 were in UTC terms; only delegation prevents
 * that. It is a backstop against the worse version of the same mistake, not
 * proof that every lastmod came from content.
 */
const today = new Date().toISOString().slice(0, 10);
const future = [];
for (const block of sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
  const loc = block[1].match(/<loc>([^<]+)<\/loc>/);
  const lm  = block[1].match(/<lastmod>([^<]+)<\/lastmod>/);
  if (loc && lm && lm[1].trim() > today) future.push(`${lm[1].trim()}  ${loc[1].trim()}`);
}
if (future.length) {
  console.error(`\n  ${future.length} URL(s) have a lastmod in the future (today is ${today}):`);
  for (const f of future.slice(0, 10)) console.error(`    ${f}`);
  if (future.length > 10) console.error(`    ...and ${future.length - 10} more`);
  console.error('  A lastmod must come from content, never from the build clock.');
  failures += future.length;
}

console.log('');
if (failures > 0) {
  console.error(`✗ verify:sitemap — ${failures} problem(s) found in ${checked} checked URLs (${skipped} skipped). Failing build.`);
  process.exit(1);
} else {
  console.log(`✓ verify:sitemap — all ${checked} sitemap URLs resolve to real files, no future lastmod (${skipped} skipped).`);
}
