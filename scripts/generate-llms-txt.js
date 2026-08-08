#!/usr/bin/env node
'use strict';
/**
 * scripts/generate-llms-txt.js
 *
 * Writes llms.txt and llms-full.txt.
 *
 * WHY THIS IS GENERATED RATHER THAN HAND-MAINTAINED
 * The previous hand-written llms.txt linked only section indexes (/news/,
 * /brands/, /witb/players/). A model deciding what to cite could see that the
 * site exists but not what is actually on it, so it had nothing specific to
 * reach for. It had also gone stale: it still advertised "The Read" on brand
 * pages months after that section was removed. Deep links plus a bake-time
 * rebuild fixes both problems at once.
 *
 * WHAT IS PRESERVED
 * The About, Data Methodology and Content Policy prose is kept verbatim. It is
 * the genuine advantage here: it is exactly what a model needs in order to cite
 * the Index accurately rather than guessing at what a DI Score means. Edit it in
 * the STATIC_* constants below, not in the output file, which is overwritten.
 *
 * llms-full.txt is the complete index of indexable URLs with titles, built from
 * the filesystem the same way sitemap.xml is, so the two cannot disagree.
 *
 *   node scripts/generate-llms-txt.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://dormied.com';

(function loadDotenv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
})();

// ── Page inventory, mirroring generate-sitemap.js ────────────────────────────

function isIndexable(filePath) {
  try {
    return !fs.readFileSync(filePath, 'utf8').includes('content="noindex');
  } catch { return false; }
}

/** Title from <title>, with the " | DORMIED" suffix stripped for readability. */
function pageTitle(filePath) {
  try {
    const html = fs.readFileSync(filePath, 'utf8');
    const m = html.match(/<title>([^<]*)<\/title>/i);
    if (!m) return null;
    return m[1]
      .replace(/\s*\|\s*DORMIED\s*$/i, '')
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      // Five articles published in April and May 2026 predate the no-em-dash
      // rule and still carry one in the headline. Normalise it here so this
      // generated index stays clean; the articles themselves are not rewritten
      // by this script, and re-titling a published page would need a re-slug.
      .replace(/\s*—\s*/g, ', ')
      .trim();
  } catch { return null; }
}

/** Every indexable {url, title} under a section directory, one level deep. */
function sectionPages(section) {
  const base = path.join(ROOT, section);
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'page') continue;
    const f = path.join(base, e.name, 'index.html');
    if (!fs.existsSync(f) || !isIndexable(f)) continue;
    out.push({ url: `${BASE}/${section}/${e.name}/`, title: pageTitle(f) || e.name, slug: e.name });
  }
  return out;
}

function loadDormiedData() {
  const src = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.DORMIED_DATA;
}

// Question-intent detection, same rule the answer-block label uses.
const QUESTION_RE = /^(who|what|where|why|when|which|how|is|are|does|do|did|can)\b/i;

// ── Static prose (preserved verbatim; see header note) ───────────────────────

const STATIC_HEADER = `# DORMIED

> Golf's brand desk. Independent monthly rankings of {BRAND_COUNT} golf brands across 10 global markets, with editorial analysis of what is moving the game.

## About

DORMIED publishes the DORMIED Index, a monthly ranking of golf brands by real search demand across the US, UK, Japan, South Korea, Canada, Australia, China, Germany, France, and Sweden. A brand's DI Score is its search volume relative to the top brand in a given period (100 = most searched). Rankings update monthly.

We cover every major segment of golf: equipment, apparel, footwear, accessories, tech and training aids, balls, shafts and grips, and lifestyle brands. All editorial content is independent. No brand pays for placement or improved ranking position.

Founded: 2024. Contact: dormiedgolf@gmail.com. Publisher: DORMIED Golf.`;

const STATIC_METHODOLOGY = `## Data Methodology

The DORMIED Index uses Google Trends search interest data as a proxy for brand relevance and consumer attention. Data is normalised so the top brand in each period scores 100. Rankings are updated monthly, typically in the first week of the following month.

Markets tracked: United States, United Kingdom, Japan, South Korea, Canada, Australia, China, Germany, France, Sweden.`;

const STATIC_POLICY = `## Content Policy

DORMIED is independent editorial content. All brand names and logos are property of their respective owners. Rankings reflect search data, not editorial opinion or commercial relationships. No brand pays for coverage or ranking position.`;

