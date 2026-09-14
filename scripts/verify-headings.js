#!/usr/bin/env node
/**
 * scripts/verify-headings.js
 *
 * Every h2 on every indexable page is phrased as a question: articles,
 * features, brand pages, WITB pages, scorecard issues, the rankings, the hubs,
 * the homepage and the static pages, including screen-reader-only h2s.
 *
 * "Indexable" is defined once in scripts/lib/seo-pages.js (not noindex, not a
 * redirect, canonical points at itself), so templates and redirect stubs are
 * not checked.
 *
 * WHY A GATE
 * The rule lives in many places: the article prompt and its post-processing,
 * the structure backfill, feature markdown, the scorecard SECTION_QUESTIONS,
 * shared labels in the generators and lib/answer-block.js, the newsletter
 * library, and hand-maintained HTML that no generator owns. A stale label in a
 * hand-maintained page survives every re-bake, so without a check one edit to
 * any of those quietly brings a statement heading back.
 *
 *   node scripts/verify-headings.js        # exits 1 on any non-question h2
 *   node scripts/verify-headings.js -v     # list every offender
 */
'use strict';

const { indexablePages, headings } = require('./lib/seo-pages');

const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');

function main() {
  const offenders = [];
  let pages = 0, seen = 0;

  for (const page of indexablePages()) {
    pages++;
    for (const h of headings(page.html)) {
      if (h.level !== 2 || !h.text) continue;
      seen++;
      if (!h.text.endsWith('?')) offenders.push(`${page.rel}  "${h.text}"`);
    }
  }

  console.log(`[headings] ${seen} h2s across ${pages} indexable pages`);
  if (!offenders.length) {
    console.log('[headings] ✓ every h2 is phrased as a question.');
    return;
  }
  console.error(`\n[headings] !! ${offenders.length} h2(s) not phrased as a question:`);
  for (const line of (VERBOSE ? offenders : offenders.slice(0, 15))) console.error(`        ${line}`);
  if (!VERBOSE && offenders.length > 15) console.error(`        ...and ${offenders.length - 15} more (-v to list all)`);
  process.exitCode = 1;
}

if (require.main === module) main();
