#!/usr/bin/env node
/**
 * patch-witb-polish.js
 *
 * Applies 6 polish tweaks to witb/index.html:
 *   1. Chart chassis: move axis titles outside SVG, update tooltip to brand-chart style
 *   2. Brand logos: add 20px logos to leaderboard rows, top-model rows, tour-share legend,
 *      and momentum lists; monogram fallback for unmapped brands
 *   3. Iron icon: add SVG golf-iron icon beside "Irons" label (leaderboard + top-model)
 *   4. Header: replace witb-hero with hero-section (matches /rankings)
 *   5. "Public" -> "Amateur" in all 4 chart-framing spots + tooltip JS
 *   6. PGAClubTracker single credit: remove from body, keep only closing "Data source:" line
 *
 * Usage:
 *   node scripts/patch-witb-polish.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '../witb/index.html');

let html = fs.readFileSync(FILE, 'utf8');

// ---------------------------------------------------------------------------
// Iron icon SVG (inline, currentColor = site green via parent container style)
// ---------------------------------------------------------------------------
const IRON_ICON = `<span class="witb-cat-icon" aria-hidden="true" style="color:var(--green)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="16" height="16" fill="currentColor"><polygon points="14,2 16.5,2 10.5,15 8,15"/><rect x="3" y="15" width="15" height="4.5" rx="1"/></svg></span>`;

// ---------------------------------------------------------------------------
// Logo helper: build img tag for a brand slug.
// Known unmapped brands in the WITB page: Iomic, Other
// ---------------------------------------------------------------------------
const LOGO_KNOWN_SLUGS = new Set([
  'titleist','taylormade','ping','callaway','odyssey-golf','srixon','cleveland-golf',
  'l-a-b-golf','pxg','cobra','mizuno','bettinardi','wilson','nike-golf',
  'bridgestone-golf','miura-golf','mclaren-golf','new-level-golf','krank-golf',
  'avoda-golf','swag-golf','honma','golf-pride','superstroke','lamkin','jumbomax',
  'maxfli','accra','aldila',
]);

// Palette for monogram fallback (matches getBgColor logic from brand.js)
const BG_PALETTE = [
  '#14532d','#1e3a5f','#7c2d12','#4a1d96',
  '#064e3b','#1e1b4b','#7f1d1d','#1c1917',
  '#0c4a6e','#365314','#6b21a8','#831843',
];
function slugBg(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return BG_PALETTE[h % BG_PALETTE.length];
}
function getInitials(name) {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

/**
 * Returns an <img> tag for brand logos in leaderboard rows (20px).
 * Falls back to a monogram circle if the slug has no logo file.
 */
