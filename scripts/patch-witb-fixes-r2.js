#!/usr/bin/env node
/**
 * patch-witb-fixes-r2.js
 *
 * Round 2 fixes on witb/index.html + css/styles.css + icon files:
 *   1. Logo artifact: replace broken onerror HTML with safe data-* + helper fn
 *   2. Chart too large: add max-height constraint to scatter inner container
 *   3. Iron icon: replace simple polygon with new SVG; save shaft/grip/ball icons
 *   4. TOP STORIES: add above LATEST in right sidebar
 *   5. Pulse strip dedup: remove hero-stats block (160 Players / 33 Brands / Weekly)
 *   6. "147v14" → "147 vs 14" formatting
 *   7. Unmapped count: left as-is (generate script handles dynamically; anon key can't query RLS table)
 *   8. Meta description: update to specified text across description, og:description, twitter:description
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const HTML_FILE = path.resolve(__dirname, '../witb/index.html');
const CSS_FILE  = path.resolve(__dirname, '../css/styles.css');
const ICONS_DIR = path.resolve(__dirname, '../images/icons');

let html = fs.readFileSync(HTML_FILE, 'utf8');
let css  = fs.readFileSync(CSS_FILE,  'utf8');

// Ensure icons dir exists
if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

// ============================================================
// FIX 3 (ICONS FIRST — create files before HTML references them)
// ============================================================

// shaft.svg — save with fill="currentColor" for future inline use
fs.writeFileSync(
  path.join(ICONS_DIR, 'shaft.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="22" viewBox="9.4 2.6 5.2 19" fill="currentColor" aria-hidden="true">
  <path d="M9.4 2.6 H14.6 L13.5 21 L13.1 21.6 L10.9 21.6 L10.5 21 Z"/>
</svg>`,
  'utf8'
);

// grip.svg — save with fill="currentColor"
fs.writeFileSync(
  path.join(ICONS_DIR, 'grip.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="7" height="22" viewBox="9.2 2.6 5.6 17.8" fill="currentColor" aria-hidden="true">
  <path d="M9.2 2.6 H14.8 V4.6 L14 5.4 L14.4 20.4 L9.6 20.4 L10 5.4 L9.2 4.6 Z"/>
  <path stroke="currentColor" stroke-width="0.7" stroke-linecap="round" fill="none" d="M10.25 7.6 L13.75 7.6 M10.3 9.8 L13.7 9.8 M10.3 12 L13.7 12 M10.35 14.2 L13.65 14.2 M10.4 16.4 L13.6 16.4 M10.45 18.6 L13.55 18.6"/>
</svg>`,
  'utf8'
);

// ball.svg — save with fill="currentColor"
fs.writeFileSync(
  path.join(ICONS_DIR, 'ball.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="3.2 3.2 17.6 17.6" fill="currentColor" aria-hidden="true">
  <path fill-rule="evenodd" d="M12 3.2 A8.8 8.8 0 1 0 12 20.8 A8.8 8.8 0 1 0 12 3.2 Z M8.2 7.4 A0.9 0.9 0 1 1 8.2 9.2 A0.9 0.9 0 1 1 8.2 7.4 Z M12 6.2 A0.9 0.9 0 1 1 12 8 A0.9 0.9 0 1 1 12 6.2 Z M15.8 7.4 A0.9 0.9 0 1 1 15.8 9.2 A0.9 0.9 0 1 1 15.8 7.4 Z M6.4 11.1 A0.9 0.9 0 1 1 6.4 12.9 A0.9 0.9 0 1 1 6.4 11.1 Z M10.1 11.1 A0.9 0.9 0 1 1 10.1 12.9 A0.9 0.9 0 1 1 10.1 11.1 Z M13.9 11.1 A0.9 0.9 0 1 1 13.9 12.9 A0.9 0.9 0 1 1 13.9 11.1 Z M17.6 11.1 A0.9 0.9 0 1 1 17.6 12.9 A0.9 0.9 0 1 1 17.6 11.1 Z M8.2 14.8 A0.9 0.9 0 1 1 8.2 16.6 A0.9 0.9 0 1 1 8.2 14.8 Z M12 14.8 A0.9 0.9 0 1 1 12 16.6 A0.9 0.9 0 1 1 12 14.8 Z M15.8 14.8 A0.9 0.9 0 1 1 15.8 16.6 A0.9 0.9 0 1 1 15.8 14.8 Z"/>
</svg>`,
  'utf8'
);

// golf_iron_icon_22px.svg — read the detailed desktop version, change fill to site green
// The desktop file uses hardcoded fill="black" which is invisible on the dark bg.
// We store a green copy as a named file for use via <img> (currentColor won't cross img boundary).
const DESKTOP_IRON = '/Users/travisr/Desktop/golf_iron_icon_22px.svg';
let ironSrc = '';
if (fs.existsSync(DESKTOP_IRON)) {
  ironSrc = fs.readFileSync(DESKTOP_IRON, 'utf8');
  // Remove XML declaration and strip verbose namespace attributes from root svg
  ironSrc = ironSrc.replace(/<\?xml[^>]*\?>\s*/i, '');
  // Change fill="black" to the site green; also fix baseProfile/version/xmlns:ev/xmlns:xlink
  ironSrc = ironSrc.replace(/fill="black"/g, 'fill="#22c55e"');
  ironSrc = ironSrc.replace(/ baseProfile="[^"]*"/g, '');
  ironSrc = ironSrc.replace(/ version="[^"]*"/g, '');
  ironSrc = ironSrc.replace(/ xmlns:ev="[^"]*"/g, '');
  ironSrc = ironSrc.replace(/ xmlns:xlink="[^"]*"/g, '');
  // Strip empty <defs />
  ironSrc = ironSrc.replace(/<defs\s*\/>/g, '');
  fs.writeFileSync(path.join(ICONS_DIR, 'golf_iron_icon_22px.svg'), ironSrc.trim(), 'utf8');
  console.log('Iron icon saved from desktop file (fill changed to #22c55e).');
} else {
  // Fallback: write improved simple iron icon if desktop file not present
  ironSrc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9.4 1.5 10 20.5" width="16" height="16" fill="#22c55e" aria-hidden="true"><path d="M9.4 1.5 H14.4 L13.5 17 L13.1 17.8 L11.9 17.8 L11.5 17 Z"/><rect x="9.6" y="17.8" width="9.8" height="4.2" rx="1"/></svg>`;
  fs.writeFileSync(path.join(ICONS_DIR, 'golf_iron_icon_22px.svg'), ironSrc, 'utf8');
  console.log('Iron icon: desktop file not found, wrote improved fallback.');
}

