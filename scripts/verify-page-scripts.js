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
const { dataVersion } = require('./lib/data-version.js');
const { cssVersion }  = require('./lib/css-version.js');
const { assetVersion } = require('./lib/asset-version.js');

/**
 * Dataset cache-busters that must track the CURRENT dataVersion().
 *
 * Only three generators interpolate dataVersion(); every other page carries the
 * tag by hand, so a monthly data update silently leaves them pointing at the
 * previous dataset. A returning visitor then keeps the cached file and reads
 * last month's numbers on a page that looks current. After the July 2026 update
 * that was 31 pages, including the homepage and /rankings/, and two of them had
 * been stranded an extra cycle on a version older still.
 */
const DATASET_FILES = ['data.min.js', 'data-home.js'];

/**
 * Stylesheet cache-busters, which must equal the CONTENT hash of the two
 * stylesheets. The version was a hand-written date in nine generators and sat
 * unchanged through three stylesheet edits, so the signup card served its dark
 * first draft to every returning visitor for a week: the file on the server was
 * right, but Cache-Control is public max-age=604800 and the URL never moved.
 * cssVersion() now derives from the files, and this asserts the baked pages
 * agree with them.
 */
const STYLESHEET_FILES = ['styles.css', 'styles.min.css'];

/**
 * Every /js/*.min.js cache-buster must equal its own file's content hash.
 *
 * This is the same failure the dataset and stylesheet checks exist for, and it
 * had already happened here unnoticed: signup.min.js was rewritten end to end,
 * popup removed and tracking added, while its URL stayed at 20260718d, so
 * returning visitors kept running the old script. search.min.js, brand.min.js
 * and feed-page.min.js were each shipping two different versions at once.
 *
 * data.min.js and data-home.js are excluded: they track the dataset, not their
 * own bytes, and the dataset check above already covers them.
 */
const DATASET_EXEMPT = new Set(['data.min.js', 'data-home.js']);

