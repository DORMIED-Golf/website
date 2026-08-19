#!/usr/bin/env node
/**
 * scripts/generate-witb-players-page.js
 *
 * Builds /witb/players/index.html — the WITB player directory.
 * Queries Supabase for all ranked players + current-bag brand data, then
 * pre-renders player cards (same pattern as brands/index.html).
 * Client-side witb-dir.js handles search, club-type, and brand filtering.
 *
 * Usage: node scripts/generate-witb-players-page.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const fs              = require('fs');
const path            = require('path');
const vm              = require('vm');
const { createClient } = require('@supabase/supabase-js');
const feedBake        = require('./feed-bake');
const { dataVersion } = require('./lib/data-version');
const { pageEligible } = require('./witb-page-eligibility');
const { cssVersion } = require('./lib/css-version.js');
const { js: jsVersion } = require('./lib/asset-version.js');

function loadDormiedData() {
  const raw = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return ctx.window.DORMIED_DATA;
}

const ROOT    = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'witb', 'players');
const OUT     = path.join(OUT_DIR, 'index.html');

// Sentinel OWGR value used for inactive/unranked players (e.g. Tiger Woods, Ian Poulter)

// ── Club-type -> filter category mapping ──────────────────────────────────────

const CLUB_TYPE_CAT = {
  'driver':       'Driver',
  'mini-driver':  'Driver',
  '3-wood':       'Fairway Wood',
  '4-wood':       'Fairway Wood',
  '5-wood':       'Fairway Wood',
  '7-wood':       'Fairway Wood',
  '9-wood':       'Fairway Wood',
  'hybrid':       'Hybrid',
  'iron':         'Iron',
  'utility-iron': 'Iron',
  'driving-iron': 'Iron',
  'utility':      'Iron',
  'wedge':        'Wedge',
  'putter':       'Putter',
  'ball':         'Ball',
  'grip':         'Grip',
};

const CAT_ORDER = ['Driver','Fairway Wood','Hybrid','Iron','Wedge','Putter','Ball','Grip'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtBagDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()];
  return `${mon} ${d.getUTCFullYear()}`;
}

function buildFlagHtml(countryCode, nation) {
  const HOME = {
    ENG: { file: 'eng', label: 'England' },
    NIR: { file: 'nir', label: 'Northern Ireland' },
    SCO: { file: 'sco', label: 'Scotland' },
    WAL: { file: 'wal', label: 'Wales' },
  };
  if (nation && HOME[nation]) {
    const { file, label } = HOME[nation];
    return `<span class="player-dir-flag" aria-label="${esc(label)} flag"><img src="/images/flags/${file}.svg" alt="${esc(label)} flag" width="16" height="10" style="display:inline-block;border-radius:1px;vertical-align:middle"></span>`;
  }
  if (countryCode && countryCode.length === 2) {
    const base = 0x1F1E6;
    const c1 = countryCode.charCodeAt(0) - 65;
    const c2 = countryCode.charCodeAt(1) - 65;
    if (c1 >= 0 && c1 <= 25 && c2 >= 0 && c2 <= 25) {
      const emoji = String.fromCodePoint(base + c1) + String.fromCodePoint(base + c2);
      return `<span class="player-dir-flag" aria-label="${esc(countryCode)} flag">${emoji}</span>`;
    }
  }
  return '';
}

const LOGO_CAP = 5; // max logos shown before "+N more"

function buildLogoStrip(brands) {
  // brands: array of { slug, name, dormied_brand_slug } (deduped, with dormied page only)
  const visible  = brands.slice(0, LOGO_CAP);
  const overflow = brands.length - visible.length;
  let html = '<div class="player-dir-logos">';
  for (const b of visible) {
    const initials = b.name.slice(0, 2).toUpperCase();
    // Use dormied_brand_slug for both the URL and the image path
    html += `<a href="/brands/${esc(b.dormied_brand_slug)}/" class="player-dir-logo-item" title="${esc(b.name)}" tabindex="-1">` +
      `<img src="/images/logos/${esc(b.dormied_brand_slug)}.jpg" alt="" class="player-dir-logo-img" width="20" height="20" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'">` +
      `<span class="player-dir-logo-mono" style="display:none">${esc(initials)}</span>` +
      `</a>`;
  }
  if (overflow > 0) {
    html += `<span class="player-dir-logos-more">+${overflow}</span>`;
  }
  html += '</div>';
  return html;
}

function buildPlayerCard(player, bagDate, filterMap, logoList) {
  const { slug, name, owgr_rank, rolex_rank, country_code, nation } = player;

  // Show numeric rank for all players with a rank (including sentinel 4990 — they sort last)
  // Rolex rank stands in where OWGR has no entry, so a women's player is not
  // labelled Unranked on the grid while her own page shows #277.
  const rankDisplay = owgr_rank ? `#${owgr_rank}` : rolex_rank ? `#${rolex_rank}` : 'Unranked';
  const dateDisplay = fmtBagDate(bagDate);
  const flagHtml    = buildFlagHtml(country_code, nation);
  const logoHtml    = buildLogoStrip(logoList);

  // data-bag: JSON map of category -> array of dormied brand slugs
  const bagData = {};
  for (const cat of CAT_ORDER) {
    const slugs = filterMap[cat];
    if (slugs && slugs.length) bagData[cat] = slugs;
  }

  // data-brands: flat deduplicated list for brand-only filter
  const allBrandSlugs = [...new Set(CAT_ORDER.flatMap(c => filterMap[c] || []))];

  // Card is a <div> (not <a>) so logo <a> links can be valid HTML children.
  // The player link <a> covers name / rank / date only.
  return `<div class="player-dir-card" ` +
    `data-name="${esc(name.toLowerCase())}" ` +
    `data-bag="${esc(JSON.stringify(bagData))}" ` +
    `data-brands="${esc(allBrandSlugs.join('|'))}">` +
    `<a href="/witb/players/${esc(slug)}/" class="player-dir-link" aria-label="${esc(name)}">` +
      `<div class="player-dir-name">${esc(name)}</div>` +
      `<div class="player-dir-rankrow">${flagHtml}<span class="player-dir-rank">${esc(rankDisplay)}</span></div>` +
      `<div class="player-dir-date">${esc(dateDisplay)}</div>` +
    `</a>` +
    logoHtml +
  `</div>`;
}

// ── Generate HTML page ────────────────────────────────────────────────────────

function buildPage(players, brandNames, latestFeedHtml, topStoriesHtml) {
  // brandNames: Map of dormied_brand_slug -> display name
  const brandNamesJson = JSON.stringify(Object.fromEntries(brandNames));

  const gridHtml = players.map(p => p._cardHtml).join('\n');
  const count    = players.length;

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

  <title>WITB Player Directory | DORMIED</title>
  <meta name="description" content="What's in the bag for ${count} ranked tour pros? DORMIED tracks every driver, iron, wedge, putter, ball, and shaft - updated weekly from verified caddie sources. Filter by brand and club type.">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" href="https://dormied.com/witb/players/">

  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="apple-touch-icon" href="/images/dormied-icon.png">

  <meta property="og:type" content="website">
  <meta property="og:url" content="https://dormied.com/witb/players/">
  <meta property="og:title" content="WITB Player Directory | DORMIED">
  <meta property="og:description" content="All ${count} tour players DORMIED tracks. Filter by equipment brand and club type to find who plays what.">
  <meta property="og:image" content="https://dormied.com/images/og-image.jpg">
  <meta property="og:site_name" content="DORMIED">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@DORMIED_GOLF">
  <meta name="twitter:title" content="WITB Player Directory | DORMIED">
  <meta name="twitter:description" content="All ${count} tour players DORMIED tracks. Filter by brand and club type.">
  <meta name="twitter:image" content="https://dormied.com/images/og-image.jpg">

  <link rel="sitemap" type="application/xml" href="/sitemap.xml">

  <link rel="stylesheet" href="/css/fonts.css">
  <link rel="stylesheet" href="/css/styles.min.css?v=${cssVersion()}">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "WITB Player Directory | DORMIED",
    "url": "https://dormied.com/witb/players/",
    "description": "All ${count} tour players DORMIED tracks, ranked by world ranking. Filterable by brand and club type.",
    "breadcrumb": {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://dormied.com/" },
        { "@type": "ListItem", "position": 2, "name": "WITB", "item": "https://dormied.com/witb/" },
        { "@type": "ListItem", "position": 3, "name": "Players", "item": "https://dormied.com/witb/players/" }
      ]
    },
    "publisher": { "@id": "https://dormied.com/#organization" }
  }
  </script>

  <style>
    /* ── Player directory card ── */
    /* Card is a <div> so logo <a> links can be valid HTML children.
       Player link covers name/rank/date; logos sit below as separate links. */
    .player-dir-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);display:flex;flex-direction:column;text-align:center;transition:border-color .15s,background .15s;overflow:hidden}
    .player-dir-card:hover{border-color:var(--green);background:var(--bg-hover)}
    /* Inner player link (name + rank + date) */
    .player-dir-link{display:flex;flex-direction:column;align-items:center;gap:5px;padding:14px 10px 8px;text-decoration:none;color:inherit;flex:1}
    .player-dir-link:hover{text-decoration:none}
    .player-dir-name{font-family:var(--font-mono);font-size:.78rem;font-weight:600;color:var(--text);line-height:1.2}
    /* Rank row: flag immediately left of the rank number */
    .player-dir-rankrow{display:flex;align-items:center;justify-content:center;gap:4px}
    .player-dir-flag{font-size:1em;line-height:1;flex-shrink:0}
    .player-dir-rank{font-family:var(--font-mono);font-size:.62rem;color:var(--green)}
    .player-dir-date{font-family:var(--font-mono);font-size:.58rem;color:var(--text-muted)}
    /* Logo strip at card bottom */
    .player-dir-logos{display:flex;align-items:center;justify-content:center;gap:3px;flex-wrap:wrap;padding:0 10px 10px}
    .player-dir-logo-item{display:inline-flex;align-items:center;text-decoration:none;flex-shrink:0}
    .player-dir-logo-img{width:20px;height:20px;object-fit:contain;border-radius:2px;display:block}
    .player-dir-logo-mono{width:20px;height:20px;border-radius:2px;background:var(--bg-raised);border:1px solid var(--border-lite);display:inline-flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:.5rem;font-weight:700;color:var(--green)}
    .player-dir-logos-more{font-family:var(--font-mono);font-size:.55rem;color:var(--text-muted);white-space:nowrap}
    /* Grid: reuse brands-grid from styles.min.css (3 cols desktop, 2 cols mobile, 10px gap, 16px top padding) */
  </style>
  <!-- Grow.me -->
  <script data-grow-initializer="">!(function(){window.growMe||((window.growMe=function(e){window.growMe._.push(e);}),(window.growMe._=[]));var e=document.createElement("script");(e.type="text/javascript"),(e.src="https://faves.grow.me/main.js"),(e.defer=!0),e.setAttribute("data-grow-faves-site-id","U2l0ZTowNjk5NTY3Ny0xMzU0LTQ5M2YtOWEyYi03Y2NkOTlkNWE3YWQ=");var t=document.getElementsByTagName("script")[0];t.parentNode.insertBefore(e,t);})();</script>
  <!-- Mediavine Journey ads -->
  <script type="text/javascript" async="async" data-noptimize="1" data-cfasync="false" src="//scripts.scriptwrapper.com/tags/06995677-1354-493f-9a2b-7ccd99d5a7ad.js"></script>
