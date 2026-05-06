#!/usr/bin/env node
/**
 * DORMIED — Brand Page Verifier
 *
 * Checks that every brand in data.js has a generated
 * brands/[slug]/index.html with a non-empty <h1> and <title>.
 *
 * Usage:
 *   node scripts/verify-brands.js
 *   node scripts/verify-brands.js --verbose    # list all passing brands too
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SITE_ROOT = path.resolve(__dirname, '..');

function loadDormiedData() {
  const raw = fs.readFileSync(path.join(SITE_ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return ctx.window.DORMIED_DATA;
}

function extractTag(html, tag, id) {
  // Extract content of <tag> or <tag id="..."> element
  const pattern = id
    ? new RegExp(`<${tag}[^>]*id="${id}"[^>]*>([^<]*)`, 'i')
    : new RegExp(`<${tag}[^>]*>([^<]*)`, 'i');
  const m = html.match(pattern);
  return m ? m[1].trim() : '';
}

function extractMetaContent(html, name) {
  const m = html.match(new RegExp(`<meta[^>]+name="${name}"[^>]+content="([^"]*)"`, 'i'))
         || html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+name="${name}"`, 'i'));
  return m ? m[1].trim() : '';
}

async function main() {
  const args    = process.argv.slice(2);
  const verbose = args.includes('--verbose');

  const dormiedData = loadDormiedData();
  const allBrands   = dormiedData.brands;

  let pass = 0, fail = 0;
  const failures = [];

  for (const brand of allBrands) {
    const slug    = brand.id;
    const outPath = path.join(SITE_ROOT, 'brands', slug, 'index.html');

    if (!fs.existsSync(outPath)) {
      failures.push({ slug, reason: 'File missing' });
      fail++;
      continue;
    }

    const html        = fs.readFileSync(outPath, 'utf8');
    const title       = extractTag(html, 'title');
    const h1          = extractTag(html, 'h1');
    const metaDesc    = extractMetaContent(html, 'description');
    const hasSlugVar  = html.includes(`window.__BRAND_SLUG__='${slug}'`);
    const hasFooterYr = html.includes('id="footer-year"');

    const issues = [];
    if (!title)                 issues.push('empty <title>');
    if (!h1)                    issues.push('empty <h1>');
    if (!metaDesc)              issues.push('empty meta description');
    if (!hasSlugVar)            issues.push('missing __BRAND_SLUG__ assignment');
    if (!hasFooterYr)           issues.push('missing footer-year span');

    if (issues.length > 0) {
      failures.push({ slug, reason: issues.join(', ') });
      fail++;
    } else {
      pass++;
      if (verbose) console.log(`  ✓ ${slug}`);
    }
  }

  if (failures.length > 0) {
    console.error('\n[verify-brands] FAILURES:');
    for (const f of failures) {
      console.error(`  ✗ ${f.slug}: ${f.reason}`);
    }
  }

  console.log(`\n[verify-brands] ${pass} passed, ${fail} failed (of ${allBrands.length} brands)`);

  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('[verify-brands] Fatal:', err.message);
  process.exit(1);
});
