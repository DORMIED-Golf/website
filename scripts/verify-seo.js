#!/usr/bin/env node
/**
 * scripts/verify-seo.js
 *
 * On-page SEO structure for every indexable page (scripts/lib/seo-pages.js):
 *
 *   - exactly one <title>, 60 characters or fewer, unique across the site
 *   - exactly one meta description, 160 characters or fewer, unique
 *   - exactly one non-empty h1, and it is the first heading on the page
 *   - no h3 before the first h2, and no skipped heading level (h2 -> h4)
 *   - a canonical, and og:url equal to it; og:title, og:description, og:image
 *   - no em dash in the title, description, h1 or any h2
 *   - every indexable page is in sitemap.xml, and every sitemap URL is an
 *     indexable page
 *
 * An article page missing from the sitemap is reported but does not fail: the
 * pipeline commits a page before publish-articles.js promotes its row, and the
 * sitemap lists published articles only, so a draft held on the image gate is
 * expected to be live and unlisted until it publishes.
 *
 * WHY A GATE
 * The generators enforce these limits themselves. This catches what they
 * cannot: a hand-maintained page, a feature config, or a template change.
 *
 *   node scripts/verify-seo.js        # exits 1 on any failure
 *   node scripts/verify-seo.js -v     # list every offender
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { ROOT, indexablePages, headings, attr, text } = require('./lib/seo-pages');

const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');
const EM_DASH = '—';

function main() {
  const pages    = indexablePages();
  const failures = new Map();
  const notices  = [];
  const fail = (rule, page, detail = '') => {
    if (!failures.has(rule)) failures.set(rule, []);
    failures.get(rule).push(`${page.rel}${detail ? `  ${detail}` : ''}`);
  };
  const titles = new Map(), descs = new Map();

  for (const page of pages) {
    const { head } = page;

    const titleTags = head.match(/<title[^>]*>[\s\S]*?<\/title>/gi) || [];
    const title = titleTags.length ? text(titleTags[0].replace(/<\/?title[^>]*>/gi, '')) : '';
    if (titleTags.length !== 1) fail('exactly one <title>', page, `found ${titleTags.length}`);
    if (!title) fail('title is empty', page);
    else {
      if (title.length > 60) fail('title over 60 characters', page, `${title.length}: ${title}`);
      if (title.includes(EM_DASH)) fail('em dash in title', page, title);
      titles.set(title, [...(titles.get(title) || []), page.rel]);
    }

    const descTags = head.match(/<meta[^>]+name=["']description["'][^>]*>/gi) || [];
    const desc = descTags.length ? attr(descTags[0], 'content') || '' : '';
    if (descTags.length !== 1) fail('exactly one meta description', page, `found ${descTags.length}`);
    if (!desc) fail('meta description is empty', page);
    else {
      if (desc.length > 160) fail('meta description over 160 characters', page, `${desc.length}`);
      if (desc.includes(EM_DASH)) fail('em dash in meta description', page);
      descs.set(desc, [...(descs.get(desc) || []), page.rel]);
    }

    if (!page.canonical) fail('missing canonical', page);
    const ogUrl = (head.match(/<meta[^>]+property=["']og:url["'][^>]*>/i) || [])[0];
    if (!ogUrl) fail('missing og:url', page);
    else if (page.canonical && attr(ogUrl, 'content') !== page.canonical) {
      fail('og:url differs from canonical', page, `${attr(ogUrl, 'content')} vs ${page.canonical}`);
    }
    for (const prop of ['og:title', 'og:description', 'og:image']) {
      if (!new RegExp(`property=["']${prop}["']`, 'i').test(head)) fail(`missing ${prop}`, page);
    }

    const hs = headings(page.html);
    const h1s = hs.filter(h => h.level === 1);
    if (h1s.length !== 1) fail('exactly one h1', page, `found ${h1s.length}`);
    if (h1s.some(h => !h.text)) fail('h1 is empty', page);
    if (hs.length && hs[0].level !== 1) fail('first heading is not the h1', page, `h${hs[0].level} "${hs[0].text}"`);
    let prev = 0, seenH2 = false;
    for (const h of hs) {
      if (!h.text) fail(`empty h${h.level}`, page);
      if (h.level === 2) seenH2 = true;
      if (h.level === 3 && !seenH2) fail('h3 before any h2', page, `"${h.text}"`);
      if (prev && h.level > prev + 1) fail('heading level skipped', page, `h${prev} -> h${h.level} "${h.text}"`);
      if ((h.level <= 2) && h.text.includes(EM_DASH)) fail(`em dash in h${h.level}`, page, `"${h.text}"`);
      prev = h.level;
    }
  }

  for (const [t, rels] of titles) if (rels.length > 1) fail('duplicate title', { rel: rels[0] }, `${rels.length}x "${t}" (${rels.slice(1, 3).join(', ')})`);
  for (const [, rels] of descs) if (rels.length > 1) fail('duplicate meta description', { rel: rels[0] }, `${rels.length}x (${rels.slice(1, 3).join(', ')})`);

  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim()));
  const byUrl = new Map(pages.map(p => [p.url, p]));
  for (const page of pages) {
    if (locs.has(page.url)) continue;
    if (/^news\/[^/]+\/index\.html$/.test(page.rel)) notices.push(page.rel);
    else fail('indexable page missing from sitemap', page);
  }
  for (const loc of locs) {
    if (!byUrl.has(loc)) fail('sitemap URL is not an indexable page', { rel: loc });
  }

  console.log(`[seo] ${pages.length} indexable pages, ${locs.size} sitemap URLs`);
  if (notices.length) {
    console.log(`[seo] note: ${notices.length} article page(s) not in the sitemap (unpublished drafts are expected here): ${notices.join(', ')}`);
  }
  if (!failures.size) {
    console.log('[seo] ✓ titles, descriptions, h1s, heading order, canonicals and sitemap coverage all pass.');
    return;
  }
  let total = 0;
  for (const [rule, list] of failures) {
    total += list.length;
    console.error(`\n[seo] !! ${rule}: ${list.length}`);
    for (const line of (VERBOSE ? list : list.slice(0, 8))) console.error(`        ${line}`);
    if (!VERBOSE && list.length > 8) console.error(`        ...and ${list.length - 8} more (-v to list all)`);
  }
  console.error(`\n[seo] ${total} problem(s).`);
  process.exitCode = 1;
}

if (require.main === module) main();
