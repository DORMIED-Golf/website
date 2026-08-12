#!/usr/bin/env node
/**
 * scripts/verify-page-scripts.js
 *
 * Interactive markup is inert without the script that binds to it. The markup
 * still renders, so the page looks completely fine, and nothing else in the
 * build notices.
 *
 * This shipped: the footer signup form was baked into every page, but three
 * templates never loaded js/signup.min.js — the 189 WITB player pages, /witb/,
 * and about/privacy/terms. With no handler nothing calls preventDefault(), so
 * submitting did a native GET to the same URL: the page reloaded, the box came
 * back empty, and the address was dropped. The input has no name attribute, so
 * the email was not even preserved in the query string. The WITB player pages
 * are the strongest organic surface on the site, so the highest-volume signup
 * surface silently converted nobody until someone tried it by hand.
 *
 * WHAT THIS CHECKS
 * For each rule below: every built page containing `marker` must also load
 * `script`. The marker is deliberately the exact DOM hook the script binds to
 * (the id it getElementById's, the class it querySelectorAll's), NOT a CSS
 * class family. A looser marker cries wolf: `latest-feed-list` is also used by
 * the scorecard issue pages for static pre-baked sidebars that feed.js has no
 * ids to hydrate, which is correct and must not fail.
 *
 * A rule matching ZERO pages is a FAILURE, not a pass. If a marker stops
 * matching because a class or id was renamed, the rule silently protects
 * nothing from then on. minPages is a floor well under the current count, so a
 * rename trips the gate instead of quietly disarming it.
 *
 * Adding a rule: use a hook the script actually queries, and set minPages
 * comfortably below today's count. If a new rule fails on first run, that is a
 * real bug it just found. Fix the templates, do not relax the rule.
 *
 * Usage:
 *   node scripts/verify-page-scripts.js          # exits 1 on any inert markup
 *   node scripts/verify-page-scripts.js -v       # list every offending page
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');

/** marker -> script that must be loaded wherever the marker appears. */
const RULES = [
  { marker: 'class="footer-signup-form"', script: 'signup.min.js',        minPages: 800, what: 'footer signup form' },
  { marker: 'id="dormied-latest-list"',   script: 'feed.min.js',          minPages: 800, what: 'LATEST feed list' },
  { marker: 'id="featured-list"',         script: 'feed.min.js',          minPages: 800, what: 'featured widget' },
  { marker: 'id="bp-latest-list"',        script: 'feed.min.js',          minPages: 150, what: 'brand LATEST list' },
  { marker: 'id="bp-shop-track"',         script: 'shop-carousel.min.js', minPages: 150, what: 'shop carousel' },
];

/** Directories that are not part of the deploy artifact. */
const SKIP = new Set(['node_modules', '.git', '.claude', '.vercel', 'scripts', 'prompts', 'eval-results']);

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      htmlFiles(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.html')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function main() {
  const pages = htmlFiles(ROOT);
  console.log(`[page-scripts] scanning ${pages.length} page(s)`);

  const results = RULES.map(r => ({ rule: r, matched: 0, missing: [] }));

  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    for (const res of results) {
      if (!html.includes(res.rule.marker)) continue;
      res.matched++;
      if (!html.includes(res.rule.script)) res.missing.push(path.relative(ROOT, file));
    }
  }

  let failed = false;

  for (const { rule, matched, missing } of results) {
    if (matched < rule.minPages) {
      failed = true;
      console.error(`\n[page-scripts] !! rule "${rule.what}" matched ${matched} page(s), expected at least ${rule.minPages}.`);
      console.error(`    marker: ${rule.marker}`);
      console.error(`    The marker has almost certainly been renamed, which means this rule`);
      console.error(`    stopped protecting anything. Update the marker, do not lower minPages.`);
      continue;
    }
    if (missing.length) {
      failed = true;
      console.error(`\n[page-scripts] !! ${missing.length} of ${matched} page(s) render the ${rule.what} without ${rule.script}:\n`);
      const show = VERBOSE ? missing : missing.slice(0, 10);
      for (const p of show) console.error(`        ${p}`);
      if (!VERBOSE && missing.length > show.length) {
        console.error(`        ...and ${missing.length - show.length} more (-v to list all)`);
      }
      continue;
    }
    console.log(`[page-scripts]   ${rule.what}: ${matched} page(s), all load ${rule.script}`);
  }

  if (failed) {
    console.error(`\n[page-scripts] FAILED — the markup renders but does nothing. Add the script to the generator, then re-bake.`);
    process.exit(1);
  }

  console.log(`\n[page-scripts] ✓ every page carrying interactive markup loads the script that binds to it.`);
}

// Only run when invoked directly, so require()-ing this for inspection does not
// execute it against production.
if (require.main === module) {
  main();
}
