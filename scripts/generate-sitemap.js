#!/usr/bin/env node
/**
 * scripts/generate-sitemap.js
 *
 * Rebuilds sitemap.xml entirely from the filesystem — no appending,
 * no merging. Every URL reflects a real, non-empty file on disk.
 *
 * Usage:
 *   node scripts/generate-sitemap.js
 *   # or as a module:
 *   const { regenerateSitemap } = require('./generate-sitemap');
 *   await regenerateSitemap();
 *
 * Sections emitted (in order):
 *   1. Static pages   — hardcoded set, always present
 *   2. Scorecard issues — scorecard/{slug}/index.html
 *   3. Brand pages    — brands/{slug}/index.html
 *   4. News articles  — news/{slug}/index.html  (with image:image blocks)
 *   5. News pages     — news/page/{n}/index.html
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const SITE_ROOT = path.resolve(__dirname, '..');
const SITE_BASE = 'https://dormied.com';
const OUT_PATH  = path.join(SITE_ROOT, 'sitemap.xml');
const MIN_BYTES = 1000; // files smaller than this are stubs — skip them

// ── Helpers ───────────────────────────────────────────────────────────────────

function xmlEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function mtimeDate(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Extract <meta property="og:image" content="..."> from HTML */
function extractOgImage(html) {
  const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
  return m ? m[1] : null;
}

/** Extract <meta property="og:title" content="..."> from HTML */
function extractOgTitle(html) {
  const m = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i);
  return m ? m[1] : null;
}

/** Extract <meta property="article:published_time" content="..."> */
function extractPublishedDate(html) {
  const m = html.match(/<meta\s+property="article:published_time"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+content="([^"]+)"\s+property="article:published_time"/i);
  return m ? m[1].slice(0, 10) : null;
}

// lastmod should reflect the last MODIFIED date when the article carries one
// (e.g. a FAQ block was added post-publish); otherwise the published date.
function extractModifiedDate(html) {
  const m = html.match(/<meta\s+property="article:modified_time"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+content="([^"]+)"\s+property="article:modified_time"/i);
  return m ? m[1].slice(0, 10) : null;
}

/** Return true if an HTML file is NOT noindex (i.e. safe to include in sitemap). */
function isIndexable(filePath) {
  try {
    const html = fs.readFileSync(filePath, 'utf8');
    return !html.includes('content="noindex');
  } catch {
    return false;
  }
}

/**
 * Walk a directory one level deep, returning subdirectory names
 * whose index.html is >= MIN_BYTES. Skips the listing directories
 * (news/index.html, brands/index.html, etc.) — those are static pages.
 */
function walkSubdirs(section, excludePaths = []) {
  const base    = path.join(SITE_ROOT, section);
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (excludePaths.includes(ent.name)) continue;
    const indexPath = path.join(base, ent.name, 'index.html');
    try {
      const stat = fs.statSync(indexPath);
      if (stat.size >= MIN_BYTES) {
        results.push({ slug: ent.name, filePath: indexPath, mtime: stat.mtime });
      }
    } catch {
      // no index.html — skip
    }
  }
  // Stable sort by slug. Entries are grouped by type at assembly time, so this
  // makes the file order type-then-URL and fully deterministic.
  //
  // This was previously mtime-descending, which meant any rebuild reshuffled the
  // whole file: a one-line date change surfaced as ~1,800 lines of reordering
  // churn that hid the real edits. Ordering must never depend on the filesystem.
  results.sort((a, b) => a.slug.localeCompare(b.slug));
  return results;
}

// ── URL entry builders ────────────────────────────────────────────────────────

