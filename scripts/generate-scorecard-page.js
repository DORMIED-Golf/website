#!/usr/bin/env node
/**
 * DORMIED Content Pipeline — Scorecard Page Generator
 *
 * Produces one fully-rendered static HTML file per scorecard issue at
 * scorecard/[slug]/index.html. All issue content is visible text in the
 * file — no fetch(), no document.write(), no client-side content injection.
 *
 * Usage:
 *   node scripts/generate-scorecard-page.js              # smart: skip up-to-date files
 *   node scripts/generate-scorecard-page.js --force      # regenerate all issues
 *   node scripts/generate-scorecard-page.js --slug=april-2026  # one issue only
 *
 * Required env vars (for consistency with pipeline; not strictly used here):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs               = require('fs');
const path             = require('path');
const vm               = require('vm');
const { createClient } = require('@supabase/supabase-js');

// Supabase client — initialized for pipeline consistency even though scorecard
// content comes entirely from js/scorecard-data.js (no DB reads needed here).
function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

const SITE_ROOT = path.resolve(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate.length === 10 ? isoDate + 'T12:00:00Z' : isoDate);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

// ── Data loaders ──────────────────────────────────────────────────────────────

function loadScorecardData() {
  const raw = fs.readFileSync(path.join(SITE_ROOT, 'js/scorecard-data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return ctx.window.DORMIED_SCORECARD_DATA;
}

function loadDormiedData() {
  const raw = fs.readFileSync(path.join(SITE_ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return ctx.window.DORMIED_DATA;
}

// ── Brand name map ────────────────────────────────────────────────────────────

/** Returns { slug -> name } for every brand in DORMIED_DATA */
function buildBrandNameMap(dormiedData) {
  const map = {};
  for (const b of (dormiedData.brands || [])) {
    if (b.id && b.name) map[b.id] = b.name;
  }
  return map;
}

// ── Brand auto-linker ─────────────────────────────────────────────────────────

/**
 * In a section's body HTML, wrap the FIRST occurrence of each brand name
 * in an anchor tag pointing to /brands/[slug]/. Subsequent occurrences in
 * the same section stay plain text. Existing <a> tags are not re-linked.
 *
 * Brands are sorted longest-first so "TaylorMade Golf" matches before "TaylorMade".
 */
function autoLinkBrandsInSection(html, brandMentions, brandNameMap) {
  const toLink = (brandMentions || [])
    .map(slug => ({ slug, name: brandNameMap[slug] }))
    .filter(b => b.name)
    .sort((a, b) => b.name.length - a.name.length);

  if (toLink.length === 0) return html;

  const linked = new Set();

  // Process tokens: existing <a>…</a> blocks pass through unchanged;
  // other tags pass through unchanged; text nodes are processed.
  return html.replace(
    /(<a[\s>][\s\S]*?<\/a>)|(<[^>]+>)|([^<]+)/g,
    (match, anchor, tag, text) => {
      if (anchor) return anchor; // Already linked — leave it
      if (tag)    return tag;    // HTML tag — pass through
      if (!text)  return match;

      let result = text;
      for (const { slug, name } of toLink) {
        if (linked.has(slug)) continue;
        const re = new RegExp(escapeRegex(name), 'i');
        if (re.test(result)) {
          // Replace only the first match, then mark as linked
          result = result.replace(re, () => {
            linked.add(slug);
            return `<a href="/brands/${slug}/">${name}</a>`;
          });
        }
      }
      return result;
    }
  );
}

// ── Meta description ──────────────────────────────────────────────────────────

