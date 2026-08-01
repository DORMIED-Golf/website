#!/usr/bin/env node
/**
 * scripts/generate-feature.js
 *
 * Generates STANDALONE feature article pages (editorial / partner features that
 * do not fit the AI brand-article pipeline). Reuses the standard article page
 * chrome (head, GTM, Grow, header/nav, LATEST sidebar, footer) but renders a
 * rich HTML body (inline figures, section figures, two-up rows, galleries,
 * data tables, FAQ), flexible byline, optional brand tag, and no brand card.
 *
 * Config-driven: each feature is an entry in FEATURES, selected by argv.
 *   node scripts/generate-feature.js confidential-sources
 *   node scripts/generate-feature.js vice-golf-balls
 *
 * Requires .env with SUPABASE_URL + SUPABASE_SERVICE_KEY (LATEST sidebar bake +
 * DORMIED_DATA brand metrics for the feed cards + dormied_articles upsert).
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { createClient } = require('@supabase/supabase-js');
const feedBake = require('./feed-bake');

const ROOT = path.resolve(__dirname, '..');

// Baked sidebar modules HTML (Brands on the Move / Recently Updated Bags).
// Set in main() via feedBake.fetchSidebarModulesHtml; '' when unavailable.
let SIDEBAR_MODULES_HTML = '';
// Set in main() before buildPage, same pattern as SIDEBAR_MODULES_HTML.
// BRAND_CARD_HTML  = the DORMIED INDEX card for the feature's brand.
// SHOP_SECTION_HTML = the affiliate carousel mount point, emitted ONLY when the
// brand has an active affiliate_programs row (empty string for every other brand).
let BRAND_CARD_HTML = '';
let SHOP_SECTION_HTML = '';
let TOP_STORIES_HTML = '';
let FEATURED_HTML = '';

// ── Feature definitions ─────────────────────────────────────────────────────────
const FEATURES = {
  'pins-and-aces': {
    slug: 'who-owns-pins-and-aces',
    title: 'Who Owns Pins & Aces? One Ugly Headcover, Two Brothers-in-Law, and a $20 Million Golf Brand',
    titleTag: 'Who Owns Pins & Aces? Founders, Edel Deal + Revenue | DORMIED',
    byline: 'Adam R.',
    authors: ['Adam R.'],
    category: 'Feature',
    brandSlug: 'pins-and-aces',
    inlineCommerce: true,   // DORMIED Index card + Shop carousel after the body
    leadRole: 'bio',
    lastUpdated: 'July 25, 2026',
    dateModified: '2026-07-25T00:00:00.000Z',
    publishedAt: '2026-07-25T15:00:00.000Z',
    metaDescription: 'Who owns Pins & Aces? The two brothers-in-law who founded it in 2018, how a headcover complaint became a $20 million brand, the Edel Golf acquisition, and what the data shows.',
    seoKeywords: ['who owns pins and aces', 'pins and aces', 'pins and aces golf', 'pins and aces founders', 'pins and aces edel golf', 'nick mertz jon major'],
    mdPath: path.join(ROOT, 'article-pins-and-aces.md'),
    imgBase: '/images/features/pins-and-aces',
    // Every caption carries the supplied photo credit ("Photo by ...").
    hero: { file: 'hero.webp', w: 1400, h: 1549, alt: 'The Pins & Aces team outside the company storefront at 5280 Ward Drive in Arvada, Colorado', caption: 'The Pins & Aces team outside the Arvada, Colorado headquarters at 5280 Ward Drive, an address the founders treat as a good omen in the Mile High City. Photo by Christian Marcy-Vega.' },
    sectionImages: {
      'It started with a headcover nobody wanted to make': { layout: 'two-up', images: [
        { file: 'headcover-ace.webp', w: 637, h: 637, alt: 'Pins & Aces Ace of Spades blade putter headcover', caption: 'The ace of spades, the mark the whole company is named for. Headcovers top out around $65. Photo by Pins & Aces.' },
        { file: 'headcover-towelie.webp', w: 600, h: 750, alt: 'Pins & Aces South Park Towelie blade putter cover', caption: 'The irreverent catalog that built the audience, from South Park covers to voodoo dolls and the LiquorStick. Photo by Pins & Aces.' },
      ]},
      'The people\'s brand, and the price ceiling that defines it': { layout: 'two-up', images: [
        { file: 'apparel-rack.webp', w: 1400, h: 933, alt: 'Pins & Aces polos and headcovers on a rack at the Arvada facility', caption: 'No polo on the site costs more than $70. Packing, shipping, photography, and embroidery are all handled in house. Photo by Brendan O\'Keeffe.' },
        { file: 'podcast-room.webp', w: 1400, h: 991, alt: 'The podcast room inside the Pins & Aces facility in Arvada, Colorado', caption: 'Inside the 14,000-square-foot Arvada facility the company bought in 2022, where 34 employees run a business that is roughly 80 percent direct to consumer. Photo by Christian Marcy-Vega.' },
      ]},
      'Growing up: bags, polos, and the bunker-to-boardroom pivot': { layout: 'single', images: [
        { file: 'player-preferred-bags.webp', w: 1200, h: 1500, alt: 'Two Pins & Aces Player Preferred stand bags on a golf course', caption: 'The Player Preferred stand bag sells at $330 against competitors clustered around $450, and became one of the company\'s best sellers. R&D ran through caddies at Turnberry. Photo by Pins & Aces.' },
      ]},
      'The Edel acquisition, and what the data says about it': { layout: 'single', images: [
        { file: 'edel-irons.webp', w: 900, h: 600, alt: 'Edel Golf SMS irons, the custom-fit clubs Pins & Aces acquired', caption: 'Edel Golf SMS irons. Pins & Aces announced the acquisition in December 2024 and cut Edel\'s prices after taking over. Photo by Lucas Botz, courtesy Edel Golf.' },
      ]},
      'Rafael Campos and the accidental endorsement': { layout: 'single', images: [
        { file: 'campos-win.webp', w: 1400, h: 933, alt: 'Rafael Campos winning the 2024 Butterfield Bermuda Championship', caption: 'Rafael Campos won the 2024 Butterfield Bermuda Championship in his 80th start, six days after his daughter was born, wearing a $70 polo he was not paid to wear. Photo by PGA Tour.' },
      ]},
    },
  },

  'primo-golf': {
    slug: 'primo-golf',
    title: 'Who Owns Primo Golf? Four Cousins, One DM, and Phil Mickelson in Joggers',
    titleTag: 'Who Owns Primo Golf? Cousins, Grant Horvat + Mickelson | DORMIED',
    byline: 'Adam R.',
    authors: ['Adam R.'],
    category: 'Feature',
    brandSlug: 'primo-golf-apparel',
    leadRole: 'bio',
    lastUpdated: 'July 20, 2026',
    dateModified: '2026-07-20T00:00:00.000Z',
    publishedAt: '2026-07-20T15:00:00.000Z',
    metaDescription: 'Who owns Primo Golf? The four cousins who founded it, how Grant Horvat bought in, why Phil Mickelson put his LIV team in Primo joggers, and what the data shows.',
    seoKeywords: ['who owns primo golf', 'primo golf', 'primo golf apparel', 'grant horvat primo', 'primo golf joggers', 'phil mickelson primo'],
    mdPath: path.join(ROOT, 'article-primo-golf.md'),
    imgBase: '/images/features/primo-golf',
    // Every caption carries the supplied photo credit ("Photo by ...").
    hero: { file: 'hero.webp', w: 1200, h: 800, alt: 'Primo Golf Apparel lookbook, golf joggers and apparel', caption: 'The Primo Golf Apparel lookbook. The brand launched around a single product, the golf jogger. Photo by Primo Golf Apparel.' },
    sectionImages: {
      'Four cousins and a jogger': { layout: 'single', images: [
        { file: 'founders.webp', w: 1000, h: 1000, alt: 'The four founding cousins of Primo Golf Apparel', caption: 'The four cousins behind Primo: Matty Gay and Jason, Jordan, and Kirk Williamson. Photo by Primo Golf Apparel.' },
      ]},
      'The DM that changed the company': { layout: 'single', images: [
        { file: 'horvat-signing.webp', w: 399, h: 501, alt: 'Grant Horvat signing his ownership deal with Primo Golf', caption: 'Grant Horvat became Primo\'s first owner from outside the founding family in March 2024, three years after the brand DMed him. Photo by Primo Golf Apparel.' },
        { file: 'horvat-website.webp', w: 1100, h: 817, alt: 'Grant Horvat modeling Primo Golf apparel on the brand\'s website', caption: 'Now an owner and the brand\'s most visible face, Horvat models Primo across its own storefront. Photo by Primo Golf Apparel.' },
      ]},
      'Phil Mickelson, a lost bet, and LIV': { layout: 'two-up', images: [
        { file: 'mickelson-joggers.webp', w: 966, h: 544, alt: 'Phil Mickelson wearing Primo golf joggers', caption: 'Phil Mickelson wore Primo joggers at the Open Championship after losing a bet to Grant Horvat. Photo by Rob Casey / SNS Group.' },
        { file: 'liv-hyflyers.webp', w: 1000, h: 667, alt: 'Phil Mickelson\'s HyFlyers GC team in Primo apparel at LIV Golf', caption: 'Primo became the official apparel sponsor of Mickelson\'s HyFlyers GC, debuting at LIV Golf in February 2025. Photo by Utah Golf Association.' },
      ]},
      'Where Primo fits': { layout: 'single', images: [
        { file: 'si-woo-kim.webp', w: 1000, h: 667, alt: 'PGA Tour winner Si Woo Kim wearing Primo Golf apparel', caption: 'Primo has begun appearing on individual tour pros beyond the HyFlyers deal, including PGA Tour winner Si Woo Kim. Photo by Irish Star.' },
      ]},
    },
  },

  'students-golf': {
    slug: 'students-golf',
    title: "What Is Students Golf? The Man Who Invented the Jogger Is Now Golf's Coolest Designer",
    titleTag: "What Is Students Golf? The Jogger Inventor's Golf Brand | DORMIED",
    byline: 'Adam R.',
    authors: ['Adam R.'],
    category: 'Feature',
    brandSlug: 'students-golf',
    leadRole: 'bio',
    lastUpdated: 'July 17, 2026',
    dateModified: '2026-07-17T00:00:00.000Z',
    publishedAt: '2026-07-17T15:00:00.000Z',
    metaDescription: 'What is Students Golf? The LA golf brand from jogger inventor Michael Huynh, the health scare that started it, and what the DORMIED Index says about its rise.',
    seoKeywords: ['students golf', 'what is students golf', 'michael huynh', 'students golf brand', 'jogger inventor', 'students sugarloaf social club'],
    mdPath: path.join(ROOT, 'article-students-golf.md'),
    imgBase: '/images/features/students-golf',
    // Every caption carries the supplied photo credit ("Photo by ...").
    hero: { file: 'hero.webp', w: 1200, h: 960, alt: 'Students Golf Summer 2026 apparel lookbook grid', caption: 'The Students Golf Summer 2026 lookbook. Photo by Students Golf.' },
    sectionImages: {
      'The health scare that started it': { layout: 'single', images: [
        { file: 'huynh-portrait.webp', w: 540, h: 304, alt: 'Michael Huynh, founder of Students Golf and the streetwear label Publish', caption: 'Michael Huynh, the Publish founder and jogger inventor who started Students after a health scare pushed him toward golf. Photo by The Hundreds.' },
      ]},
      'What Students actually makes': { layout: 'single', images: [
        { file: 'students-hoodies.webp', w: 1000, h: 1300, alt: 'Students Golf hoodies and graphic apparel', caption: 'Students built its early identity off the course with graphic tees, hoodies, and pullovers. Photo by HBX.' },
      ]},
      'The Sugarloaf collab and the company Students keeps': { layout: 'single', images: [
        { file: 'sugarloaf-collab.webp', w: 1000, h: 667, alt: 'Students of Sugarloaf Social Club collaboration apparel', caption: 'Students of Sugarloaf Social Club, the March 2026 collaboration Boardroom called one of the coolest golf collabs of the year. Photo by Students Golf.' },
      ]},
    },
  },

  'take-this-job-and-shove-it': {
    slug: 'take-this-job-and-shove-it',
    title: 'Take This Job and Shove It',
    titleTag: 'Take This Job and Shove It: A Country Club Confidential Story | DORMIED',
    byline: 'Adam R. and Travis R.',
    authors: ['Adam R.', 'Travis R.'],
    category: 'Feature',
    brandSlug: '',
    leadRole: 'subtitle',
    publishedAt: '2026-07-16T15:00:00.000Z',
    metaDescription: 'A Country Club Confidential story, running in full on DORMIED: an assistant pro, a tyrant boss, and the most elaborate resignation in golf. Plus the behind-the-scenes from the anonymous founders.',
    seoKeywords: ['Country Club Confidential', 'golf pro shop story', 'take this job and shove it', 'assistant pro resignation', 'golf newsletter', 'DORMIED'],
    mdPath: path.join(ROOT, 'article-ccc-take-this-job.md'),
    imgBase: '/images/features/take-this-job-and-shove-it',
    // Single hero image; no in-body figures.
    hero: { file: 'hero.webp', w: 1200, h: 630, alt: 'Take This Job and Shove It, a Country Club Confidential story on DORMIED: a golf cart merchandised inside a pro shop' },
  },

  'confidential-sources': {
    slug: 'confidential-sources',
    title: 'Confidential Sources',
    byline: 'Adam and Travis',
    authors: ['Adam', 'Travis'],
    category: 'Feature',
    brandSlug: '',
    leadRole: 'subtitle',
    metaDescription: 'How Country Club Confidential turned the stories that circulate inside private golf into a real media business. The anonymous founders explain how.',
    seoKeywords: ['Country Club Confidential', 'golf newsletter', 'private golf', 'golf media', 'DORMIED'],
    mdPath: path.join(ROOT, 'article-ccc-confidential-sources.md'),
    imgBase: '/images/features/confidential-sources',
    // CCC images are inline (md ![] by order); index 0 is the hero.
    hero: { file: 'hero.webp', w: 1200, h: 630, alt: 'Country Club Confidential feature, DORMIED' },
    inlineImages: [
      { file: 'hero.webp',        w: 1200, h: 630,  alt: 'Country Club Confidential feature, DORMIED', caption: '' },
      { file: 'subpar.webp',      w: 1200, h: 675,  alt: 'Country Club Confidential founder on the Subpar podcast with face blurred', caption: 'Even on camera, the mask stays on. A CCC founder joins Subpar hosts Colt Knost and Drew Stoltz, face blurred, which is exactly the idea.' },
      { file: 'openrate.webp',    w: 1200, h: 700,  alt: 'Country Club Confidential newsletter open-rate visual', caption: '' },
      { file: 'subscribers.webp', w: 1179, h: 1008, alt: 'Country Club Confidential subscriber-growth chart from mid-2024 to early 2026', caption: 'Active subscribers from mid-2024 to early 2026. The near-vertical climb on the right, what CCC calls the Subpar effect, traces back to a single magazine handed over in a parking lot.' },
      { file: 'video.webp',       w: 1200, h: 675,  alt: 'Country Club Confidential video series still', caption: 'The video series that became CCC’s most expensive lesson: comedian hosts, a celebrity narrator, a real budget, and about two thousand views. The format, it turned out, was the product.' },
      { file: 'wrongcut.webp',    w: 1200, h: 630,  alt: 'Country Club Confidential The Wrong Cut story title card', caption: '"The Wrong Cut" story. Names changed, club unidentified, ending sharpened when the truth ran out. That is the house method in one title card.' },
    ],
  },

  'vice-golf-balls': {
    slug: 'vice-golf-balls',
    title: "Vice Golf Balls: The Full Lineup, the Customization, and the Data Behind Golf's Fastest-Rising Ball Brand",
    titleTag: 'Vice Golf Balls: Full Lineup, Customization, and the Data | DORMIED',
    byline: 'Travis',
    authors: ['Travis'],
    category: 'Feature',
    brandSlug: 'vice-golf',
    leadRole: 'bio',
    lastUpdated: 'May 28, 2026',
    dateModified: '2026-05-28T00:00:00.000Z',
    metaDescription: 'Every Vice golf ball explained: Pro Plus, Pro, Pro Air, Tour, and Drive, plus customization, colors, and why Vice is golf\'s fastest-rising ball brand.',
    seoKeywords: ['vice golf balls', 'vice pro plus', 'vice pro', 'vice golf ball customization', 'best vice golf ball'],
    mdPath: path.join(ROOT, 'article-vice-golf-balls.md'),
    imgBase: '/images/features/vice-golf-balls',
    hero: { file: 'hero.webp', w: 1200, h: 859, alt: 'Vice Golf balls, the full lineup' },
    // Vice images are injected after the matching section heading.
    sectionImages: {
      'Vice Pro Plus: the fast-swing flagship': { layout: 'two-up', images: [
        { file: 'proplus.webp', w: 800, h: 800, alt: 'Vice Pro Plus golf ball', caption: 'The Vice Pro Plus, the four-piece cast-urethane flagship for fast swing speeds.' },
        { file: 'proplus-cutaway.webp', w: 800, h: 800, alt: 'Vice Pro Plus four-layer construction cutaway: core, outer mantle, inner mantle, cast urethane cover', caption: 'Inside the Pro Plus: a lightweight speed core, high-performance resin outer mantle, Surlyn inner mantle, and a cast urethane cover.' },
      ]},
      'Vice Pro: the all-around tour ball': { layout: 'single', images: [
        { file: 'pro.webp', w: 800, h: 800, alt: 'Vice Pro golf ball', caption: 'The Vice Pro, the three-piece cast-urethane all-rounder and the closest Vice ball to a traditional tour ball.' },
      ]},
      'Vice Pro Air: the soft, high-launch urethane': { layout: 'single', images: [
        { file: 'proair.webp', w: 800, h: 800, alt: 'Vice Pro Air golf ball', caption: 'The Vice Pro Air, the soft-feel, high-launch cast-urethane ball that replaced the Pro Soft.' },
      ]},
      'Vice Tour: the Surlyn all-rounder': { layout: 'single', images: [
        { file: 'tour.webp', w: 800, h: 800, alt: 'Vice Tour golf ball', caption: 'The Vice Tour, the three-piece Surlyn-covered value all-rounder.' },
      ]},
      'Vice Drive: the two-piece distance ball': { layout: 'single', images: [
        { file: 'drive.webp', w: 800, h: 800, alt: 'Vice Drive golf ball', caption: 'The Vice Drive, the two-piece Surlyn distance ball and the entry point to the range.' },
      ]},
      'Vice golf ball customization': { layout: 'single', images: [
        { file: 'custom-dog.webp', w: 1000, h: 1333, alt: "Custom Vice golf ball printed with a dog's face next to a standard Vice ball", caption: "A real Vice customization job: the author's dog printed on a dozen, most of which now live in ponds and fescue." },
      ]},
      'The colors, the Drip, and the special editions': { layout: 'gallery', images: [
        { file: 'shade-galaxy.webp', w: 600, h: 600, alt: 'Vice Pro Shade Galaxy golf ball', caption: "The Vice Pro Shade Galaxy, part of the brand's gradient Shade line." },
        { file: 'cotton-candy.webp', w: 700, h: 700, alt: 'Vice Pro Air Cotton Candy golf ball', caption: "The Cotton Candy Pro Air, one of Vice's rotating special-edition colorways." },
        { file: 'greg-mike.webp', w: 800, h: 800, alt: 'Vice Greg Mike collaboration golf balls', caption: 'The Greg Mike collaboration, the kind of artist-driven drop that pulls buyers who never think about which ball they play.' },
        { file: 'special-tracer.webp', w: 700, h: 700, alt: 'Vice Pro Special Tracer golf ball', caption: "Vice's Tracer alignment system, a dual-color graphic that doubles as an aim line and a putting feedback tool." },
      ]},
      'How Vice golf balls compare on price': { layout: 'single', images: [
        { file: 'variety-pack.webp', w: 800, h: 800, alt: 'Vice Golf variety pack of golf balls', caption: 'The Vice variety pack lets golfers test the full range before committing to a volume order.' },
      ]},
    },
  },

  'who-is-arnie-mcnair': {
    slug: 'who-is-arnie-mcnair',
    title: 'Who Is Arnie McNair? How an Anonymous Golfer Built a Cult Brand',
    titleTag: 'Who Is Arnie McNair? The Anonymous Golfer Behind the Cult Brand | DORMIED',
    byline: 'Adam R.',
    authors: ['Adam'],
    category: 'Feature',
    brandSlug: 'arnie-mcnair',
    leadRole: 'bio',
    lastUpdated: 'July 9, 2026',
    dateModified: '2026-07-09T00:00:00.000Z',
    metaDescription: 'Who is Arnie McNair? The anonymous Minnesota golfer behind the cult American-made apparel brand, what the $95 McNair Polo is, and what the DORMIED data shows.',
    seoKeywords: ['arnie mcnair', 'arnie mcnair clothing', 'arnie mcnair golf', 'arnie mcnair polo', 'who is arnie mcnair'],
    mdPath: path.join(ROOT, 'article-arnie-mcnair.md'),
    imgBase: '/images/features/arnie-mcnair',
    hero: { file: 'hero.webp', w: 1200, h: 779, alt: 'Arnie McNair golf polos in navy, pink, and white' },
    // Images injected after the matching section heading.
    sectionImages: {
      'The Burnerverse origin story': { layout: 'single', images: [
        { file: 'x-profile.webp', w: 884, h: 512, alt: 'Arnie McNair verified profile on X, @therealmcnair', caption: 'The account that started it. Arnie McNair built a following posting as an anonymous country club traditionalist on golf X before the brand existed.' },
      ]},
      'What the clothes actually are': { layout: 'single', images: [
        { file: 'polo-navy.webp', w: 1000, h: 1326, alt: 'Navy Arnie McNair McNair Polo on a hanger, with a Made in the USA flag label', caption: 'The McNair Polo. Made in the USA from Supima cotton, with no visible logo and the flag on the label rather than the chest.' },
      ]},
      'Why the anonymity works': { layout: 'single', images: [
        { file: 'am-visor.webp', w: 1000, h: 1334, alt: 'White Arnie McNair AM visor with an American flag, beside classic leather golf shoes', caption: 'The look is deliberately traditional: natural fibers, an American flag, and no oversized branding.' },
      ]},
    },
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function loadDormiedData() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(raw, ctx);
    return ctx.window.DORMIED_DATA;
  } catch (e) {
    console.warn('[feature] Could not load DORMIED_DATA:', e.message);
    return null;
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function readTime(words) { return Math.max(1, Math.round(words / 200)) + ' min read'; }

/** Inline Markdown: links [text](url), **strong**, *emphasis*. Escapes the rest. */
function autoLinkBrands(html, ctx) {
  if (!ctx) return html;
  for (const { name, slug } of ctx.brands) {
    if (ctx.linked.has(slug)) continue;
    const escapedName = escHtml(name);
    const pat = escapedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\w/"\\-])${pat}(?![\\w"\\-])`);
    if (re.test(html)) {
      html = html.replace(re, `<a href="/brands/${slug}/" class="da-brand-link">${escapedName}</a>`);
      ctx.linked.add(slug);
    }
  }
  return html;
}

function buildBrandCtx(dormiedData) {
  const brands = ((dormiedData && dormiedData.brands) || [])
    .filter(b => b.id && b.name)
    .map(b => ({ name: b.name, slug: b.id }))
    .sort((a, b) => b.name.length - a.name.length);
  return { brands, linked: new Set() };
}

function inlineMd(text, brandCtx) {
  const links = [];
  let t = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, anchor, url) => {
    links.push({ anchor, url });
    return 'L' + (links.length - 1) + '';
  });
  t = escHtml(t);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  if (brandCtx) t = autoLinkBrands(t, brandCtx);
  t = t.replace(/L(\d+)/g, (m, i) => {
    const { anchor, url } = links[+i];
    const external = !/^https?:\/\/(www\.)?dormied\.com(\/|$)/i.test(url.trim());
    const attrs = external ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${escHtml(url)}"${attrs}>${escHtml(anchor)}</a>`;
  });
  return t;
}

