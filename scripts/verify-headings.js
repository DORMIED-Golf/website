#!/usr/bin/env node
/**
 * scripts/verify-headings.js
 *
 * Content h2s are phrased as questions on article, feature, brand, WITB, hub
 * and static pages (about, contact, privacy, terms).
 *
 * OUT OF SCOPE, by editorial decision (2026-09-13): the homepage, /rankings and
 * the Scorecard pages keep their named section titles ("The Standings",
 * "Category Leaders", "At The Top"), and the shared sidebar module labels
 * (class latest-feed-heading: "Latest", "Trending", "Features",
 * "Biggest Movers", "Read the latest Scorecard") are short labels everywhere.
 *
 * "Indexable" is defined once in scripts/lib/seo-pages.js (not noindex, not a
 * redirect, canonical points at itself), so templates and redirect stubs are
 * not checked.
 *
 * WHY A GATE
 * The rule lives in the article prompt and its post-processing, the structure
 * backfill, feature markdown, shared labels in the generators and
 * lib/answer-block.js, the newsletter library, and hand-maintained HTML that no
 * generator owns. A stale label in a hand-maintained page survives every
 * re-bake, so without a check one edit quietly brings a statement heading back.
 *
 *   node scripts/verify-headings.js        # exits 1 on any non-question h2
 *   node scripts/verify-headings.js -v     # list every offender
 */
'use strict';

const { indexablePages } = require('./lib/seo-pages');

const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');

// Pages whose section titles are named, not questions: the homepage, /rankings,
// the Scorecard, every WITB page, and the static about/contact/privacy/terms pages.
const EXEMPT_PAGE = rel => rel === 'index.html'
  || /^(rankings|scorecard|witb|about|contact|privacy|terms)\//.test(rel);
// Shared sidebar module labels.
const EXEMPT_CLASS = /\blatest-feed-heading\b/;

function text(s) {
  return String(s).replace(/<[^>]+>/g, '')
    .replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function main() {
  const offenders = [];
  let pages = 0, seen = 0;

  for (const page of indexablePages()) {
    if (EXEMPT_PAGE(page.rel)) continue;
    pages++;
    const body = page.html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, '');
    for (const m of body.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi)) {
      if (EXEMPT_CLASS.test(m[1])) continue;
      const t = text(m[2]);
      if (!t) continue;
      seen++;
      if (!t.endsWith('?')) offenders.push(`${page.rel}  "${t}"`);
    }
  }

  console.log(`[headings] ${seen} content h2s across ${pages} pages in scope`);
  if (!offenders.length) {
    console.log('[headings] ✓ every content h2 in scope is phrased as a question.');
    return;
  }
  console.error(`\n[headings] !! ${offenders.length} h2(s) not phrased as a question:`);
  for (const line of (VERBOSE ? offenders : offenders.slice(0, 15))) console.error(`        ${line}`);
  if (!VERBOSE && offenders.length > 15) console.error(`        ...and ${offenders.length - 15} more (-v to list all)`);
  process.exitCode = 1;
}

if (require.main === module) main();
