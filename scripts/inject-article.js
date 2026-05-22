#!/usr/bin/env node
/**
 * DORMIED Content Pipeline — Manual Article Injector
 *
 * Injects a manually-sourced article into the pipeline:
 * calls Opus, generates HTML, writes to disk, inserts Supabase record,
 * updates sitemap. Identical to generate-article.js but the source
 * content is provided directly rather than pulled from golf_wire_matched.
 *
 * Usage:
 *   node scripts/inject-article.js
 *
 * Edit the CONFIG block below for each article, then run.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const fs               = require('fs');
const path             = require('path');
const vm               = require('vm');
const Anthropic        = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
let   sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

// ═══════════════════════════════════════════════════════════════════════════════
// ── CONFIG — edit this block for each manually-sourced article ────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  /** Brand slug as it appears in data.js (e.g. 'vice-golf') */
  brandSlug: 'vice-golf',

  /** Where the source story originated */
  sourceUrl:  'https://shopping.yahoo.com/style/articles/zara-home-dropped-most-unexpected-193638126.html',
  sourceName: 'Yahoo Shopping',

  /**
   * Optional hero image URL.
   * Leave null to use the DORMIED default og-image as the social card.
   */
  imageUrl: null,

  /**
   * The raw source content Opus will rewrite into a DORMIED article.
   * Write this as you would a wire brief: facts first, context second.
   * Opus will apply its own editorial voice, headline, and structure.
   */
  sourceBody: `
Zara Home, the lifestyle and interiors arm of Inditex (Zara's Spanish parent company),
has launched an unexpected golf collection that crosses between the course and the home.
The collection covers apparel (polos, vests, trousers, a golf cardigan at $129, a cap at $35),
a premium leather golf bag with matching headcovers and duffels, and a range of lifestyle
accessories: ceramic ashtrays, cocktail glasses with golf ball stems, linen napkins,
coasters, leather notebook covers ($70), divot tools ($30), and headcovers ($46).

Vice Golf, the Munich-based direct-to-consumer brand known for premium golf balls and
gloves at accessible price points, is supplying the gloves and balls in the collection.

Both Vice and Zara operate from a similar philosophical position: European brands that
deliver premium aesthetics and performance without the traditional premium price tags.
Vice built its reputation selling pro-calibre golf balls direct to consumers at roughly
half the price of Titleist and Callaway. Zara Home, while distinct from fast-fashion
sibling Zara, applies the same Inditex lens — design-forward product at accessible
retail. The collection's price points reflect this: nothing aspirationally unattainable,
everything considered.

The aesthetic leans heavily toward the post-round ritual: deep greens, warm browns,
soft creams, a clubhouse-meets-modern-European sensibility. Zara Home is positioning
golf less as a sport and more as a lifestyle marker — the kind of thing that looks right
on a shelf or a bar cart as much as it does in a bag. Vice's inclusion in the collection
signals an appetite for the brand to extend beyond the fairway and into spaces where
golf is a cultural reference rather than a game being played.
  `.trim(),
};

// ═══════════════════════════════════════════════════════════════════════════════

const SITE_ROOT = path.resolve(__dirname, '..');
const MODEL     = 'claude-opus-4-5';

