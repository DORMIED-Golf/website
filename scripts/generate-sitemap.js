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

// Content dates come from Supabase (see the resolver below), so the standalone
// CLI needs credentials. Callers that already loaded .env are unaffected.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

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

/**
 * Decode HTML entities. Meta attribute values are already HTML-escaped, so a
 * raw regex capture must be decoded before xmlEsc() re-escapes it — otherwise
 * "Pins &amp; Aces" ships as "Pins &amp;amp; Aces". &amp; is decoded last so
 * an encoded "&amp;lt;" survives as the literal text "&lt;".
 */
function htmlDecode(str) {
  return String(str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Extract <meta property="og:image" content="..."> from HTML */
function extractOgImage(html) {
  const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
  return m ? htmlDecode(m[1]) : null;
}

/** Extract <meta property="og:title" content="..."> from HTML */
function extractOgTitle(html) {
  const m = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i);
  return m ? htmlDecode(m[1]) : null;
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
        // NB: no mtime captured — lastmod comes from content sources, never the filesystem.
        results.push({ slug: ent.name, filePath: indexPath });
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

// ── Content-date sources ──────────────────────────────────────────────────────
/**
 * lastmod must reflect genuine content change, and NOTHING here may fall back to
 * file mtime or now(). On a fresh CI clone every file's mtime is the clone time,
 * so an mtime-derived lastmod stamps the build date on every URL — systematic
 * fake freshness, which is what this resolver exists to remove.
 *
 * If a source is unreachable or a URL resolves to no date, we throw. The caller
 * exits non-zero and NO sitemap is written. A sitemap that fails to build is a
 * visible problem; one that quietly rebuilds itself with fabricated dates is not.
 */
function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY required to resolve sitemap content dates (no mtime fallback exists)');
  }
  const { createClient } = require('@supabase/supabase-js');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

const isoDay = v => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * Brand pages: the refreshed_at of that brand's MOST RECENT snapshot_month row.
 *
 * Deliberately NOT max(refreshed_at) across all of a brand's rows. Both return
 * the same value while the table is rebuilt wholesale, but they diverge on a
 * scoped historical correction: `refresh-brand-summary.js --month=2026-01-01`
 * rewrites only that month, so max() across all rows would bump brand lastmod
 * for a change to an old month that alters nothing on the live page. Keying on
 * the latest snapshot_month row ignores it. That property is load-bearing.
 */
async function fetchBrandDates(sb) {
  const byBrand = new Map();          // slug -> { month, refreshed_at }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('dormied_monthly_brand_summary')
      .select('brand_slug, snapshot_month, refreshed_at')
      .range(from, from + 999);
    if (error) throw new Error(`brand summary fetch failed: ${error.message}`);
    if (!data || !data.length) break;
    for (const r of data) {
      const cur = byBrand.get(r.brand_slug);
      if (!cur || r.snapshot_month > cur.month) {
        byBrand.set(r.brand_slug, { month: r.snapshot_month, refreshed_at: r.refreshed_at });
      }
    }
    if (data.length < 1000) break;
  }
  const out = new Map();
  for (const [slug, v] of byBrand) {
    const d = isoDay(v.refreshed_at);
    if (d) out.set(slug, d);
  }
  return out;
}

/** WITB players: the bag_date of the player's CURRENT bag (real equipment change). */
async function fetchWitbDates(sb) {
  const { data: players, error: pErr } = await sb
    .from('witb_players').select('slug, current_bag_id').not('current_bag_id', 'is', null);
  if (pErr) throw new Error(`witb_players fetch failed: ${pErr.message}`);
  const bagIds = [...new Set((players || []).map(p => p.current_bag_id))];
  const bagDate = new Map();
  for (let i = 0; i < bagIds.length; i += 500) {
    const { data, error } = await sb.from('witb_bags').select('id, bag_date').in('id', bagIds.slice(i, i + 500));
    if (error) throw new Error(`witb_bags fetch failed: ${error.message}`);
    (data || []).forEach(b => bagDate.set(b.id, isoDay(b.bag_date)));
  }
  const out = new Map();
  for (const p of players || []) {
    const d = bagDate.get(p.current_bag_id);
    if (d) out.set(p.slug, d);
  }
  return out;
}

