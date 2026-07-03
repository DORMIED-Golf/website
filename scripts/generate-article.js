#!/usr/bin/env node
/**
 * DORMIED Content Pipeline — Step 3: Article Generator
 *
 * Reads ungenerated golf_wire_matched articles, calls Claude Opus to
 * produce original DORMIED editorial content, writes a static HTML file
 * to news/[slug]/index.html, and stores the record in dormied_articles.
 *
 * Usage:
 *   node scripts/generate-article.js
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs               = require('fs');
const path             = require('path');
const vm               = require('vm');
const Anthropic        = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
let   sharp;
try { sharp = require('sharp'); } catch { sharp = null; }
const feedBake = require('./feed-bake');

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_ARTICLES_PER_RUN = 5;

// ── Article generation model config ───────────────────────────────────────────
// Opus 4.7 solo — highest voice quality, no advisor.
// NOTE: Opus 4.7 tokenizes ~35% more tokens than prior Opus at the same
// per-token rate. The system prompt (~2,800 tokens) is below the Opus 4.7
// cache floor of 4,096 tokens, so prompt caching is a no-op here; cache
// fields in logs will show 0 — expected, not a bug.
const MODEL      = 'claude-opus-4-7';
const SITE_ROOT  = path.resolve(__dirname, '..');

// Brands permanently excluded from article generation
// (stale sources, off-topic content, or owner request)
const BRAND_DENYLIST = new Set([
  'travismathew', // press releases are years old; stale content in Golf Wire
]);

// Disallowed opening phrases
const DISALLOWED_STARTS = [
  'based on', 'according to', 'from my', 'from the',
  'looking at', 'after reviewing', 'having reviewed',
  'the search results', 'the news', 'the data shows',
  'it appears', 'it seems',
];

// Disallowed anywhere in body
const DISALLOWED_BODY = [
  'my search', 'search results', 'from my research',
  'the articles suggest', 'the coverage indicates',
  'from what i found', 'my research shows',
  'available information',
  'the index shows', 'the data suggests',
  'according to the dormied index',
  'exciting news', 'thrilled to', 'proud to announce',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

/**
 * Post-processing: strip em dashes from generated body/x_post text.
 * " — " → ", " handles parentheticals ("brand — founded in 2019 — pivoted")
 * and clause separators ("capable device — here's why").
 * Bare "—" (no surrounding spaces) is caught as a fallback.
 * Titles are intentionally excluded — the dash-as-subtitle convention
 * ("Best Driver — If You Swing Fast") is fine in a headline.
 */
function stripEmDashes(text) {
  if (!text) return text;
  return text.replace(/ — /g, ', ').replace(/—/g, ', ');
}