// ── Build ────────────────────────────────────────────────────────────────────

function buildLlmsTxt(data, inventory) {
  const brandCount = (data.brands || []).length;
  const month      = data.meta.currentMonth;

  // Top brands by current DI rank. Rank order is already computed into the
  // directory bake, so recompute it here the same way rather than trusting
  // whatever order the array happens to be in.
  const cm = data.meta.currentMonth;
  const ranked = [...(data.brands || [])]
    .map(b => ({ b, cur: (b.searchesByMarket && b.searchesByMarket.global && b.searchesByMarket.global[cm]) || 0 }))
    .sort((x, y) => y.cur - x.cur)
    .slice(0, 30);

  const brandLines = ranked.map((r, i) =>
    `- [${r.b.name}](${BASE}/brands/${r.b.id}/): Rank #${i + 1}, ${r.b.category || 'golf brand'}`
  ).join('\n');

  // Top WITB pages by OWGR (best-ranked players are the ones being searched).
  const witb = inventory.witb
    .filter(p => p.owgr)
    .sort((a, b) => a.owgr - b.owgr)
    .slice(0, 30)
    .map(p => `- [${p.name} WITB](${p.url}): Current bag, world #${p.owgr}`)
    .join('\n');

  // Question-shaped articles, linked with their question as the anchor text.
  const questions = inventory.news
    .filter(p => QUESTION_RE.test(p.title) || p.title.endsWith('?') || QUESTION_RE.test(p.slug.replace(/-/g, ' ')))
    .slice(0, 40)
    .map(p => `- [${p.title}](${p.url})`)
    .join('\n');

  const features = inventory.features
    .map(p => `- [${p.title}](${p.url})`)
    .join('\n');

  return `${STATIC_HEADER.replace('{BRAND_COUNT}', brandCount)}

## Pages

- [Homepage](${BASE}/): Monthly match-ups, top movers, brand scorecard, latest DORMIED news
- [Rankings (DORMIED Index)](${BASE}/rankings/): Full ${brandCount}-brand index table, sortable by 10 markets, updated monthly
- [The Scorecard](${BASE}/scorecard/): Monthly editorial breakdown of who moved, who faded, and why it matters
- [Brand Directory](${BASE}/brands/): Browse all ${brandCount} brands by category with DI scores and trend data
- [News Feed](${BASE}/news/): Original articles from golf's brand desk, tagged by brand, updated daily
- [WITB Player Directory](${BASE}/witb/players/): What tour pros play, tracked weekly across every club category
- [About](${BASE}/about/): Editorial mission, methodology, and team
- [Contact](${BASE}/contact/): Get in touch with DORMIED
- [Privacy Policy](${BASE}/privacy/): How DORMIED handles data
- [Terms](${BASE}/terms/): Terms of use
- [Full URL index](${BASE}/llms-full.txt): Every indexable page with its title
- [Sitemap](${BASE}/sitemap.xml): Full list of indexed URLs

## Brand Pages

Each of the ${brandCount} brands has a dedicated page at ${BASE}/brands/[slug]/ with:

- Current global rank and DI Score
- Month-over-month change, 3-month trend, 12-month trend
- Monthly trend chart (12 or more months of data)
- Rankings across all 10 markets (US, UK, Japan, Korea, Canada, Australia, China, Germany, France, Sweden)
- A frequently-asked-questions block covering ownership, origin and category
- Latest DORMIED news articles covering that brand

### Top 30 brands by current rank (${month})

${brandLines}

## WITB: What Tour Pros Play

Every tracked player has a page at ${BASE}/witb/players/[slug]/ listing the exact
driver, fairway woods, irons, wedges, putter, grips and ball in the current bag,
with the snapshot date and the full bag history. ${inventory.witb.length} players are tracked.

### Most-searched player bags

${witb}

## Question Articles

Articles that answer a specific question directly. Each carries a Quick Answer
block at the top and a frequently-asked-questions section.

${questions}

## Features

Long-form reporting on golf brands, founders and the business behind them.

${features}

${STATIC_METHODOLOGY}

## News Coverage

DORMIED publishes original editorial articles covering golf brand moves: equipment launches, apparel collections, athlete signings, retail shifts, marketing campaigns, and search-trend analysis. Each article is tagged to its primary brand and relevant secondary brands. Articles are available at the [News Feed](${BASE}/news/) and on individual brand pages.

## Social and Newsletter

- [X / Twitter](https://x.com/DORMIED_GOLF): Daily brand desk updates
- [Instagram](https://www.instagram.com/dormiedgolf): Visual brand coverage

${STATIC_POLICY}
`;
}