// Inline iron icon HTML — replace old simple polygon with <img> referencing saved file
const OLD_IRON_ICON = `<span class="witb-cat-icon" aria-hidden="true" style="color:var(--green)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="16" height="16" fill="currentColor"><polygon points="14,2 16.5,2 10.5,15 8,15"/><rect x="3" y="15" width="15" height="4.5" rx="1"/></svg></span>`;
const NEW_IRON_ICON = `<span class="witb-cat-icon" aria-hidden="true"><img src="/images/icons/golf_iron_icon_22px.svg" width="16" height="16" alt=""></span>`;
html = html.split(OLD_IRON_ICON).join(NEW_IRON_ICON);

// ============================================================
// FIX 1 — Logo artifact: replace malformed onerror with helper fn
// ============================================================

// Add witbLogoErr helper function immediately after GTM noscript (before any logo img tags)
const LOGO_HELPER_SCRIPT = `
  <!-- Logo fallback helper: avoids nested-quote HTML attribute bug -->
  <script>function witbLogoErr(img){img.style.display='none';var sm=img.className.indexOf('-sm')!==-1;var sz=sm?16:20;var mr=sm?4:5;var s=document.createElement('span');s.style.cssText='width:'+sz+'px;height:'+sz+'px;display:inline-flex;align-items:center;justify-content:center;font-family:Barlow Condensed,sans-serif;font-weight:700;font-size:.55rem;background:'+img.dataset.bg+';border-radius:2px;flex-shrink:0;margin-right:'+mr+'px;vertical-align:middle;color:#e2f0de';s.textContent=img.dataset.ini;img.insertAdjacentElement('afterend',s)}</script>
`;