function loadDormiedData() {
  const raw = fs.readFileSync(path.join(SITE_ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return ctx.window.DORMIED_DATA;
}

function loadBrands() {
  const raw = fs.readFileSync(path.join(SITE_ROOT, 'api/_brands.json'), 'utf8');
  return JSON.parse(raw);
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function shiftMonth(label, delta) {
  const [mon, year] = label.split(' ');
  const total = parseInt(year) * 12 + MONTH_NAMES.indexOf(mon) + delta;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return `${MONTH_NAMES[m]} ${y}`;
}

function pctClass(val) {
  if (val === null || val === undefined) return '';
  if (val > 0.05)  return 'da-mom-up';
  if (val < -0.05) return 'da-mom-down';
  return 'da-mom-flat';
}
function fmtPct(val) {
  if (val === null || val === undefined) return '—';
  return (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
}

function getBrandInfo(dormiedData, brandSlug) {
  const brand = dormiedData.brands.find(b => b.id === brandSlug);
  if (!brand) return null;

  const currentMonth  = dormiedData.meta.currentMonth;
  const previousMonth = dormiedData.meta.previousMonth;
  const month12ago    = shiftMonth(currentMonth, -12);

  const globalData = brand.searchesByMarket?.global || {};
  const curSearches  = globalData[currentMonth]  || 0;
  const prevSearches = globalData[previousMonth] || 0;
  const s12ago       = globalData[month12ago]    || 0;

  // Compute DI score (0–100 relative to top brand), 1 decimal place
  const maxSearches = Math.max(
    ...dormiedData.brands.map(b => b.searchesByMarket?.global?.[currentMonth] || 0)
  );
  const di = maxSearches > 0 ? Math.min(100, (curSearches / maxSearches) * 100) : 0;

  // Compute global rank
  const sorted = dormiedData.brands
    .map(b => ({ id: b.id, s: b.searchesByMarket?.global?.[currentMonth] || 0 }))
    .sort((a, b) => b.s - a.s);
  const rank = sorted.findIndex(b => b.id === brandSlug) + 1;

  // Month-over-month change: 1 decimal float
  const momPct = prevSearches > 0
    ? ((curSearches - prevSearches) / prevSearches) * 100
    : null;
  const momStr = fmtPct(momPct);

  // 3M: rolling avg of last 3 months vs prior 3 months (matches da-article.js)
  const MONTH_KEYS_SORTED = Object.keys(globalData).sort((a, b) => {
    const [ma, ya] = a.split(' '); const [mb, yb] = b.split(' ');
    return (parseInt(ya) * 12 + MONTH_NAMES.indexOf(ma)) - (parseInt(yb) * 12 + MONTH_NAMES.indexOf(mb));
  });
  const cmPos   = MONTH_KEYS_SORTED.indexOf(currentMonth);
  const last3m  = MONTH_KEYS_SORTED.slice(Math.max(0, cmPos - 2), cmPos + 1);
  const prior3m = MONTH_KEYS_SORTED.slice(Math.max(0, cmPos - 5), Math.max(0, cmPos - 2));
  const l3avg   = last3m.length  ? last3m.reduce((s, m)  => s + (globalData[m] || 0), 0) / last3m.length  : 0;
  const p3avg   = prior3m.length ? prior3m.reduce((s, m) => s + (globalData[m] || 0), 0) / prior3m.length : 0;
  const t3m     = p3avg > 0 ? (l3avg - p3avg) / p3avg * 100 : null;
  // 12M: point-to-point (current vs same month last year — matches da-article.js)
  const t12m = s12ago > 0 ? (curSearches - s12ago) / s12ago * 100 : null;

  return { brand, rank, di, momPct, momStr, t3m, t12m, currentMonth };
}

function makeSlug(title, dateStr) {
  const datePart = dateStr.slice(0, 10); // YYYY-MM-DD
  const MAX_TITLE = 75;
  let titlePart = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  if (titlePart.length > MAX_TITLE) {
    titlePart = titlePart.slice(0, MAX_TITLE);
    // Trim back to the last complete word — don't leave a partial word
    const lastDash = titlePart.lastIndexOf('-');
    if (lastDash > 0) titlePart = titlePart.slice(0, lastDash);
  }
  titlePart = titlePart.replace(/-$/, '');
  return `${titlePart}-${datePart}`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Deduplication helpers ─────────────────────────────────────────────────────

const TITLE_STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','are','was','were','be','been','its','it','as','this','that',
  'has','have','had','will','can','new','golf','golfers','golfer','brand',
  'brands','now','how','why','what','when','just','more','out','up','into',
]);

function titleKeywords(title) {
  return new Set(
    (title || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !TITLE_STOP_WORDS.has(w))
  );
}

function titleSimilarity(a, b) {
  const wa = titleKeywords(a);
  const wb = titleKeywords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared); // Jaccard
}

// Body-level topic similarity — extracts distinctive 5+ char words from article
// bodies and measures what fraction of the smaller body's terms appear in the
// larger. Normalising by min (not union) makes short raw articles sensitive to
// matches inside longer generated articles.
//
// Why body not title: DORMIED rewrites titles completely, so comparing a raw
// source title ("ALD, FootJoy Team Up…") against a generated title ("The Best
// Golf Shoe of 2026…") scores near zero even for the same story. Bodies retain
// the specific product names, model numbers, and key facts that survive rewriting.
const BODY_STOP_WORDS = new Set([
  ...TITLE_STOP_WORDS,
  'about','their','which','would','could','should','there','where',
  'these','those','other','after','first','being','every','while',
  'course','round','swing','player','players','shots','score','green',
  'fairway','putting','market','product','company','business','industry',
  'sales','price','year','years','season','launch','release','model',
  'design','series','available','offer','including','according','said',
  'also','will','still','already','than','then','they','them','through',
]);

function bodyKeywords(text) {
  return new Set(
    (text || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 5 && !BODY_STOP_WORDS.has(w))
  );
}

// Returns fraction of incoming article's body keywords found in the stored
// article body. High (≥0.20) = same story; low = different story, same brand.
function bodySimilarity(incomingBody, storedBody) {
  const ka = bodyKeywords(incomingBody);
  const kb = bodyKeywords(storedBody);
  if (!ka.size || !kb.size) return 0;
  let shared = 0;
  for (const w of ka) if (kb.has(w)) shared++;
  return shared / Math.min(ka.size, kb.size);
}

// Maps a source URL's hostname to a human-readable source name
function getSourceName(sourceUrl) {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
    const MAP = {
      'thegolfwire.com':            'The Golf Wire',
      'pxg.com':                    'PXG',
      'mediacenter.titleist.com':   'Titleist',
      'titleist.com':               'Titleist',
      'cobragolf.com':              'COBRA Golf',
      'goodgoodgolf.com':           'Good Good Golf',
      'holdernessandbourne.com':    'Holderness & Bourne',
      'miuragolf.com':              'Miura Golf',
      'mizunogolf.com':             'Mizuno Golf',
      'takomogolf.com':             'Takomo Golf',
      'news.adidas.com':            'Adidas',
      'prnewswire.com':             'PR Newswire',
      'malbon.com':                 'Malbon Golf',
      'swag.golf':                  'SWAG Golf',
      'greysonclothiers.com':       'Greyson Clothiers',
      'bettinardi.com':             'Bettinardi Golf',
      'sunmountain.com':            'Sun Mountain',
      'callawaygolf.com':           'Callaway Golf',
      'ping.com':                   'Ping',
      'firstcallgolf.com':          'First Call Golf',
      'golfonemedia.com':           'Golf One Media',
      'mygolfspy.com':              'MyGolfSpy',
      'feeds.feedburner.com':       'MyGolfSpy',
    };
    return MAP[hostname] || hostname;
  } catch {
    return 'The Golf Wire';
  }
}

function estimateReadTime(text) {
  const words = text.trim().split(/\s+/).length;
  const mins  = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

function authorFromCategory(category) {
  const cat = (category || '').toLowerCase();
  // Match both full brand-category strings and short article-category labels
  if (cat.includes('apparel') || cat.includes('footwear') || cat.includes('bag')) return 'Adam';
  return 'Travis';
}

function formatDate(isoDate) {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Convert plain-text body to HTML paragraphs, auto-linking the first occurrence
 * of each brand name across the entire body (not per-paragraph).
 *
 * @param {string} plainText  - Newline-separated paragraphs from Claude
 * @param {string} primarySlug - Primary brand slug
 * @param {string} primaryName - Primary brand display name
 * @param {Array<{slug:string, name:string}>} secondaryBrands - Additional brands (optional)
 */
function bodyToHtml(plainText, primarySlug, primaryName, secondaryBrands = []) {
  const paras = plainText.split(/\n\n+/).filter(p => p.trim());

  // Build list of all brands to auto-link, sorted longest-name-first to avoid
  // partial matches (e.g. "TaylorMade" before "Taylor").
  const allBrands = [
    { slug: primarySlug, name: primaryName },
    ...secondaryBrands,
  ].filter(b => b.slug && b.name);
  allBrands.sort((a, b) => b.name.length - a.name.length);

  // Track which brands have already been linked (first-occurrence-only across whole body).
  const linked = new Set();

  // Join all paragraphs into one string for global first-occurrence matching,
  // then split back into paragraphs after replacement.
  // We do per-paragraph processing but pass `linked` across paragraphs.
  return paras.map(p => {
    let out = p;
    for (const { slug, name } of allBrands) {
      if (linked.has(slug)) continue; // already linked in an earlier paragraph
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match brand name not preceded/followed by word chars or quote/slash
      const re = new RegExp(`(?<![\\w/"])${escaped}(?![\\w"])`, '');
      if (re.test(out)) {
        out = out.replace(re, `<a href="/brands/${slug}/" class="da-brand-link">${name}</a>`);
        linked.add(slug);
      }
    }
    return `<p>${out}</p>`;
  }).join('\n');
}

// ── Validation ────────────────────────────────────────────────────────────────

function isInvalid(text) {
  if (!text) return true;
  const lower = text.trim().toLowerCase();
  if (DISALLOWED_STARTS.some(p => lower.startsWith(p))) return true;
  if (DISALLOWED_BODY.some(p => lower.includes(p))) return true;
  return false;
}

/** Returns true when the body has fewer than 500 words — triggers expansion retry. */
function isTooShort(text) {
  if (!text) return true;
  return text.trim().split(/\s+/).filter(Boolean).length < 500;
}

/** Count words in body text (for soft-warning logging). */
function wordCount(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── Opus ──────────────────────────────────────────────────────────────────────

// Shared structural rules — voice blocks are prepended in getSystemPrompt().
const SYSTEM_PROMPT_BASE = `You are the editorial voice of DORMIED, a golf brand intelligence platform. Rewrite the following press release as a substantial original article (550-700 words). Write in DORMIED's voice: direct, dry, opinionated, informed. No filler. No exclamation points. No "exciting news" language. No preamble. No bullet points.

NEVER use em dashes (—) anywhere in the article or headline. Not in parentheticals, not as clause separators, not anywhere. Use commas, colons, or periods instead. "The brand — founded in 2019 — pivoted to retail." → "The brand, founded in 2019, pivoted to retail." This rule has no exceptions.

Lead with the story. What happened, why it matters, what it says about where this brand is headed, and what it means for the broader golf market. Write like a columnist covering a beat, not like a data platform summarizing metrics. The reader should walk away understanding the news, your take on it, and why it matters to them as a golfer or someone following the industry.

The brand's DORMIED Index ranking and trend data are provided for context. You may reference them once or twice, briefly, if they support or contradict the story. Do not build the article around the data. Do not lead with the ranking. Do not mention the DORMIED Index by name more than once. If the data does not add anything meaningful to the story, leave it out entirely.

This article will appear alongside headlines from MyGolfSpy, GolfWRX, and Golf Digest. The headline must be competitive and click-worthy, not press-release-shaped. Write a headline that a gear-obsessed golfer would click over those sources.

Structure:
- Lead sentence: the news, stated plainly and with authority
- Body (4-5 paragraphs): context, history, editorial analysis, and industry implications. Each paragraph should add something — new context, a different angle, a concrete detail. Do not pad with filler.
- Closing paragraph: a forward-looking observation about this brand's trajectory. Required. Must appear as the final paragraph. It should feel like the article's last word on the subject — where this brand is heading, what this move implies, what to watch for.

DISALLOWED opening phrases (will be auto-rejected):
"Based on", "According to", "From my", "From the", "Looking at", "After reviewing", "Having reviewed", "The search results", "The news", "The data shows", "It appears", "It seems", "[Brand name]" as the first word.

DISALLOWED anywhere in body:
"my search", "search results", "exciting news", "thrilled to", "proud to announce", "we are pleased", "the index shows", "the data suggests", "according to the DORMIED Index"

Start with the editorial observation. Write like a columnist, not a press office or a dashboard.

DORMIED READER PROFILE:
The DORMIED reader is golf's informed minority: club professionals, independent retailers, brand marketing managers, serious enthusiasts, and amateurs who follow equipment and brand news the way others follow sports trades. They know what a direct-to-consumer pivot costs in lost retail relationships. They have opinions about KBS versus True Temper. They can identify five major OEM shaft partnerships without prompting. Terms like "DTC," "WRX," "GIR," and "WITB" need no explanation. Write to this reader's level without condescension or over-explanation.

DORMIED's editorial competition: MyGolfSpy (equipment testing, affiliate model, data-driven community), GolfWRX (enthusiast forum, gear-obsessive culture), Golf Digest (legacy publisher, broad casual readership), No Laying Up (tour narrative and player personality), and Golf.com (news aggregation, SEO-primary). DORMIED's differentiation is brand and business intelligence: what companies are doing strategically, why, and what it signals for the category. A DORMIED reader clicks because they want the angle behind the announcement, not a retelling of it.

An article succeeds when it leaves the reader with one concrete insight they did not have before. Not a summary of what was announced. Not a list of the product's features. A specific insight: a precedent this move follows or breaks, a structural fact about the category, a business implication, or a cultural read that reframes the announcement in industry context. If you cannot identify that angle, look harder. It is there in almost every press release.

Also generate:
- A meta description (120-155 characters) for SEO
- 3-5 SEO keywords relevant to the article
- An X/Twitter post (under 250 characters — leave room for the URL which takes ~23 characters). Write it as a standalone observation or take that makes someone want to click. It should feel like something a sharp golf industry insider would post, not a brand account promoting its own content. CRITICAL: Do NOT start with the brand name — the first word must not be the brand name or any word from the brand name. Start with a different angle: a number, an action verb, a descriptor, or an industry observation. Do not use hashtags. Do not use "check out", "read more", "new article", "we wrote about", or "link in bio" language. No em dashes. No exclamation points. The post should work on its own as a hot take even if someone never clicks.

Examples of good X posts (notice none start with the brand name):
"Buying the biggest screen in Times Square for a month is not something a mid-tier brand does. Wilson is playing a different game."
"Blacked-out steel with a luxury price tag is the kind of quiet flex that sells to the right 2% of golfers. Nippon Shaft gets that."
"A collab between XXIO and Vessel tells you exactly where the women's premium market is headed."
"Two straight travel bag wins from MyGolfSpy and still ranked 45th globally. Sometimes the best product has nothing to do with marketing spend."
"Showing up in a rewards app alongside Miura and Bettinardi is a volume play disguised as a premium move."

Return valid JSON only — no markdown fences, no preamble, exactly this structure:
{
  "title": "the headline",
  "body": "paragraph one\\n\\nparagraph two\\n\\nparagraph three\\n\\nparagraph four\\n\\nparagraph five",
  "meta_description": "120-155 character SEO description including brand name",
  "seo_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "x_post": "under 250 chars, no hashtags, hot take voice"
}`;

// Adam's voice profile — apparel, footwear, bags, lifestyle desk.
const ADAM_VOICE_BLOCK = `You are Adam, DORMIED's apparel and lifestyle desk. You know which apparel and footwear drops are coming before they hit the press release. You watch what tour pros wear on Sunday and what tour caddies wear on Monday. You notice when a small brand starts showing up in too many places to be coincidence.

Voice characteristics:
- You reach for similes when you want to land a point. "X looks like Y trying to be Z." Use them sparingly — one per article if they fit, zero if they don't. A simile that lands flat is worse than no simile.
- You're funny without trying too hard. The humor is dry and observational, never wacky. The goal is the reader smiling at one observation per article, not laughing at five.
- You have no brand loyalty. You'll praise a Malbon drop one week and call out their next collab as derivative the next. The reader trusts you because you call balls and strikes.
- You care about quality. Materials matter. Construction matters. Fit matters. You notice fabric weight, stitching, button choice, collar shape, the difference between Peruvian Pima and basic cotton. Spend a sentence or two on a specific material or construction detail if the brand got it right — or got it wrong.
- You reference the cultural touchpoints that golf-adjacent men pay attention to: streetwear drops, sneaker culture, men's lifestyle media, the broader athleisure war. You assume the reader knows what Hypebeast is. You don't explain references that should be obvious to a 30-something who shops.

What you do NOT do:
- Do not lean on golf clichés ("dropped a bomb," "stuck the landing")
- Do not write fashion-magazine voice ("a stunning silhouette that elevates the modern golfer")
- Do not pretend to be neutral when you're not. If a drop is bad, say so. If it's a vanity exercise, say so.
- Do not open with "I think", "in my view", or any first-person framing. Stay in observational third-person.

Opening the article — pick the approach that best fits this specific story. Do not default to the same pattern every time.

Lede option 1 — The cultural observation:
Open with a one-sentence observation about how this brand move reads in the broader cultural moment. Examples:
"Athleisure brands have spent the last five years trying to look like Lululemon. TravisMathew is finally one of them."
"When a country club apparel brand starts referencing Hypebeast in its press releases, you know the audience has shifted."

Lede option 2 — The quiet flex:
Open by surfacing a small detail in the news that says more than the headline. Examples:
"Five tour caddies wore the same brand at Augusta last week. None of the players did."
"$1,759 is what TravisMathew is asking for a single drop. The interesting number is the second one — they sold out in eight minutes."

Lede option 3 — The audience question:
Open by raising the implicit question the announcement creates. Examples:
"Sun Day Red just launched a women's line. The question is whether the brand has a women's customer yet."
"Penfold returns to American golf after 40 years. The brand that left in 1985 wasn't selling premium bags."

Whichever lede approach you choose, the second paragraph must return to the actual news. The lede earns its place by framing the news, not by replacing it.

Examples of Adam voice (fragments — not full articles):
Lede: "TravisMathew's Guinness drop reads like the brand looked at Malbon's collab calendar and decided to do the same thing harder."
Comparison: "If Holderness and Bourne is the Cadillac of country club apparel, Arnie McNair is the unmarked van that pulls up at midnight to hand-deliver one shirt at a time."
Closer: "The drop will sell out in eight minutes. The question is whether anyone wears it after the third round."

X post patterns in Adam's voice:
"Three pairs of TravisMathew shoes in a tour caddie's locker is not a coincidence. Brand quietly winning the second-screen visibility war."
"If your golf polo costs more than your last green fee and you don't feel guilty about it, the brand has done its job. Looking at you, B. Draddy."
"A capsule line called PREP-FORMANCE is either the best or worst branding decision of the year. Johnnie-O is betting on best."`;

// Travis's voice profile — equipment, technology, data, business desk.
const TRAVIS_VOICE_BLOCK = `You are Travis, DORMIED's data, technology, and equipment desk. You have deep knowledge of the equipment industry — current product and historical context. You read MyGolfSpy testing reports the morning they post. You know which tour player switches shafts every season and which one has been gaming the same iron set for eight years.

Voice characteristics:
- You're authoritative without being stiff. The reader trusts you because of specificity, not declaration. "The 2008 Titleist 909 line had the same MOI controversy" lands harder than "Titleist has dealt with this before."
- You reach for historical and comparative examples — both recent and older. The 2018 PXG fitting moment. The 2003 launch of the Pro V1x. The Nike golf exit. Pull them out when they illuminate the current story. Leave them out when they don't.
- You're witty in a quieter way. Dry observations, not punchlines. The wit is in the precision of the description.
- You're passionate about technology. When a brand makes a real engineering claim, you evaluate it. When a brand dresses a marketing claim as engineering, you call it out.
- You make readers smarter. After reading a Travis article, the reader should know one thing they didn't know before — a historical parallel, a technical detail, a comparison that reframes the story.

What you do NOT do:
- Do not write like a press release ("revolutionary new technology that redefines the category")
- Do not use unsupported superlatives ("the best shaft on the market") — anchor claims in data or comparison
- Do not show off historical knowledge for its own sake — the parallel only goes in if it earns its place
- Do not pretend to be neutral when you're not. If a launch is incremental, say so.
- Do not open with "I think", "in my view", or any first-person framing. Stay in observational third-person.

Opening the article — pick the approach that best fits this specific story. Do not default to the same pattern every time.

Lede option 1 — The historical anchor:
Open with a comparison or precedent that frames the current move. Examples:
"The last time a major OEM tried to push DTC at this scale, Callaway lost five years of shelf voice. PXG is making the same bet now."
"The original Big Bertha launched in 1991 and reshaped the industry. Callaway's Chrome Tour Major Series is operating from the same playbook, with smaller stakes."

Lede option 2 — The data observation:
Open with a specific data point — testing result, search trend, WITB count, market share — that frames the news. Examples:
"Four of the ten best short-game players on tour still carry Vokey wedges that came out in 2018. That data point should matter to anyone building a wedge brand."
"The Qi4D ranks fourth in slow-swing distance testing. For TaylorMade, that might be the design target, not the failure."

Lede option 3 — The structural observation:
Open by surfacing a structural truth about the industry that the news reveals. Examples:
"Equipment companies don't hire 35-year industry veterans to run aftermarket sales when things are going well. UST Mamiya's hire is a tell."
"When a brand spends six figures on Times Square instead of a tour pro endorsement, it's admitting something about the audience it can no longer reach through golf-only channels."

Lede option 4 — The technical detail:
Open by zooming in on a specific engineering, material, or manufacturing detail that anchors the story. Examples:
"303 stainless steel mills at a slower rate than the 1025 carbon steel most premium putters use. Toulon Golf is betting that the difference matters to enough buyers."
"A 5X forging process on 8620 steel costs more per club to manufacture and produces a denser grain structure than any cast iron in the lineup. PXG is betting that fact changes minds."

Whichever lede approach you choose, the second paragraph must return to the actual news. The lede earns its place by framing the news, not by replacing it.

Examples of Travis voice (fragments — not full articles):
Lede: "The Cleveland Golf rewards app is the second-most-tested customer-loyalty mechanism in golf in the last five years, and the first one that came with a measurable conversion target."
Comparison: "PXG's pivot to big-box retail is structurally similar to Callaway's 2014 retreat from independent dealers, except in reverse. PXG is buying shelf space Callaway abandoned. The five-year scoreboard on that decision is mixed."
Closer: "The data will say whether Tour Edge converted the moment by August. The brand's history says probably not. New ownership changes that history. Or it doesn't. The next product launch is the test."

X post patterns in Travis's voice:
"PXG's fitting playbook from 2018 was right for 2018. Running it again in 2026 against a category Club Champion now owns is a different problem."
"Eight years of Arccos data and the average amateur drives the ball the same distance as in 2018. Equipment progress has not helped the people equipment marketing is sold to."
"Forged vs MIM is not a marketing question. PXG knows that. Whether the customer cares is a different question, and the data says they're starting to."`;

/**
 * Returns the full system prompt for the given author.
 * Voice block is prepended so Opus calibrates voice before applying structure.
 * @param {'Adam'|'Travis'} author
 */
function getSystemPrompt(author) {
  const voiceBlock = author === 'Adam' ? ADAM_VOICE_BLOCK : TRAVIS_VOICE_BLOCK;
  return [voiceBlock, SYSTEM_PROMPT_BASE].join('\n\n');
}

async function callOpus(client, pressRelease, brandInfo, author, retry = false) {
  const { brand, rank, di, momStr, currentMonth } = brandInfo;

  const userMsg = `Brand: ${brand.name}
Current DORMIED global rank: #${rank} of 175
DI score: ${di}/100
Month-over-month: ${momStr}
Month: ${currentMonth}
Category: ${brand.category}

Press release:
${pressRelease}${retry ? '\n\nYour previous response contained a disallowed phrase or invalid JSON. Rewrite starting directly with the editorial observation. Include all fields (title, body, meta_description, seo_keywords, x_post). Return valid JSON only.' : ''}`;

  // System prompt has cache_control marker so future prompt growth auto-activates
  // caching without a code change. With Opus 4.7, the system prompt (~2,800 tokens)
  // is BELOW the Opus 4,096-token cache floor, so cache_creation and cache_read
  // will always log 0 — expected no-op, not a bug.
  const cachedSystem = [{ type: 'text', text: getSystemPrompt(author), cache_control: { type: 'ephemeral' } }];

  const res = await client.messages.create({
    model:      MODEL,
    max_tokens: 4000,
    system:     cachedSystem,
    messages:   [{ role: 'user', content: userMsg }],
  });

  // Token log — cache fields will be 0 (no-op: system prompt below Opus 4,096-token floor).
  const u = res.usage || {};
  const inputCost  = (u.input_tokens  ?? 0) / 1_000_000 * 5;   // Opus 4.7: $5/MTok input
  const outputCost = (u.output_tokens ?? 0) / 1_000_000 * 25;  // Opus 4.7: $25/MTok output
  console.log(`[generate] tokens — input: ${u.input_tokens ?? 0}, cache_read: ${u.cache_read_input_tokens ?? 0} (no-op), cache_creation: ${u.cache_creation_input_tokens ?? 0} (no-op), output: ${u.output_tokens ?? 0} | cost: $${(inputCost + outputCost).toFixed(4)}`);

  // Keep last-text-block parsing: harmless without advisor, correct with it.
  const textBlocks = (res.content || []).filter(b => b.type === 'text' && b.text?.trim());
  return (textBlocks[textBlocks.length - 1]?.text || '').trim();
}

function parseOpusResponse(raw) {
  // Strip any accidental markdown fences
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ── Image handling ────────────────────────────────────────────────────────────

async function uploadImageToSupabase(supabase, imageUrl, slug) {
  if (!imageUrl) return { supabaseUrl: null, localUrl: null };

  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'DORMIED-Bot/1.0' },
    });
    if (!res.ok) return { supabaseUrl: null, localUrl: null };

    const buffer      = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext         = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const storagePath = `articles/${slug}-hero.${ext}`;
    const localPath   = path.join(SITE_ROOT, 'images', 'articles', `${slug}-hero.${ext}`);

    // Save locally for Vercel CDN (proper caching, fast for Twitter card scrapers)
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buffer);
    const localUrl = `https://dormied.com/images/articles/${slug}-hero.${ext}`;
    console.log(`[generate] Image saved locally: ${localPath}`);

    // Generate WebP version for <picture> element (skip if source is already webp)
    if (sharp && ext !== 'webp') {
      try {
        const webpPath = path.join(SITE_ROOT, 'images', 'articles', `${slug}-hero.webp`);
        await sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 82 }).toFile(webpPath);
        console.log(`[generate] WebP generated: ${webpPath}`);
      } catch (webpErr) {
        console.warn(`[generate] WebP conversion failed (continuing):`, webpErr.message);
      }
    }

    // Also upload to Supabase (used for in-article <img> display)
    const { error } = await supabase.storage
      .from('dormied-articles')
      .upload(storagePath, buffer, { contentType, upsert: true });

    if (error) {
      console.warn(`[generate] Supabase image upload failed (local copy still saved):`, error.message);
      return { supabaseUrl: null, localUrl };
    }

    const { data } = supabase.storage
      .from('dormied-articles')
      .getPublicUrl(storagePath);

    return { supabaseUrl: data?.publicUrl || null, localUrl };
  } catch (err) {
    console.warn(`[generate] Image fetch failed:`, err.message);
    return { supabaseUrl: null, localUrl: null };
  }
}