/** Strip Markdown to plain text (DB body / search index). */
function mdToPlain(md) {
  return md.replace(/\r\n/g, '\n').split(/\n\n+/).map(b => b.trim()).filter(Boolean)
    .filter(b => !b.startsWith('# ') && !/^\*By .*\*$/.test(b) && !/^!\[/.test(b) && !/^-{3,}$/.test(b) && !/^\|/.test(b))
    .map(b => b.replace(/^#{2,3}\s+/, '')
               .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
               .replace(/\*\*([^*]+)\*\*/g, '$1')
               .replace(/\*([^*]+)\*/g, '$1'))
    .join('\n\n');
}

function figureHtml(F, img, eager) {
  const cap = img.caption ? `<figcaption class="da-figcaption">${inlineMd(img.caption)}</figcaption>` : '';
  return `<figure class="da-figure">`
    + `<img src="${F.imgBase}/${img.file}" alt="${escHtml(img.alt)}" width="${img.w}" height="${img.h}" loading="${eager ? 'eager' : 'lazy'}">`
    + cap + `</figure>`;
}

function renderSectionImages(F, sec) {
  if (!sec || !sec.images || !sec.images.length) return '';
  if (sec.layout === 'two-up') {
    return `<div class="da-figure-row">${sec.images.map(im => figureHtml(F, im, false)).join('')}</div>`;
  }
  if (sec.layout === 'gallery') {
    return `<div class="da-figure-grid">${sec.images.map(im => figureHtml(F, im, false)).join('')}</div>`;
  }
  return sec.images.map(im => figureHtml(F, im, false)).join('\n              ');
}

/** Markdown pipe table -> responsive HTML table (sc-table pattern). */
function tableHtml(block) {
  const rows = block.split('\n').map(l => l.trim()).filter(Boolean);
  const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2); // rows[1] is the |---| separator
  const thead = `<thead><tr>${head.map(c => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${body.map(r => `<tr>${cells(r).map(c => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<div class="sc-table-wrap"><table class="sc-table">${thead}${tbody}</table></div>`;
}

// ── Markdown parse ───────────────────────────────────────────────────────────────
function parseMarkdown(md, F, dormiedData) {
  const blocks = md.replace(/\r\n/g, '\n').split(/\n\n+/).map(b => b.trim()).filter(Boolean);
  const brandCtx = buildBrandCtx(dormiedData);  // auto-links brand names in prose
  const out = [];
  const faqs = [];
  let lead = '';
  let words = 0;
  let inlineIdx = 0;          // for CCC inline ![] images
  let pendingSection = null;  // for Vice section images (flush at next heading)
  let inFaq = false;
  const sectionImages = F.sectionImages || {};

  function flushSection() {
    if (pendingSection) { out.push(renderSectionImages(F, pendingSection)); pendingSection = null; }
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    if (b.startsWith('# '))            continue;                  // H1 (chrome)
    if (/^\*By .*\*$/.test(b))         continue;                  // byline (chrome)
    if (!lead && /^\*.+\*$/.test(b)) { lead = b.replace(/^\*|\*$/g, ''); continue; } // deck/bio

    // Inline image (CCC): map by order; index 0 is the hero (skip in body).
    const imgMatch = b.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (imgMatch && F.inlineImages) {
      const cfg = F.inlineImages[inlineIdx];
      if (inlineIdx > 0 && cfg) out.push(figureHtml(F, cfg, false));
      inlineIdx++;
      if (blocks[i + 1] && /^\*.+\*$/.test(blocks[i + 1]) && !/^\*By /.test(blocks[i + 1])) i++; // skip md caption
      continue;
    }

    // Headings
    if (b.startsWith('### ')) {
      flushSection();
      const h = b.slice(4).trim();
      inFaq = false;
      words += h.split(/\s+/).length;
      out.push(`<h3 class="sc-sub-heading">${inlineMd(h)}</h3>`);
      pendingSection = sectionImages[h] || null;
      continue;
    }
    if (b.startsWith('## ')) {
      flushSection();
      const h = b.slice(3).trim();
      inFaq = (h.toLowerCase() === 'faq');
      words += h.split(/\s+/).length;
      out.push(`<h2 class="sc-main-heading">${inlineMd(h)}</h2>`);
      pendingSection = sectionImages[h] || null;
      continue;
    }

    if (/^-{3,}$/.test(b)) { flushSection(); out.push('<hr class="da-article-hr">'); continue; }

    // Pipe table
    if (b.split('\n')[0].trim().startsWith('|')) { out.push(tableHtml(b)); continue; }

    // FAQ Q/A block: "**Question?**\nAnswer..."
    if (inFaq && /^\*\*[^*]+\*\*/.test(b)) {
      const nl = b.indexOf('\n');
      const qRaw = (nl === -1 ? b : b.slice(0, nl)).replace(/^\*\*|\*\*$/g, '').trim();
      const aRaw = nl === -1 ? '' : b.slice(nl + 1).trim();
      words += b.split(/\s+/).length;
      faqs.push({ q: qRaw, a: aRaw });
      out.push(`<div class="da-faq-item"><h3 class="da-faq-q">${inlineMd(qRaw)}</h3><p class="da-faq-a">${inlineMd(aRaw, brandCtx)}</p></div>`);
      continue;
    }

    // Paragraph
    words += b.replace(/\[[^\]]*\]\([^)]*\)/g, m => m.replace(/\([^)]*\)/, '')).split(/\s+/).length;
    out.push(`<p>${inlineMd(b, brandCtx)}</p>`);
  }
  flushSection();
  return { lead, bodyHtml: out.join('\n              '), wordCount: words, faqs };
}

// ── Page template ────────────────────────────────────────────────────────────────
function buildPage(F, parsed, dormiedLatestHtml) {
  const { lead, bodyHtml, wordCount, faqs } = parsed;
  const publishedAt   = F.publishedAt;
  const dateISO       = new Date(publishedAt).toISOString();
  const modISO        = F.dateModified || dateISO;
  const dateFormatted = formatDate(publishedAt);
  const canonicalUrl  = `https://dormied.com/news/${F.slug}/`;
  const titleTag      = F.titleTag || `${F.title} | DORMIED`;
  const ogImage       = `https://dormied.com${F.imgBase}/${F.hero.file}`;
  const keywordsStr   = (F.seoKeywords || []).join(', ');
  const rt            = readTime(wordCount);
  const authorsLd     = F.authors.map(a => `{ "@type": "Person", "name": "${escHtml(a)}", "url": "https://dormied.com/about/" }`).join(', ');
  const authorLdField = F.authors.length > 1 ? `[${authorsLd}]` : authorsLd;

  const subtitleHtml = (F.leadRole === 'subtitle' && lead) ? `<p class="sc-article-subtitle">${escHtml(lead)}</p>` : '';
  const lastUpdHtml  = F.lastUpdated ? `<p class="da-last-updated">Last updated: ${escHtml(F.lastUpdated)}</p>` : '';
  const bioHtml      = (F.leadRole === 'bio' && lead) ? `<p class="da-bio">${inlineMd(lead)}</p>` : '';

  const heroCap  = F.hero.caption
    ? `\n          <figcaption class="da-figcaption sc-article-hero-caption">${inlineMd(F.hero.caption)}</figcaption>`
    : '';
  const heroHtml = `<figure class="sc-article-image${heroCap ? ' sc-article-image--cap' : ''}">
          <img class="sc-article-hero-img" src="${F.imgBase}/${F.hero.file}" alt="${escHtml(F.hero.alt)}" width="${F.hero.w}" height="${F.hero.h}" loading="eager">${heroCap}
        </figure>`;

  // FAQPage JSON-LD (answers use the same plain text shown on-page)
  const faqLd = faqs.length ? `
  <script type="application/ld+json">
  ${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  })}
  </script>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-N4Q8J6L3');</script>
  <!-- End Google Tag Manager -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title>${escHtml(titleTag)}</title>
  <meta name="description" content="${escHtml(F.metaDescription)}">
  <meta name="keywords" content="${escHtml(keywordsStr)}">
  <meta name="author" content="${escHtml(F.byline)}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" href="${canonicalUrl}">

  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="apple-touch-icon" href="/images/dormied-icon.png">

  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${escHtml(F.title)}">
  <meta property="og:description" content="${escHtml(F.metaDescription)}">
  <meta property="og:image" content="${escHtml(ogImage)}">
  <meta property="og:image:width" content="${F.hero.w}">
  <meta property="og:image:height" content="${F.hero.h}">
  <meta property="og:site_name" content="DORMIED">
  <meta property="og:locale" content="en_US">
  <meta property="article:published_time" content="${dateISO}">
  <meta property="article:modified_time" content="${modISO}">
  <meta property="article:author" content="${escHtml(F.byline)}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@DORMIED_GOLF">
  <meta name="twitter:title" content="${escHtml(F.title)}">
  <meta name="twitter:description" content="${escHtml(F.metaDescription)}">
  <meta name="twitter:image" content="${escHtml(ogImage)}">

  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
  <link rel="stylesheet" href="/css/fonts.css">
  <link rel="stylesheet" href="/css/styles.css?v=20260726">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": ${JSON.stringify(F.title)},
    "description": "${escHtml(F.metaDescription)}",
    "image": "${escHtml(ogImage)}",
    "datePublished": "${dateISO}",
    "dateModified": "${modISO}",
    "author": ${authorLdField},
    "publisher": { "@type": "Organization", "name": "DORMIED", "url": "https://dormied.com", "logo": { "@type": "ImageObject", "url": "https://dormied.com/images/dormied-logo-colour.png" } },
    "url": "${canonicalUrl}",
    "breadcrumb": {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home",  "item": "https://dormied.com/" },
        { "@type": "ListItem", "position": 2, "name": "News",  "item": "https://dormied.com/news/" },
        { "@type": "ListItem", "position": 3, "name": ${JSON.stringify(F.title)}, "item": "${canonicalUrl}" }
      ]
    }
  }
  </script>${faqLd}
  <!-- Grow.me -->
  <script data-grow-initializer="">!(function(){window.growMe||((window.growMe=function(e){window.growMe._.push(e);}),(window.growMe._=[]));var e=document.createElement("script");(e.type="text/javascript"),(e.src="https://faves.grow.me/main.js"),(e.defer=!0),e.setAttribute("data-grow-faves-site-id","U2l0ZTowNjk5NTY3Ny0xMzU0LTQ5M2YtOWEyYi03Y2NkOTlkNWE3YWQ=");var t=document.getElementsByTagName("script")[0];t.parentNode.insertBefore(e,t);})();</script>
  <!-- Mediavine Journey ads -->
  <script type="text/javascript" async="async" data-noptimize="1" data-cfasync="false" src="//scripts.scriptwrapper.com/tags/06995677-1354-493f-9a2b-7ccd99d5a7ad.js"></script>
</head>
<body>

  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>

  <header class="site-header" role="banner">
    <div class="container header-inner">
      <a href="/" class="site-logo" aria-label="DORMIED home">
        <img src="/images/dormied-logo-colour.png" alt="DORMIED" class="logo-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="logo-text-fallback" style="display:none">DORMIED</span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a href="/rankings/"  class="site-nav-link">Index</a>
        <a href="/witb/"      class="site-nav-link">WITB</a>
        <a href="/scorecard/" class="site-nav-link">Scorecard</a>
        <a href="/news/"      class="site-nav-link site-nav-link--active">News</a>
        <a href="/brands/"    class="site-nav-link">Brands</a>
      </nav>
      <button class="nav-hamburger" id="nav-hamburger" aria-label="Open navigation menu" aria-expanded="false" aria-controls="mobile-nav-panel">
        <span class="bars" aria-hidden="true"><span class="bar"></span><span class="bar"></span><span class="bar"></span></span>
      </button>
      <div class="site-search">
        <button class="site-search-trigger" aria-label="Search" aria-haspopup="true" aria-expanded="false">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
          <span class="site-search-trigger-label">Search</span>
        </button>
        <div class="site-search-panel" hidden>
          <div class="site-search-input-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;opacity:.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="search" class="site-search-input" placeholder="Search brands, news, scorecard…" autocomplete="off" aria-label="Search dormied.com">
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
      <a href="/news/"      class="mobile-nav-link active">News</a>
      <a href="/brands/"    class="mobile-nav-link">Brands</a>
    </nav>
  </header>

  <main id="main-content">

    <nav class="breadcrumb container" aria-label="Breadcrumb">
      <a href="/" class="breadcrumb-link">Home</a>
      <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
      <a href="/news/" class="breadcrumb-link">News</a>
      <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
      <span class="breadcrumb-item--current" aria-current="page">${escHtml(F.title)}</span>
    </nav>

    <header class="da-article-header container">
      <a href="/news/" class="sc-label sc-label--link">News</a>
      <h1 class="sc-article-title">${escHtml(F.title)}</h1>
      ${subtitleHtml}
      <p class="sc-article-byline">By ${escHtml(F.byline)} &nbsp;·&nbsp; <time datetime="${dateISO}">${escHtml(dateFormatted)}</time> &nbsp;·&nbsp; ${escHtml(F.category)} &nbsp;·&nbsp; ${escHtml(rt)}</p>
      ${lastUpdHtml}
    </header>

    <section class="da-article-section">
      <div class="container">
        <div class="table-layout table-layout--post">

          <div class="sc-article-main">

            ${heroHtml}

            <div class="da-article-body">
              ${bioHtml}
              ${bodyHtml}
            </div>
${BRAND_CARD_HTML}${SHOP_SECTION_HTML}
            <!-- ══ TAIL FEEDS (moved from sidebar; baked for crawlers) ══ -->
            <div class="tail-feeds">
              <section class="home-stories-section latest-feed-section sf-mobile" aria-labelledby="article-latest-m-heading">
                <h2 class="latest-feed-heading" id="article-latest-m-heading">Latest</h2>
                <div class="latest-feed-list">
                  ${dormiedLatestHtml || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
                </div>
              </section>
              <div class="bp-latest-see-all sf-mobile"><a href="/news/">See All News</a></div>
              <section class="home-stories-section latest-feed-section" aria-labelledby="article-stories-heading">
                <h2 class="latest-feed-heading" id="article-stories-heading">Top Stories</h2>
                <div id="home-stories-list" class="latest-feed-list" data-limit="10">
                  ${TOP_STORIES_HTML || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
                </div>
              </section>
              <section id="featured-widget" class="home-stories-section latest-feed-section" aria-labelledby="article-featured-heading">
                <h2 class="latest-feed-heading" id="article-featured-heading">Featured</h2>
                <div id="featured-list" class="latest-feed-list">
                  ${FEATURED_HTML || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
                </div>
              </section>
              <div class="bp-latest-see-all"><a href="/news/">See All News</a></div>
            </div>

          </div><!-- /sc-article-main -->

          <aside class="sidebar-ad-col">
            <section class="home-stories-section latest-feed-section sf-desktop" aria-labelledby="article-latest-heading">
              <h2 class="latest-feed-heading" id="article-latest-heading">Latest</h2>
              <div id="dormied-latest-list" class="latest-feed-list" data-limit="5">
                ${dormiedLatestHtml || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
              </div>
            </section>
            ${SIDEBAR_MODULES_HTML}
          </aside>

        </div><!-- /table-layout -->
      </div><!-- /container -->
    </section>

  </main>

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
      <p class="footer-legal">© <span id="footer-year"></span> DORMIED. Rankings are independent editorial content. No brand pays for placement or improved position on the DORMIED Index. All brand names and logos are property of their respective owners.</p>
    </div>
  </footer>

  <!-- ══ SCRIPTS ════════════════════════════════════════════════════════════ -->
  <script>window.__DA_BRAND_SLUG__='${escHtml(F.brandSlug || '')}';window.__DA_ARTICLE_SLUG__='${escHtml(F.slug)}';</script>
  <script>
  (function(){
    var btn=document.getElementById('nav-hamburger'),panel=document.getElementById('mobile-nav-panel');
    if(!btn||!panel)return;
    function openNav(){btn.setAttribute('aria-expanded','true');panel.classList.add('open');panel.removeAttribute('hidden')}
    function closeNav(){btn.setAttribute('aria-expanded','false');panel.classList.remove('open');panel.setAttribute('hidden','')}
    btn.addEventListener('click',function(){btn.getAttribute('aria-expanded')==='true'?closeNav():openNav()});
    panel.querySelectorAll('a').forEach(function(a){a.addEventListener('click',closeNav)});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closeNav()});
    document.addEventListener('click',function(e){if(!btn.contains(e.target)&&!panel.contains(e.target))closeNav()});
  })();
  </script>
  <script>document.getElementById('footer-year').textContent=new Date().getFullYear();</script>
  <script src="/js/analytics.min.js?v=20260320a"></script>
  <script src="/js/signup.min.js?v=20260718d"></script>
  <script src="/js/search.min.js?v=20260508"></script>
  <script src="/js/feed.min.js?v=20260717"></script>
  ${SHOP_SECTION_HTML ? '<script defer src="/js/shop-carousel.min.js?v=20260728"></script>' : ''}

</body>
</html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const key = process.argv[2];
  const F = FEATURES[key];
  if (!F) {
    console.error('Usage: node scripts/generate-feature.js <feature-key>\n  keys: ' + Object.keys(FEATURES).join(', '));
    process.exit(1);
  }
  // A fixed config date always wins; otherwise the existing row's published_at is
  // preserved on rebuild (looked up below); only a genuinely new feature falls back
  // to now(). This stops a rebuild from resetting published_at and reposting the feature.
  const configPublishedAt = F.publishedAt || null;
  F.outDir = path.join(ROOT, 'news', F.slug);

  const md = fs.readFileSync(F.mdPath, 'utf8');
  const dormiedData = loadDormiedData();   // for brand auto-linking + sidebar chips
  const parsed = parseMarkdown(md, F, dormiedData);

  // LATEST sidebar bake (excludes this slug)
  let dormiedLatestHtml = null;
  let existingPublishedAt = null;
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const latest = await feedBake.fetchLatestArticles(supabase, 5, F.slug);
      if (latest.length) dormiedLatestHtml = feedBake.renderLatestFeedHtml(latest, dormiedData);
      const { data: existing } = await supabase
        .from('dormied_articles').select('published_at').eq('slug', F.slug).maybeSingle();
      if (existing && existing.published_at) existingPublishedAt = existing.published_at;
      SIDEBAR_MODULES_HTML = await feedBake.fetchSidebarModulesHtml(supabase, dormiedData);
      const [topArts, featArts] = await Promise.all([
        feedBake.fetchTopStoriesArticles(supabase, dormiedData, 10),
        feedBake.fetchFeaturedArticles(supabase, 10),
      ]);
      TOP_STORIES_HTML = topArts.length ? feedBake.renderLatestFeedHtml(topArts, dormiedData) : '';
      FEATURED_HTML    = featArts.length ? feedBake.renderLatestFeedHtml(featArts, dormiedData) : '';
    } catch (e) { console.warn('[feature] LATEST sidebar bake failed:', e.message); }
  }

  // ── DORMIED Index card + affiliate carousel (end of article) ────────────────
  // The card mirrors the news-article template's .da-brand-card so the two page
  // types read identically. Metrics come from dormied_monthly_brand_summary
  // (already computed there) rather than being recalculated from data.js.
  // The carousel mount is emitted ONLY for a brand with an active affiliate
  // program, is EMPTY (no product data baked), and is fed client-side by
  // /api/shop via js/shop-carousel.js. tracking_url never reaches the page.
  // inlineCommerce is opt-in per feature: without it a feature keeps the plain
  // body-only tail, so adding the block here never retroactively changes
  // already-published features when they are regenerated.
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY && F.brandSlug && F.inlineCommerce) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: sum } = await supabase
        .from('dormied_monthly_brand_summary')
        .select('global_rank, di_score, mom_change_pct, three_month_change_pct, yoy_change_pct')
        .eq('brand_slug', F.brandSlug)
        .order('snapshot_month', { ascending: false })
        .limit(1)
        .maybeSingle();

      const brandMeta = (dormiedData.brands || []).find(b => b.id === F.brandSlug) || {};
      const bName = brandMeta.name || F.brandSlug;
      const pct = v => (v === null || v === undefined || v === '') ? '—'
        : (Number(v) > 0 ? '+' : Number(v) < 0 ? '\u2212' : '') + Math.abs(Number(v)).toFixed(1) + '%';
      const cls = v => (v === null || v === undefined || v === '') ? ''
        : Number(v) > 0 ? ' bp-metric-val--up' : Number(v) < 0 ? ' bp-metric-val--down' : '';
      const logo = brandMeta.logo
        ? `<img src="${escHtml(brandMeta.logo)}" alt="${escHtml(bName)}" class="bp-logo-img" width="48" height="48" style="width:48px;height:48px">`
        : `<span class="bp-logo-initials" style="background:#1a2a1a;width:48px;height:48px;font-size:1rem">${escHtml(bName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>`;

      if (sum) {
        BRAND_CARD_HTML = `
            <!-- Brand card -->
            <div class="da-brand-card">
              <div class="da-brand-card-header">
                <span class="da-brand-card-label">DORMIED INDEX</span>
                <a href="/brands/${escHtml(F.brandSlug)}/" class="da-brand-card-cta">View Brand &rarr;</a>
              </div>
              <div class="da-brand-card-main">
                <div class="da-brand-card-identity">
                  <div class="da-brand-card-logo">${logo}</div>
                  <a href="/brands/${escHtml(F.brandSlug)}/" class="da-brand-card-name">${escHtml(bName)}</a>
                </div>
                <div class="da-brand-card-stats">
                  <div class="bp-metric-card"><span class="bp-metric-label">Global Rank</span><span class="bp-metric-val">#${sum.global_rank}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">DI Score</span><span class="bp-metric-val">${Number(sum.di_score).toFixed(1)}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">M/M Change</span><span class="bp-metric-val${cls(sum.mom_change_pct)}">${pct(sum.mom_change_pct)}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">3M Trend</span><span class="bp-metric-val${cls(sum.three_month_change_pct)}">${pct(sum.three_month_change_pct)}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">12M Trend</span><span class="bp-metric-val${cls(sum.yoy_change_pct)}">${pct(sum.yoy_change_pct)}</span></div>
                </div>
              </div>
            </div>
`;
      }

      const { data: prog } = await supabase
        .from('affiliate_programs')
        .select('dormied_brand_slug')
        .eq('dormied_brand_slug', F.brandSlug)
        .eq('status', 'active')
        .maybeSingle();
      if (prog) {
        SHOP_SECTION_HTML = `
            <!-- Shop ${escHtml(bName)} (affiliate) -->
            <section class="bp-shop-section" id="bp-shop-section" data-brand-slug="${escHtml(F.brandSlug)}" data-brand-name="${escHtml(bName)}">
              <p class="bp-chart-heading">Shop ${escHtml(bName)}</p>
              <div class="bp-shop-viewport">
                <button type="button" class="bp-shop-arrow bp-shop-arrow--prev" id="bp-shop-prev" aria-label="Scroll to previous products" hidden>&#8249;</button>
                <div class="bp-shop-track" id="bp-shop-track" role="region" aria-label="Shop ${escHtml(bName)} products" tabindex="0"></div>
                <button type="button" class="bp-shop-arrow bp-shop-arrow--next" id="bp-shop-next" aria-label="Scroll to next products" hidden>&#8250;</button>
              </div>
              <div class="bp-shop-dots" id="bp-shop-dots" role="tablist" aria-label="Product pages"></div>
              <p class="bp-shop-disclosure">Some links on this page are affiliate links. DORMIED may earn a commission on purchases made through them. This does not influence the DORMIED Index or our editorial coverage.</p>
            </section>
`;
        console.log(`[feature] affiliate carousel mount emitted for ${F.brandSlug}`);
      }
    } catch (e) { console.warn('[feature] brand card / shop mount failed:', e.message); }
  }

  // Resolve the effective publish date now that we know whether the feature already exists.
  F.publishedAt = configPublishedAt || existingPublishedAt || new Date().toISOString();

  const html = buildPage(F, parsed, dormiedLatestHtml);
  // Exclude baked feed lists from the em-dash check: article titles sourced from
  // the DB may legitimately contain em dashes inside the feed cards.
  const htmlNoFeed = html.replace(/(<div[^>]*class="latest-feed-list"[^>]*>)[\s\S]*?(<\/div>\s*<\/section>)/g, '$1$2');
  if (htmlNoFeed.includes('—')) throw new Error('[feature] Em dash found in output — aborting');

  fs.mkdirSync(F.outDir, { recursive: true });
  fs.writeFileSync(path.join(F.outDir, 'index.html'), html, 'utf8');

  // dormied_articles upsert (feed/sitemap/search). brand_slug may be '' (no chip)
  // or a real brand (chip shows). category 'Feature' => generate-article.js skips it.
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const row = {
        brand_slug: F.brandSlug || '', secondary_brand_slugs: [],
        title: F.title, body: mdToPlain(md),
        image_url: `${F.imgBase}/${F.hero.file}`,
        source_url: `https://dormied.com/news/${F.slug}/`, source_name: 'DORMIED',
        meta_description: F.metaDescription, seo_keywords: F.seoKeywords,
        published_at: F.publishedAt, status: 'published', slug: F.slug,
        category: F.category, author: F.byline,
      };
      // Upsert on the unique slug — never delete. On an existing row only the content
      // fields + published_at (already resolved to the preserved/config value) in `row`
      // are written; x_posted_at, x_post_text, x_post_id, threads_post_id,
      // threads_posted_at, featured, created_at and id are omitted, so ON CONFLICT
      // leaves them intact (no repost, no re-tweet).
      const { error } = await supabase.from('dormied_articles').upsert(row, { onConflict: 'slug' });
      if (error) console.warn('[feature] DB upsert failed:', error.message);
      else console.log(`[feature] dormied_articles row upserted (brand_slug="${F.brandSlug || ''}")`);
    } catch (e) { console.warn('[feature] DB upsert error:', e.message); }
  }

  const figs = (html.match(/<figure class="da-figure"/g) || []).length;
  console.log(`[feature] Wrote ${path.join('news', F.slug, 'index.html')} | figures=${figs} | faqs=${parsed.faqs.length} | words=${parsed.wordCount} | readTime="${readTime(parsed.wordCount)}"`);

  // Propagate this feature into the baked LATEST / sidebar modules on every
  // module-bearing page so nothing goes stale. Idempotent (a no-op when the feed
  // is unchanged) and module-region-only (never touches body prose or dates).
  // Skip with --skip-refresh when batch-regenerating existing features.
  if (!process.argv.includes('--skip-refresh')) {
    try {
      require('child_process').execFileSync('node', [path.join(__dirname, 'refresh-modules.js')], { stdio: 'inherit' });
    } catch (e) { console.warn('[feature] module refresh failed (non-fatal):', e.message); }
  }
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(e => { console.error('[feature] Fatal:', e.message); process.exit(1); });
}