// Insert after the GTM noscript block
html = html.replace(
  '  <!-- ══ HEADER ═══════════════════════════════════════════════════════════════ -->',
  LOGO_HELPER_SCRIPT + '  <!-- ══ HEADER ═══════════════════════════════════════════════════════════════ -->'
);

// Now replace all logo img onerror handlers with clean data-* pattern
// Pattern: onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span style="...background:COLOR;...">INITIALS</span>')"
// Note: In the raw HTML file, the inner style= uses literal double-quotes (this is what breaks the browser parser)
html = html.replace(
  /(<img src="[^"]+" alt="" class="witb-brand-logo[^"]*" loading="lazy") onerror="this\.style\.display='none';this\.insertAdjacentHTML\('afterend','<span style="[^"]*background:([^;]+);[^"]*">([^<]*)<\/span>'\)"/g,
  function(match, imgAttrs, bg, ini) {
    return `${imgAttrs} data-bg="${bg}" data-ini="${ini}" onerror="witbLogoErr(this)"`;
  }
);

// ============================================================
// FIX 5 — Remove duplicate pulse block (hero-stats with "Weekly Updates")
// ============================================================

html = html.replace(
  `          <div class="hero-stats" aria-label="WITB statistics">
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
          </div>`,
  ''
);

// ============================================================
// FIX 4 — Add TOP STORIES above LATEST in sidebar
// ============================================================

html = html.replace(
  `      <aside class="witb-sidebar sidebar-ad-col">
        <section class="home-stories-section latest-feed-section" aria-labelledby="witb-latest-heading">
          <h2 class="latest-feed-heading" id="witb-latest-heading">Latest</h2>
          <div id="dormied-latest-list" class="latest-feed-list">
            <p class="latest-feed-loading">Loading&#x2026;</p>
          </div>
        </section>
      </aside>`,
  `      <aside class="witb-sidebar sidebar-ad-col">
        <section class="home-stories-section latest-feed-section" aria-labelledby="witb-stories-heading">
          <h2 class="latest-feed-heading" id="witb-stories-heading">Top Stories</h2>
          <div id="home-stories-list" class="latest-feed-list">
            <p class="latest-feed-loading">Loading&#x2026;</p>
          </div>
        </section>
        <section class="home-stories-section latest-feed-section" aria-labelledby="witb-latest-heading">
          <h2 class="latest-feed-heading" id="witb-latest-heading">Latest</h2>
          <div id="dormied-latest-list" class="latest-feed-list">
            <p class="latest-feed-loading">Loading&#x2026;</p>
          </div>
        </section>
      </aside>`
);

// ============================================================
// FIX 6 — "147v14" → "147 vs 14"
// ============================================================

html = html.replace(
  '<div class="witb-dyk-stat">147<span style="font-size:1rem">v</span>14</div>',
  '<div class="witb-dyk-stat">147 <span style="font-size:.7rem;font-weight:400;letter-spacing:.02em">vs</span> 14</div>'
);

// ============================================================
// FIX 8 — Meta description + og:description + twitter:description
// ============================================================

const META_DESC = "What's in the bag on tour: the most-used drivers, irons, wedges, putters, and balls across 160 pro bags, mapped against what amateur golfers search for.";