</head>

<body>

  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->

  <!-- SITE HEADER -->
  <header class="site-header" role="banner">
    <div class="container header-inner">
      <a href="/" class="site-logo" aria-label="DORMIED home">
        <img src="/images/dormied-logo-colour.png" alt="DORMIED: Golf's Brand Desk" class="logo-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="logo-text-fallback" style="display:none">DORMIED</span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a href="/rankings/"  class="site-nav-link">Index</a>
        <a href="/witb/"      class="site-nav-link site-nav-link--active">WITB</a>
        <a href="/scorecard/" class="site-nav-link">Scorecard</a>
        <a href="/news/"      class="site-nav-link">News</a>
        <a href="/brands/"    class="site-nav-link">Brands</a>
      </nav>

      <button class="nav-hamburger" id="nav-hamburger" aria-label="Open navigation menu"
        aria-expanded="false" aria-controls="mobile-nav-panel">
        <span class="bars" aria-hidden="true">
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
        </span>
      </button>

      <div class="site-search">
        <button class="site-search-trigger" aria-label="Search" aria-haspopup="true" aria-expanded="false">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
          <span class="site-search-trigger-label">Search</span>
        </button>
        <div class="site-search-panel" hidden>
          <div class="site-search-input-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;opacity:.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="search" class="site-search-input" placeholder="Search brands, players, news..." autocomplete="off" aria-label="Search dormied.com">
            <button class="site-search-close" aria-label="Close search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="site-search-results" role="listbox" aria-label="Search results"></div>
          <div class="site-search-empty" hidden>No results for that search.</div>
        </div>
      </div>
    </div>

    <nav class="mobile-nav-panel" id="mobile-nav-panel" aria-label="Mobile navigation" hidden>
      <a href="/rankings/"  class="mobile-nav-link">Index</a>
      <a href="/witb/"      class="mobile-nav-link">WITB</a>
      <a href="/scorecard/" class="mobile-nav-link">Scorecard</a>
      <a href="/news/"      class="mobile-nav-link">News</a>
      <a href="/brands/"    class="mobile-nav-link">Brands</a>
    </nav>
  </header>

  <main id="main-content">

    <!-- Hero -->
    <section class="hero-section" aria-labelledby="players-title">
      <div class="container">
        <div class="hero-content">
          <div class="hero-text">
            <h1 id="players-title" class="hero-title">The Players</h1>
            <p class="hero-subhead">WITB Player Directory</p>
            <p class="hero-desc">What's in the bag for every ranked player on tour? DORMIED tracks the current equipment setup for ${count} professional golfers - drivers, irons, wedges, putters, balls, and shafts - pulled from verified caddie sources and updated weekly.</p>
            <p class="hero-desc hero-desc--secondary">Filter by club type and brand to find who plays what. See which shaft TaylorMade's top users actually install, which putter brand the world's best players trust, or which iron set is quietly taking over tour bags. Each player page shows the full bag with brand history, equipment changes over time, and links to every brand in the bag.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Players section -->
    <section class="index-section brands-dir-section" aria-labelledby="players-grid-heading">
      <div class="container">
        <div class="table-layout">

          <!-- Main column -->
          <div class="table-main">
            <h2 id="players-grid-heading" class="sr-only">WITB player directory</h2>

            <!-- Filter bar -->
            <div class="brands-filter-bar filter-bar" role="search" aria-label="Search and filter players">
              <div class="search-wrap">
                <svg class="search-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input
                  type="search"
                  id="players-search"
                  class="search-input"
                  placeholder="Search players..."
                  aria-label="Search players"
                  autocomplete="off"
                  spellcheck="false"
                >
              </div>
              <select id="players-type-filter" class="filter-select" aria-label="Filter by club type">
                <option value="">All club types</option>
                <option value="Driver">Driver</option>
                <option value="Fairway Wood">Fairway Wood</option>
                <option value="Hybrid">Hybrid</option>
                <option value="Iron">Iron</option>
                <option value="Wedge">Wedge</option>
                <option value="Putter">Putter</option>
                <option value="Ball">Ball</option>
                <option value="Grip">Grip</option>
              </select>
              <select id="players-brand-filter" class="filter-select" aria-label="Filter by brand">
                <option value="">All brands</option>
              </select>
              <button id="players-clear" class="clear-btn" aria-label="Clear filters">Clear</button>
              <span id="players-count" class="results-count" aria-live="polite" aria-atomic="true">${count} of ${count} players</span>
            </div>

            <!-- Player grid -->
            <div id="players-grid" class="brands-grid" aria-live="polite">