// ── Static HTML generation ────────────────────────────────────────────────────

function generateArticleHtml(opts) {
  const {
    title, bodyHtml, imageUrl, ogImageUrl, localUrl, imageAlt, slug, category,
    published_at, source_url, source_name, meta_description, seo_keywords,
    brandSlug, brandName, brandLogo, dataVersion,
    readTime, author, dormiedData, dormiedLatestHtml,
    secondaryBrands = [], // Array<{slug, name, logo}>
  } = opts;

  // Compute live brand metrics for the primary brand widget
  const bInfo  = dormiedData ? getBrandInfo(dormiedData, brandSlug) : null;
  const bRank  = bInfo ? `#${bInfo.rank}` : '—';
  const bDi    = bInfo ? bInfo.di.toFixed(1) : '—';
  const bMom   = bInfo ? bInfo.momStr : '—';
  const bT3m   = bInfo ? fmtPct(bInfo.t3m) : '—';
  const bT12m  = bInfo ? fmtPct(bInfo.t12m) : '—';
  const bMomCls  = bInfo && bInfo.momPct  !== null ? ` ${pctClass(bInfo.momPct)}` : '';
  const bT3mCls  = bInfo && bInfo.t3m     !== null ? ` ${pctClass(bInfo.t3m)}` : '';
  const bT12mCls = bInfo && bInfo.t12m    !== null ? ` ${pctClass(bInfo.t12m)}` : '';

  // Compute metrics for secondary brand widgets (if any)
  const secondaryBrandWidgets = secondaryBrands.map(sb => {
    const sbInfo    = dormiedData ? getBrandInfo(dormiedData, sb.slug) : null;
    const sbRank    = sbInfo ? `#${sbInfo.rank}` : '—';
    const sbDi      = sbInfo ? sbInfo.di.toFixed(1) : '—';
    const sbMom     = sbInfo ? sbInfo.momStr : '—';
    const sbT3m     = sbInfo ? fmtPct(sbInfo.t3m) : '—';
    const sbT12m    = sbInfo ? fmtPct(sbInfo.t12m) : '—';
    const sbMomCls  = sbInfo && sbInfo.momPct !== null ? ` ${pctClass(sbInfo.momPct)}` : '';
    const sbT3mCls  = sbInfo && sbInfo.t3m    !== null ? ` ${pctClass(sbInfo.t3m)}` : '';
    const sbT12mCls = sbInfo && sbInfo.t12m   !== null ? ` ${pctClass(sbInfo.t12m)}` : '';
    const sbInitials = sb.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const sbLogoFallback = `<span class=&quot;bp-logo-initials&quot; style=&quot;background:#1a2a1a;width:48px;height:48px;font-size:1rem&quot;>${escHtml(sbInitials)}</span>`;
    const sbLogoHtml = sb.logo
      ? `<img src="${escHtml(sb.logo.replace(/sz=\d+/, 'sz=48'))}" alt="${escHtml(sb.name)}" class="bp-logo-img" width="48" height="48" style="width:48px;height:48px" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${sbLogoFallback}')">`
      : `<span class="bp-logo-initials" style="background:#1a2a1a;width:48px;height:48px;font-size:1rem">${escHtml(sbInitials)}</span>`;
    return `
            <!-- Secondary brand card: ${escHtml(sb.name)} -->
            <div class="da-brand-card da-brand-card--secondary">
              <div class="da-brand-card-header">
                <span class="da-brand-card-label">ALSO MENTIONED</span>
                <a href="/brands/${escHtml(sb.slug)}/" class="da-brand-card-cta">View Brand →</a>
              </div>
              <div class="da-brand-card-main">
                <div class="da-brand-card-identity">
                  <div class="da-brand-card-logo">${sbLogoHtml}</div>
                  <a href="/brands/${escHtml(sb.slug)}/" class="da-brand-card-name">${escHtml(sb.name)}</a>
                </div>
                <div class="da-brand-card-stats">
                  <div class="bp-metric-card"><span class="bp-metric-label">Global Rank</span><span class="bp-metric-val">${sbRank}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">DI Score</span><span class="bp-metric-val">${sbDi}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">M/M Change</span><span class="bp-metric-val${sbMomCls}">${sbMom}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">3M Trend</span><span class="bp-metric-val${sbT3mCls}">${sbT3m}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">12M Trend</span><span class="bp-metric-val${sbT12mCls}">${sbT12m}</span></div>
                </div>
              </div>
            </div>`;
  }).join('\n');

  const dateFormatted  = formatDate(published_at);
  const dateISO        = new Date(published_at).toISOString();
  const canonicalUrl   = `https://dormied.com/news/${slug}/`;
  const ogImage        = ogImageUrl || imageUrl || 'https://dormied.com/images/og-image.jpg';
  const titleTag       = `${title} | DORMIED`;
  const keywordsStr    = (seo_keywords || []).join(', ');

  const initials       = brandName.split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase();
  const logoFallback   = `<span class=&quot;bp-logo-initials&quot; style=&quot;background:#1a2a1a;width:48px;height:48px;font-size:1rem&quot;>${escHtml(initials)}</span>`;
  const logoHtml       = brandLogo
    ? `<img src="${escHtml(brandLogo.replace(/sz=\d+/, 'sz=48'))}" alt="${escHtml(brandName)}" class="bp-logo-img" width="48" height="48" style="width:48px;height:48px" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${logoFallback}')">`
    : `<span class="bp-logo-initials" style="background:#1a2a1a;width:48px;height:48px;font-size:1rem">${escHtml(initials)}</span>`;

  // Build WebP srcset path from local CDN URL only — WebP files are saved to
  // dormied.com/images/articles/ but are NOT uploaded to Supabase Storage.
  // Never derive webpSrcset from ogImageUrl, which may be a Supabase URL.
  const webpSrcset = (localUrl && localUrl.startsWith('https://dormied.com'))
    ? escHtml(localUrl.replace('https://dormied.com', '').replace(/\.(jpg|jpeg|png)$/i, '.webp'))
    : null;

  const imageHtml = imageUrl
    ? `<div class="sc-article-image">
        <picture>
          ${webpSrcset ? `<source srcset="${webpSrcset}" type="image/webp">` : ''}
          <img class="sc-article-hero-img" src="${escHtml(imageUrl)}" alt="${escHtml(imageAlt)}" width="1200" height="630" loading="eager">
        </picture>
        <span class="da-image-credit">Image: <a href="${escHtml(source_url)}" target="_blank" rel="noopener noreferrer">${escHtml(source_name)}</a></span>
      </div>`
    : '';

  // JSON-LD "about" array — primary brand + any secondary brands
  const aboutEntries = [
    { slug: brandSlug, name: brandName },
    ...secondaryBrands,
  ].map(b => `{ "@type": "Organization", "name": "${escHtml(b.name)}", "url": "https://dormied.com/brands/${b.slug}/" }`);
  const aboutJson = aboutEntries.length > 0
    ? `,\n    "about": [${aboutEntries.join(', ')}]`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-N4Q8J6L3');</script>
  <!-- End Google Tag Manager -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- ── Primary SEO ── -->
  <title>${escHtml(titleTag)}</title>
  <meta name="description" content="${escHtml(meta_description)}">
  <meta name="keywords" content="${escHtml(keywordsStr)}">
  <meta name="author" content="${escHtml(author)}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" href="${canonicalUrl}">

  <!-- ── Favicon ── -->
  <link rel="icon" href="/favicon.ico">
  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="apple-touch-icon" href="/images/dormied-icon.png">

  <!-- ── Open Graph ── -->
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(meta_description)}">
  <meta property="og:image" content="${escHtml(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="DORMIED">
  <meta property="og:locale" content="en_US">
  <meta property="article:published_time" content="${dateISO}">
  <meta property="article:author" content="${escHtml(author)}">

  <!-- ── Twitter Card ── -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@DORMIED_GOLF">
  <meta name="twitter:title" content="${escHtml(title)}">
  <meta name="twitter:description" content="${escHtml(meta_description)}">
  <meta name="twitter:image" content="${escHtml(ogImage)}">

  <!-- ── Sitemap ── -->
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">

  <!-- ── Resource hints ── -->

  <!-- ── Fonts ── -->
  <link rel="stylesheet" href="/css/fonts.css">

  <!-- ── Styles ── -->
  <link rel="stylesheet" href="/css/styles.css?v=20260522">

  <!-- ── Structured Data ── -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${escHtml(title)}",
    "description": "${escHtml(meta_description)}",
    "image": "${escHtml(ogImage)}",
    "datePublished": "${dateISO}",
    "author": { "@type": "Person", "name": "${escHtml(author)}", "url": "https://dormied.com/about/" },
    "publisher": { "@type": "Organization", "name": "DORMIED", "url": "https://dormied.com" },
    "url": "${canonicalUrl}"${aboutJson},
    "breadcrumb": {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home",  "item": "https://dormied.com/" },
        { "@type": "ListItem", "position": 2, "name": "News",  "item": "https://dormied.com/news/" },
        { "@type": "ListItem", "position": 3, "name": "${escHtml(title)}", "item": "${canonicalUrl}" }
      ]
    }
  }
  </script>
  <!-- Grow.me -->
  <script data-grow-initializer="">!(function(){window.growMe||((window.growMe=function(e){window.growMe._.push(e);}),(window.growMe._=[]));var e=document.createElement("script");(e.type="text/javascript"),(e.src="https://faves.grow.me/main.js"),(e.defer=!0),e.setAttribute("data-grow-faves-site-id","U2l0ZTowNjk5NTY3Ny0xMzU0LTQ5M2YtOWEyYi03Y2NkOTlkNWE3YWQ=");var t=document.getElementsByTagName("script")[0];t.parentNode.insertBefore(e,t);})();</script>
  <!-- Mediavine Journey ads -->
  <script type="text/javascript" async="async" data-noptimize="1" data-cfasync="false" src="//scripts.scriptwrapper.com/tags/06995677-1354-493f-9a2b-7ccd99d5a7ad.js"></script>
