#!/usr/bin/env node
/**
 * scripts/refresh-signup-blocks.js
 *
 * Most pages get their signup block from a generator, so changing
 * lib/signup-block.js and re-baking is enough. A handful do not:
 *
 *   index.html, scorecard/index.html   hand-maintained pages
 *   the PROTECTED_SLUGS articles       hand-authored HTML that
 *                                      generate-article.js must never overwrite
 *
 * On those the block was pasted in once and then quietly stopped tracking the
 * library. The 3B redesign is what surfaced it: the block's CSS moved, the
 * markup on those pages did not, and they would have shipped a widget with no
 * layout at all. Nothing failed loudly, which is the actual problem.
 *
 * So this does not carry a list of files. It scans every page, rebuilds each
 * block from the library, and reports the ones that no longer match. Generated
 * pages match already and cost one string compare each; a page that does not
 * match is either hand-maintained or a generator that has fallen behind, and
 * both are worth knowing about.
 *
 * The copy on those pages is theirs and is preserved verbatim: this replaces
 * the SHAPE of the block, never its words. Anything the library does not own
 * (which issue the success state links to, the brand slug) is read off the
 * existing block and passed back in.
 *
 * Usage:
 *   node scripts/refresh-signup-blocks.js            # rewrite stale blocks
 *   node scripts/refresh-signup-blocks.js --check    # exit 1 if any are stale
 *   node scripts/refresh-signup-blocks.js --verbose  # list every page scanned
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { signupBlockHtml } = require('./lib/signup-block.js');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['brands', 'news', 'witb', 'scorecard', 'rankings'];
const SCAN_ROOT_FILES = ['index.html'];

// Global: scorecard issues carry two blocks (primary and secondary), so a
// single-match regex would have quietly left every second one behind.
const BLOCK_RE = /<section class="scb"[\s\S]*?<\/section>/g;

/** Undo the escaping signupBlockHtml applied, so the copy round-trips exactly. */
function unesc(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&');   // last, or &amp;lt; would decode twice
}

function attr(block, name) {
  const m = block.match(new RegExp(`${name}="([^"]*)"`));
  return m ? unesc(m[1]) : '';
}

function inner(block, cls) {
  const m = block.match(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)<\\/`));
  return m ? unesc(m[1]) : '';
}

function walkHtml(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkHtml(p, acc);
    else if (e.isFile() && e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

function main() {
  const check   = process.argv.includes('--check');
  const verbose = process.argv.includes('--verbose');

  const files = SCAN_ROOT_FILES.map(f => path.join(ROOT, f))
    .filter(f => fs.existsSync(f))
    .concat(...SCAN_DIRS.map(d => walkHtml(path.join(ROOT, d))));

  let scanned = 0, stale = 0, fixed = 0;

  for (const file of files) {
    const html   = fs.readFileSync(file, 'utf8');
    const blocks = html.match(BLOCK_RE);
    if (!blocks) continue;
    scanned++;

    const rel = path.relative(ROOT, file);
    let bad = 0, drift = 0;

    const next = html.replace(BLOCK_RE, (block) => {
      const slot     = attr(block, 'data-slot');
      const pageType = attr(block, 'data-page-type');
      if (!slot || !pageType) {
        console.error(`[signup-blocks] ✗ ${rel}: a block has no slot/page-type.`);
        bad++;
        return block;
      }

      const fresh = signupBlockHtml({
        slot,
        pageType,
        brandSlug:      attr(block, 'data-brand-slug') || undefined,
        latestIssueUrl: attr(block, 'data-latest-issue') || undefined,
        copy: {
          headline:  inner(block, 'scb-headline'),
          proofLine: inner(block, 'scb-proof'),
        },
      });

      if (fresh === block) return block;
      drift++;
      // In --check nothing is written, so hand the original back either way.
      return check ? block : fresh;
    });

    if (bad) process.exitCode = 1;
    if (!drift) {
      if (verbose) console.log(`[signup-blocks] = ${rel} (${blocks.length} block(s))`);
      continue;
    }

    stale++;
    if (check) {
      console.error(`[signup-blocks] ✗ ${rel}: ${drift} of ${blocks.length} block(s) stale against lib/signup-block.js.`);
      continue;
    }
    fs.writeFileSync(file, next);
    fixed++;
    console.log(`[signup-blocks] ✓ ${rel}: ${drift} block(s) rebuilt.`);
  }

  console.log(`[signup-blocks] ${scanned} page(s) carry a block; ${stale} stale, ${fixed} rewritten.`);
  if (check && stale) {
    console.error('[signup-blocks] Run: node scripts/refresh-signup-blocks.js');
    process.exitCode = 1;
  }
}

main();