${gridHtml}
            </div>
          </div><!-- /table-main -->

          <!-- Sidebar -->
          <aside class="sidebar-ad-col">
            <section class="home-stories-section latest-feed-section" aria-labelledby="players-stories-heading">
              <h2 class="latest-feed-heading" id="players-stories-heading">Top Stories</h2>
              <div id="home-stories-list" class="latest-feed-list">
                ${topStoriesHtml || '<p class="latest-feed-loading">Loading...</p>'}
              </div>
            </section>
            <section class="home-stories-section latest-feed-section" aria-labelledby="players-latest-heading">
              <h2 class="latest-feed-heading" id="players-latest-heading">Latest</h2>
              <div id="dormied-latest-list" class="latest-feed-list">
                ${latestFeedHtml || '<p class="latest-feed-loading">Loading...</p>'}
              </div>
            </section>
          </aside>

        </div><!-- /table-layout -->
      </div><!-- /container -->
    </section>

  </main>

  <!-- FOOTER -->
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
        </div>
      </div>
      <nav class="footer-nav" aria-label="Footer navigation">
        <a href="/rankings/">Index</a>
        <a href="/witb/">WITB</a>
        <a href="/scorecard/">Scorecard</a>
        <a href="/news/">News</a>
        <a href="/brands/">Brands</a>
        <a href="/about/">About</a>
        <a href="/contact/">Contact</a>
        <a href="/privacy/">Privacy</a>
        <a href="/terms/">Terms</a>
        <a href="/sitemap.xml">Sitemap</a>
      </nav>
      <div class="footer-signup">
        <div class="footer-signup-header"><p class="footer-signup-label">THE SCORECARD</p><p class="footer-signup-sub">Golf's brand desk in your inbox. The biggest moves of the month, what drove them, and what they mean. Once a month (sometimes more).</p></div>
        <form class="footer-signup-form" novalidate>
          <div class="footer-signup-row">
            <input class="footer-signup-input" type="email" placeholder="Your email" required autocomplete="email" aria-label="Email address">
            <button class="footer-signup-btn" type="submit">Get The Scorecard</button>
          </div>
          <p class="footer-signup-msg" style="display:none"></p>
        </form>
      </div>
      <p class="footer-legal">
        &copy; <span id="footer-year"></span> DORMIED. Rankings are independent editorial content. No brand pays for placement or improved position on the DORMIED Index. All brand names and logos are property of their respective owners.
      </p>
    </div>
  </footer>

  <script>document.getElementById('footer-year').textContent = new Date().getFullYear();</script>

  <!-- WITB dir data for client-side filtering -->
  <script>window.WITB_DIR_DATA = { brandNames: ${brandNamesJson} };</script>

  <script defer src="/js/utils.min.js?v=${jsVersion('utils.min.js')}"></script>
  <script defer src="/js/witb-dir.min.js?v=${jsVersion('witb-dir.min.js')}"></script>
  <script defer src="/js/data.min.js?v=${dataVersion()}"></script>
  <script defer src="/js/feed.min.js?v=${jsVersion('feed.min.js')}"></script>
  <script defer src="/js/analytics.min.js?v=${jsVersion('analytics.min.js')}"></script>
  <script defer src="/js/signup.min.js?v=${jsVersion('signup.min.js')}"></script>
  <script defer src="/js/search.min.js?v=${jsVersion('search.min.js')}"></script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Load all players ordered by OWGR rank (nulls last)
  console.log('[witb-players-page] Loading players...');
  const { data: allPlayers, error: pErr } = await sb
    .from('witb_players')
    .select('id, slug, name, owgr_rank, rolex_rank, country_code, nation, current_bag_id')
    .order('owgr_rank', { ascending: true, nullsFirst: false });
  if (pErr) throw new Error(`Players query failed: ${pErr.message}`);

  // 2. Load current bag dates for ALL players first — needed to decide eligibility.
  const allBagIds = [...new Set(allPlayers.map(p => p.current_bag_id).filter(Boolean))];
  const bagDateMap = new Map();
  for (let i = 0; i < allBagIds.length; i += 500) {
    const { data: bd, error: bErr } = await sb.from('witb_bags').select('id, bag_date').in('id', allBagIds.slice(i, i + 500));
    if (bErr) throw new Error(`Bags query failed: ${bErr.message}`);
    (bd || []).forEach(b => bagDateMap.set(b.id, b.bag_date));
  }

  // Keep ranked players plus unranked-but-eligible (recent bag or evergreen
  // allowlist); see witb-page-eligibility.js. Ranked sort by rank ascending;
  // eligible unranked sort last, alphabetically, and render "Unranked".
  const players = allPlayers
    .filter(p => pageEligible(p.owgr_rank, p.slug, bagDateMap.get(p.current_bag_id)))
    .sort((a, b) => {
      if (a.owgr_rank === null && b.owgr_rank === null) return a.name.localeCompare(b.name);
      if (a.owgr_rank === null) return 1;
      if (b.owgr_rank === null) return -1;
      return a.owgr_rank - b.owgr_rank;
    });
  const bagIds = [...new Set(players.map(p => p.current_bag_id).filter(Boolean))];
  const unrankedShown = players.filter(p => p.owgr_rank === null).length;

  console.log(`[witb-players-page] ${players.length} players (${players.length - unrankedShown} ranked + ${unrankedShown} unranked-eligible; excluded ${allPlayers.length - players.length}).`);

  // 3. Load ALL non-shaft bag items (paginated) then filter to current bags in JS.
  //    Using .in(bagIds) with many UUIDs silently truncates the URL and misses rows.
  const bagIdSet = new Set(bagIds);
  console.log('[witb-players-page] Loading bag items (paginated, filter in JS)...');
  const items = [];
  const ITEMS_PAGE = 1000;
  let itemsFrom = 0;
  while (true) {
    const { data: page, error: iErr } = await sb
      .from('witb_bag_items')
      .select('bag_id, club_type, brand_id')
      .neq('club_type', 'shaft')
      .range(itemsFrom, itemsFrom + ITEMS_PAGE - 1);
    if (iErr) throw new Error(`Items query failed: ${iErr.message}`);
    for (const row of page) {
      if (bagIdSet.has(row.bag_id)) items.push(row);
    }
    if (page.length < ITEMS_PAGE) break;
    itemsFrom += ITEMS_PAGE;
  }
  console.log(`[witb-players-page] ${items.length} current-bag items loaded.`);

  // 3b. Bulk-load all referenced brands in one query
  const uniqueBrandIds = [...new Set(items.map(i => i.brand_id).filter(Boolean))];
  const { data: brandsArr, error: brErr } = await sb
    .from('witb_brands')
    .select('id, slug, name, dormied_brand_slug')
    .in('id', uniqueBrandIds);
  if (brErr) throw new Error(`Brands query failed: ${brErr.message}`);
  const brandById = new Map((brandsArr || []).map(b => [b.id, b]));

  // 4. Group items by bag_id (join brand in JS)
  const itemsByBag = new Map();
  for (const item of items) {
    const { bag_id, club_type, brand_id } = item;
    const brand = brand_id ? brandById.get(brand_id) : null;
    if (!brand) continue;
    if (!itemsByBag.has(bag_id)) itemsByBag.set(bag_id, []);
    itemsByBag.get(bag_id).push({ club_type, brand });
  }

  // 5. Build brand name map (dormied_brand_slug -> display name)
  const brandNames = new Map();

  // 6. Build player cards
  const playersWithCards = [];
  for (const player of players) {
    const bagId   = player.current_bag_id;
    const bagDate = bagId ? bagDateMap.get(bagId) : null;
    const rawItems = (bagId && itemsByBag.get(bagId)) || [];

    // Build filter map: cat -> array of unique dormied brand slugs
    const filterMap = {};
    const logoSeen  = new Set();
    const logoList  = [];

    // Group items by category
    const itemsByCat = {};
    for (const { club_type, brand } of rawItems) {
      const cat = CLUB_TYPE_CAT[club_type];
      if (!cat) continue;
      if (!itemsByCat[cat]) itemsByCat[cat] = [];
      itemsByCat[cat].push(brand);
    }

    for (const cat of CAT_ORDER) {
      const catItems = itemsByCat[cat] || [];
      const slugSeen = new Set();
      const catSlugs = [];
      for (const brand of catItems) {
        if (!brand.dormied_brand_slug) continue;
        const dslug = brand.dormied_brand_slug;
        if (!slugSeen.has(dslug)) {
          slugSeen.add(dslug);
          catSlugs.push(dslug);
          brandNames.set(dslug, brand.name);
          if (!logoSeen.has(dslug)) {
            logoSeen.add(dslug);
            logoList.push({ slug: brand.slug, name: brand.name, dormied_brand_slug: dslug });
          }
        }
      }
      if (catSlugs.length) filterMap[cat] = catSlugs;
    }

    player._cardHtml = buildPlayerCard(player, bagDate, filterMap, logoList);
    playersWithCards.push(player);
  }

  // 7. Fetch feed articles and bake sidebar HTML
  const dormiedData = loadDormiedData();
  let latestFeedHtml = null;
  let topStoriesHtml = null;
  try {
    const [latestArticles, topStoriesArticles] = await Promise.all([
      feedBake.fetchLatestArticles(sb, 10, null),
      feedBake.fetchTopStoriesArticles(sb, dormiedData, 10),
    ]);
    latestFeedHtml = latestArticles.length    ? feedBake.renderLatestFeedHtml(latestArticles,    dormiedData) : null;
    topStoriesHtml = topStoriesArticles.length ? feedBake.renderLatestFeedHtml(topStoriesArticles, dormiedData) : null;
  } catch (e) {
    console.warn('[witb-players-page] Feed bake failed:', e.message);
  }

  // 8. Generate and write page
  const html = buildPage(playersWithCards, brandNames, latestFeedHtml, topStoriesHtml);
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');

  console.log(`[witb-players-page] Wrote ${OUT} (${playersWithCards.length} players, ${Math.round(html.length/1024)}KB)`);
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => {
    console.error('[witb-players-page] Fatal:', err.message);
    process.exit(1);
  });
}