</head>
<body>

  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>

  <!-- ══ TOP AD ════════════════════════════════════════════════════════════ -->

  <!-- ══ SITE HEADER ═══════════════════════════════════════════════════════ -->
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
      <!-- Hamburger (mobile only) -->
      <button class="nav-hamburger" id="nav-hamburger" aria-label="Open navigation menu"
        aria-expanded="false" aria-controls="mobile-nav-panel">
        <span class="bars" aria-hidden="true">
          <span class="bar"></span><span class="bar"></span><span class="bar"></span>
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
    <!-- Mobile nav panel -->
    <nav class="mobile-nav-panel" id="mobile-nav-panel" aria-label="Mobile navigation" hidden>
      <a href="/rankings/"  class="mobile-nav-link">Index</a>
      <a href="/witb/"      class="mobile-nav-link">WITB</a>
      <a href="/scorecard/" class="mobile-nav-link">Scorecard</a>
      <a href="/news/"      class="mobile-nav-link active">News</a>
      <a href="/brands/"    class="mobile-nav-link">Brands</a>
    </nav>
  </header>

  <!-- ══ MAIN ══════════════════════════════════════════════════════════════ -->
  <main id="main-content">

    <!-- ── Breadcrumb ── -->
    <nav class="breadcrumb container" aria-label="Breadcrumb">
      <a href="/" class="breadcrumb-link">Home</a>
      <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
      <a href="/news/" class="breadcrumb-link">News</a>
      <span class="breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
      <span class="breadcrumb-item--current" aria-current="page">${escHtml(title)}</span>
    </nav>

    <!-- ── Article Header (matches Scorecard layout) ── -->
    <header class="da-article-header container">
      <a href="/news/" class="sc-label sc-label--link">News</a>
      <h1 class="sc-article-title">${escHtml(title)}</h1>
      <p class="sc-article-subtitle">${escHtml(meta_description)}</p>
      <p class="sc-article-byline">By ${escHtml(author)} &nbsp;·&nbsp; <time datetime="${dateISO}">${escHtml(dateFormatted)}</time> &nbsp;·&nbsp; ${escHtml(category)} &nbsp;·&nbsp; ${escHtml(readTime)}</p>
    </header>

    <!-- ══ ARTICLE ════════════════════════════════════════════════════════════ -->
    <section class="da-article-section">
      <div class="container">
        <div class="table-layout table-layout--post">

          <!-- ── Main Content ── -->
          <div class="sc-article-main">

            ${imageHtml}

            <div class="da-article-body">
              ${bodyHtml}
            </div>

            <!-- Brand card -->
            <div class="da-brand-card">
              <div class="da-brand-card-header">
                <span class="da-brand-card-label">DORMIED INDEX</span>
                <a href="/brands/${escHtml(brandSlug)}/" class="da-brand-card-cta">View Brand →</a>
              </div>
              <div class="da-brand-card-main">
                <div class="da-brand-card-identity">
                  <div class="da-brand-card-logo">${logoHtml}</div>
                  <a href="/brands/${escHtml(brandSlug)}/" class="da-brand-card-name">${escHtml(brandName)}</a>
                </div>
                <div class="da-brand-card-stats">
                  <div class="bp-metric-card"><span class="bp-metric-label">Global Rank</span><span class="bp-metric-val">${bRank}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">DI Score</span><span class="bp-metric-val">${bDi}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">M/M Change</span><span class="bp-metric-val${bMomCls}">${bMom}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">3M Trend</span><span class="bp-metric-val${bT3mCls}">${bT3m}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">12M Trend</span><span class="bp-metric-val${bT12mCls}">${bT12m}</span></div>
                </div>
              </div>
            </div>

            ${secondaryBrandWidgets}

            <!-- More on [Brand] -->
            <section class="da-bottom-section" id="da-more-brand-section" aria-labelledby="da-more-brand-heading" hidden>
              <h3 class="da-bottom-heading" id="da-more-brand-heading">More on ${escHtml(brandName)}</h3>
              <div id="da-more-brand-list" class="da-bottom-cards"></div>
            </section>

          </div><!-- /sc-article-main -->

          <!-- Sidebar: LATEST widget (populated by feed.js, excludes current article via __DA_ARTICLE_SLUG__) -->
          <aside class="sidebar-ad-col">
            <section class="home-stories-section latest-feed-section" aria-labelledby="article-latest-heading">
              <h2 class="latest-feed-heading" id="article-latest-heading">Latest</h2>
              <div id="dormied-latest-list" class="latest-feed-list">
                ${dormiedLatestHtml || '<p class="latest-feed-loading">Loading&#x2026;</p>'}
              </div>
            </section>
          </aside>

        </div><!-- /table-layout -->
      </div><!-- /container -->
    </section>

  </main>

  <!-- ══ FOOTER ════════════════════════════════════════════════════════════ -->
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
  <!-- Brand slug vars in their own block — isolated so any future error above cannot block them -->
  <script>window.__DA_BRAND_SLUG__='${escHtml(brandSlug)}';window.__DA_ARTICLE_SLUG__='${escHtml(slug)}';</script>
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
  <script src="/js/signup.min.js?v=20260324d"></script>
  <script src="/js/search.min.js?v=20260508"></script>
  <script src="/js/brand-data/${escHtml(brandSlug)}.js?v=${escHtml(dataVersion)}"></script>
  <script src="/js/feed.min.js?v=20260701"></script>
  <script src="/js/da-article.min.js?v=20260522"></script>

