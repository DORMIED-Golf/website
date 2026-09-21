#!/usr/bin/env node
/**
 * DORMIED Content Pipeline — Search Index Generator
 *
 * Builds /search-index.json from the filesystem so the client-side search
 * bar always reflects the current deploy. No Supabase dependency — reads
 * brand data from js/data.js, articles from news/{slug}/index.html, and
 * scorecard issues from js/scorecard-data.js.
 *
 * Output: search-index.json at project root (served at /search-index.json)
 *
 * Usage:
 *   node scripts/generate-search-index.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SITE_ROOT = path.resolve(__dirname, '..');
const OUT_PATH  = path.join(SITE_ROOT, 'search-index.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadVmFile(filePath, windowKey) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return windowKey ? ctx.window[windowKey] : ctx.window;
}

/**
 * Decode HTML entities in text lifted out of a page. The search UI escapes what
 * it renders, so anything left encoded here shows literally: "Mason Mount&#39;s"
 * in the dropdown. Covers named, decimal and hex entities.
 */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", hellip: "\u2026", ndash: "\u2013", mdash: "\u2014" };
function decodeEntities(str) {
  return String(str || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in NAMED_ENTITIES ? NAMED_ENTITIES[n.toLowerCase()] : m));
}

/** Extract content of a meta tag attribute from raw HTML. */
function extractMeta(html, attr, attrVal, contentAttr) {
  contentAttr = contentAttr || 'content';
  const re = new RegExp(
    `<meta[^>]+${attr}="${attrVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]+${contentAttr}="([^"]*)"`,
    'i'
  );
  let m = html.match(re);
  if (m) return decodeEntities(m[1]);
  // Try reversed attribute order
  const re2 = new RegExp(
    `<meta[^>]+${contentAttr}="([^"]*)"[^>]+${attr}="${attrVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
    'i'
  );
  m = html.match(re2);
  return m ? decodeEntities(m[1]) : null;
}

/** Extract text content from first matching tag. */
function extractTag(html, tag, cls) {
  const clsPart = cls ? `[^>]+class="[^"]*${cls}[^"]*"` : '';
  const re = new RegExp(`<${tag}${clsPart}[^>]*>([^<]+)</${tag}>`, 'i');
  const m  = html.match(re);
  return m ? decodeEntities(m[1]).trim() : null;
}

function stripHtml(html) {
  return decodeEntities((html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Brand entries ──────────────────────────────────────────────────────────────

function buildBrandEntries(dormiedData) {
  const entries = [];
  for (const brand of dormiedData.brands || []) {
    const searchText = [
      brand.name,
      brand.id,
      brand.category,
      brand.sub_category,
      brand.parentCompany,
      brand.headquarters,
      (brand.description || '').slice(0, 200),
    ].filter(Boolean).join(' ').toLowerCase();

    entries.push({
      type:        'brand',
      slug:        brand.id,
      title:       brand.name,
      subtitle:    [brand.category, brand.sub_category].filter(Boolean).join(' / '),
      url:         `/brands/${brand.id}/`,
      thumbnail:   brand.logo || null,
      search_text: searchText,
    });
  }
  return entries;
}

// ── News article entries ───────────────────────────────────────────────────────

function buildNewsEntries() {
  const newsDir  = path.join(SITE_ROOT, 'news');
  const entries  = [];

  // Skip pagination dirs (page/2, page/3, …) and index.html
  const slugs = fs.readdirSync(newsDir).filter(name => {
    if (name === 'index.html') return false;
    const full = path.join(newsDir, name);
    return fs.statSync(full).isDirectory() && name !== 'page';
  });

  for (const slug of slugs) {
    const htmlPath = path.join(newsDir, slug, 'index.html');
    if (!fs.existsSync(htmlPath)) continue;

    const html = fs.readFileSync(htmlPath, 'utf8');

    // Title: from <h1 class="sc-article-title">
    const title = extractTag(html, 'h1', 'sc-article-title') ||
      extractMeta(html, 'property', 'og:title');
    if (!title) continue;

    // Byline: "By Adam · May 7, 2026" — extract author and date
    const bylineEl  = html.match(/<p[^>]+sc-article-byline[^>]*>([\s\S]*?)<\/p>/i);
    const bylineRaw = bylineEl ? stripHtml(bylineEl[1]) : '';
    // Parse date from <time datetime="...">
    const timem = html.match(/<time[^>]+datetime="([^"]+)"[^>]*>([^<]+)<\/time>/i);
    const dateStr   = timem ? timem[2].trim() : '';
    // Desk names carry a surname initial ("Adam R."). Capturing only the first
    // word silently reverted every search result to the pre-rename byline.
    const authorM   = bylineRaw.match(/By\s+([A-Za-z]+(?:\s+[A-Z]\.)?)/);
    const author    = authorM ? authorM[1] : 'DORMIED';
    const subtitle  = dateStr ? `By ${author} · ${dateStr}` : `By ${author}`;

    // Thumbnail: og:image
    const thumbnail = extractMeta(html, 'property', 'og:image');

    // Search text: title + meta description + keywords + brand slug + author
    const metaDesc  = extractMeta(html, 'name', 'description') || '';
    const keywords  = extractMeta(html, 'name', 'keywords') || '';
    const brandSlugM = html.match(/window\.__DA_BRAND_SLUG__='([^']+)'/);
    const brandSlug = brandSlugM ? brandSlugM[1] : '';

    const searchText = [title, metaDesc, keywords, brandSlug, author].join(' ').toLowerCase();

    entries.push({
      type:        'news',
      slug,
      title,
      subtitle,
      url:         `/news/${slug}/`,
      thumbnail:   thumbnail || null,
      search_text: searchText,
    });
  }

  return entries;
}

// ── Scorecard entries ──────────────────────────────────────────────────────────

function buildScorecardEntries(scorecardData) {
  const entries = [];
  for (const issue of scorecardData.issues || []) {
    // Thumbnail: first strip image, or hero image
    const strip = issue.images && issue.images.strip;
    const hero  = issue.images && issue.images.hero;
    const thumbnail = (strip && strip[0] && strip[0].src) || hero || null;

    // Intro text for search
    const intro = (issue.sections || []).find(s => s.id === 'intro');
    const introText = intro ? stripHtml(intro.body || '').slice(0, 300) : '';

    const searchText = [
      issue.title,
      issue.monthLabel || '',
      (issue.brandMentions || []).join(' '),
      introText,
      issue.subtitle || '',
    ].filter(Boolean).join(' ').toLowerCase();

    entries.push({
      type:        'scorecard',
      slug:        issue.slug,
      title:       issue.title,
      subtitle:    issue.date || '',
      url:         `/scorecard/${issue.slug}/`,
      thumbnail:   thumbnail || null,
      search_text: searchText,
    });
  }
  return entries;
}

// ── WITB player entries ────────────────────────────────────────────────────────

function buildWitbPlayerEntries() {
  const playersDir = path.join(SITE_ROOT, 'witb', 'players');
  const entries    = [];

  let slugs;
  try {
    slugs = fs.readdirSync(playersDir).filter(name => {
      // Skip index.html and non-directories
      if (name === 'index.html') return false;
      const full = path.join(playersDir, name);
      return fs.statSync(full).isDirectory();
    });
  } catch (e) {
    return entries;
  }

  /* Headshots are read from each player's own page, below, rather than from
     js/witb-leaders.js. That file only carries the RANKED players the leaders
     chart plots -- 233 of 277 -- so every unranked player came out of here
     with a null thumbnail and rendered the club icon even when a perfectly
     good headshot existed. The page is also the authoritative record of which
     thumbnail was actually baked for that player, so this cannot drift from
     what the page itself serves, and reading it keeps the script offline and
     secret-free. Players with no headshot at all still fall back to the icon. */

  for (const slug of slugs) {
    const htmlPath = path.join(playersDir, slug, 'index.html');
    if (!fs.existsSync(htmlPath)) continue;

    const html = fs.readFileSync(htmlPath, 'utf8');

    // Player name from <h1 class="witb-player-title">
    const nameM = html.match(/<h1[^>]+witb-player-title[^>]*>([^<]+)<\/h1>/i);
    if (!nameM) continue;
    const name = nameM[1].trim();

    // Meta description for search text
    const metaDesc = extractMeta(html, 'name', 'description') || '';

    // OWGR rank from the rank element ("#N" for ranked, "Unranked" otherwise).
    // Unranked players that have a page (recent bag or allowlist — see
    // witb-page-eligibility.js) are included so they are searchable; the page
    // only exists at all if the player was deemed eligible.
    const rankM = html.match(/<span class="witb-rank-num">(#[\d]+|Unranked)<\/span>/i);
    const rank  = rankM ? rankM[1] : '';

    // Current bag date from the snapshots sub-heading "N snapshots tracked, YYYY[-YYYY]"
    const subM  = html.match(/class="witb-section-sub">([^<]*snapshots[^<]*)<\/p>/i);
    const subStr = subM ? subM[1].trim() : '';

    // Subtitle: "OWGR #N · bag date"
    const subtitle = [rank, subStr].filter(Boolean).join(' · ');

    // The hero <img class="witb-player-face"> is baked at 200px; the search
    // dropdown draws it at 28px, so ask for the 80px file from the same set.
    const faceM = html.match(/<img[^>]+class="witb-player-face"[^>]+src="([^"]+)"/i);
    const headshot = faceM ? faceM[1].replace(/-\d+\.webp$/, '-80.webp') : null;

    const searchText = [name, metaDesc].join(' ').toLowerCase();

    entries.push({
      type:        'witb-player',
      slug,
      title:       name,
      subtitle,
      url:         `/witb/players/${slug}/`,
      thumbnail:   headshot,
      search_text: searchText,
    });
  }

  return entries;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function generateSearchIndex() {
  console.log('[search-index] Building search index…');

  // 1. Brands
  const dormiedData = loadVmFile(path.join(SITE_ROOT, 'js/data.js'));
  const DORMIED_DATA = dormiedData.DORMIED_DATA;
  const brandEntries = buildBrandEntries(DORMIED_DATA);
  console.log(`[search-index]   Brands: ${brandEntries.length}`);

  // 2. News articles
  const newsEntries = buildNewsEntries();
  console.log(`[search-index]   News:   ${newsEntries.length}`);

  // 3. Scorecard issues
  const scorecardWin = loadVmFile(path.join(SITE_ROOT, 'js/scorecard-data.js'));
  const scorecardData = scorecardWin.DORMIED_SCORECARD_DATA;
  const scorecardEntries = buildScorecardEntries(scorecardData || { issues: [] });
  console.log(`[search-index]   Scorecard: ${scorecardEntries.length}`);

  // 4. WITB players
  const witbEntries = buildWitbPlayerEntries();
  console.log(`[search-index]   WITB players: ${witbEntries.length}`);

  const output = {
    generated_at: new Date().toISOString(),
    version:      1,
    entries:      [...brandEntries, ...witbEntries, ...newsEntries, ...scorecardEntries],
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output), 'utf8');
  console.log(`[search-index] ✓ Wrote ${output.entries.length} entries → search-index.json`);
  return output.entries.length;
}

// Allow require() from other scripts (e.g. generate-article.js)
module.exports = { generateSearchIndex };

// Run directly
if (require.main === module) {
  try {
    generateSearchIndex();
  } catch (err) {
    console.error('[search-index] Fatal:', err.message);
    process.exit(1);
  }
}