function buildMetaDesc(issue) {
  // Use the intro section body, stripped of HTML
  const intro = (issue.sections || []).find(s => s.id === 'intro');
  const raw   = intro ? stripHtml(intro.body || '') : '';
  const base  = raw || stripHtml(issue.subtitle || '') || `${issue.title} from DORMIED.`;
  if (base.length <= 157) return base;
  const cut       = base.slice(0, 157);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

// ── Image HTML ────────────────────────────────────────────────────────────────

function buildImageHtml(issue) {
  if (!issue.images) return '';
  const strip = issue.images.strip || [];
  const hero  = issue.images.hero;

  if (strip.length > 0) {
    const items = strip.map(img =>
      `<div class="sc-strip-item">` +
        `<img class="sc-strip-img" src="${escHtml(img.src)}" alt="${escHtml(img.label || '')}" loading="lazy">` +
        (img.label ? `<span class="sc-strip-label">${escHtml(img.label)}</span>` : '') +
      `</div>`
    ).join('');
    return `<div class="sc-image-strip">${items}</div>`;
  }

  if (hero) {
    return `<img class="sc-hero-img" src="${escHtml(hero)}" alt="${escHtml(issue.title)}" loading="lazy">`;
  }

  return '';
}

// ── Table of contents ─────────────────────────────────────────────────────────

function buildTocHtml(issue) {
  const toc = issue.toc || [];
  if (toc.length === 0) return '';
  const items = toc.map(item =>
    `      <li class="sc-toc-item"><a href="#${escHtml(item.id)}" class="sc-toc-link">${escHtml(item.label)}</a></li>`
  ).join('\n');
  return `<nav class="sc-article-toc" aria-label="Article sections">
      <ol class="sc-toc-list">
${items}
      </ol>
    </nav>`;
}

// ── Index snapshot table ──────────────────────────────────────────────────────

function buildSnapshotHtml(issue) {
  const snap = issue.indexSnapshot || [];
  if (snap.length === 0) return '';
  const rows = snap.map(e => {
    const momStr = e.mom >= 0 ? `+${e.mom.toFixed(1)}%` : `${e.mom.toFixed(1)}%`;
    return `          <tr>
            <td>#${e.rank}</td>
            <td><a href="/brands/${escHtml(e.id)}/">${escHtml(e.name)}</a></td>
            <td>${e.di.toFixed(1)}</td>
            <td class="${e.mom >= 0 ? 'sc-mom-up' : 'sc-mom-down'}">${escHtml(momStr)}</td>
          </tr>`;
  }).join('\n');
  return `
    <section class="sc-article-section sc-snapshot-section" id="index-snapshot">
      <h2 class="sc-section-heading">Index Snapshot</h2>
      <div class="section-body">
        <p class="sc-snapshot-label">Top ${snap.length} — ${escHtml(issue.monthLabel)}</p>
        <div class="table-scroll-wrap">
          <table class="sc-snapshot-table">
            <thead>
              <tr><th>Rank</th><th>Brand</th><th>DI Score</th><th>MoM</th></tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>
      </div>
    </section>`;
}

// ── Article sections ──────────────────────────────────────────────────────────

function buildSectionsHtml(issue, brandNameMap) {
  return (issue.sections || []).map(section => {
    const linkedBody = autoLinkBrandsInSection(
      section.body || '',
      issue.brandMentions,
      brandNameMap
    );
    const headingHtml = section.heading
      ? `\n      <h2 class="sc-section-heading">${escHtml(section.heading)}</h2>`
      : '';
    return `    <section class="sc-article-section" id="${escHtml(section.id)}">${headingHtml}
      <div class="section-body">
        ${linkedBody}
      </div>
    </section>`;
  }).join('\n\n');
}

// ── More issues (cross-links) ─────────────────────────────────────────────────

function buildMoreIssuesHtml(issue, allIssues) {
  const others = allIssues.filter(i => i.slug !== issue.slug).slice(0, 3);
  if (others.length === 0) return '';
  const items = others.map(i =>
    `      <li class="sc-more-item"><a href="/scorecard/${escHtml(i.slug)}/" class="sc-more-link">${escHtml(i.title)}</a> <span class="sc-more-date">${escHtml(i.date)}</span></li>`
  ).join('\n');
  return `    <section class="sc-more-issues">
      <h2 class="sc-section-heading">More from The Scorecard</h2>
      <ul class="sc-more-list">
${items}
      </ul>
    </section>`;
}

// ── Prev / Next navigation ────────────────────────────────────────────────────

function buildPrevNextHtml(issue, allIssues) {
  const idx  = allIssues.findIndex(i => i.slug === issue.slug);
  // Issues are newest-first; "prev" in reading = next in array (older); "next" = prev in array (newer)
  const newer = idx > 0              ? allIssues[idx - 1] : null; // more recent
  const older = idx < allIssues.length - 1 ? allIssues[idx + 1] : null; // older

  if (!newer && !older) return '';

  const newerLink = newer
    ? `<a href="/scorecard/${escHtml(newer.slug)}/" class="sc-prevnext-link sc-prevnext-newer">← ${escHtml(newer.title)}</a>`
    : '<span></span>';
  const olderLink = older
    ? `<a href="/scorecard/${escHtml(older.slug)}/" class="sc-prevnext-link sc-prevnext-older">${escHtml(older.title)} →</a>`
    : '<span></span>';

  return `    <nav class="sc-article-prevnext" aria-label="Issue navigation">
      ${newerLink}
      ${olderLink}
    </nav>`;
}

// ── Full page HTML ────────────────────────────────────────────────────────────

function generateIssuePage(issue, allIssues, brandNameMap) {
  const slug         = issue.slug;
  const canonicalUrl = `https://dormied.com/scorecard/${slug}/`;
  const metaDesc     = buildMetaDesc(issue);
  const pageTitle    = `${issue.title} | DORMIED`;
  const ogImage      = (issue.images && issue.images.hero) || 'https://dormied.com/images/og-image.jpg';
  const displayDate  = formatDate(issue.dateISO);
  const authorStr    = 'Adam & Travis';

  const imageHtml    = buildImageHtml(issue);
  const tocHtml      = buildTocHtml(issue);
  const sectionsHtml = buildSectionsHtml(issue, brandNameMap);
  const snapshotHtml = buildSnapshotHtml(issue);
  const moreHtml     = buildMoreIssuesHtml(issue, allIssues);
  const prevNextHtml = buildPrevNextHtml(issue, allIssues);

  // JSON-LD: NewsArticle
  const newsLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: issue.title,
    datePublished: issue.dateISO,
    dateModified: issue.dateISO,
    author: [
      { '@type': 'Person', name: 'Adam' },
      { '@type': 'Person', name: 'Travis' },
    ],
    publisher: {
      '@type': 'Organization',
      name: 'DORMIED',
      url: 'https://dormied.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://dormied.com/images/dormied-logo-colour.png',
      },
    },
    description: metaDesc,
    ...(issue.images && issue.images.hero ? { image: issue.images.hero } : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
  });

  // JSON-LD: BreadcrumbList
  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',          item: 'https://dormied.com/' },
      { '@type': 'ListItem', position: 2, name: 'The Scorecard', item: 'https://dormied.com/scorecard/' },
      { '@type': 'ListItem', position: 3, name: issue.title,     item: canonicalUrl },
    ],
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-N4Q8J6L3');</script>
  <!-- End Google Tag Manager -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- ── Primary SEO ── -->
  <title>${escHtml(pageTitle)}</title>
  <meta name="description" content="${escHtml(metaDesc)}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="canonical" href="${canonicalUrl}">

  <!-- ── Favicon ── -->
  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="apple-touch-icon" href="/images/dormied-icon.png">

  <!-- ── Open Graph ── -->
  <meta property="og:type"         content="article">
  <meta property="og:url"          content="${canonicalUrl}">
  <meta property="og:title"        content="${escHtml(pageTitle)}">
  <meta property="og:description"  content="${escHtml(metaDesc)}">
  <meta property="og:image"        content="${escHtml(ogImage)}">
  <meta property="og:image:width"  content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name"    content="DORMIED">
  <meta property="og:locale"       content="en_US">

  <!-- ── Twitter Card ── -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:site"        content="@DORMIED_GOLF">
  <meta name="twitter:title"       content="${escHtml(pageTitle)}">
  <meta name="twitter:description" content="${escHtml(metaDesc)}">
  <meta name="twitter:image"       content="${escHtml(ogImage)}">

  <!-- ── Article meta ── -->
  <meta property="article:published_time" content="${escHtml(issue.dateISO)}">
  <meta property="article:author"         content="${escHtml(authorStr)}">
  <meta property="article:section"        content="The Scorecard">

  <!-- ── Resource hints ── -->
  <link rel="preconnect" href="https://pagead2.googlesyndication.com">

  <!-- ── Fonts ── -->
  <link rel="stylesheet" href="/css/fonts.css">

  <!-- ── Styles ── -->
  <link rel="stylesheet" href="/css/styles.css?v=20260505">

  <!-- ── JSON-LD ── -->
  <script type="application/ld+json">${newsLd}</script>
  <script type="application/ld+json">${breadcrumbLd}</script>