function logoImg(slug, name, size = 20) {
  if (!slug) return '';
  const bg  = slugBg(slug);
  const ini = getInitials(name || slug);
  const fallbackStyle = `width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.55rem;background:${bg};border-radius:2px;flex-shrink:0;margin-right:5px;vertical-align:middle;color:#e2f0de`;
  const fallback = `<span style="${fallbackStyle}">${ini}</span>`;
  if (LOGO_KNOWN_SLUGS.has(slug)) {
    return `<img src="/images/logos/${slug}.jpg" alt="" class="witb-brand-logo${size <= 16 ? '-sm' : ''}" loading="lazy" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${fallback.replace(/'/g, "\\'")}')">`;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// TWEAK 4 — Replace hero with hero-section (matches /rankings)
// ---------------------------------------------------------------------------

html = html.replace(
  `    <div class="container" style="padding-top:28px;padding-bottom:0">
      <nav class="witb-breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a> &rsaquo; WITB
      </nav>

      <div class="witb-hero">
        <h1 class="witb-hero-h1">What's In The Bag</h1>
        <p class="witb-hero-dek">What the tour actually plays, and how it lines up with what the rest of golf is paying attention to.</p>
      </div>
    </div>`,

  `    <section class="hero-section" aria-labelledby="witb-title">
      <div class="container">
        <nav class="witb-breadcrumb" aria-label="Breadcrumb" style="padding-top:12px;margin-bottom:16px">
          <a href="/">Home</a> &rsaquo; WITB
        </nav>
        <div class="hero-content">
          <div class="hero-text">
            <h1 id="witb-title" class="hero-title">What's In The Bag</h1>
            <p class="hero-desc">What the tour actually plays, and how it lines up with what the rest of golf pays attention to.</p>
          </div>
          <div class="hero-stats" aria-label="WITB statistics">
            <div class="stat-item">
              <span class="stat-value">160</span>
              <span class="stat-label">Players</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-value">33</span>
              <span class="stat-label">Brands</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-value">Weekly</span>
              <span class="stat-label">Updates</span>
            </div>
          </div>
        </div>
      </div>
    </section>`
);

// ---------------------------------------------------------------------------
// TWEAK 5 — Rename "Public" → "Amateur" in 4 chart-framing spots
// ---------------------------------------------------------------------------

// 1. Section heading
html = html.replace(
  'Tour Usage vs. Public Attention</h2>',
  'Tour Usage vs. Amateur Attention</h2>'
);

// 2. Scatter caption
html = html.replace(
  'pro favorites the public underrates.',
  'pro favorites the amateur game underrates.'
);

// 3. Methodology subhead
html = html.replace(
  '<h2>Reading the Tour Usage vs. Public Attention Chart</h2>',
  '<h2>Reading the Tour Usage vs. Amateur Attention Chart</h2>'
);

// 4. Methodology body prose (all public references in chart-framing context)
html = html.replace(
  'pro favorites the general golf public has not yet matched with search attention',
  'pro favorites the amateur game has not yet matched with search attention'
);
html = html.replace(
  'command more public attention than their tour presence suggests',
  'command more amateur attention than their tour presence suggests'
);
html = html.replace(
  "general golf public's awareness",
  "amateur golfers' awareness"
);
html = html.replace(
  'between tour presence and public awareness can be dramatic',
  'between tour presence and amateur awareness can be dramatic'
);

// 5. Tooltip JS gap label
html = html.replace(
  "'Underrated by public (+'",
  "'Underrated by amateurs (+'",
);

// ---------------------------------------------------------------------------
// TWEAK 6 — Single PGAClubTracker credit (remove from body, keep closing line)
// ---------------------------------------------------------------------------

html = html.replace(
  'pulling bag data from <a href="https://www.pgaclubtracker.com" rel="noopener noreferrer" target="_blank">PGAClubTracker.com</a> on a weekly basis',
  'pulling bag data from tour equipment tracking on a weekly basis'
);

// ---------------------------------------------------------------------------
// TWEAK 1 — Chart chassis: move axis titles outside SVG, upgrade tooltip style
// ---------------------------------------------------------------------------

// 1a. Remove axis title text elements from inside the SVG
html = html.replace(
  '\n    <text class="witb-scatter-axis-label" x="356" y="416" text-anchor="middle">Tour Usage (%)</text>\n    <text class="witb-scatter-axis-label" x="10" y="196" text-anchor="middle" transform="rotate(-90,10,196)">DI Score</text>',
  ''
);

// 1b. Wrap SVG in frame layout with HTML axis titles
html = html.replace(
  '<div class="witb-scatter-wrap">\n            <svg class="witb-scatter-svg"',
  '<div class="witb-scatter-wrap">\n            <div class="witb-scatter-frame">\n              <div class="witb-scatter-ytitle" aria-hidden="true">DI Score</div>\n              <div class="witb-scatter-inner"><svg class="witb-scatter-svg"'
);

// Close the inner div and frame, add x-title
html = html.replace(
  '  </svg>\n          </div>\n          <p style="font-family:var(--font-mono)',
  '  </svg></div>\n            </div>\n            <div class="witb-scatter-xtitle" aria-hidden="true">Tour Usage (%)</div>\n          </div>\n          <p style="font-family:var(--font-mono)'
);

// 1c. Upgrade tooltip HTML in the JS (match brand chart style)
html = html.replace(
  `          '<strong>' + name + '</strong><br>' +
          'Tour: ' + tour + '% (' + players + ' players)<br>' +
          'DI score: ' + di + ' (#' + rank + ')<br>' +
          '<span style="color:var(--text-muted)">' + gapLabel + '</span>';`,
  `          '<div class="witb-tt-title">' + name + '</div>' +
          '<div>Tour: ' + tour + '% (' + players + ' players)</div>' +
          '<div>DI score: ' + di + ' (rank #' + rank + ')</div>' +
          '<div class="witb-tt-gap">' + gapLabel + '</div>';`
);

// 1d. Improve tooltip position: flip up near bottom/right edges
html = html.replace(
  `    function posTooltip(e) {
      var x = e.clientX + 14, y = e.clientY - 10;
      if (x + 230 > window.innerWidth) x = e.clientX - 230;
      tooltip.style.left = x + 'px';
      tooltip.style.top  = y + 'px';
    }`,
  `    function posTooltip(e) {
      var x = e.clientX + 14, y = e.clientY - 10;
      var TW = 220, TH = 90;
      if (x + TW > window.innerWidth)  x = e.clientX - TW - 8;
      if (y + TH > window.innerHeight - 24) y = e.clientY - TH - 8;
      tooltip.style.left = x + 'px';
      tooltip.style.top  = y + 'px';
    }`
);

// ---------------------------------------------------------------------------
// TWEAK 2 — Brand logos in leaderboard rows
// ---------------------------------------------------------------------------
//
// Pattern: <span class="witb-lb-name"><a href="/brands/{slug}/">{name}</a>...
// (covers both leaderboard rows AND top-model rows AND momentum lists)

html = html.replace(
  /<span class="witb-lb-name"><a href="\/brands\/([^"\/]+)\/">/g,
  (match, slug) => {
    // Derive name from slug for fallback initials
    const name = slug.replace(/-/g, ' ');
    return `<span class="witb-lb-name">${logoImg(slug, name)}<a href="/brands/${slug}/">`;
  }
);

