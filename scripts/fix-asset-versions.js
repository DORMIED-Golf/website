#!/usr/bin/env node
/**
 * scripts/fix-asset-versions.js
 *
 * Rewrites every ?v= cache-buster in the built pages to the value the asset's
 * own content implies, so verify-page-scripts.js passes for the right reason.
 * Run it after any stylesheet or script edit, before committing.
 *
 *   node scripts/fix-asset-versions.js          # rewrite
 *   node scripts/fix-asset-versions.js --check  # report only, exit 1 if stale
 *
 * WHY THE DELIMITER IS A CHARACTER CLASS AND NOT A SLASH
 * Most pages reference scripts root-absolutely ("/js/feed.min.js?v=..."), but
 * the homepage builds its list as an array of quoted RELATIVE paths inside a
 * loader. The first version of this script, and the gate that was supposed to
 * catch what it missed, both required the leading slash -- so between them they
 * never once examined the homepage, and all eleven of its cache-busters stayed
 * frozen on hand-written dates through every asset rewrite. The one that
 * mattered was scorecard-data.min.js: August's issue shipped, the file on the
 * server changed, the URL did not, and returning visitors kept being served
 * July's Scorecard from cache.
 *
 * A delimiter is still required, just a wider one. Matching a bare filename
 * would let "data.min.js" match the tail of "scorecard-data.min.js" and
 * overwrite part of its content hash.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { assetVersion } = require(path.join(ROOT, 'scripts/lib/asset-version.js'));
const { cssVersion }   = require(path.join(ROOT, 'scripts/lib/css-version.js'));
const { dataVersion }  = require(path.join(ROOT, 'scripts/lib/data-version.js'));

const CHECK_ONLY = process.argv.includes('--check');

const SKIP = new Set(['node_modules', '.git', '.claude', '.vercel', 'scripts', 'prompts', 'eval-results']);

/** These track the dataset, not their own bytes. */
const DATASET_FILES = new Set(['data.min.js', 'data-home.js']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.html')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function main() {
  const cv = cssVersion();
  const dv = dataVersion();
  let files = 0, jsFixed = 0, cssFixed = 0, dataFixed = 0;
  const stale = [];

  for (const f of walk(ROOT)) {
    const html = fs.readFileSync(f, 'utf8');
    let out = html;
    const rel = path.relative(ROOT, f);

    // Scripts. Group 1 is the delimiter (slash or quote), preserved verbatim.
    out = out.replace(/([/'"])js\/([a-z-]+\.(?:min\.)?js)\?v=([0-9a-z]+)/g, (m, delim, file, ver) => {
      const want = DATASET_FILES.has(file)
        ? dv
        : (() => { try { return assetVersion(`js/${file}`); } catch { return null; } })();
      if (want === null || want === ver) return m;
      if (DATASET_FILES.has(file)) dataFixed++; else jsFixed++;
      stale.push(`${rel}  ${file}?v=${ver} -> ${want}`);
      return `${delim}js/${file}?v=${want}`;
    });

    // Stylesheets.
    out = out.replace(/(styles(?:\.min)?\.css)\?v=([0-9a-z]+)/g, (m, file, ver) => {
      if (ver === cv) return m;
      cssFixed++;
      stale.push(`${rel}  ${file}?v=${ver} -> ${cv}`);
      return `${file}?v=${cv}`;
    });

    if (out !== html) {
      if (!CHECK_ONLY) fs.writeFileSync(f, out);
      files++;
    }
  }

  const total = jsFixed + cssFixed + dataFixed;
  if (CHECK_ONLY) {
    if (total === 0) {
      console.log('[asset-versions] ✓ every cache-buster matches its asset.');
      return;
    }
    console.error(`[asset-versions] !! ${total} stale reference(s) across ${files} page(s):`);
    for (const line of stale.slice(0, 15)) console.error(`        ${line}`);
    if (stale.length > 15) console.error(`        ...and ${stale.length - 15} more`);
    process.exit(1);
  }

  console.log(`[asset-versions] ${files} page(s) updated | ${jsFixed} script, ${cssFixed} stylesheet, ${dataFixed} dataset reference(s) corrected`);
}

if (require.main === module) main();