</head>
<body class="scorecard-article-page">

  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>

  <!-- ══ TOP AD ══════════════════════════════════════════════════════════════ -->
  <div class="ad-top-zone" aria-hidden="true">
    <div class="ad-leaderboard tablet-ad">
      <ins class="adsbygoogle" style="display:inline-block;width:728px;height:90px"
           data-ad-client="ca-pub-5259693727609263" data-ad-slot="2855716557"></ins>
    </div>
    <div class="ad-mobile-banner mobile-ad">
      <ins class="adsbygoogle" style="display:inline-block;width:320px;height:50px"
           data-ad-client="ca-pub-5259693727609263" data-ad-slot="6216377061"></ins>
    </div>
  </div>

  <!-- ══ SITE HEADER ══════════════════════════════════════════════════════════ -->
  <header class="site-header" role="banner">
    <div class="container header-inner">
      <a href="/" class="site-logo" aria-label="DORMIED home">
        <img src="/images/dormied-logo-colour.png" alt="DORMIED — Golf's Brand Desk" class="logo-img"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="logo-text-fallback" style="display:none">DORMIED</span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a href="/rankings/"  class="site-nav-link">Index</a>
        <a href="/scorecard/" class="site-nav-link site-nav-link--active">Scorecard</a>
        <a href="/news/"      class="site-nav-link">News</a>
        <a href="/brands/"    class="site-nav-link">Brands</a>
      </nav>
    </div>
  </header>

  <!-- ══ MAIN ════════════════════════════════════════════════════════════════ -->
  <main id="main-content">

    <article class="sc-article-layout">

      <!-- ── Breadcrumb ── -->
      <nav class="bp-breadcrumb container" aria-label="Breadcrumb"
           style="padding-top:.75rem;padding-bottom:.25rem;font-size:.78rem;color:var(--text-muted);font-family:var(--font-mono);font-weight:600;letter-spacing:.04em;text-transform:uppercase">
        <a href="/" style="color:inherit;text-decoration:none">Home</a>
        <span aria-hidden="true" style="margin:0 .4em">&rsaquo;</span>
        <a href="/scorecard/" style="color:inherit;text-decoration:none">Scorecard</a>
        <span aria-hidden="true" style="margin:0 .4em">&rsaquo;</span>
        <span aria-current="page">${escHtml(issue.title)}</span>
      </nav>

      <!-- ── Article Header ── -->
      <header class="sc-article-header container">
        <a href="/scorecard/" class="sc-label sc-label--link">THE SCORECARD</a>
        <h1 class="sc-article-title">${escHtml(issue.title)}</h1>
        ${issue.subtitle ? `<p class="sc-article-subtitle">${escHtml(issue.subtitle)}</p>` : ''}
        <p class="sc-article-byline">By ${escHtml(authorStr)}</p>
        <p class="sc-article-date"><time datetime="${escHtml(issue.dateISO)}">${escHtml(displayDate)}</time></p>
      </header>

      <!-- ── Two-column layout: article content + sidebar ad ── -->
      <div class="container">
        <div class="table-layout">

          <!-- ── Main column ── -->
          <div class="sc-article-main">

            ${imageHtml ? `<!-- ── Images ── -->\n            <div class="sc-article-image">${imageHtml}</div>` : ''}

            ${tocHtml ? `<!-- ── Table of contents ── -->\n            ${tocHtml}` : ''}

            <!-- ── Mid-article Ad ── -->
            <div class="sc-article-ad" aria-hidden="true">
              <div class="ad-in-table desktop-ad">
                <ins class="adsbygoogle" style="display:inline-block;width:728px;height:90px"
                     data-ad-client="ca-pub-5259693727609263" data-ad-slot="3187856648"></ins>
              </div>
              <div class="ad-in-table mobile-ad">
                <ins class="adsbygoogle" style="display:inline-block;width:300px;height:250px"
                     data-ad-client="ca-pub-5259693727609263" data-ad-slot="5011106608"></ins>
              </div>
            </div>

            <!-- ── Article body ── -->
            <div class="sc-article-body">

