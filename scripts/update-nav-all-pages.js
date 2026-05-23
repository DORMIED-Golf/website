#!/usr/bin/env node
/**
 * update-nav-all-pages.js
 *
 * Adds WITB to site nav (desktop + mobile) across all existing HTML pages.
 *
 * Changes per file:
 *   1. Desktop nav: insert WITB link between Index and Scorecard
 *   2. Hamburger button: insert after </nav> (site-nav) and before <div class="site-search">
 *   3. Mobile nav panel: insert inside <header> just before </header>
 *   4. Footer nav: insert WITB link between Index and Scorecard
 *   5. Hamburger JS: insert before </body>
 *
 * Idempotent: skips files that already contain href="/witb/".
 * Excludes: witb/index.html (already has the new nav).
 *
 * Usage:
 *   node scripts/update-nav-all-pages.js            # write changes
 *   node scripts/update-nav-all-pages.js --dry-run  # report only
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Strings to inject
// ---------------------------------------------------------------------------

// 1. WITB desktop nav link (inserted after the Index link)
const WITB_DESKTOP_LINK = `        <a href="/witb/"      class="site-nav-link">WITB</a>`;

// 2. Hamburger button HTML
const HAMBURGER_HTML = `
      <!-- Hamburger (mobile only) -->
      <button class="nav-hamburger" id="nav-hamburger" aria-label="Open navigation menu"
        aria-expanded="false" aria-controls="mobile-nav-panel">
        <span class="bars" aria-hidden="true">
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
        </span>
      </button>
`;

// 3. Mobile nav panel (goes inside <header>, before </header>)
const MOBILE_NAV_HTML = `
    <!-- Mobile nav panel -->
    <nav class="mobile-nav-panel" id="mobile-nav-panel" aria-label="Mobile navigation" hidden>
      <a href="/rankings/"  class="mobile-nav-link">Index</a>
      <a href="/witb/"      class="mobile-nav-link">WITB</a>
      <a href="/scorecard/" class="mobile-nav-link">Scorecard</a>
      <a href="/news/"      class="mobile-nav-link">News</a>
      <a href="/brands/"    class="mobile-nav-link">Brands</a>
    </nav>
`;

// 4. WITB footer nav link
const WITB_FOOTER_LINK = `        <a href="/witb/">WITB</a>`;

// 5. Hamburger JS snippet (inserted just before </body>)
const HAMBURGER_JS = `
  <!-- Mobile nav hamburger -->
  <script>
  (function(){
    var btn   = document.getElementById('nav-hamburger');
    var panel = document.getElementById('mobile-nav-panel');
    if (!btn || !panel) return;
    function openNav()  { btn.setAttribute('aria-expanded','true');  panel.classList.add('open');    panel.removeAttribute('hidden'); }
    function closeNav() { btn.setAttribute('aria-expanded','false'); panel.classList.remove('open'); panel.setAttribute('hidden',''); }
    btn.addEventListener('click', function() {
      btn.getAttribute('aria-expanded') === 'true' ? closeNav() : openNav();
    });
    panel.querySelectorAll('a').forEach(function(a) { a.addEventListener('click', closeNav); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeNav(); });
    document.addEventListener('click', function(e) {
      if (!btn.contains(e.target) && !panel.contains(e.target)) closeNav();
    });
  })();
  </script>
`;

// ---------------------------------------------------------------------------
// Transform a single file's HTML
// ---------------------------------------------------------------------------

function transform(html, filePath) {
  let out = html;

  // 1. Desktop nav: insert WITB after Index link
  //    Case-insensitive for link text: some pages use "INDEX" (about/privacy/terms)
  //    Match: the Index anchor, then the Scorecard anchor (handles --active variants)
  const desktopNavRe = /([ \t]*<a href="\/rankings\/"[^>]*>[Ii][Nn][Dd][Ee][Xx]<\/a>\n)([ \t]*<a href="\/scorecard\/")/;
  if (desktopNavRe.test(out)) {
    out = out.replace(desktopNavRe, (_, indexAnchor, scorecardStart) => {
      // Detect casing from surrounding links (check if uppercase style)
      const isUpperCase = />[A-Z]{2,}<\/a>/.test(indexAnchor);
      const witbLabel = isUpperCase ? 'WITB' : 'WITB'; // acronym is always uppercase
      const witbLink = WITB_DESKTOP_LINK; // already uppercase WITB
      return `${indexAnchor}${witbLink}\n${scorecardStart}`;
    });
  } else {
    console.warn(`  WARN: desktop nav pattern not found in ${path.relative(ROOT, filePath)}`);
  }

  // 2. Hamburger button: insert after site-nav.
  //    Primary: between </nav> (site-nav) and the site-search div (full headers)
  //    Fallback: before the </div> closing header-inner (simple headers without search)
  const hamburgerAnchorFull = /(<\/nav>\n)([ \t]*<div class="site-search">)/;
  const hamburgerAnchorSimple = /(<\/nav>\n)([ \t]*<\/div>\n[ \t]*<\/header>)/;
  if (hamburgerAnchorFull.test(out)) {
    out = out.replace(hamburgerAnchorFull, (_, navClose, searchOpen) => {
      return `${navClose}${HAMBURGER_HTML}\n${searchOpen}`;
    });
  } else if (hamburgerAnchorSimple.test(out)) {
    out = out.replace(hamburgerAnchorSimple, (_, navClose, closingDiv) => {
      return `${navClose}${HAMBURGER_HTML}\n${closingDiv}`;
    });
  } else {
    console.warn(`  WARN: hamburger anchor not found in ${path.relative(ROOT, filePath)}`);
  }

  // 3. Mobile nav panel: insert inside <header> before </header>
  //    Pattern: the last </div> closing the header-inner div, then newline, then </header>
  const mobileNavAnchor = /([ \t]*<\/div>\n)([ \t]*<\/header>)/;
  if (mobileNavAnchor.test(out)) {
    // We only want the FIRST match that closes the header-inner block
    // Use replace with a counter to hit only the first occurrence
    let replaced = false;
    out = out.replace(mobileNavAnchor, (match, closingDiv, headerClose) => {
      if (replaced) return match;
      replaced = true;
      return `${closingDiv}${MOBILE_NAV_HTML}\n${headerClose}`;
    });
  } else {
    console.warn(`  WARN: mobile nav anchor not found in ${path.relative(ROOT, filePath)}`);
  }

  // 4. Footer nav: insert WITB between Index and Scorecard
  const footerNavRe = /([ \t]*<a href="\/rankings\/">Index<\/a>\n)([ \t]*<a href="\/scorecard\/">)/;
  if (footerNavRe.test(out)) {
    out = out.replace(footerNavRe, (_, indexAnchor, scorecardStart) => {
      return `${indexAnchor}${WITB_FOOTER_LINK}\n${scorecardStart}`;
    });
  } else {
    console.warn(`  WARN: footer nav pattern not found in ${path.relative(ROOT, filePath)}`);
  }

  // 5. Hamburger JS: insert before </body>
  if (out.includes('</body>')) {
    out = out.replace('</body>', `${HAMBURGER_JS}\n</body>`);
  } else {
    console.warn(`  WARN: </body> not found in ${path.relative(ROOT, filePath)}`);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Find all HTML files
// ---------------------------------------------------------------------------

function findHtmlFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.claude') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findHtmlFiles(full, results);
    } else if (entry.name.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const files = findHtmlFiles(ROOT);

  // Exclude the WITB page itself (already has the new nav)
  const WITB_PAGE = path.join(ROOT, 'witb', 'index.html');

  let total = 0, skipped = 0, updated = 0, errors = 0;

  for (const filePath of files) {
    total++;

    // Skip witb/index.html
    if (filePath === WITB_PAGE) { skipped++; continue; }

    const rel = path.relative(ROOT, filePath);
    const html = fs.readFileSync(filePath, 'utf8');

    // Idempotency: skip if already has WITB nav link
    if (html.includes('href="/witb/"')) {
      skipped++;
      continue;
    }

    // Skip files that don't have a site-nav (e.g. any non-templated pages)
    if (!html.includes('class="site-nav"')) {
      skipped++;
      continue;
    }

    try {
      const newHtml = transform(html, filePath);

      if (newHtml === html) {
        console.warn(`  WARN: no changes made to ${rel}`);
        skipped++;
        continue;
      }

      if (!DRY_RUN) {
        fs.writeFileSync(filePath, newHtml, 'utf8');
      }

      updated++;
      if (DRY_RUN) {
        process.stdout.write(`\r  Would update: ${updated} files...`);
      } else {
        process.stdout.write(`\r  Updated: ${updated} files...`);
      }
    } catch (err) {
      console.error(`\n  ERROR ${rel}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n\n===========================================`);
  console.log(`NAV UPDATE ${DRY_RUN ? '(dry run) ' : ''}COMPLETE`);
  console.log(`===========================================`);
  console.log(`Total HTML files:  ${total}`);
  console.log(`Updated:           ${updated}`);
  console.log(`Skipped:           ${skipped}`);
  console.log(`Errors:            ${errors}`);
  if (DRY_RUN) console.log(`\n(No files written -- dry run)`);
}

main();