/** News articles/hub/pagination: published_at, newest first. */
async function fetchArticleDates(sb) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('dormied_articles').select('slug, published_at')
      .eq('status', 'published').order('published_at', { ascending: false }).range(from, from + 999);
    if (error) throw new Error(`dormied_articles fetch failed: ${error.message}`);
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows.map(r => ({ slug: r.slug, date: isoDay(r.published_at) })).filter(r => r.date);
}

/** Scorecard issues: dateISO from js/scorecard-data.js (no Supabase table exists). */
function fetchScorecardDates() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SITE_ROOT, 'js', 'scorecard-data.js'), 'utf8'), ctx);
  const issues = (ctx.window.DORMIED_SCORECARD_DATA || {}).issues || [];
  const out = new Map();
  for (const i of issues) {
    const d = isoDay(i.dateISO);
    if (d) out.set(i.slug, d);
  }
  return out;
}

/**
 * Permanently redirected paths, read from vercel.json.
 *
 * A URL that 301/308s must never appear in the sitemap. Legacy misspelling stubs
 * (e.g. /brands/travismatthew/ -> /brands/travismathew/) are small files that can
 * clear the MIN_BYTES filter, and under the old mtime scheme they silently got a
 * date and shipped. The content-date resolver has no date for them, which is how
 * this was found.
 */
function loadRedirectSources() {
  const out = new Set();
  try {
    const v = JSON.parse(fs.readFileSync(path.join(SITE_ROOT, 'vercel.json'), 'utf8'));
    for (const r of v.redirects || []) {
      if (!r.source) continue;
      // Form-agnostic on purpose: Vercel expresses permanence as `permanent: true`
      // OR as `statusCode: 301|308`, and all 46 current entries use the former.
      // We exclude EVERY redirect source, permanent or not — a URL that redirects
      // at all should never be advertised in a sitemap — so a future 302/307 or a
      // statusCode-style entry is handled without touching this code.
      out.add(r.source.replace(/\/$/, ''));       // normalise trailing slash
    }
  } catch { /* no vercel.json — nothing to exclude */ }
  return out;
}

/** Static pages: committed manifest (see data/sitemap-static-dates.json). */
function loadStaticDates() {
  const p = path.join(SITE_ROOT, 'data', 'sitemap-static-dates.json');
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  const out = new Map(Object.entries(json.pages || {}));
  if (!out.size) throw new Error('sitemap-static-dates.json has no pages');
  return out;
}

// ── Main regeneration ─────────────────────────────────────────────────────────