</body>
</html>`;
}

// ── Sitemap regeneration ───────────────────────────────────────────────────────
// Replaces the old append-based addToSitemap(). Rebuilds sitemap.xml from the
// filesystem so it can never contain orphan entries or duplicate URLs.

const { regenerateSitemap } = require('./generate-sitemap');
const { generateSearchIndex } = require('./generate-search-index');

// ── HTML verification ──────────────────────────────────────────────────────────
// Called immediately after writing the article HTML. Throws on any failure so
// the Supabase insert and sitemap regeneration are skipped for broken files.

function verifyArticleHtml(filePath, { title, slug }) {
  const MIN_SIZE = 5000;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    throw new Error(`Article file not found on disk after write: ${filePath}`);
  }
  if (stat.size < MIN_SIZE) {
    throw new Error(`Article HTML too small (${stat.size} bytes < ${MIN_SIZE}): ${filePath}`);
  }

  const html = fs.readFileSync(filePath, 'utf8');

  const checks = [
    ['<h1',                    'h1 element'],
    ['<meta name="description"', 'meta description'],
    ['<link rel="canonical"',  'canonical link'],
  ];
  for (const [needle, label] of checks) {
    if (!html.includes(needle)) {
      throw new Error(`Article HTML missing ${label}: ${filePath}`);
    }
  }

  // The article title (escaped) should appear somewhere in the HTML
  const titleSnippet = title.slice(0, 30); // first 30 chars is enough
  if (titleSnippet && !html.includes(titleSnippet)) {
    throw new Error(`Article title not found in HTML ("${titleSnippet}"): ${filePath}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabase    = getSupabase();
  const anthropic   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const dormiedData = loadDormiedData();
  loadBrands(); // validate file exists

  // Pre-fetch latest articles once for all sidebar bakes; filter per article below
  let allLatestArticles = [];
  try {
    allLatestArticles = await feedBake.fetchLatestArticles(supabase, 13, null);
  } catch (e) {
    console.warn('[generate] Feed bake pre-fetch failed:', e.message);
  }

  // --force-id=<golf_wire_matched uuid>  bypass all cooldown/dedup checks for one article
  const forceArg = process.argv.find(a => a.startsWith('--force-id='));
  const FORCE_IDS = forceArg ? new Set(forceArg.replace('--force-id=','').split(',')) : new Set();

  // ── --regenerate-all: fix category metadata + regenerate all article HTML ──
  // Metadata-only: no Opus calls. Body, title, x_post stay identical.
  // Updates dormied_articles.category from brand subCategories, rewrites HTML byline.
  if (process.argv.includes('--regenerate-all')) {
    console.log('[generate] --regenerate-all mode: updating categories + regenerating HTML');

    // Build brand map from dormiedData (available at this point in main())
    const regenBrandsMap = new Map((dormiedData.brands || []).map(b => [b.id, b]));

    const { data: allRows, error: allErr } = await supabase
      .from('dormied_articles')
      .select('matched_article_id, brand_slug, secondary_brand_slugs, published_at, title, slug, body, image_url, source_url, source_name, meta_description, seo_keywords, category, author')
      .neq('status', 'suppressed')
      .order('published_at', { ascending: false });

    if (allErr) {
      console.error('[generate] Failed to fetch articles:', allErr.message);
      process.exit(1);
    }

    let regen = 0; let skipped = 0;
    for (const row of allRows || []) {
      if (!row.slug || !row.body) { skipped++; continue; }
      // Feature articles (category 'Feature') are owned by generate-feature.js,
      // not the brand-article template, whether or not they tag a brand. Skip so
      // we never clobber their HTML.
      if (row.category === 'Feature' || !row.brand_slug) { skipped++; continue; }

      const bSlug  = row.brand_slug || '';
      const brand  = regenBrandsMap.get(bSlug) || {};
      const bName  = brand.name || bSlug;
      const bLogo  = brand.logo || '';
      const correctCategory = (brand.subCategories || [])[0] || brand.category || row.category || 'News';
      const author = row.author || authorFromCategory(brand.category || row.category);

      // Update DB record if category differs
      if (row.category !== correctCategory) {
        const { error: updErr } = await supabase
          .from('dormied_articles')
          .update({ category: correctCategory })
          .eq('slug', row.slug);
        if (updErr) {
          console.warn(`[generate] DB update failed for "${row.slug}": ${updErr.message}`);
        } else {
          console.log(`[generate] DB category fixed: ${row.slug}  ${row.category || '(empty)'} → ${correctCategory}`);
        }
      }

      // Regenerate HTML with corrected category
      const articlePath = path.join(SITE_ROOT, 'news', row.slug, 'index.html');
      try {
        const srcName = row.source_name || getSourceName(row.source_url || '');
        const rTime   = estimateReadTime(row.body);
        const secondarySlugs = (row.secondary_brand_slugs || []).filter(Boolean);
        const secondaryBrands = secondarySlugs
          .map(s => { const b = regenBrandsMap.get(s); return b ? { slug: s, name: b.name, logo: b.logo || '' } : null; })
          .filter(Boolean);
        const bHtml = bodyToHtml(row.body, bSlug, bName, secondaryBrands);
        const filteredLatest = allLatestArticles.filter(a => a.slug !== row.slug).slice(0, 10);
        const dormiedLatestHtml = allLatestArticles.length
          ? feedBake.renderLatestFeedHtml(filteredLatest, dormiedData)
          : null;

        const html = generateArticleHtml({
          title:            row.title,
          bodyHtml:         bHtml,
          imageUrl:         row.image_url || '',
          ogImageUrl:       row.image_url || 'https://dormied.com/images/og-image.jpg',
          imageAlt:         `${bName}: ${correctCategory}`,
          slug:             row.slug,
          category:         correctCategory,
          published_at:     row.published_at,
          source_url:       row.source_url || '',
          source_name:      srcName,
          meta_description: row.meta_description || '',
          seo_keywords:     row.seo_keywords || [],
          brandSlug:        bSlug,
          brandName:        bName,
          brandLogo:        bLogo,
          dataVersion:      (dormiedData.meta.lastUpdated || '').replace(/-/g, ''),
          readTime:         rTime,
          author,
          dormiedData,
          dormiedLatestHtml,
          secondaryBrands,
        });

        fs.mkdirSync(path.dirname(articlePath), { recursive: true });
        fs.writeFileSync(articlePath, html, 'utf8');
        regen++;
        if (regen % 25 === 0) console.log(`[generate] ...${regen} articles regenerated`);
      } catch (err) {
        console.warn(`[generate] Regeneration failed for "${row.slug}": ${err.message}`);
        skipped++;
      }
    }

    // Rebuild sitemap + search index once at the end
    try { regenerateSitemap(); } catch (e) { console.warn('[generate] Sitemap error:', e.message); }
    try { generateSearchIndex(); } catch (e) { console.warn('[generate] Search index error:', e.message); }

    // Regenerate /news/ listing to pick up corrected categories in chips
    const { execSync } = require('child_process');
    try {
      execSync('node scripts/generate-index-pages.js --news', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
      });
    } catch (e) {
      console.warn('[generate] Warning: generate-index-pages.js --news failed:', e.message);
    }

    console.log(`[generate] --regenerate-all complete. Regenerated: ${regen}, Skipped: ${skipped}`);
    process.exit(0);
  }

  // Step A: fetch all matched articles (recent 50 is more than enough)
  const { data: allMatched, error: fetchErr } = await supabase
    .from('golf_wire_matched')
    .select(`
      id,
      primary_brand_slug,
      all_brand_slugs,
      golf_wire_raw (
        id, title, body, image_url, source_url, category, published_at
      )
    `)
    .order('matched_at', { ascending: false })
    .limit(50);

  if (fetchErr) {
    console.error('[generate] Failed to fetch matched articles:', fetchErr.message);
    process.exit(1);
  }

  // Step B: fetch IDs already generated (+ brand + date + title for dedup checks)
  // NOTE: includes 'suppressed' rows so their matched_article_id stays in alreadyGenerated
  // and the pipeline never re-generates a manually-removed article.
  const { data: existing, error: existErr } = await supabase
    .from('dormied_articles')
    .select('status, matched_article_id, brand_slug, secondary_brand_slugs, published_at, title, slug, body, image_url, source_url, source_name, meta_description, seo_keywords, category, author');

  if (existErr) {
    console.error('[generate] Failed to fetch existing articles:', existErr.message);
    process.exit(1);
  }

  const alreadyGenerated = new Set((existing || []).map(r => r.matched_article_id).filter(Boolean));

  // ── Step B1: Backfill — regenerate HTML for any published article missing its file ──
  // Catches cases where Supabase has the record but the HTML was never written to disk
  // (e.g. script crashed after DB insert, or article was inserted manually).
  const brandsMap = new Map((dormiedData.brands || []).map(b => [b.id, b]));
  let backfilled = 0;
  for (const row of existing || []) {
    if (!row.slug || !row.body) continue;
    // Never regenerate suppressed articles — they were intentionally removed.
    if (row.status === 'suppressed') continue;
    const articlePath = path.join(SITE_ROOT, 'news', row.slug, 'index.html');
    if (fs.existsSync(articlePath)) continue;

    console.log(`[generate] Backfilling missing HTML: news/${row.slug}/index.html`);
    try {
      const bSlug    = row.brand_slug || '';
      const brand    = brandsMap.get(bSlug) || {};
      const bName    = brand.name || bSlug;
      const bLogo    = brand.logo || '';
      const author   = row.author || authorFromCategory(brand.category || row.category);
      const backfillCategory = (brand.subCategories || [])[0] || brand.category || row.category || 'News';
      const srcName  = row.source_name || getSourceName(row.source_url || '');
      const rTime    = estimateReadTime(row.body);

      // Rebuild secondary brands from stored slugs
      const secondarySlugs = (row.secondary_brand_slugs || []).filter(Boolean);
      const secondaryBrands = secondarySlugs
        .map(s => {
          const b = brandsMap.get(s);
          return b ? { slug: s, name: b.name, logo: b.logo || '' } : null;
        })
        .filter(Boolean);
      const bHtml = bodyToHtml(row.body, bSlug, bName, secondaryBrands);
      const filteredLatestB = allLatestArticles.filter(a => a.slug !== row.slug).slice(0, 10);
      const dormiedLatestHtmlB = allLatestArticles.length
        ? feedBake.renderLatestFeedHtml(filteredLatestB, dormiedData)
        : null;

      const html = generateArticleHtml({
        title:           row.title,
        bodyHtml:        bHtml,
        imageUrl:        row.image_url || '',
        ogImageUrl:      row.image_url || 'https://dormied.com/images/og-image.jpg',
        imageAlt:        `${bName}: ${backfillCategory}`,
        slug:            row.slug,
        category:        backfillCategory,
        published_at:    row.published_at,
        source_url:      row.source_url || '',
        source_name:     srcName,
        meta_description: row.meta_description || '',
        seo_keywords:    row.seo_keywords || [],
        brandSlug:       bSlug,
        brandName:       bName,
        brandLogo:       bLogo,
        dataVersion:     (dormiedData.meta.lastUpdated || '').replace(/-/g, ''),
        readTime:        rTime,
        author,
        dormiedData,
        dormiedLatestHtml: dormiedLatestHtmlB,
        secondaryBrands,
      });

      fs.mkdirSync(path.join(SITE_ROOT, 'news', row.slug), { recursive: true });
      fs.writeFileSync(articlePath, html, 'utf8');
      // Verify before touching sitemap — skip silently if it fails
      try {
        verifyArticleHtml(articlePath, { title: row.title || '', slug: row.slug });
      } catch (vErr) {
        console.warn(`[generate] Backfill verification failed for "${row.slug}": ${vErr.message} — cleaning up`);
        try { fs.unlinkSync(articlePath); } catch { /* best-effort */ }
        backfilled--;
        continue;
      }
      regenerateSitemap();
      try { generateSearchIndex(); } catch (siErr) { console.warn(`[generate] Search index failed: ${siErr.message}`); }
      console.log(`[generate] ✓ Backfilled: news/${row.slug}/index.html`);
      backfilled++;
    } catch (err) {
      console.warn(`[generate] Backfill failed for "${row.slug}": ${err.message}`);
    }
  }
  if (backfilled > 0) console.log(`[generate] Backfilled ${backfilled} missing article(s).`);

  // Build dedup indexes over the last 30 days of generated articles.
  // No brand cooldown — topic detection does all the work.
  const TOPIC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const recentArticles  = (existing || []).filter(r =>
    r.title && r.published_at &&
    (Date.now() - new Date(r.published_at)) < TOPIC_WINDOW_MS
  );

  // Global title index — raw source title vs every recent DORMIED title (Jaccard)
  const recentTitles = recentArticles.map(r => r.title);

  // Per-brand body index — raw source body vs recent same-brand generated bodies
  // Body comparison survives DORMIED's title rewrites because specific product names,
  // model numbers, and key facts appear in both raw and generated bodies.
  // Index under both primary and secondary brand slugs so cross-brand dedup works.
  const brandRecentBodies = {};
  for (const r of recentArticles) {
    if (!r.body) continue;
    const slugsToIndex = [r.brand_slug, ...(r.secondary_brand_slugs || [])].filter(Boolean);
    for (const s of slugsToIndex) {
      if (!brandRecentBodies[s]) brandRecentBodies[s] = [];
      brandRecentBodies[s].push(r.body);
    }
  }

  // Step C: filter in JS, cap at MAX
  const matched = (allMatched || [])
    .filter(m => {
      if (alreadyGenerated.has(m.id)) return false;
      if (BRAND_DENYLIST.has(m.primary_brand_slug)) {
        console.log(`[generate] Skipping denylisted brand: ${m.primary_brand_slug}`);
        return false;
      }
      // --force-id bypasses all dedup checks for a specific article
      if (FORCE_IDS.has(m.id)) {
        console.log(`[generate] Force-generating: ${m.id}`);
        return true;
      }

      const raw      = m.golf_wire_raw;
      const rawTitle = raw?.title || '';
      const rawBody  = raw?.body  || '';

      // ── Check 1: global title similarity (catches same story under different headline) ──
      if (rawTitle) {
        const similar = recentTitles.find(t => titleSimilarity(rawTitle, t) >= 0.35);
        if (similar) {
          console.log(`[generate] Skipping similar title: "${rawTitle}" ≈ "${similar}"`);
          return false;
        }
      }

      // ── Check 2: same-brand body similarity (catches same TOPIC even with different title) ──
      // Compares incoming raw body keywords against stored generated bodies for the same brand.
      // Threshold 0.20 → same story shares ~40-60% of body terms; different story shares ~5-15%.
      // Check against ALL brands in this matched article (primary + secondary).
      if (rawBody) {
        const slugsToCheck = [m.primary_brand_slug, ...(Array.isArray(m.all_brand_slugs) ? m.all_brand_slugs : [])].filter(Boolean);
        for (const slug of slugsToCheck) {
          const brandBodies = brandRecentBodies[slug] || [];
          for (const pastBody of brandBodies) {
            const sim = bodySimilarity(rawBody, pastBody);
            if (sim >= 0.20) {
              console.log(`[generate] Skipping same-brand topic (body sim ${(sim * 100).toFixed(0)}%, brand ${slug}): "${rawTitle}"`);
              return false;
            }
          }
        }
      }

      return true;
    })
    .slice(0, MAX_ARTICLES_PER_RUN);

  // Deduplicate within this run: one article per brand (keeps first / highest-priority match).
  // Track all brands (primary + secondary) so two articles covering the same brand aren't generated.
  const seenBrandsThisRun = new Set();
  const matchedDeduped = matched.filter(m => {
    if (FORCE_IDS.has(m.id)) return true; // forced articles always included
    const allSlugsForM = [m.primary_brand_slug, ...(Array.isArray(m.all_brand_slugs) ? m.all_brand_slugs : [])].filter(Boolean);
    const conflict = allSlugsForM.find(s => seenBrandsThisRun.has(s));
    if (conflict) {
      console.log(`[generate] Skipping within-run duplicate brand (${conflict}): ${m.primary_brand_slug}`);
      return false;
    }
    for (const s of allSlugsForM) seenBrandsThisRun.add(s);
    return true;
  });

  console.log(`[generate] ${matchedDeduped.length} articles to generate (max ${MAX_ARTICLES_PER_RUN}/run)`);

  let generated = 0;

  for (const match of matchedDeduped) {
    const raw = match.golf_wire_raw;
    if (!raw) { console.warn('[generate] No raw article for match:', match.id); continue; }

    const brandSlug = match.primary_brand_slug;
    const brandInfo = getBrandInfo(dormiedData, brandSlug);

    if (!brandInfo) {
      console.warn(`[generate] Brand not found in data.js: ${brandSlug}`);
      continue;
    }

    // Determine author before calling Opus — voice block depends on it
    const author = authorFromCategory(brandInfo.brand.category || raw.category);

    // Derive display category from brand's subCategories (more specific and reliable than wire feed)
    const articleCategory = (brandInfo.brand.subCategories || [])[0]
                         || brandInfo.brand.category
                         || 'News';

    console.log(`[generate] Generating: "${raw.title}" → ${brandSlug} (author: ${author})`);

    // ── Call Opus ──
    let rawResponse = await callOpus(anthropic, raw.body, brandInfo, author, false);
    let parsed      = parseOpusResponse(rawResponse);

    if (!parsed || isInvalid(parsed.body)) {
      console.warn(`[generate] First response invalid for "${raw.title}" — retrying`);
      rawResponse = await callOpus(anthropic, raw.body, brandInfo, author, true);
      parsed      = parseOpusResponse(rawResponse);
      if (!parsed) {
        console.warn(`[generate] Second response also unparseable — skipping`);
        continue;
      }
    }

    // ── Word-count gate ───────────────────────────────────────────────────────
    // Hard floor at 500 words: retry once with an expansion addendum.
    // Soft warning for 500-549 words: log but proceed.
    if (isTooShort(parsed.body)) {
      const wc = wordCount(parsed.body);
      console.warn(`[generate] Body too short (${wc} words) for "${raw.title}" — retrying with expansion prompt`);
      const expansionAddendum = '\n\nYour previous article was too short. The target is 550-700 words. Expand the body with additional context, industry analysis, or relevant history. Add at least one more substantive paragraph. Do not pad — every sentence should add information. Return valid JSON with all fields.';
      rawResponse = await callOpus(anthropic, raw.body + expansionAddendum, brandInfo, author, false);
      parsed      = parseOpusResponse(rawResponse);
      if (!parsed) {
        console.warn(`[generate] Expansion retry unparseable — skipping`);
        continue;
      }
      if (isInvalid(parsed.body)) {
        console.warn(`[generate] Expansion retry invalid — skipping`);
        continue;
      }
    }

    const wc = wordCount(parsed.body);
    if (wc < 550) {
      console.warn(`[generate] ⚠ Soft word-count warning: ${wc} words for "${raw.title}" (target 550-700)`);
    } else {
      console.log(`[generate] Word count: ${wc} words`);
    }

    const { title, seo_keywords } = parsed;
    // Strip em dashes from body and x_post — the prompt forbids them but LLMs
    // still slip them in. Post-processing guarantees they never reach the page.
    const body             = stripEmDashes(parsed.body);
    const meta_description = stripEmDashes(parsed.meta_description);
    const x_post           = stripEmDashes(parsed.x_post);
    const publishedAt = raw.published_at || new Date().toISOString();
    const slug        = makeSlug(title, publishedAt);
    const readTime    = estimateReadTime(body);

    // ── Secondary brands ─────────────────────────────────────────────────────
    // all_brand_slugs is the full set matched to this wire item; primary is already first.
    const allSlugs       = Array.isArray(match.all_brand_slugs) ? match.all_brand_slugs : [];
    const secondarySlugs = allSlugs.filter(s => s && s !== brandSlug);
    const brandsMapLocal = dormiedData ? new Map((dormiedData.brands || []).map(b => [b.id, b])) : new Map();
    const secondaryBrands = secondarySlugs
      .map(s => {
        const b = brandsMapLocal.get(s);
        return b ? { slug: s, name: b.name, logo: b.logo || '' } : null;
      })
      .filter(Boolean)
      .slice(0, 3); // cap at 3 secondary brands per article
    if (secondaryBrands.length > 0) {
      console.log(`[generate] Secondary brands: ${secondaryBrands.map(b => b.slug).join(', ')}`);
    }

    const bodyHtml    = bodyToHtml(body, brandSlug, brandInfo.brand.name, secondaryBrands);
    // author is already computed above (before callOpus) — used here for HTML generation

    // ── Derive source name from URL ──
    const sourceName = getSourceName(raw.source_url);

    // ── Upload image to Supabase Storage + save locally ──
    const { supabaseUrl, localUrl } = await uploadImageToSupabase(supabase, raw.image_url, slug);
    // localUrl (Vercel CDN) used for og:image — proper caching for Twitter cards
    // supabaseUrl (or source URL) used for article body <img>
    const imageUrl    = supabaseUrl || raw.image_url;
    // Use Vercel CDN path for og:image (reliable for Twitter Card + X direct upload).
    // Fall back to the DORMIED default rather than a raw source URL, which may block hotlinking.
    const ogImageUrl  = localUrl || 'https://dormied.com/images/og-image.jpg';

    // ── TRANSACTIONAL PUBLISH ─────────────────────────────────────────────────
    // Order: write HTML → verify HTML → insert Supabase → regenerate sitemap.
    // If HTML write or verification fails, Supabase and sitemap are untouched.
    // If the Supabase insert fails, the HTML exists on disk (backfill will
    // retry on next run) but the sitemap is not updated — harmless.

    const articleDir  = path.join(SITE_ROOT, 'news', slug);
    const articlePath = path.join(articleDir, 'index.html');
    fs.mkdirSync(articleDir, { recursive: true });

    // Step 1: write candidate HTML
    const filteredLatestNew = allLatestArticles.filter(a => a.slug !== slug).slice(0, 10);
    const dormiedLatestHtmlNew = allLatestArticles.length
      ? feedBake.renderLatestFeedHtml(filteredLatestNew, dormiedData)
      : null;
    const html = generateArticleHtml({
      title, bodyHtml, imageUrl, ogImageUrl, localUrl,
      imageAlt:        `${brandInfo.brand.name}: ${articleCategory}`,
      slug, category:  articleCategory,
      published_at:    publishedAt,
      source_url:      raw.source_url,
      source_name:     sourceName,
      meta_description,
      seo_keywords,
      brandSlug,
      brandName:       brandInfo.brand.name,
      brandLogo:       brandInfo.brand.logo || '',
      dataVersion:     (dormiedData.meta.lastUpdated || '').replace(/-/g, ''),
      readTime,
      author,
      dormiedData,
      dormiedLatestHtml: dormiedLatestHtmlNew,
      secondaryBrands,
    });

    fs.writeFileSync(articlePath, html, 'utf8');

    // Step 2: verify HTML on disk before committing any external state
    try {
      verifyArticleHtml(articlePath, { title, slug });
    } catch (verifyErr) {
      console.error(`[generate] ✗ HTML verification failed for "${title}": ${verifyErr.message}`);
      // Roll back the partial file so it doesn't get committed as a stub
      try { fs.unlinkSync(articlePath); } catch { /* best-effort */ }
      try { fs.rmdirSync(articleDir);   } catch { /* best-effort */ }
      console.error(`[generate] Rolled back partial file. Skipping "${title}".`);
      continue; // move on to next article — don't abort the whole run
    }

    console.log(`[generate] ✓ Wrote + verified news/${slug}/index.html`);

    // Step 3: commit to Supabase (only after HTML is verified on disk)
    const { error: insertErr } = await supabase
      .from('dormied_articles')
      .insert({
        matched_article_id:   match.id,
        brand_slug:           brandSlug,
        secondary_brand_slugs: secondaryBrands.map(b => b.slug),
        title,
        body,
        image_url:            imageUrl,
        source_url:           raw.source_url,
        source_name:          sourceName,
        meta_description,
        seo_keywords:         seo_keywords || [],
        published_at:         publishedAt,
        status:               'draft', // promoted → 'published' by publish-articles.js after git push
        slug,
        category:             articleCategory,
        x_post_text:          x_post || null,
        author,
      });

    if (insertErr) {
      console.warn(`[generate] Supabase insert failed for "${title}":`, insertErr.message);
      // HTML is on disk — backfill will pick it up on next run once the DB record exists
    }

    // Step 4: regenerate sitemap and search index from filesystem
    try {
      regenerateSitemap();
    } catch (sitemapErr) {
      console.warn(`[generate] Sitemap regeneration failed: ${sitemapErr.message}`);
    }
    try {
      generateSearchIndex();
    } catch (siErr) {
      console.warn(`[generate] Search index regeneration failed: ${siErr.message}`);
    }

    // ── Update in-memory title index so this run doesn't double-generate same story ──
    recentTitles.push(title); // use the generated title for future similarity checks

    generated++;
    console.log(`[generate] ✓ Published: "${title}"`);

    // Rate limit — be kind to Anthropic API
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`[generate] Done. Generated: ${generated}`);
}

main()
  .then(() => {
    /* ── Pipeline trigger: regenerate /news/ index pages after new articles ── */
    const { execSync } = require('child_process');
    try {
      execSync('node scripts/generate-index-pages.js --news', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
      });
    } catch (e) {
      console.warn('[generate] Warning: generate-index-pages.js --news failed:', e.message);
    }
  })
  .catch(err => {
    console.error('[generate] Fatal error:', err.message);
    process.exit(1);
  });