const DISALLOWED_STARTS = [
  'based on', 'according to', 'from my', 'from the',
  'looking at', 'after reviewing', 'having reviewed',
  'the search results', 'the news', 'the data shows',
  'it appears', 'it seems',
];
const DISALLOWED_BODY = [
  'my search', 'search results', 'from my research',
  'the articles suggest', 'the coverage indicates',
  'from what i found', 'my research shows',
  'available information',
  'the index shows', 'the data suggests',
  'according to the dormied index',
  'exciting news', 'thrilled to', 'proud to announce',
];

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
  const globalData    = brand.searchesByMarket?.global || {};
  const curSearches   = globalData[currentMonth]  || 0;
  const prevSearches  = globalData[previousMonth] || 0;
  const s12ago        = globalData[month12ago]    || 0;
  const maxSearches   = Math.max(...dormiedData.brands.map(b => b.searchesByMarket?.global?.[currentMonth] || 0));
  // DI: 1 decimal place, not rounded
  const di            = maxSearches > 0 ? Math.min(100, (curSearches / maxSearches) * 100) : 0;
  const sorted        = dormiedData.brands
    .map(b => ({ id: b.id, s: b.searchesByMarket?.global?.[currentMonth] || 0 }))
    .sort((a, b) => b.s - a.s);
  const rank          = sorted.findIndex(b => b.id === brandSlug) + 1;
  // M/M: 1 decimal place float
  const momPct        = prevSearches > 0 ? ((curSearches - prevSearches) / prevSearches) * 100 : null;
  const momStr        = fmtPct(momPct);
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
  const trend3mStr   = fmtPct(t3m);
  const trend3mClass = pctClass(t3m);
  // 12M: point-to-point (current vs same month last year — matches da-article.js)
  const t12m         = s12ago > 0 ? (curSearches - s12ago) / s12ago * 100 : null;
  const trend12mStr  = fmtPct(t12m);
  const trend12mClass = pctClass(t12m);
  return { brand, rank, di, momPct, momStr, trend3mStr, trend3mClass, trend12mStr, trend12mClass, currentMonth };
}