/** marker -> script that must be loaded wherever the marker appears. */
const RULES = [
  { marker: 'class="footer-signup-form"', script: 'signup.min.js',        minPages: 800, what: 'footer signup form' },
  { marker: 'id="dormied-latest-list"',   script: 'feed.min.js',          minPages: 800, what: 'LATEST feed list' },
  { marker: 'id="featured-list"',         script: 'feed.min.js',          minPages: 800, what: 'featured widget' },
  { marker: 'id="bp-latest-list"',        script: 'feed.min.js',          minPages: 150, what: 'brand LATEST list' },
  { marker: 'id="bp-shop-track"',         script: 'shop-carousel.min.js', minPages: 150, what: 'shop carousel' },
  { marker: 'class="scb"',                script: 'signup.min.js',        minPages: 400, what: 'inline Scorecard signup' },
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

  // ── Dataset cache-busters ────────────────────────────────────────────────
  const current = dataVersion();
  const stale = [];
  let datasetRefs = 0;
  for (const file of DATASET_FILES) {
    // Anchor on a slash OR a quote. A delimiter is required because bare
    // "data.min.js" also matches the tail of "scorecard-data.min.js" and
    // captures the first digits of its content hash -- the substring trap that
    // made an earlier cache-buster sweep silently miss every page it was meant
    // to fix. But requiring specifically a SLASH was the mirror-image mistake:
    // the homepage lists its scripts as quoted relative paths, so its
    // data-home.js reference was never checked either.
    const re = new RegExp('[/\'"]' + file.replace('.', '\\.') + '\\?v=(\\d+)', 'g');
    for (const p of pages) {
      const html = fs.readFileSync(p, 'utf8');
      for (const m of html.matchAll(re)) {
        datasetRefs++;
        if (m[1] !== current) stale.push(`${path.relative(ROOT, p)}  ${file}?v=${m[1]}`);
      }
    }
  }
  if (stale.length) {
    failed = true;
    console.error(`\n[page-scripts] !! ${stale.length} dataset reference(s) not on the current version (${current}):\n`);
    for (const line of (VERBOSE ? stale : stale.slice(0, 10))) console.error(`        ${line}`);
    if (!VERBOSE && stale.length > 10) console.error(`        ...and ${stale.length - 10} more (-v to list all)`);
    console.error(`\n    These pages serve a cached copy of the PREVIOUS dataset, so returning`);
    console.error(`    visitors read last month's numbers. Bump the tag wherever it is hand-written.`);
  } else {
    console.log(`[page-scripts]   dataset cache-busters: ${datasetRefs} reference(s), all on ${current}`);
  }

  // ── Stylesheet cache-busters ─────────────────────────────────────────────
  const cssCurrent = cssVersion();
  const cssStale = [];
  let cssRefs = 0;
  for (const file of STYLESHEET_FILES) {
    const re = new RegExp(file.replace('.', '\\.') + '\\?v=([0-9a-z]+)', 'g');
    for (const p of pages) {
      const html = fs.readFileSync(p, 'utf8');
      for (const m of html.matchAll(re)) {
        cssRefs++;
        if (m[1] !== cssCurrent) cssStale.push(`${path.relative(ROOT, p)}  ${file}?v=${m[1]}`);
      }
    }
  }
  if (cssStale.length) {
    failed = true;
    console.error(`\n[page-scripts] !! ${cssStale.length} stylesheet reference(s) not on the current content hash (${cssCurrent}):\n`);
    for (const line of (VERBOSE ? cssStale : cssStale.slice(0, 10))) console.error(`        ${line}`);
    if (!VERBOSE && cssStale.length > 10) console.error(`        ...and ${cssStale.length - 10} more (-v to list all)`);
    console.error(`\n    The stylesheet changed but these pages still request the old URL, so a`);
    console.error(`    returning visitor keeps the cached copy for a week. Re-bake them.`);
  } else {
    console.log(`[page-scripts]   stylesheet cache-busters: ${cssRefs} reference(s), all on ${cssCurrent}`);
  }

  // ── JS asset cache-busters ───────────────────────────────────────────────
  const jsStale = [];
  let jsRefs = 0;
  // Match a root-absolute "/js/x.min.js" OR a relative "js/x.min.js" opened by
  // a quote. The homepage builds its script list as an array of RELATIVE paths
  // inside a loader, so a pattern requiring the leading slash skipped all
  // eleven of its scripts -- including scorecard-data.min.js, which is how the
  // homepage went on serving July's Scorecard from cache after August shipped.
  // The leading delimiter is still required: bare "data.min.js" would otherwise
  // match the tail of "scorecard-data.min.js" and read a hash as a version.
  const jsRe = /(?:\/|['"])js\/([a-z-]+\.min\.js)\?v=([0-9a-z]+)/g;
  for (const p of pages) {
    const html = fs.readFileSync(p, 'utf8');
    for (const m of html.matchAll(jsRe)) {
      const [, file, version] = m;
      if (DATASET_EXEMPT.has(file)) continue;
      jsRefs++;
      let expected;
      try { expected = assetVersion(`js/${file}`); }
      catch (e) { jsStale.push(`${path.relative(ROOT, p)}  ${file} (asset missing)`); continue; }
      if (version !== expected) jsStale.push(`${path.relative(ROOT, p)}  ${file}?v=${version} (expected ${expected})`);
    }
  }
  if (jsStale.length) {
    failed = true;
    console.error(`\n[page-scripts] !! ${jsStale.length} script reference(s) not on their file's content hash:\n`);
    for (const line of (VERBOSE ? jsStale : jsStale.slice(0, 10))) console.error(`        ${line}`);
    if (!VERBOSE && jsStale.length > 10) console.error(`        ...and ${jsStale.length - 10} more (-v to list all)`);
    console.error(`\n    The script changed but these pages request the old URL, so a returning`);
    console.error(`    visitor keeps running the previous version. Re-bake them.`);
  } else {
    console.log(`[page-scripts]   script cache-busters: ${jsRefs} reference(s), all on their file hash`);
  }

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
