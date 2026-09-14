#!/usr/bin/env node
/**
 * scripts/verify-headings.js
 *
 * Every h2 a reader or crawler meets in a news article, a feature, or one of the
 * shared template blocks must be phrased as a question.
 *
 * WHAT IT CHECKS
 *   - Article and feature body section headings (h2.sc-main-heading) on every
 *     page under news/<slug>/.
 *   - The shared template headings wherever they appear site-wide: the sidebar
 *     modules (latest-feed-heading), the newsletter block (scb-headline), the
 *     answer block (da-answer-label), the FAQ heading (da-bottom-heading) and the
 *     intent cluster (da-cluster-heading).
 *   - Hand-authored article pages (PROTECTED_SLUGS in generate-article.js),
 *     whose h2s are plain tags with no class.
 *
 * Section headings on brand, WITB, rankings and scorecard pages ("Rankings by
 * Market", "Find a Player") are deliberately out of scope.
 *
 * WHY A GATE
 * The rule is enforced in at least six places: the article prompt, the
 * structure backfill, generate-feature.js plus its markdown, shared labels in
 * seven generators and lib/answer-block.js, the newsletter library, and
 * hand-maintained HTML that no generator owns. The refresher for the newsletter
 * block deliberately preserves existing copy, and a stale label in a
 * hand-maintained page survives every re-bake. Without a check, one edit to any
 * of those quietly brings a statement heading back.
 *
 *   node scripts/verify-headings.js        # exits 1 on any non-question h2
 *   node scripts/verify-headings.js -v     # list every offender
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');
const SKIP    = new Set(['node_modules', '.git', '.claude', '.vercel', 'scripts', 'prompts', 'eval-results']);

const TEMPLATE_CLASS = /\b(latest-feed-heading|scb-headline|da-answer-label|da-bottom-heading|da-cluster-heading)\b/;
const BODY_CLASS     = /\bsc-main-heading\b/;

function decode(s) {
  return s.replace(/<[^>]+>/g, '')
    .replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function protectedSlugs() {
  const src = fs.readFileSync(path.join(__dirname, 'generate-article.js'), 'utf8');
  const m = src.match(/const PROTECTED_SLUGS = new Set\(\[([\s\S]*?)\]\)/);
  return new Set(m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : []);
}

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) htmlFiles(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
  }
  return out;
}

function main() {
  const PROTECTED = protectedSlugs();
  const offenders = { template: [], body: [], protected: [] };
  let templateSeen = 0, bodySeen = 0, protectedSeen = 0;

  for (const file of htmlFiles(ROOT)) {
    const rel  = path.relative(ROOT, file);
    const html = fs.readFileSync(file, 'utf8');
    const parts = rel.split(path.sep);
    const isArticlePage = parts[0] === 'news' && parts.length === 3 && parts[1] !== 'page';
    const isProtected   = isArticlePage && PROTECTED.has(parts[1]);

    for (const m of html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/g)) {
      const attrs = m[1];
      const text  = decode(m[2]);
      if (!text) continue;
      const isQ = text.endsWith('?');
      if (TEMPLATE_CLASS.test(attrs)) {
        templateSeen++;
        if (!isQ) offenders.template.push(`${rel}  "${text}"`);
      } else if (isArticlePage && BODY_CLASS.test(attrs)) {
        bodySeen++;
        if (!isQ) offenders.body.push(`${rel}  "${text}"`);
      } else if (isProtected && !/\bclass=/.test(attrs)) {
        protectedSeen++;
        if (!isQ) offenders.protected.push(`${rel}  "${text}"`);
      }
    }
  }

  console.log(`[headings] template h2s: ${templateSeen}, article/feature body h2s: ${bodySeen}, hand-authored article h2s: ${protectedSeen}`);
  const total = offenders.template.length + offenders.body.length + offenders.protected.length;
  if (!total) {
    console.log('[headings] ✓ every checked h2 is phrased as a question.');
    return;
  }
  for (const [kind, list] of Object.entries(offenders)) {
    if (!list.length) continue;
    console.error(`\n[headings] !! ${list.length} ${kind} h2(s) not phrased as a question:`);
    for (const line of (VERBOSE ? list : list.slice(0, 10))) console.error(`        ${line}`);
    if (!VERBOSE && list.length > 10) console.error(`        ...and ${list.length - 10} more (-v to list all)`);
  }
  process.exitCode = 1;
}

if (require.main === module) main();
