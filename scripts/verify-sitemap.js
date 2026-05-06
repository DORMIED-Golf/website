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

console.log('');
if (failures > 0) {
  console.error(`✗ verify:sitemap — ${failures} orphan(s) found in ${checked} checked URLs (${skipped} skipped). Failing build.`);
  process.exit(1);
} else {
  console.log(`✓ verify:sitemap — all ${checked} sitemap URLs resolve to real files (${skipped} skipped).`);
}
