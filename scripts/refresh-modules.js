#!/usr/bin/env node
/**
 * scripts/refresh-modules.js
 *
 * Refreshes ONLY the baked LATEST / Top Stories / Featured / sidebar-modules
 * regions across every built HTML page, using the one shared feed source
 * (feed-bake.js). This keeps the baked/static, crawlable, zero-CLS modules
 * CURRENT after any publish without re-rendering page bodies.
 *
 * What it touches (and NOTHING else):
 *   - PRERENDER markers on shell pages: home-stories, home-stories-mobile,
 *     dormied-latest, featured
 *   - sidebar-mods:start..end (Brands on the Move / Recently Updated Bags)
 *   - inline id lists on baked pages: #dormied-latest-list (limit 5, excludes
 *     the page's own article), #home-stories-list (limit 10), #featured-list
 *   - the no-id sf-mobile Latest duplicate in the tail of baked pages
 *
 * It never edits article body prose, figures, headings, titles, or any
 * dateModified / published_at field. A stale-sidebar refresh is not a content
 * change, so page freshness signals are left exactly as they were.
 *
 * Usage:
 *   node scripts/refresh-modules.js            # refresh every page
 *   node scripts/refresh-modules.js --dry-run  # report what would change
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { createClient } = require('@supabase/supabase-js');
const feedBake = require('./feed-bake');
// Homepage LATEST is a hero-first variant (renderHomeLatestHtml), NOT the generic
// uniform list. Reuse the same render + preload-link the home prerender bakes so
// the refresh pass produces byte-identical hero-first homepage output.
const { generatePreloadLink } = require('./generate-home-prerender');

const ROOT    = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

function loadData() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'), ctx);
  return ctx.window.DORMIED_DATA;
}

// Balanced replacement of the inner HTML of `<div id="ID" ...>…</div>`.
// Card markup contains nested <div>s, so we count depth rather than regex-match.
function replaceDivInnerById(html, id, newInner) {
  const openRe = new RegExp('<div id="' + id + '"[^>]*>');
  const m = openRe.exec(html);
  if (!m) return html;
  let i = m.index + m[0].length;
  let depth = 1;
  const tok = /<div\b|<\/div>/g;
  tok.lastIndex = i;
  let t;
  while ((t = tok.exec(html)) !== null) {
    depth += t[0] === '</div>' ? -1 : 1;
    if (depth === 0) {
      return html.slice(0, m.index + m[0].length) + newInner + html.slice(t.index);
    }
  }
  return html;
}

// Replace content between literal start/end comment markers (function
// replacement so any '$' in the baked content is inserted literally).
function replaceBetween(html, start, end, content) {
  const idx = html.indexOf(start);
  if (idx === -1) return html;
  const from = idx + start.length;
  const to = html.indexOf(end, from);
  if (to === -1) return html;
  return html.slice(0, from) + content + html.slice(to);
}

// Replace the WHOLE region from the first start marker to the last end marker
// (inclusive) with `content`. Used when `content` already carries its own
// start/end markers (fetchSidebarModulesHtml does), so we must not nest them.
// Anchoring on first-start..last-end also self-heals any previously accumulated
// duplicate markers, collapsing them back to one clean block.
function replaceRegionInclusive(html, start, end, content) {
  const from = html.indexOf(start);
  if (from === -1) return html;
  const lastEnd = html.lastIndexOf(end);
  if (lastEnd === -1 || lastEnd < from) return html;
  return html.slice(0, from) + content + html.slice(lastEnd + end.length);
}

// Replace the inner of the first no-id `<div class="latest-feed-list">` that
// follows a section carrying the given aria-labelledby. Covers the no-id lists:
// the sf-mobile Latest duplicate in baked-page tails ({x}-latest-m-heading) and
// the scorecard-issue Latest / Top Stories lists (sc-issue-*-heading).
function replaceListByAria(html, ariaRe, newInner) {
  const a = ariaRe.exec(html);
  if (!a) return html;
  const listRe = /<div class="latest-feed-list">/g;
  listRe.lastIndex = a.index;
  const l = listRe.exec(html);
  if (!l) return html;
  let depth = 1;
  const tok = /<div\b|<\/div>/g;
  tok.lastIndex = l.index + l[0].length;
  let t;
  while ((t = tok.exec(html)) !== null) {
    depth += t[0] === '</div>' ? -1 : 1;
    if (depth === 0) {
      return html.slice(0, l.index + l[0].length) + newInner + html.slice(t.index);
    }
  }
  return html;
}

// Every built HTML file that can carry a module. Excludes build tooling.
function collectHtml() {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === '.claude' || name === '.vercel') continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.html')) out.push(p);
    }
  })(ROOT);
  return out;
}

// The article/feature slug a page should exclude from its own Latest list.
function ownSlug(relPath) {
  const m = relPath.match(/^news\/([^/]+)\/index\.html$/);
  return m ? m[1] : null;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[refresh-modules] Missing Supabase env; aborting.');
    process.exit(1);
  }
  const data = loadData();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // One fetch of the shared feed source; render everything from it.
  const [latestPool, topPool, featuredPool, modsHtml] = await Promise.all([
    feedBake.fetchLatestArticles(sb, 13, null),          // pool to slice + exclude
    feedBake.fetchTopStoriesArticles(sb, data, 10),
    feedBake.fetchFeaturedArticles(sb, 10),
    feedBake.fetchSidebarModulesHtml(sb, data),
  ]);

  const render = (arr) => (arr && arr.length) ? feedBake.renderLatestFeedHtml(arr, data) : '';
  const latestN = (limit, exclude) =>
    render(latestPool.filter(a => !exclude || a.slug !== exclude).slice(0, limit));

  // Marker content (shell pages) mirrors generate-index-pages injectPageFeeds.
  const markerStories   = render(topPool.slice(0, 5));
  const markerLatest    = render(latestPool.slice(0, 10));   // scorecard-issue Latest (uniform)
  const markerFeatured  = render(featuredPool.slice(0, 10));

  // Homepage LATEST is hero-first (hero + up to 5 supporting cards), matching
  // generate-home-prerender exactly, plus the paired LCP <link rel=preload>.
  const homeLatest   = (latestPool.length) ? feedBake.renderHomeLatestHtml(latestPool.slice(0, 6), data) : '';
  const heroPreload  = (latestPool.length) ? generatePreloadLink(latestPool[0]) : '';

  // Inline id-list content (baked pages).
  const topStories10 = render(topPool.slice(0, 10));
  const featuredAll  = render(featuredPool.slice(0, 10));

  const files = collectHtml();
  let changed = 0, scanned = 0;

  for (const abs of files) {
    scanned++;
    const rel = path.relative(ROOT, abs);
    let html = fs.readFileSync(abs, 'utf8');
    const before = html;
    const exclude = ownSlug(rel);
    const latest5 = latestN(5, exclude); // sidebar + mobile-dup Latest

    // (A) PRERENDER markers — shell pages
    if (markerStories)  { html = replaceBetween(html, '<!-- PRERENDER-START:home-stories -->',        '<!-- PRERENDER-END:home-stories -->',        markerStories); }
    if (markerStories)  { html = replaceBetween(html, '<!-- PRERENDER-START:home-stories-mobile -->', '<!-- PRERENDER-END:home-stories-mobile -->', markerStories); }
    // dormied-latest is the homepage's hero-first LATEST (+ its LCP preload).
    if (homeLatest)     { html = replaceBetween(html, '<!-- PRERENDER-START:dormied-latest -->',      '<!-- PRERENDER-END:dormied-latest -->',      homeLatest); }
    if (heroPreload)    { html = replaceBetween(html, '<!-- PRERENDER-START:hero-preload -->',        '<!-- PRERENDER-END:hero-preload -->',        heroPreload); }
    if (markerFeatured) { html = replaceBetween(html, '<!-- PRERENDER-START:featured -->',            '<!-- PRERENDER-END:featured -->',            markerFeatured); }

    // (B) sidebar modules — modsHtml already includes its start/end markers, so
    // replace the whole region (also self-heals any duplicated markers).
    if (modsHtml && html.includes('<!-- sidebar-mods:start -->')) {
      html = replaceRegionInclusive(html, '<!-- sidebar-mods:start -->', '<!-- sidebar-mods:end -->', modsHtml);
    }

    // (C) inline id lists — baked pages
    if (latest5 && html.includes('id="dormied-latest-list"')) html = replaceDivInnerById(html, 'dormied-latest-list', latest5);
    if (topStories10 && html.includes('id="home-stories-list"')) html = replaceDivInnerById(html, 'home-stories-list', topStories10);
    if (featuredAll && html.includes('id="featured-list"'))    html = replaceDivInnerById(html, 'featured-list', featuredAll);

    // (D) no-id sf-mobile Latest duplicate — baked-page tails
    if (latest5 && /aria-labelledby="[a-z-]*latest-m-heading"/.test(html)) {
      html = replaceListByAria(html, /aria-labelledby="[a-z-]*latest-m-heading"/, latest5);
    }

    // (E) scorecard-issue no-id lists (Latest 10, Top Stories 5)
    if (markerLatest && html.includes('aria-labelledby="sc-issue-latest-heading"')) {
      html = replaceListByAria(html, /aria-labelledby="sc-issue-latest-heading"/, markerLatest);
    }
    if (markerStories && html.includes('aria-labelledby="sc-issue-stories-heading"')) {
      html = replaceListByAria(html, /aria-labelledby="sc-issue-stories-heading"/, markerStories);
    }

    if (html !== before) {
      changed++;
      if (!DRY_RUN) fs.writeFileSync(abs, html, 'utf8');
    }
  }

  console.log(`[refresh-modules] ${DRY_RUN ? 'would refresh' : 'refreshed'} ${changed} of ${scanned} pages`);
  console.log(`[refresh-modules] feed: latest=${latestPool.length} topStories=${topPool.length} featured=${featuredPool.length} mods=${modsHtml ? 'yes' : 'no'}`);
}

main().catch(e => { console.error('[refresh-modules] Fatal:', e.message); process.exit(1); });