async function regenerateSitemap() {
  // Resolve every content date up front. Any failure throws before a single byte
  // of sitemap.xml is written.
  const sb            = getSupabase();
  const brandDates    = await fetchBrandDates(sb);
  const witbDates     = await fetchWitbDates(sb);
  const articleDates  = await fetchArticleDates(sb);
  const scorecardDates= fetchScorecardDates();
  const staticDates   = loadStaticDates();
  const redirected    = loadRedirectSources();
  const notRedirected = (section) => (p) => !redirected.has(`/${section}/${p.slug}`);
  const articleBySlug = new Map(articleDates.map(a => [a.slug, a.date]));
  const newestArticle = articleDates.length ? articleDates[0].date : null;
  const newestBagDate = [...witbDates.values()].sort().pop() || null;
  if (!newestArticle) throw new Error('no published articles — cannot date the news hub');
  if (!newestBagDate) throw new Error('no current WITB bags — cannot date the WITB hub');

  // Fail loudly rather than fabricating a date for any URL.
  const need = (map, key, what) => {
    const v = map.get(key);
    if (!v) throw new Error(`no content date for ${what} "${key}" — refusing to fabricate a lastmod`);
    return v;
  };

  // News pagination: the newest article listed on that page. articleDates is
  // sorted newest-first and pages hold 25 each, matching generate-index-pages.
  const PER_PAGE = 25;
  const pageLastmod = (n) => {
    const idx = (parseInt(n, 10) - 1) * PER_PAGE;
    const a = articleDates[idx] || articleDates[articleDates.length - 1];
    if (!a) throw new Error(`no content date for news page "${n}" — refusing to fabricate a lastmod`);
    return a.date;
  };

  // ── 1. Static pages ────────────────────────────────────────────────────────
  // Hardcoded set — add a line here whenever a new top-level static page ships.
  // Hand-authored static pages come from the committed manifest; hubs derive from
  // the newest item they list. Never mtime.
  const staticIndexLastmod = need(staticDates, '/',           'static page');
  const brandsIndexLastmod = need(staticDates, '/brands/',    'static page');
  const scIndexLastmod     = need(staticDates, '/scorecard/', 'static page');
  const rankLastmod        = need(staticDates, '/rankings/',  'static page');
  const aboutLastmod       = need(staticDates, '/about/',     'static page');
  const contactLastmod     = need(staticDates, '/contact/',   'static page');
  const privacyLastmod     = need(staticDates, '/privacy/',   'static page');
  const termsLastmod       = need(staticDates, '/terms/',     'static page');

  const newsIndexLastmod   = newestArticle;   // news hub = newest published article
  const witbIndexLastmod   = newestBagDate;   // WITB hub = most recent current-bag date
  const witbPlayersLastmod = newestBagDate;

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
  // lastmod = the player's CURRENT bag_date (real equipment change), never mtime.
  const witbPlayerPages = walkSubdirs('witb/players', []).filter(notRedirected('witb/players'));
  const witbPlayerEntries = witbPlayerPages.length
    ? [
        `\n  <!-- ── WITB player pages (${witbPlayerPages.length}) ── -->`,
        ...witbPlayerPages
          .filter(p => isIndexable(p.filePath))
          .map(p => {
            const lastmod = need(witbDates, p.slug, 'WITB player');
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
  // Only real issues, which are always {month}-{year}. /scorecard/subscribed/ is
  // the no-JS signup confirmation page: it is noindex and has no content date,
  // so it must not be enumerated as an issue (doing so aborted the whole sitemap
  // rather than fabricating a lastmod, which is the correct refusal).
  const ISSUE_SLUG = /^[a-z]+-\d{4}$/;
  const scorecardPages = walkSubdirs('scorecard')
    .filter(notRedirected('scorecard'))
    .filter(p => ISSUE_SLUG.test(p.slug));
  const scorecardEntries = scorecardPages.length
    ? [
        `\n  <!-- ── Scorecard issues ── -->`,
        ...scorecardPages.map(p =>
          pageEntry('scorecard', p.slug, need(scorecardDates, p.slug, 'scorecard issue'), 'monthly', '0.8')
        ),
      ]
    : [];

  // ── 3. Brand pages ────────────────────────────────────────────────────────
  const brandPages = walkSubdirs('brands').filter(notRedirected('brands'));
  const brandEntries = brandPages.length
    ? [
        `\n  <!-- ── Brand pages (${brandPages.length}) ── -->`,
        ...brandPages.map(p =>
          pageEntry('brands', p.slug, need(brandDates, p.slug, 'brand page'), 'monthly', '0.8')
        ),
      ]
    : [];

  // ── 4. News articles (with image blocks) ──────────────────────────────────
  const newsPages = walkSubdirs('news', ['page']).filter(notRedirected('news')); // exclude news/page/ + redirects
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
                          || articleBySlug.get(p.slug);
          if (!lastmod) throw new Error(`no content date for news article "${p.slug}" — refusing to fabricate a lastmod`);
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
            `    <lastmod>${pageLastmod(p.slug)}</lastmod>`,
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
  regenerateSitemap().catch(err => {
    // No sitemap is written on failure — see the content-date resolver notes.
    console.error('[sitemap] Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { regenerateSitemap };