// ---------------------------------------------------------------------------
// TWEAK 2 (cont.) — Brand logos in prop-legend items (tour-share section)
// ---------------------------------------------------------------------------
// Pattern: colored dot span followed by brand anchor
// <span class="witb-prop-legend-dot" style="..."></span>
//       <a href="/brands/{slug}/" style="color:inherit">

html = html.replace(
  /(<span class="witb-prop-legend-dot"[^>]*><\/span>\n      )(<a href="\/brands\/([^"\/]+)\/"[^>]*>)/g,
  (match, dotSpan, aTag, slug) => {
    const name = slug.replace(/-/g, ' ');
    return `${dotSpan}${logoImg(slug, name, 16)}${aTag}`;
  }
);

// ---------------------------------------------------------------------------
// TWEAK 3 — Iron icon beside "Irons" labels
// ---------------------------------------------------------------------------

// Irons leaderboard section title
html = html.replace(
  '<div class="witb-lb-title">Irons</div>',
  `<div class="witb-lb-title">${IRON_ICON}Irons</div>`
);

// Irons row in Top Model table (the category label span)
html = html.replace(
  '<span class="witb-lb-name" style="color:var(--text-muted);min-width:90px;max-width:90px;font-size:.75rem;font-family:var(--font-mono);text-transform:uppercase">Irons</span>',
  `<span class="witb-lb-name" style="color:var(--text-muted);min-width:90px;max-width:90px;font-size:.75rem;font-family:var(--font-mono);text-transform:uppercase">${IRON_ICON}Irons</span>`
);

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

fs.writeFileSync(FILE, html, 'utf8');
console.log('witb/index.html patched successfully.');

// ---------------------------------------------------------------------------
// Verify public count
// ---------------------------------------------------------------------------
const publicCount = (html.match(/public/gi) || []).length;
// Expected: only the Google "public" in pgaclubtracker attribution area
// Check chart-framing context specifically
const chartFramingPublic = [
  'public underrates', 'public attention', 'public awareness', 'golf public',
  'public has not yet', 'more public', "public's awareness", 'Underrated by public',
].filter(s => html.toLowerCase().includes(s.toLowerCase()));

console.log('\n=== Verification ===');
console.log(`PGAClubTracker count: ${(html.match(/pgaclubtracker/gi) || []).length} (expected: 2 — the link href and link text)`);
console.log(`Public count (all): ${publicCount}`);
console.log('Chart-framing "public" remaining:', chartFramingPublic.length ? chartFramingPublic : 'none');
console.log('Em dashes (literal —):', (html.match(/—/g) || []).length === 0 ? 'none' : 'FOUND!');
console.log('Amateur attention present:', html.includes('Amateur Attention') ? 'YES' : 'NO');
console.log('Iron icon present:', html.includes('witb-cat-icon') ? 'YES' : 'NO');
console.log('Brand logos present:', html.includes('witb-brand-logo') ? 'YES' : 'NO');
console.log('hero-section present:', html.includes('hero-section') ? 'YES' : 'NO');
console.log('Scatter frame present:', html.includes('witb-scatter-frame') ? 'YES' : 'NO');
