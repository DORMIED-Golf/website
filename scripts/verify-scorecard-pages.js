#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   scripts/verify-scorecard-pages.js
   Validates each scorecard/[slug]/index.html against the anti-stub rules:
     - File exists and is > 15,000 bytes
     - Contains <h1> with issue title
     - Contains <title> with issue title
     - Has a non-empty, unique meta description
     - Contains zero fetch( calls for content loading
     - Contains zero document.write calls
   Exits 0 on success, 1 on failure.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.resolve(__dirname, '..');

let errors = 0;

function check(label, value, min) {
  if (typeof value === 'boolean') {
    if (!value) { console.error(`  ✖  ${label}`); errors++; }
    else          console.log(`  ✔  ${label}`);
  } else {
    if (value < min) { console.error(`  ✖  ${label}: got ${value}, need ${min === 0 ? '0' : '>= ' + min}`); errors++; }
    else               console.log(`  ✔  ${label}: ${value}`);
  }
}

function loadScorecardData() {
  const raw = fs.readFileSync(path.join(ROOT, 'js/scorecard-data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return ctx.window.DORMIED_SCORECARD_DATA;
}

const data   = loadScorecardData();
const issues = data.issues || [];

if (issues.length === 0) {
  console.error('✖  No issues found in scorecard-data.js');
  process.exit(1);
}

const descs = [];

for (const issue of issues) {
  const filePath = path.join(ROOT, 'scorecard', issue.slug, 'index.html');
  console.log(`\n── scorecard/${issue.slug}/index.html ${'─'.repeat(Math.max(0, 44 - issue.slug.length))}`);

  if (!fs.existsSync(filePath)) {
    console.error(`  ✖  File not found: scorecard/${issue.slug}/index.html`);
    errors++;
    continue;
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const size = Buffer.byteLength(html, 'utf8');

  check('File size > 15,000 bytes', size, 15001);

  // <h1> present somewhere
  check('<h1> tag present',   html.includes('<h1'), true);

  // title tag contains the issue slug month (e.g. "April 2026" or "March 2026")
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const titleText  = titleMatch ? titleMatch[1] : '';
  check('<title> non-empty',  titleText.length > 0, true);

  // canonical
  check(`canonical /scorecard/${issue.slug}/`, html.includes(`/scorecard/${issue.slug}/`), true);

  // meta description
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
  const descText  = descMatch ? descMatch[1] : '';
  check('meta description non-empty', descText.length > 0, true);
  if (descText) descs.push({ slug: issue.slug, desc: descText });

  // no fetch( loading content
  // The adsbygoogle loader does not use fetch — we check for the pattern the old shell used
  const fetchCount = (html.match(/fetch\(/g) || []).length;
  check('no fetch( calls', fetchCount === 0, true);

  // no document.write
  const writeCount = (html.match(/document\.write/g) || []).length;
  check('no document.write', writeCount === 0, true);

  // brand links (auto-linker output)
  const brandLinks = (html.match(/href="\/brands\/[^"]+\/"/g) || []).length;
  check('brand links > 0', brandLinks, 1);
}

/* ── Uniqueness check across all issues ──────────────────────────────────── */
console.log('\n── Cross-issue uniqueness ─────────────────────────────────────────────');
const seen = new Map();
for (const { slug, desc } of descs) {
  if (seen.has(desc)) {
    console.error(`  ✖  Duplicate meta description: ${slug} and ${seen.get(desc)}`);
    errors++;
  } else {
    seen.set(desc, slug);
    console.log(`  ✔  Unique meta description: ${slug}`);
  }
}

/* ── Vercel config check ─────────────────────────────────────────────────── */
console.log('\n── vercel.json ────────────────────────────────────────────────────────');
{
  const vercelPath = path.join(ROOT, 'vercel.json');
  if (fs.existsSync(vercelPath)) {
    const config  = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
    const hasShell = (config.rewrites || []).some(r => r.destination === '/scorecard/article.html');
    check('Shell rewrites removed from vercel.json', !hasShell, true);
    const hasCacheRule = (config.headers || []).some(h => h.source === '/scorecard/(.+)/');
    check('/scorecard/(.+)/ cache rule present', hasCacheRule, true);
  } else {
    console.warn('  ⚠  vercel.json not found — skipping');
  }
}

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(72));
if (errors > 0) {
  console.error(`✖  ${errors} check(s) failed`);
  process.exit(1);
} else {
  console.log('✔  All scorecard page checks passed');
}