function makeSlug(title, dateStr) {
  const datePart = dateStr.slice(0, 10);
  const MAX_TITLE = 75;
  let titlePart = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  if (titlePart.length > MAX_TITLE) {
    titlePart = titlePart.slice(0, MAX_TITLE);
    const lastDash = titlePart.lastIndexOf('-');
    if (lastDash > 0) titlePart = titlePart.slice(0, lastDash);
  }
  return `${titlePart.replace(/-$/, '')}-${datePart}`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function estimateReadTime(text) {
  const words = text.trim().split(/\s+/).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

function authorFromCategory(category) {
  const cat = (category || '').toLowerCase();
  if (cat.includes('apparel') || cat.includes('footwear') || cat.includes('bag')) return 'Adam';
  return 'Travis';
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function bodyToHtml(plainText, brandSlug, brandName) {
  const paras = plainText.split(/\n\n+/).filter(p => p.trim());
  return paras.map(p => {
    const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\w/"])${escaped}(?![\\w"])`, 'g');
    const linked = p.replace(re, `<a href="/brands/${brandSlug}/" class="da-brand-link">${brandName}</a>`);
    return `<p>${linked}</p>`;
  }).join('\n');
}

function isInvalid(text) {
  if (!text) return true;
  const lower = text.trim().toLowerCase();
  if (DISALLOWED_STARTS.some(p => lower.startsWith(p))) return true;
  if (DISALLOWED_BODY.some(p => lower.includes(p))) return true;
  return false;
}

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

Return valid JSON only — no markdown fences, no preamble, exactly this structure:
{
  "title": "the headline",
  "body": "paragraph one\\n\\nparagraph two\\n\\nparagraph three",
  "meta_description": "120-155 character SEO description including brand name",
  "seo_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "x_post": "under 250 chars, no hashtags, hot take voice"
}`;

async function callOpus(client, sourceBody, brandInfo, retry = false) {
  const { brand, rank, di, momStr, currentMonth } = brandInfo;
  const userMsg = `Brand: ${brand.name}
Current DORMIED global rank: #${rank} of 175
DI score: ${di}/100
Month-over-month: ${momStr}
Month: ${currentMonth}
Category: ${brand.category}

Source content:
${sourceBody}${retry ? '\n\nYour previous response contained a disallowed phrase or invalid JSON. Rewrite starting directly with the editorial observation. Include all fields. Return valid JSON only.' : ''}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });
  return (res.content[0]?.text || '').trim();
}

function parseOpusResponse(raw) {
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

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
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buffer);
    const localUrl = `https://dormied.com/images/articles/${slug}-hero.${ext}`;
    if (sharp && ext !== 'webp') {
      try {
        const webpPath = path.join(SITE_ROOT, 'images', 'articles', `${slug}-hero.webp`);
        await sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 82 }).toFile(webpPath);
      } catch {}
    }
    const { error } = await supabase.storage.from('dormied-articles').upload(storagePath, buffer, { contentType, upsert: true });
    if (error) return { supabaseUrl: null, localUrl };
    const { data } = supabase.storage.from('dormied-articles').getPublicUrl(storagePath);
    return { supabaseUrl: data?.publicUrl || null, localUrl };
  } catch {
    return { supabaseUrl: null, localUrl: null };
  }
}

function xmlEscSitemap(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addToSitemap(slug, publishedAt, imageUrl, imageTitle) {
  const sitemapPath = path.join(SITE_ROOT, 'sitemap.xml');
  let sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const dateStr = publishedAt.slice(0, 10);
  const today   = new Date().toISOString().slice(0, 10);
  const hasImage = imageUrl && !imageUrl.includes('og-image.jpg');
  const imageBlock = hasImage
    ? `\n    <image:image>\n      <image:loc>${xmlEscSitemap(imageUrl)}</image:loc>\n      <image:title>${xmlEscSitemap(imageTitle)}</image:title>\n    </image:image>`
    : '';
  const entry = `\n  <url>\n    <loc>https://dormied.com/news/${slug}/</loc>\n    <lastmod>${dateStr}</lastmod>\n    <changefreq>never</changefreq>\n    <priority>0.7</priority>${imageBlock}\n  </url>`;
  sitemap = sitemap.replace('</urlset>', entry + '\n</urlset>');
  sitemap = sitemap.replace(
    /(<loc>https:\/\/dormied\.com\/news\/<\/loc>\n\s*<lastmod>)[^<]+(<\/lastmod>)/,
    `$1${today}$2`,
  );
  fs.writeFileSync(sitemapPath, sitemap, 'utf8');
  console.log(`[inject] Added /news/${slug}/ to sitemap`);
}

// Inline generateArticleHtml — identical to generate-article.js
function generateArticleHtml(opts) {
  const {
    title, bodyHtml, imageUrl, ogImageUrl, localUrl, imageAlt, slug, category,
    published_at, source_url, source_name, meta_description, seo_keywords,
    brandSlug, brandName, brandLogo, brandRank, brandDI, brandMom,
    brandTrend3m, brandTrend3mClass, brandTrend12m, brandTrend12mClass, readTime, author,
  } = opts;

  const dateFormatted = formatDate(published_at);
  const dateISO       = new Date(published_at).toISOString();
  const canonicalUrl  = `https://dormied.com/news/${slug}/`;
  const ogImage       = ogImageUrl || imageUrl || 'https://dormied.com/images/og-image.jpg';
  const titleTag      = `${title} | DORMIED`;
  const momClass      = brandMom > 0.05 ? 'da-mom-up' : brandMom < -0.05 ? 'da-mom-down' : 'da-mom-flat';
  const momDisplay    = fmtPct(brandMom);
  const keywordsStr   = (seo_keywords || []).join(', ');
  const initials      = brandName.split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase();
  const logoFallback  = `<span class=&quot;bp-logo-initials&quot; style=&quot;background:#1a2a1a;width:48px;height:48px;font-size:1rem&quot;>${escHtml(initials)}</span>`;
  const logoHtml      = brandLogo
    ? `<img src="${escHtml(brandLogo.replace(/sz=\d+/, 'sz=48'))}" alt="${escHtml(brandName)}" class="bp-logo-img" width="48" height="48" style="width:48px;height:48px" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${logoFallback}')">`
    : `<span class="bp-logo-initials" style="background:#1a2a1a;width:48px;height:48px;font-size:1rem">${escHtml(initials)}</span>`;

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
  <title>${escHtml(titleTag)}</title>
  <meta name="description" content="${escHtml(meta_description)}">
  <meta name="keywords" content="${escHtml(keywordsStr)}">
  <meta name="author" content="${escHtml(author)}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="icon" href="/favicon.ico">
  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="apple-touch-icon" href="/images/dormied-icon.png">
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
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@DORMIED_GOLF">
  <meta name="twitter:title" content="${escHtml(title)}">
  <meta name="twitter:description" content="${escHtml(meta_description)}">
  <meta name="twitter:image" content="${escHtml(ogImage)}">
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
  <link rel="preconnect" href="https://pagead2.googlesyndication.com">
  <link rel="stylesheet" href="/css/fonts.css">
  <link rel="stylesheet" href="/css/styles.css?v=20260409">
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
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
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
  <main id="main-content">
    <nav class="da-breadcrumb container" aria-label="Breadcrumb" style="padding-top:.75rem;padding-bottom:.25rem;font-size:.78rem;color:var(--clr-muted,#6b7a6b)">
      <a href="/" style="color:inherit;text-decoration:none">Home</a>
      <span aria-hidden="true" style="margin:0 .4em">&rsaquo;</span>
      <a href="/news/" style="color:inherit;text-decoration:none">News</a>
      <span aria-hidden="true" style="margin:0 .4em">&rsaquo;</span>
      <span aria-current="page">${escHtml(title)}</span>
    </nav>
    <header class="da-article-header container">
      <a href="/news/" class="sc-label sc-label--link">News</a>
      <h1 class="sc-article-title">${escHtml(title)}</h1>
      <p class="sc-article-subtitle">${escHtml(meta_description)}</p>
      <p class="sc-article-byline">By ${escHtml(author)} &nbsp;·&nbsp; <time datetime="${dateISO}">${escHtml(dateFormatted)}</time> &nbsp;·&nbsp; ${escHtml(category)} &nbsp;·&nbsp; ${escHtml(readTime)}</p>
    </header>
    <section class="da-article-section">
      <div class="container">
        <div class="table-layout">
          <div class="sc-article-main">
            ${imageHtml}
            <div class="da-article-body">${bodyHtml}</div>
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
                  <div class="bp-metric-card"><span class="bp-metric-label">DI Score</span><span class="bp-metric-val">${brandDI.toFixed(1)}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">M/M Change</span><span class="bp-metric-val ${momClass}">${momDisplay}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">3M Trend</span><span class="bp-metric-val ${brandTrend3mClass}">${escHtml(brandTrend3m || '—')}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">12M Trend</span><span class="bp-metric-val ${brandTrend12mClass}">${escHtml(brandTrend12m || '—')}</span></div>
                </div>
              </div>
            </div>
            <section class="da-bottom-section" id="da-more-brand-section" aria-labelledby="da-more-brand-heading" hidden>
              <h3 class="da-bottom-heading" id="da-more-brand-heading">More on ${escHtml(brandName)}</h3>
              <div id="da-more-brand-list" class="da-bottom-cards"></div>
            </section>
            <section class="da-bottom-section" id="da-latest-dormied-section" aria-labelledby="da-latest-dormied-heading" hidden>
              <h3 class="da-bottom-heading" id="da-latest-dormied-heading">Latest from DORMIED</h3>
              <div id="da-latest-dormied-list" class="da-bottom-cards"></div>
            </section>
          </div>
          <aside class="sidebar-ad-col">
            <div class="sidebar-sticky-zone" aria-hidden="true">
              <div class="ad-skyscraper">
                <ins class="adsbygoogle" style="display:inline-block;width:160px;height:600px"
                     data-ad-client="ca-pub-5259693727609263" data-ad-slot="6935529969"></ins>
              </div>
            </div>
          </aside>
        </div>
      </div>
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
      <p class="footer-legal">© DORMIED. Rankings are independent editorial content. No brand pays for placement or improved position on the DORMIED Index. All brand names and logos are property of their respective owners.</p>
    </div>
  </footer>
  <script>
    document.getElementById('footer-year').textContent = new Date().getFullYear();
    window.__DA_BRAND_SLUG__   = '${escHtml(brandSlug)}';
    window.__DA_ARTICLE_SLUG__ = '${escHtml(slug)}';
  </script>
  <script src="/js/analytics.min.js?v=20260320a"></script>
  <script src="/js/signup.min.js?v=20260324d"></script>
  <script src="/js/brand-data/${escHtml(brandSlug)}.js"></script>
  <script src="/js/da-article.min.js?v=20260522"></script>
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
    throw new Error('Missing required env vars (SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY)');
  }

  const supabase    = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const anthropic   = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Load data.js for brand stats
  const raw = fs.readFileSync(path.join(SITE_ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  const dormiedData = ctx.window.DORMIED_DATA;

  const { brandSlug, sourceUrl, sourceName, imageUrl, sourceBody } = CONFIG;

  const brandInfo = getBrandInfo(dormiedData, brandSlug);
  if (!brandInfo) throw new Error(`Brand not found in data.js: ${brandSlug}`);

  console.log(`[inject] Brand: ${brandInfo.brand.name} (#${brandInfo.rank}, DI ${brandInfo.di}, ${brandInfo.momStr} MoM)`);
  console.log(`[inject] Calling Opus...`);

  let rawResponse = await callOpus(anthropic, sourceBody, brandInfo, false);
  let parsed      = parseOpusResponse(rawResponse);

  if (!parsed || isInvalid(parsed.body)) {
    console.warn('[inject] First response invalid — retrying');
    rawResponse = await callOpus(anthropic, sourceBody, brandInfo, true);
    parsed      = parseOpusResponse(rawResponse);
    if (!parsed) throw new Error('Opus returned unparseable JSON on retry');
  }

  const { title, body, meta_description, seo_keywords, x_post } = parsed;
  const publishedAt = new Date().toISOString();
  const slug        = makeSlug(title, publishedAt);
  const readTime    = estimateReadTime(body);
  const bodyHtml    = bodyToHtml(body, brandSlug, brandInfo.brand.name);
  const author      = authorFromCategory(brandInfo.brand.category);
  const category    = brandInfo.brand.category || 'Business';

  console.log(`[inject] Title: "${title}"`);
  console.log(`[inject] Slug:  news/${slug}/`);
  console.log(`[inject] X post: ${x_post}`);

  // Image
  const { supabaseUrl, localUrl } = await uploadImageToSupabase(supabase, imageUrl, slug);
  const finalImageUrl = supabaseUrl || imageUrl || null;
  const ogImageUrl    = localUrl || 'https://dormied.com/images/og-image.jpg';

  // Write HTML
  const articleDir = path.join(SITE_ROOT, 'news', slug);
  fs.mkdirSync(articleDir, { recursive: true });
  const html = generateArticleHtml({
    title, bodyHtml,
    imageUrl:        finalImageUrl,
    ogImageUrl,
    localUrl,
    imageAlt:        `${brandInfo.brand.name} — ${category}`,
    slug, category,
    published_at:    publishedAt,
    source_url:      sourceUrl,
    source_name:     sourceName,
    meta_description, seo_keywords,
    brandSlug,
    brandName:    brandInfo.brand.name,
    brandLogo:    brandInfo.brand.logo || '',
    brandRank:    brandInfo.rank,
    brandDI:           brandInfo.di,
    brandMom:          brandInfo.momPct,
    brandTrend3m:      brandInfo.trend3mStr,
    brandTrend3mClass: brandInfo.trend3mClass,
    brandTrend12m:     brandInfo.trend12mStr,
    brandTrend12mClass: brandInfo.trend12mClass,
    readTime, author,
  });
  fs.writeFileSync(path.join(articleDir, 'index.html'), html, 'utf8');
  console.log(`[inject] Wrote news/${slug}/index.html`);

  // Supabase insert — no matched_article_id since this is manually sourced
  const { error: insertErr } = await supabase.from('dormied_articles').insert({
    matched_article_id: null,
    brand_slug:         brandSlug,
    title,
    body,
    image_url:          finalImageUrl,
    source_url:         sourceUrl,
    source_name:        sourceName,
    meta_description,
    seo_keywords:       seo_keywords || [],
    published_at:       publishedAt,
    status:             'draft',
    slug,
    category,
    x_post_text:        x_post || null,
    author,
  });
  if (insertErr) console.warn('[inject] Supabase insert failed:', insertErr.message);
  else console.log('[inject] Supabase record inserted (status: draft)');

  // Sitemap
  addToSitemap(slug, publishedAt, ogImageUrl, title);

  console.log('\n[inject] Done. Next steps:');
  console.log(`  git add news/${slug}/ sitemap.xml`);
  console.log(`  git commit -m "feat: add article — ${title}"`);
  console.log('  git push origin main');
  console.log('  (Vercel deploys → publish-articles.js promotes to published → X post)');
}

main().catch(err => {
  console.error('[inject] Fatal:', err.message);
  process.exit(1);
});