function staticEntry(loc, lastmod, changefreq, priority) {
  return [
    `  <url>`,
    `    <loc>${SITE_BASE}${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    `  </url>`,
  ].join('\n');
}

function pageEntry(section, slug, lastmod, changefreq, priority) {
  const loc = `${SITE_BASE}/${section}/${slug}/`;
  return [
    `  <url>`,
    `    <loc>${xmlEsc(loc)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    `  </url>`,
  ].join('\n');
}

function newsEntry(slug, lastmod, imageUrl, imageTitle) {
  const loc = `${SITE_BASE}/news/${slug}/`;
  const hasImage = imageUrl && !imageUrl.includes('og-image.jpg');
  const imageBlock = hasImage
    ? [
        `    <image:image>`,
        `      <image:loc>${xmlEsc(imageUrl)}</image:loc>`,
        `      <image:title>${xmlEsc(imageTitle || '')}</image:title>`,
        `    </image:image>`,
      ].join('\n')
    : null;

  const lines = [
    `  <url>`,
    `    <loc>${xmlEsc(loc)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>weekly</changefreq>`,
    `    <priority>0.7</priority>`,
  ];
  if (imageBlock) lines.push(imageBlock);
  lines.push(`  </url>`);
  return lines.join('\n');
}

// ── Main regeneration ─────────────────────────────────────────────────────────

function regenerateSitemap() {
  const today = new Date().toISOString().slice(0, 10);

  // ── 1. Static pages ────────────────────────────────────────────────────────
  // Hardcoded set — add a line here whenever a new top-level static page ships.
  const staticIndexLastmod = mtimeDate(path.join(SITE_ROOT, 'index.html'));
  const brandsIndexLastmod = mtimeDate(path.join(SITE_ROOT, 'brands',    'index.html'));
  const newsIndexLastmod   = mtimeDate(path.join(SITE_ROOT, 'news',      'index.html'));
  const scIndexLastmod     = mtimeDate(path.join(SITE_ROOT, 'scorecard', 'index.html'));
  const rankLastmod        = mtimeDate(path.join(SITE_ROOT, 'rankings',  'index.html'));
  const aboutLastmod       = mtimeDate(path.join(SITE_ROOT, 'about',     'index.html'));
  const contactLastmod     = mtimeDate(path.join(SITE_ROOT, 'contact',   'index.html'));
  const privacyLastmod     = mtimeDate(path.join(SITE_ROOT, 'privacy',   'index.html'));
  const termsLastmod       = mtimeDate(path.join(SITE_ROOT, 'terms',     'index.html'));

  const witbIndexLastmod   = mtimeDate(path.join(SITE_ROOT, 'witb', 'index.html'));
  const witbPlayersLastmod = mtimeDate(path.join(SITE_ROOT, 'witb', 'players', 'index.html'));

  const staticEntries = [
    `  <!-- ── Static pages ── -->`,
    staticEntry('/',               staticIndexLastmod, 'monthly', '1.0'),
    staticEntry('/rankings/',      rankLastmod,        'monthly', '0.9'),
    staticEntry('/witb/',          witbIndexLastmod,   'weekly',  '0.9'),
    staticEntry('/witb/players/',  witbPlayersLastmod, 'weekly',  '0.8'),
    staticEntry('/scorecard/',     scIndexLastmod,     'monthly', '0.9'),
    staticEntry('/news/',          newsIndexLastmod,   'daily',   '0.8'),
    staticEntry('/brands/',        brandsIndexLastmod, 'daily',   '0.8'),
    staticEntry('/about/',         aboutLastmod,       'monthly', '0.6'),
    staticEntry('/contact/',       contactLastmod,     'monthly', '0.6'),
    staticEntry('/privacy/',       privacyLastmod,     'monthly', '0.5'),
    staticEntry('/terms/',         termsLastmod,       'monthly', '0.5'),
  ];

  // ── 2. WITB player pages ─────────────────────────────────────────────────
  // Walk witb/players/* — include only indexable pages (not noindex).
  // lastmod uses file mtime, which equals the last time the bag was regenerated.
  const witbPlayerPages = walkSubdirs('witb/players', []);
  const witbPlayerEntries = witbPlayerPages.length
    ? [
        `\n  <!-- ── WITB player pages (${witbPlayerPages.length}) ── -->`,
        ...witbPlayerPages
          .filter(p => isIndexable(p.filePath))
          .map(p => {
            const lastmod = p.mtime.toISOString().slice(0, 10);
            const loc     = `${SITE_BASE}/witb/players/${xmlEsc(p.slug)}/`;
            return [
              `  <url>`,
              `    <loc>${loc}</loc>`,
              `    <lastmod>${lastmod}</lastmod>`,
              `    <changefreq>weekly</changefreq>`,
              `    <priority>0.7</priority>`,
              `  </url>`,
            ].join('\n');
          }),
      ]
    : [];

  // ── 3. Scorecard issues ────────────────────────────────────────────────────
  const scorecardPages = walkSubdirs('scorecard');
  const scorecardEntries = scorecardPages.length
    ? [
        `\n  <!-- ── Scorecard issues ── -->`,
        ...scorecardPages.map(p =>
          pageEntry('scorecard', p.slug, p.mtime.toISOString().slice(0, 10), 'monthly', '0.8')
        ),
      ]
    : [];

  // ── 3. Brand pages ────────────────────────────────────────────────────────
  const brandPages = walkSubdirs('brands');
  const brandEntries = brandPages.length
    ? [
        `\n  <!-- ── Brand pages (${brandPages.length}) ── -->`,
        ...brandPages.map(p =>
          pageEntry('brands', p.slug, p.mtime.toISOString().slice(0, 10), 'monthly', '0.8')
        ),
      ]
    : [];

  // ── 4. News articles (with image blocks) ──────────────────────────────────
  const newsPages = walkSubdirs('news', ['page']); // exclude news/page/
  const newsEntries = newsPages.length
    ? [
        `\n  <!-- ── News articles (${newsPages.length}) ── -->`,
        ...newsPages.map(p => {
          // Read the file to extract image metadata — worth the I/O for accurate image sitemaps
          let html = '';
          try { html = fs.readFileSync(p.filePath, 'utf8'); } catch { /* skip */ }
          const imageUrl   = extractOgImage(html);
          const imageTitle = extractOgTitle(html);
          const lastmod    = extractModifiedDate(html)
                          || extractPublishedDate(html)
                          || p.mtime.toISOString().slice(0, 10);
          return newsEntry(p.slug, lastmod, imageUrl, imageTitle);
        }),
      ]
    : [];

  // ── 5. News pagination pages ───────────────────────────────────────────────
  const newsPageDirs = walkSubdirs('news/page');
  const newsPagEntries = newsPageDirs.length
    ? [
        `\n  <!-- ── News pagination ── -->`,
        ...newsPageDirs.map(p =>
          // Pagination page URL is /news/page/N/
          [
            `  <url>`,
            `    <loc>${SITE_BASE}/news/page/${xmlEsc(p.slug)}/</loc>`,
            `    <lastmod>${p.mtime.toISOString().slice(0, 10)}</lastmod>`,
            `    <changefreq>weekly</changefreq>`,
            `    <priority>0.4</priority>`,
            `  </url>`,
          ].join('\n')
        ),
      ]
    : [];

  // ── Assemble ───────────────────────────────────────────────────────────────
  const allEntries = [
    ...staticEntries,
    ...witbPlayerEntries,
    ...scorecardEntries,
    ...brandEntries,
    ...newsEntries,
    ...newsPagEntries,
  ];

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"`,
    `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`,
    ``,
    allEntries.join('\n'),
    ``,
    `</urlset>`,
  ].join('\n');

  fs.writeFileSync(OUT_PATH, xml, 'utf8');

  const witbIndexableCount = witbPlayerPages.filter(p => isIndexable(p.filePath)).length;
  const total = staticEntries.filter(e => e.includes('<url>')).length + witbIndexableCount + scorecardPages.length + brandPages.length + newsPages.length + newsPageDirs.length;
  console.log(`[sitemap] ✓ Regenerated sitemap.xml — ${total} URLs (${newsPages.length} articles, ${brandPages.length} brands, ${witbIndexableCount} WITB players, ${scorecardPages.length} scorecard issues)`);
  return total;
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  try {
    regenerateSitemap();
  } catch (err) {
    console.error('[sitemap] Fatal error:', err.message);
    process.exit(1);
  }
}

module.exports = { regenerateSitemap };