function buildLlmsFullTxt(inventory) {
  const section = (heading, pages) =>
    `## ${heading} (${pages.length})\n\n` +
    pages.map(p => `- [${p.title}](${p.url})`).join('\n') + '\n';

  const total = inventory.news.length + inventory.brands.length +
                inventory.witb.length + inventory.scorecard.length + inventory.core.length;

  return `# DORMIED: full URL index

> Every indexable page on dormied.com with its title. Generated from the same
> filesystem walk as sitemap.xml, so the two cannot disagree. See
> ${BASE}/llms.txt for what DORMIED is, how the Index is calculated, and the
> content policy.

Total indexable pages: ${total}

${section('Core pages', inventory.core)}
${section('Brand pages', inventory.brands)}
${section('News and features', inventory.news)}
${section('WITB player bags', inventory.witb)}
${section('Scorecard issues', inventory.scorecard)}`;
}

function buildInventory(data) {
  const owgrBySlug = new Map();
  // OWGR lives in Supabase, but the baked page carries it in the rank line, so
  // parse it out rather than adding a database round trip to a static bake.
  const witb = sectionPages('witb/players').map(p => {
    // Read the rendered rank chip specifically. A loose />#(\d+)</ match picks
    // up the first "#N" anywhere on the page and put an unranked player at
    // world #2. The chip holds either "#N" or the literal "Unranked".
    let owgr = null;
    try {
      const html = fs.readFileSync(path.join(ROOT, 'witb/players', p.slug, 'index.html'), 'utf8');
      const m = html.match(/<span class="witb-rank-num">\s*#(\d+)\s*<\/span>/);
      if (m) owgr = parseInt(m[1], 10);
    } catch {}
    owgrBySlug.set(p.slug, owgr);
    return { ...p, owgr, name: p.title.replace(/\s*WITB.*$/i, '').trim() };
  });

  const news = sectionPages('news');
  const featureSlugs = new Set(['who-owns-pins-and-aces', 'primo-golf', 'what-is-maejer-golf',
    'students-golf', 'take-this-job-and-shove-it', 'confidential-sources',
    'vice-golf-balls', 'who-is-arnie-mcnair']);

  const core = ['', 'rankings', 'brands', 'news', 'witb', 'witb/players', 'scorecard', 'about', 'contact', 'privacy', 'terms']
    .map(s => {
      const f = s === '' ? path.join(ROOT, 'index.html') : path.join(ROOT, s, 'index.html');
      if (!fs.existsSync(f) || !isIndexable(f)) return null;
      return { url: s === '' ? `${BASE}/` : `${BASE}/${s}/`, title: pageTitle(f) || s || 'Homepage' };
    })
    .filter(Boolean);

  return {
    core,
    brands:    sectionPages('brands'),
    news,
    features:  news.filter(p => featureSlugs.has(p.slug)),
    witb,
    scorecard: sectionPages('scorecard'),
  };
}

function main() {
  const data      = loadDormiedData();
  const inventory = buildInventory(data);

  const llms     = buildLlmsTxt(data, inventory);
  const llmsFull = buildLlmsFullTxt(inventory);

  if (llms.includes('—') || llmsFull.includes('—')) {
    throw new Error('[llms] em dash found in output, aborting');
  }

  fs.writeFileSync(path.join(ROOT, 'llms.txt'), llms, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'llms-full.txt'), llmsFull, 'utf8');

  console.log(`[llms] llms.txt      ${llms.length} bytes`);
  console.log(`[llms] llms-full.txt ${llmsFull.length} bytes`);
  console.log(`[llms] indexed: ${inventory.brands.length} brands, ${inventory.news.length} news, ` +
              `${inventory.witb.length} WITB, ${inventory.scorecard.length} scorecard, ${inventory.core.length} core`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('[llms] Fatal:', e.message); process.exit(1); }
}

module.exports = { main };