${sectionsHtml}

${snapshotHtml}

            </div><!-- /sc-article-body -->

${moreHtml}

            <!-- ── Signup CTA ── -->
            <div class="sc-article-signup">
              <div class="sc-signup-inner">
                <p class="sc-signup-label">THE SCORECARD</p>
                <p class="sc-signup-sub">Get the monthly breakdown of what moved in golf brands, who's trending, who's fading, and why it matters. Delivered to your inbox before it hits the site.</p>
                <form class="footer-signup-form sc-signup-form" novalidate>
                  <div class="footer-signup-row">
                    <input class="footer-signup-input" type="email" placeholder="Your email" required autocomplete="email" aria-label="Email address">
                    <button class="footer-signup-btn" type="submit">Get The Scorecard</button>
                  </div>
                  <p class="footer-signup-msg" style="display:none"></p>
                </form>
              </div>
            </div>

            <!-- ── Cross-links ── -->
            <div class="sc-article-crosslinks">
              <a href="/rankings/" class="sc-crosslink">View the full DORMIED Index &rarr;</a>
              <a href="/brands/"   class="sc-crosslink">Browse The Field &rarr;</a>
            </div>

${prevNextHtml}

          </div><!-- /sc-article-main -->

          <!-- ── Sidebar: skyscraper ad ── -->
          <aside class="sidebar-ad-col">
            <div class="sidebar-sticky-zone" aria-hidden="true">
              <div class="ad-skyscraper">
                <ins class="adsbygoogle"
                     style="display:inline-block;width:160px;height:600px"
                     data-ad-client="ca-pub-5259693727609263"
                     data-ad-slot="6935529969"></ins>
              </div>
            </div>
          </aside>

        </div><!-- /table-layout -->
      </div><!-- /container -->

    </article>

  </main>

  <!-- ══ FOOTER ═══════════════════════════════════════════════════════════════ -->
  <footer class="site-footer" role="contentinfo">
    <div class="container footer-inner">
      <div class="footer-brand">
        <a href="/" class="footer-logo" aria-label="DORMIED home">DORMIED</a>
        <div class="footer-social">
          <a href="https://x.com/DORMIED_GOLF" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on X">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <a href="https://www.instagram.com/dormiedgolf" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on Instagram">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
          </a>
          <a href="https://dormiedgolf.substack.com/" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on Substack">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z"/></svg>
          </a>
        </div>
      </div>
      <nav class="footer-nav" aria-label="Footer navigation">
        <a href="/rankings/">Index</a>
        <a href="/scorecard/">Scorecard</a>
        <a href="/news/">News</a>
        <a href="/brands/">Brands</a>
        <a href="/about/">About</a>
        <a href="/contact/">Contact</a>
        <a href="/privacy/">Privacy</a>
        <a href="/sitemap.xml">Sitemap</a>
      </nav>
      <div class="footer-signup">
        <div class="footer-signup-header">
          <p class="footer-signup-label">THE SCORECARD</p>
          <p class="footer-signup-sub">Golf's brand desk in your inbox. The biggest moves of the month, what drove them, and what they mean. Once a month.</p>
        </div>
        <form class="footer-signup-form" novalidate>
          <div class="footer-signup-row">
            <input class="footer-signup-input" type="email" placeholder="Your email" required autocomplete="email" aria-label="Email address">
            <button class="footer-signup-btn" type="submit">Get The Scorecard</button>
          </div>
          <p class="footer-signup-msg" style="display:none"></p>
        </form>
      </div>
      <p class="footer-legal">&copy; <span id="footer-year"></span> DORMIED. Rankings are independent editorial content. No brand pays for placement or improved position on the DORMIED Index. All brand names and logos are property of their respective owners.</p>
    </div>
  </footer>

  <!-- ══ SCRIPTS ══════════════════════════════════════════════════════════════ -->
  <!-- scorecard-article.min.js is intentionally excluded: content is pre-rendered -->
  <script>document.getElementById('footer-year').textContent = new Date().getFullYear();</script>
  <script defer src="/js/utils.min.js?v=20260318"></script>
  <script defer src="/js/analytics.min.js?v=20260320a"></script>
  <script defer src="/js/signup.min.js?v=20260324d"></script>

  <script>
    window.addEventListener('load', function () {
      var s = document.createElement('script');
      s.async = true; s.crossOrigin = 'anonymous';
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5259693727609263';
      document.head.appendChild(s);
      s.onload = function () {
        var ads = document.querySelectorAll('.adsbygoogle');
        for (var i = 0; i < ads.length; i++) { (adsbygoogle = window.adsbygoogle || []).push({}); }
      };
    });
  </script>

