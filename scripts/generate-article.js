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

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_ARTICLES_PER_RUN = 5;
const MODEL                = 'claude-opus-4-5';
const SITE_ROOT            = path.resolve(__dirname, '..');

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

function trendStr(cur, base) {
  if (!base) return '—';
  const pct = Math.round(((cur - base) / base) * 100);
  return pct > 0 ? `+${pct}%` : pct < 0 ? `${pct}%` : 'flat';
}

function getBrandInfo(dormiedData, brandSlug) {
  const brand = dormiedData.brands.find(b => b.id === brandSlug);
  if (!brand) return null;

  const currentMonth  = dormiedData.meta.currentMonth;
  const previousMonth = dormiedData.meta.previousMonth;
  const month3ago     = shiftMonth(currentMonth, -3);
  const month12ago    = shiftMonth(currentMonth, -12);

  const globalData = brand.searchesByMarket?.global || {};
  const curSearches  = globalData[currentMonth]  || 0;
  const prevSearches = globalData[previousMonth] || 0;
  const s3ago        = globalData[month3ago]     || 0;
  const s12ago       = globalData[month12ago]    || 0;

  // Compute DI score (0–100 relative to top brand)
  const maxSearches = Math.max(
    ...dormiedData.brands.map(b => b.searchesByMarket?.global?.[currentMonth] || 0)
  );
  const di = maxSearches > 0 ? Math.min(100, Math.round((curSearches / maxSearches) * 100)) : 0;

  // Compute global rank
  const sorted = dormiedData.brands
    .map(b => ({ id: b.id, s: b.searchesByMarket?.global?.[currentMonth] || 0 }))
    .sort((a, b) => b.s - a.s);
  const rank = sorted.findIndex(b => b.id === brandSlug) + 1;

  // Month-over-month change
  const momPct = prevSearches > 0
    ? Math.round(((curSearches - prevSearches) / prevSearches) * 100)
    : 0;
  const momStr = momPct > 0 ? `+${momPct}%` : momPct < 0 ? `${momPct}%` : 'flat';

  // 3-month and 12-month trends
  const trend3mStr  = trendStr(curSearches, s3ago);
  const trend12mStr = trendStr(curSearches, s12ago);

  return { brand, rank, di, momPct, momStr, trend3mStr, trend12mStr, currentMonth };
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

function bodyToHtml(plainText, brandSlug, brandName) {
  const paras = plainText.split(/\n\n+/).filter(p => p.trim());
  return paras.map(p => {
    // Auto-link brand name in body
    const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\w/"])${escaped}(?![\\w"])`, 'g');
    const linked = p.replace(re, `<a href="/brands/${brandSlug}/" class="da-brand-link">${brandName}</a>`);
    return `<p>${linked}</p>`;
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

// ── Opus ──────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the editorial voice of DORMIED, a golf brand intelligence platform. Rewrite the following press release as a substantial original article (400-600 words). Write in DORMIED's voice: direct, dry, opinionated, informed. No filler. No em dashes. No exclamation points. No "exciting news" language. No preamble. No bullet points.

Lead with the story. What happened, why it matters, what it says about where this brand is headed, and what it means for the broader golf market. Write like a columnist covering a beat, not like a data platform summarizing metrics. The reader should walk away understanding the news, your take on it, and why it matters to them as a golfer or someone following the industry.

The brand's DORMIED Index ranking and trend data are provided for context. You may reference them once or twice, briefly, if they support or contradict the story. Do not build the article around the data. Do not lead with the ranking. Do not mention the DORMIED Index by name more than once. If the data does not add anything meaningful to the story, leave it out entirely.

This article will appear alongside headlines from MyGolfSpy, GolfWRX, and Golf Digest. The headline must be competitive and click-worthy, not press-release-shaped. Write a headline that a gear-obsessed golfer would click over those sources.

Structure:
- Lead sentence: the news, stated plainly and with authority
- Body (3-5 paragraphs): context, history, editorial analysis, and industry implications
- Closing paragraph: a forward-looking observation about this brand's trajectory

DISALLOWED opening phrases (will be auto-rejected):
"Based on", "According to", "From my", "From the", "Looking at", "After reviewing", "Having reviewed", "The search results", "The news", "The data shows", "It appears", "It seems", "[Brand name]" as the first word.

DISALLOWED anywhere in body:
"my search", "search results", "exciting news", "thrilled to", "proud to announce", "we are pleased", "the index shows", "the data suggests", "according to the DORMIED Index"

Start with the editorial observation. Write like a columnist, not a press office or a dashboard.

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
  "body": "paragraph one\\n\\nparagraph two\\n\\nparagraph three",
  "meta_description": "120-155 character SEO description including brand name",
  "seo_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "x_post": "under 250 chars, no hashtags, hot take voice"
}`;

async function callOpus(client, pressRelease, brandInfo, retry = false) {
  const { brand, rank, di, momStr, currentMonth } = brandInfo;

  const userMsg = `Brand: ${brand.name}
Current DORMIED global rank: #${rank} of 169
DI score: ${di}/100
Month-over-month: ${momStr}
Month: ${currentMonth}
Category: ${brand.category}

Press release:
${pressRelease}${retry ? '\n\nYour previous response contained a disallowed phrase or invalid JSON. Rewrite starting directly with the editorial observation. Include all fields (title, body, meta_description, seo_keywords, x_post). Return valid JSON only.' : ''}`;

  const res = await client.messages.create({
    model:      MODEL,
    max_tokens: 2000,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userMsg }],
  });

  return (res.content[0]?.text || '').trim();
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
    brandSlug, brandName, brandLogo, brandRank, brandDI, brandMom,
    brandTrend3m, brandTrend12m,
    readTime, author,
  } = opts;

  const dateFormatted  = formatDate(published_at);
  const dateISO        = new Date(published_at).toISOString();
  const canonicalUrl   = `https://dormied.com/news/${slug}/`;
  const ogImage        = ogImageUrl || imageUrl || 'https://dormied.com/images/og-image.jpg';
  const titleTag       = `${title} | DORMIED`;
  const momClass       = brandMom > 0 ? 'da-mom-up' : brandMom < 0 ? 'da-mom-down' : 'da-mom-flat';
  const momDisplay     = brandMom > 0 ? `+${brandMom}%` : brandMom < 0 ? `${brandMom}%` : 'flat';
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
  <link rel="preconnect" href="https://pagead2.googlesyndication.com">

  <!-- ── Fonts ── -->
  <link rel="stylesheet" href="/css/fonts.css">

  <!-- ── Styles ── -->
  <link rel="stylesheet" href="/css/styles.css?v=20260409">

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
    "url": "${canonicalUrl}",
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
</head>
<body>

  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>

  <!-- ══ TOP AD ════════════════════════════════════════════════════════════ -->
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

  <!-- ══ SITE HEADER ═══════════════════════════════════════════════════════ -->
  <header class="site-header" role="banner">
    <div class="container header-inner">
      <a href="/" class="site-logo" aria-label="DORMIED home">
        <img src="/images/dormied-logo-colour.png" alt="DORMIED" class="logo-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="logo-text-fallback" style="display:none">DORMIED</span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a href="/rankings/"  class="site-nav-link">Index</a>
        <a href="/scorecard/" class="site-nav-link">Scorecard</a>
        <a href="/news/"      class="site-nav-link site-nav-link--active">News</a>
        <a href="/brands/"    class="site-nav-link">Brands</a>
      </nav>
    </div>
  </header>

  <!-- ══ MAIN ══════════════════════════════════════════════════════════════ -->
  <main id="main-content">

    <!-- ── Breadcrumb ── -->
    <nav class="da-breadcrumb container" aria-label="Breadcrumb" style="padding-top:.75rem;padding-bottom:.25rem;font-size:.78rem;color:var(--clr-muted,#6b7a6b)">
      <a href="/" style="color:inherit;text-decoration:none">Home</a>
      <span aria-hidden="true" style="margin:0 .4em">&rsaquo;</span>
      <a href="/news/" style="color:inherit;text-decoration:none">News</a>
      <span aria-hidden="true" style="margin:0 .4em">&rsaquo;</span>
      <span aria-current="page">${escHtml(title)}</span>
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
        <div class="table-layout">

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
                  <div class="bp-metric-card"><span class="bp-metric-label">Global Rank</span><span class="bp-metric-val">#${brandRank}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">DI Score</span><span class="bp-metric-val">${brandDI}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">M/M Change</span><span class="bp-metric-val ${momClass}">${momDisplay}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">3M Trend</span><span class="bp-metric-val">${escHtml(brandTrend3m || '—')}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">12M Trend</span><span class="bp-metric-val">${escHtml(brandTrend12m || '—')}</span></div>
                </div>
              </div>
            </div>


            <!-- More on [Brand] -->
            <section class="da-bottom-section" id="da-more-brand-section" aria-labelledby="da-more-brand-heading" hidden>
              <h3 class="da-bottom-heading" id="da-more-brand-heading">More on ${escHtml(brandName)}</h3>
              <div id="da-more-brand-list" class="da-bottom-cards"></div>
            </section>

            <!-- Latest from DORMIED -->
            <section class="da-bottom-section" id="da-latest-dormied-section" aria-labelledby="da-latest-dormied-heading" hidden>
              <h3 class="da-bottom-heading" id="da-latest-dormied-heading">Latest from DORMIED</h3>
              <div id="da-latest-dormied-list" class="da-bottom-cards"></div>
            </section>

          </div><!-- /sc-article-main -->

          <!-- ── Sidebar: 160×600 ad ── -->
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
          <a href="https://www.threads.com/@dormiedgolf" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on Threads">
            <svg width="15" height="15" viewBox="0 0 192 192" fill="currentColor" aria-hidden="true"><path d="M141.537 88.988a66.667 66.667 0 0 0-2.518-1.143c-1.482-27.307-16.403-43.246-41.457-43.39h-.34c-14.986 0-27.449 6.396-35.12 18.05l13.78 9.452c5.73-8.695 14.724-10.548 21.348-10.548h.23c8.248.054 14.474 2.452 18.502 7.129 2.932 3.405 4.893 8.111 5.864 14.05-7.314-1.243-15.224-1.626-23.68-1.14-23.82 1.371-39.134 15.264-38.105 34.568.522 9.792 5.4 18.216 13.735 23.719 7.047 4.652 16.124 6.927 25.557 6.412 12.458-.683 22.231-5.436 29.049-14.127 5.178-6.6 8.453-15.153 9.899-25.93 5.937 3.583 10.337 8.298 12.767 13.966 4.132 9.635 4.373 25.468-8.546 38.376-11.319 11.308-24.925 16.2-45.488 16.35-22.809-.169-40.06-7.484-51.275-21.742C35.236 139.966 29.808 120.682 29.605 96c.203-24.682 5.63-43.966 16.133-57.317C56.954 24.425 74.204 17.11 97.013 16.94c22.975.17 40.526 7.52 52.171 21.848 5.71 6.989 10.031 15.88 12.903 26.395l16.147-4.314c-3.466-12.94-9.004-24.076-16.55-33.236-15.02-18.384-37.221-27.805-65.768-28.006h-.23C68.882-.152 46.447 9.306 30.664 27.836 16.582 44.498 9.123 67.568 8.887 96.013c.236 28.445 7.695 51.515 21.777 68.177 15.783 18.53 38.218 27.988 66.67 28.143h.23c25.551-.164 43.597-6.916 58.435-21.742 19.72-19.694 19.131-44.39 12.637-59.573-4.548-10.603-13.311-19.222-26.099-25.03Zm-45.48 43.645c-10.446.571-21.295-4.101-21.836-14.167-.388-7.254 5.14-15.316 21.405-16.25 1.875-.108 3.718-.16 5.531-.16 6.316 0 12.218.609 17.577 1.774-2.003 24.993-12.854 28.214-22.677 28.803Z"/></svg>
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
          <p class="footer-signup-sub">Where golf culture, brand, and marketing collide, once a month in your inbox.</p>
        </div>
        <form class="footer-signup-form" novalidate>
          <div class="footer-signup-row">
            <input class="footer-signup-input" type="email" placeholder="Your email" required autocomplete="email" aria-label="Email address">
            <button class="footer-signup-btn" type="submit">Get The Scorecard</button>
          </div>
          <p class="footer-signup-msg" style="display:none"></p>
        </form>
      </div>
      <p class="footer-legal">© <span id="footer-year"></span> DORMIED. Rankings are independent editorial content. All brand names and logos are property of their respective owners.</p>
    </div>
  </footer>

  <!-- ══ SCRIPTS ════════════════════════════════════════════════════════════ -->
  <script>
    document.getElementById('footer-year').textContent = new Date().getFullYear();
    window.__DA_BRAND_SLUG__   = '${escHtml(brandSlug)}';
    window.__DA_ARTICLE_SLUG__ = '${escHtml(slug)}';
  </script>
  <script src="/js/analytics.min.js?v=20260320a"></script>
  <script src="/js/signup.min.js?v=20260324d"></script>
  <script src="/js/brand-data/${escHtml(brandSlug)}.js"></script>
  <script src="/js/da-article.min.js?v=20260419d"></script>
  <script>
  window.addEventListener('load',function(){
    var s=document.createElement('script');
    s.async=true;s.crossOrigin='anonymous';
    s.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5259693727609263';
    document.head.appendChild(s);
    s.onload=function(){
      var ads=document.querySelectorAll('.adsbygoogle');
      for(var i=0;i<ads.length;i++){(adsbygoogle=window.adsbygoogle||[]).push({});}
    };
  });
  </script>