html = html.replace(
  /(<meta name="description" content=")[^"]*(")/,
  `$1${META_DESC}$2`
);

html = html.replace(
  /(<meta property="og:description" content=")[^"]*(")/,
  `$1${META_DESC}$2`
);

html = html.replace(
  /(<meta name="twitter:description" content=")[^"]*(")/,
  `$1${META_DESC}$2`
);

// ============================================================
// FIX 2 — Chart max-height constraint
// ============================================================

// Add max-height to .witb-scatter-inner so the SVG stays proportionally compact
// (matches brand-page DI graph proportions — wider-than-tall)
css = css.replace(
  '.witb-scatter-inner { flex: 1; min-width: 0; }',
  '.witb-scatter-inner { flex: 1; min-width: 0; max-height: 340px; overflow: hidden; }'
);

// Also update SVG to be height-constrained
css = css.replace(
  `.witb-scatter-svg {
  width: 100%;
  height: auto;
  display: block;
}`,
  `.witb-scatter-svg {
  width: 100%;
  height: auto;
  max-height: 340px;
  display: block;
}`
);

// ============================================================
// Write outputs
// ============================================================

fs.writeFileSync(HTML_FILE, html, 'utf8');
fs.writeFileSync(CSS_FILE, css, 'utf8');
console.log('witb/index.html patched.');
console.log('css/styles.css patched.');

// ============================================================
// Verification
// ============================================================

console.log('\n=== Verification ===');

// FIX 1: artifact gone
const artifactCount = (html.match(/'\)">/) || []).length;
console.log(`Logo artifact (\\'\\)">): ${artifactCount} (expected: 0)`);

const logoImgCount = (html.match(/class="witb-brand-logo/g) || []).length;
const helperFnPresent = html.includes('witbLogoErr');
console.log(`witbLogoErr helper: ${helperFnPresent ? 'YES' : 'NO'}`);
console.log(`Logo img tags: ${logoImgCount}`);
console.log(`data-bg present: ${(html.match(/data-bg="/g) || []).length}`);

// FIX 2: chart size
console.log(`Scatter max-height in CSS: ${css.includes('max-height: 340px') ? 'YES' : 'NO'}`);

// FIX 3: iron icon
console.log(`New iron icon (<img>): ${(html.match(/golf_iron_icon_22px\.svg/g) || []).length} occurrences (expected: 2)`);
console.log(`Old iron icon (polygon): ${html.includes('<polygon points="14,2 16.5,2') ? 'STILL PRESENT (bad)' : 'gone (good)'}`);

// FIX 4: TOP STORIES
console.log(`TOP STORIES present: ${html.includes('home-stories-list') ? 'YES' : 'NO'}`);
console.log(`Top Stories heading: ${html.includes('witb-stories-heading') ? 'YES' : 'NO'}`);

// FIX 5: dedup
console.log(`Weekly Updates present: ${html.includes('Weekly') && html.includes('stat-label') ? 'BAD' : 'removed'}`);
console.log(`hero-stats present: ${html.includes('class="hero-stats"') ? 'BAD' : 'removed'}`);

// FIX 6: spacing
console.log(`"147 vs 14" present: ${html.includes('147 ') && html.includes('>vs<') ? 'YES' : 'NO'}`);
console.log(`"147v14" artifact: ${html.includes('>v<') ? 'STILL PRESENT (bad)' : 'gone (good)'}`);

// FIX 8: meta
const descMatch = html.match(/<meta name="description" content="([^"]+)"/);
console.log(`Meta description: ${descMatch ? descMatch[1].slice(0, 60) + '...' : 'NOT FOUND'}`);
const ogDescMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
console.log(`OG description: ${ogDescMatch ? 'SET' : 'NOT FOUND'}`);
const twDescMatch = html.match(/<meta name="twitter:description" content="([^"]+)"/);
console.log(`Twitter description: ${twDescMatch ? 'SET' : 'NOT FOUND'}`);

// Prior tweaks: confirm still intact
console.log('\n=== Prior tweaks integrity ===');
console.log(`Amateur Attention: ${html.includes('Amateur Attention') ? 'YES' : 'NO'}`);
console.log(`hero-section: ${html.includes('hero-section') ? 'YES' : 'NO'}`);
console.log(`witb-scatter-frame: ${html.includes('witb-scatter-frame') ? 'YES' : 'NO'}`);
console.log(`witb-tt-title: ${html.includes('witb-tt-title') ? 'YES' : 'NO'}`);
console.log(`PGAClubTracker lines: ${(html.split('\n').filter(l => /pgaclubtracker/i.test(l))).length} (expected: 1)`);
console.log(`Em dashes literal: ${(html.match(/—/g) || []).length === 0 ? 'none (good)' : 'FOUND (bad)'}`);