</body>
</html>`;
}

// ── Sitemap ───────────────────────────────────────────────────────────────────

function upsertSitemapEntry(slug, dateStr) {
  const sitemapPath = path.join(SITE_ROOT, 'sitemap.xml');
  let sitemap = fs.readFileSync(sitemapPath, 'utf8');

  const locUrl = `https://dormied.com/scorecard/${slug}/`;
  const updated = sitemap.replace(
    new RegExp(`(<loc>${escapeRegex(locUrl)}<\\/loc>\\s*<lastmod>)[^<]+(<\\/lastmod>)`, 'g'),
    `$1${dateStr}$2`,
  );

  if (updated !== sitemap) {
    fs.writeFileSync(sitemapPath, updated, 'utf8');
    return;
  }

  // Entry not present — add it before </urlset>
  const entry = `  <url>\n    <loc>${locUrl}</loc>\n    <lastmod>${dateStr}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  fs.writeFileSync(sitemapPath, sitemap.replace('</urlset>', entry + '</urlset>'), 'utf8');
}

// ── Vercel config: remove shell rewrites, add cache header ───────────────────

function updateVercelConfig() {
  const vercelPath = path.join(SITE_ROOT, 'vercel.json');
  const config     = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

  // Remove the two /scorecard/:slug rewrites
  const before = config.rewrites.length;
  config.rewrites = config.rewrites.filter(r =>
    !(r.destination === '/scorecard/article.html')
  );
  const removed = before - config.rewrites.length;

  // Add /scorecard/(.+)/ cache header if not already present
  const cacheSource = '/scorecard/(.+)/';
  const hasHeader = (config.headers || []).some(h => h.source === cacheSource);
  if (!hasHeader) {
    config.headers = config.headers || [];
    // Insert after /brands/(.+)/ entry if present, else append
    const brandsIdx = config.headers.findIndex(h => h.source === '/brands/(.+)/');
    const newRule = {
      source: cacheSource,
      headers: [{ key: 'Cache-Control', value: 'public, no-cache' }],
    };
    if (brandsIdx >= 0) {
      config.headers.splice(brandsIdx + 1, 0, newRule);
    } else {
      config.headers.push(newRule);
    }
  }

  fs.writeFileSync(vercelPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  if (removed > 0) console.log(`[scorecard-page] Removed ${removed} shell rewrite(s) from vercel.json`);
  if (!hasHeader)  console.log(`[scorecard-page] Added /scorecard/(.+)/ cache header to vercel.json`);
}

// ── Process one issue ─────────────────────────────────────────────────────────

function processOneIssue(issue, allIssues, brandNameMap, force) {
  const outPath = path.join(SITE_ROOT, 'scorecard', issue.slug, 'index.html');

  if (!force && fs.existsSync(outPath)) {
    const fileMtime = fs.statSync(outPath).mtimeMs;
    const dataMtime = fs.statSync(path.join(SITE_ROOT, 'js/scorecard-data.js')).mtimeMs;
    if (fileMtime >= dataMtime) {
      return 'skipped';
    }
  }

  const html = generateIssuePage(issue, allIssues, brandNameMap);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');

  upsertSitemapEntry(issue.slug, issue.dateISO);

  console.log(`[scorecard-page] ✓  scorecard/${issue.slug}/index.html  (${html.length.toLocaleString()} bytes)`);
  return 'written';
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const args    = process.argv.slice(2);
  const force   = args.includes('--force');
  const slugArg = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');

  const scorecardData = loadScorecardData();
  const dormiedData   = loadDormiedData();
  const brandNameMap  = buildBrandNameMap(dormiedData);

  const allIssues = scorecardData.issues || [];
  const targets   = slugArg
    ? allIssues.filter(i => i.slug === slugArg)
    : allIssues;

  if (slugArg && targets.length === 0) {
    console.error(`[scorecard-page] Slug not found in scorecard-data.js: "${slugArg}"`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`[scorecard-page] Starting — ${today}`);
  if (force)   console.log('[scorecard-page] --force: regenerating all issues');
  if (slugArg) console.log(`[scorecard-page] --slug: single issue — ${slugArg}`);

  let written = 0, skipped = 0, errors = 0;

  for (const issue of targets) {
    try {
      const status = processOneIssue(issue, allIssues, brandNameMap, force);
      if (status === 'written') written++;
      else skipped++;
    } catch (err) {
      console.error(`[scorecard-page] ✗  ${issue.slug}:`, err.message);
      errors++;
    }
  }

  console.log(`\n[scorecard-page] Done — ${written} written, ${skipped} skipped, ${errors} errors`);

  if (written > 0) {
    // Bump /scorecard/ lastmod in sitemap
    const sitemapPath = path.join(SITE_ROOT, 'sitemap.xml');
    let sitemap = fs.readFileSync(sitemapPath, 'utf8');
    const bumped = sitemap.replace(
      /(<loc>https:\/\/dormied\.com\/scorecard\/<\/loc>\s*<lastmod>)[^<]+(<\/lastmod>)/,
      `$1${today}$2`,
    );
    if (bumped !== sitemap) {
      fs.writeFileSync(sitemapPath, bumped, 'utf8');
      console.log('[scorecard-page] Bumped /scorecard/ lastmod in sitemap');
    }

    // Only remove shell rewrites once ALL issues have static files
    const allHaveFiles = allIssues.every(i => {
      return fs.existsSync(path.join(SITE_ROOT, 'scorecard', i.slug, 'index.html'));
    });
    if (allHaveFiles) {
      updateVercelConfig();
    } else {
      console.log('[scorecard-page] Note: not all issues have static files yet — shell rewrites kept');
    }
  }
}

main();