</body>
</html>`;
}

// ── Sitemap updater ───────────────────────────────────────────────────────────

function xmlEscSitemap(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addToSitemap(slug, publishedAt, imageUrl, imageTitle) {
  const sitemapPath = path.join(SITE_ROOT, 'sitemap.xml');
  let sitemap = fs.readFileSync(sitemapPath, 'utf8');

  const dateStr    = publishedAt.slice(0, 10);
  const today      = new Date().toISOString().slice(0, 10);

  // Build image block (include only if we have an actual hero image — not the og-image fallback)
  const hasImage = imageUrl && !imageUrl.includes('og-image.jpg');
  const imageBlock = hasImage
    ? `\n    <image:image>\n      <image:loc>${xmlEscSitemap(imageUrl)}</image:loc>\n      <image:title>${xmlEscSitemap(imageTitle)}</image:title>\n    </image:image>`
    : '';

  // Article entry with image tag
  const entry = `\n  <url>\n    <loc>https://dormied.com/news/${slug}/</loc>\n    <lastmod>${dateStr}</lastmod>\n    <changefreq>never</changefreq>\n    <priority>0.7</priority>${imageBlock}\n  </url>`;

  // Insert before the closing </urlset>
  sitemap = sitemap.replace('</urlset>', entry + '\n</urlset>');

  // Also bump the /news/ index lastmod so Google knows to re-crawl the listing
  sitemap = sitemap.replace(
    /(<loc>https:\/\/dormied\.com\/news\/<\/loc>\n\s*<lastmod>)[^<]+(<\/lastmod>)/,
    `$1${today}$2`,
  );

  fs.writeFileSync(sitemapPath, sitemap, 'utf8');
  console.log(`[generate] Added /news/${slug}/ to sitemap (image: ${hasImage ? 'yes' : 'no'})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabase    = getSupabase();
  const anthropic   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const dormiedData = loadDormiedData();
  loadBrands(); // validate file exists

  // --force-id=<golf_wire_matched uuid>  bypass all cooldown/dedup checks for one article
  const forceArg = process.argv.find(a => a.startsWith('--force-id='));
  const FORCE_IDS = forceArg ? new Set(forceArg.replace('--force-id=','').split(',')) : new Set();

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
  const { data: existing, error: existErr } = await supabase
    .from('dormied_articles')
    .select('matched_article_id, brand_slug, published_at, title, slug, body, image_url, source_url, source_name, meta_description, seo_keywords, category, author');

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
    const articlePath = path.join(SITE_ROOT, 'news', row.slug, 'index.html');
    if (fs.existsSync(articlePath)) continue;

    console.log(`[generate] Backfilling missing HTML: news/${row.slug}/index.html`);
    try {
      const bSlug    = row.brand_slug || '';
      const brand    = brandsMap.get(bSlug) || {};
      const bName    = brand.name || bSlug;
      const bLogo    = brand.logo || '';
      const author   = row.author || authorFromCategory(row.category);
      const srcName  = row.source_name || getSourceName(row.source_url || '');
      const bHtml    = bodyToHtml(row.body, bSlug, bName);
      const rTime    = estimateReadTime(row.body);

      const html = generateArticleHtml({
        title:           row.title,
        bodyHtml:        bHtml,
        imageUrl:        row.image_url || '',
        ogImageUrl:      row.image_url || 'https://dormied.com/images/og-image.jpg',
        imageAlt:        `${bName} — ${row.category || 'Golf'}`,
        slug:            row.slug,
        category:        row.category || 'Business',
        published_at:    row.published_at,
        source_url:      row.source_url || '',
        source_name:     srcName,
        meta_description: row.meta_description || '',
        seo_keywords:    row.seo_keywords || [],
        brandSlug:       bSlug,
        brandName:       bName,
        brandLogo:       bLogo,
        brandRank:       0,
        brandDI:         0,
        brandMom:        0,
        brandTrend3m:    '—',
        brandTrend12m:   '—',
        readTime:        rTime,
        author,
      });

      fs.mkdirSync(path.join(SITE_ROOT, 'news', row.slug), { recursive: true });
      fs.writeFileSync(articlePath, html, 'utf8');
      addToSitemap(row.slug, row.published_at, row.image_url || '', row.title || '');
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
  const brandRecentBodies = {};
  for (const r of recentArticles) {
    if (!r.brand_slug || !r.body) continue;
    if (!brandRecentBodies[r.brand_slug]) brandRecentBodies[r.brand_slug] = [];
    brandRecentBodies[r.brand_slug].push(r.body);
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
      if (rawBody) {
        const brandBodies = brandRecentBodies[m.primary_brand_slug] || [];
        for (const pastBody of brandBodies) {
          const sim = bodySimilarity(rawBody, pastBody);
          if (sim >= 0.20) {
            console.log(`[generate] Skipping same-brand topic (body sim ${(sim * 100).toFixed(0)}%): "${rawTitle}"`);
            return false;
          }
        }
      }

      return true;
    })
    .slice(0, MAX_ARTICLES_PER_RUN);

  // Deduplicate within this run: one article per brand (keeps first / highest-priority match)
  const seenBrandsThisRun = new Set();
  const matchedDeduped = matched.filter(m => {
    if (FORCE_IDS.has(m.id)) return true; // forced articles always included
    if (seenBrandsThisRun.has(m.primary_brand_slug)) {
      console.log(`[generate] Skipping within-run duplicate brand: ${m.primary_brand_slug}`);
      return false;
    }
    seenBrandsThisRun.add(m.primary_brand_slug);
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

    console.log(`[generate] Generating: "${raw.title}" → ${brandSlug}`);

    // ── Call Opus ──
    let rawResponse = await callOpus(anthropic, raw.body, brandInfo, false);
    let parsed      = parseOpusResponse(rawResponse);

    if (!parsed || isInvalid(parsed.body)) {
      console.warn(`[generate] First response invalid for "${raw.title}" — retrying`);
      rawResponse = await callOpus(anthropic, raw.body, brandInfo, true);
      parsed      = parseOpusResponse(rawResponse);
      if (!parsed) {
        console.warn(`[generate] Second response also unparseable — skipping`);
        continue;
      }
    }

    const { title, body, meta_description, seo_keywords, x_post } = parsed;
    const publishedAt = raw.published_at || new Date().toISOString();
    const slug        = makeSlug(title, publishedAt);
    const readTime    = estimateReadTime(body);
    const bodyHtml    = bodyToHtml(body, brandSlug, brandInfo.brand.name);
    // Use brand category first (reliable) — raw.category from the wire can be generic
    const author      = authorFromCategory(brandInfo.brand.category || raw.category);

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

    // ── Write static HTML file ──
    const articleDir = path.join(SITE_ROOT, 'news', slug);
    fs.mkdirSync(articleDir, { recursive: true });

    const html = generateArticleHtml({
      title, bodyHtml, imageUrl, ogImageUrl, localUrl,
      imageAlt:        `${brandInfo.brand.name} — ${raw.category || 'Golf'}`,
      slug, category:  raw.category || 'Business',
      published_at:    publishedAt,
      source_url:      raw.source_url,
      source_name:     sourceName,
      meta_description,
      seo_keywords,
      brandSlug,
      brandName:  brandInfo.brand.name,
      brandLogo:  brandInfo.brand.logo || '',
      brandRank:  brandInfo.rank,
      brandDI:    brandInfo.di,
      brandMom:      brandInfo.momPct,
      brandTrend3m:  brandInfo.trend3mStr,
      brandTrend12m: brandInfo.trend12mStr,
      readTime,
      author,
    });

    fs.writeFileSync(path.join(articleDir, 'index.html'), html, 'utf8');
    console.log(`[generate] ✓ Wrote news/${slug}/index.html`);

    // ── Store in Supabase ──
    const { error: insertErr } = await supabase
      .from('dormied_articles')
      .insert({
        matched_article_id: match.id,
        brand_slug:         brandSlug,
        title,
        body,
        image_url:          imageUrl,
        source_url:         raw.source_url,
        source_name:        sourceName,
        meta_description,
        seo_keywords:       seo_keywords || [],
        published_at:       publishedAt,
        status:             'draft', // promoted → 'published' by publish-articles.js after git push
        slug,
        category:           raw.category || 'Business',
        x_post_text:        x_post || null,
        author,
      });

    if (insertErr) {
      console.warn(`[generate] Supabase insert failed for "${title}":`, insertErr.message);
    }

    // ── Update sitemap (with image tags for Google Image Search + Discover) ──
    addToSitemap(slug, publishedAt, ogImageUrl, title);

    // ── Update in-memory title index so this run doesn't double-generate same story ──
    recentTitles.push(title); // use the generated title for future similarity checks

    generated++;
    console.log(`[generate] ✓ Published: "${title}"`);

    // Rate limit — be kind to Anthropic API
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`[generate] Done. Generated: ${generated}`);
}

main().catch(err => {
  console.error('[generate] Fatal error:', err.message);
  process.exit(1);
});
