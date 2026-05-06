#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   scripts/generate-index-pages.js
   Converts /brands/, /news/, /scorecard/ from client-rendered shells to
   statically pre-rendered HTML so crawlers see content without JavaScript.

   Usage:
     node scripts/generate-index-pages.js            # all three pages
     node scripts/generate-index-pages.js --brands   # brands only
     node scripts/generate-index-pages.js --news     # news only
     node scripts/generate-index-pages.js --scorecard # scorecard only
     node scripts/generate-index-pages.js --target=brands|news|scorecard

   Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in .env (for news)
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

/* ── Resolve root ─────────────────────────────────────────────────────────── */
const ROOT = path.resolve(__dirname, '..');

/* ── Load .env ────────────────────────────────────────────────────────────── */
(function loadDotenv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
})();

/* ── CLI flags ────────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const targetArg = args.find(a => a.startsWith('--target='));
const targetVal = targetArg ? targetArg.split('=')[1] : null;

const forceAll    = args.includes('--force') || args.includes('--all');
const doAll       = args.length === 0 || forceAll;
const doBrands    = doAll || args.includes('--brands')    || targetVal === 'brands';
const doNews      = doAll || args.includes('--news')      || targetVal === 'news';
const doScorecard = doAll || args.includes('--scorecard') || targetVal === 'scorecard';

/* ── mtime-based skip helper ──────────────────────────────────────────────── */
/**
 * Returns true when the output file is UP TO DATE relative to all source files,
 * so the caller can skip regeneration.
 *
 * Skipped only in "default" (no explicit target flag) invocations; explicit flags
 * (--brands, --news, --scorecard, --force, --all) always regenerate.
 */
function isUpToDate(outputPath, ...sourcePaths) {
  if (forceAll) return false;         // --force always regenerates
  if (!fs.existsSync(outputPath)) return false;
  const outMtime = fs.statSync(outputPath).mtimeMs;
  for (const src of sourcePaths) {
    if (!fs.existsSync(src)) return false;
    if (fs.statSync(src).mtimeMs > outMtime) return false;
  }
  return true;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/** YYYY-MM-DD or ISO → "Apr 30, 2026" */
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Strip HTML tags and return plain text */
function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

/** Extract first N sentences from plain text */
function firstSentences(text, n) {
  const clean = text.replace(/\s+/g, ' ').trim();
  // Split on sentence-ending punctuation followed by a space and capital letter
  const re = /[.!?]+\s+(?=[A-Z"])/g;
  const bounds = [];
  let m;
  while ((m = re.exec(clean)) !== null) {
    bounds.push(m.index + m[0].length);
    if (bounds.length === n) break;
  }
  if (bounds.length >= n) return clean.slice(0, bounds[n - 1]).trim();
  return clean;
}

/** Replace the inner content of a specific id'd element in an HTML string. */
function injectIntoId(html, elementId, newContent) {
  const openTagRe = new RegExp(
    `(<(?:div|section|ul|ol|nav|article|aside|main)[^>]+\\bid=["\']${escapeRegex(elementId)}["\'][^>]*>)`,
    's'
  );
  const m = openTagRe.exec(html);
  if (!m) {
    console.warn(`  ⚠  Could not find element #${elementId}`);
    return html;
  }

  const openTag      = m[1];
  const tagName      = openTag.match(/^<([a-z]+)/i)[1];
  const contentStart = m.index + openTag.length;

  let depth   = 1;
  let pos     = contentStart;
  const openRe  = new RegExp(`<${tagName}[\\s>]`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');

  while (depth > 0 && pos < html.length) {
    openRe.lastIndex  = pos;
    closeRe.lastIndex = pos;
    const nextOpen  = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(0, contentStart) + '\n' + newContent + '\n' + html.slice(nextClose.index);
      }
      pos = nextClose.index + nextClose[0].length;
    }
  }

  console.warn(`  ⚠  Could not find closing tag for #${elementId}`);
  return html;
}

/** Replace a tag's full content matched by a regex pattern */
function replaceTag(html, pattern, replacement) {
  return html.replace(pattern, replacement);
}

/** Update <title>, meta description, OG/Twitter tags for a page */
function updateHeadMeta(html, { title, description, ogTitle, ogDescription }) {
  // <title>
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`);

  // <meta name="description">
  html = html.replace(
    /(<meta\s+name="description"\s+content=")[^"]*(")/,
    `$1${escHtml(description)}$2`
  );
  // also handle reversed attribute order
  html = html.replace(
    /(<meta\s+content=")[^"]*("\s+name="description")/,
    `$1${escHtml(description)}$2`
  );

  // OG title
  html = html.replace(
    /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
    `$1${escHtml(ogTitle || title)}$2`
  );

  // OG description
  html = html.replace(
    /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
    `$1${escHtml(ogDescription || description)}$2`
  );

  // Twitter title
  html = html.replace(
    /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,
    `$1${escHtml(ogTitle || title)}$2`
  );

  // Twitter description
  html = html.replace(
    /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
    `$1${escHtml(ogDescription || description)}$2`
  );

  return html;
}

/** Replace the hero section intro: h1 stays, inject subhead + paragraphs after it.
 *  Fully string-based (no regex) so it is safe against greedy match issues.
 *  Idempotent: skips any existing hero-subhead and hero-desc paragraphs
 *  that may have been injected by a previous run.
 */
function injectHeroContent(html, h1Id, subhead, paragraphsHtml) {
  const openH1 = `<h1 id="${h1Id}"`;
  const closeH1 = `</h1>`;

  const h1Start = html.indexOf(openH1);
  if (h1Start === -1) {
    console.warn(`  ⚠  Could not find h1#${h1Id} for hero content injection`);
    return html;
  }

  const h1Close = html.indexOf(closeH1, h1Start);
  if (h1Close === -1) {
    console.warn(`  ⚠  Could not find </h1> for h1#${h1Id}`);
    return html;
  }

  // Cursor starts right after </h1>
  let pos = h1Close + closeH1.length;

  // Helper: skip whitespace characters at pos
  function skipWhitespace() {
    while (pos < html.length && (html[pos] === '\n' || html[pos] === ' ' || html[pos] === '\r' || html[pos] === '\t')) {
      pos++;
    }
  }

  // Helper: skip one <p ...>...</p> block if it starts at pos.
  // Matches both <p class="hero-desc"> and <p class="hero-desc hero-desc--secondary">
  // (i.e. the class attribute starts with className, optionally followed by a space).
  function skipPTag(className) {
    skipWhitespace();
    const openExact  = `<p class="${className}"`;
    const openPrefix = `<p class="${className} `;
    if (!html.startsWith(openExact, pos) && !html.startsWith(openPrefix, pos)) return false;
    const closeP = '</p>';
    const endPos = html.indexOf(closeP, pos);
    if (endPos === -1) return false;
    pos = endPos + closeP.length;
    return true;
  }

  // Skip any hero-subhead already injected
  skipPTag('hero-subhead');

  // Skip all hero-desc paragraphs already injected (one or more)
  let skipped = true;
  while (skipped) {
    skipped = skipPTag('hero-desc');
  }

  // After skipping, pos is right after the last hero paragraph (or right after </h1>)
  const afterHero = html.slice(pos);
  const before    = html.slice(0, h1Close + closeH1.length);

  // Build the new hero content
  const subheadHtml = `<p class="hero-subhead">${escHtml(subhead)}</p>`;
  const newHeroContent = `\n            ${subheadHtml}\n            ${paragraphsHtml}`;

  return before + newHeroContent + '\n' + afterHero;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ══════════════════════════════════════════════════════════════════════════
   BRANDS  (/brands/index.html)
   ══════════════════════════════════════════════════════════════════════════ */
function generateBrands() {
  console.log('\n── Brands ──────────────────────────────────────────────');

  /* mtime check: skip if brands/index.html is newer than js/data.js */
  const brandsOutput = path.join(ROOT, 'brands/index.html');
  const brandsSource = path.join(ROOT, 'js/data.js');
  if (!args.includes('--brands') && targetVal !== 'brands' && isUpToDate(brandsOutput, brandsSource)) {
    console.log('  ✔  brands/index.html is up to date — skipping');
    return;
  }

  /* Load data.js */
  const dataSrc = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
  const dataCtx = { window: {}, console };
  vm.createContext(dataCtx);
  vm.runInContext(dataSrc, dataCtx);
  const data = dataCtx.window.DORMIED_DATA;
  if (!data || !data.brands || !data.meta) {
    console.error('  ✖  Could not load DORMIED_DATA from js/data.js');
    process.exit(1);
  }

  /* Compute rankings — mirrors brands-dir.js computeRankings() */
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function shiftMonth(label, delta) {
    const parts = label.split(' ');
    const total = MONTH_NAMES.indexOf(parts[0]) + parseInt(parts[1], 10) * 12 + delta;
    return MONTH_NAMES[((total % 12) + 12) % 12] + ' ' + Math.floor(total / 12);
  }

  const curMonth  = data.meta.currentMonth;
  const prevMonth = data.meta.previousMonth;
  const ago3Month = shiftMonth(curMonth, -3);

  const scored = data.brands.map(b => {
    const g    = b.searchesByMarket && b.searchesByMarket.global;
    const cur  = (g && g[curMonth])  || 0;
    const prev = (g && g[prevMonth]) || 0;
    const ago3 = (g && g[ago3Month]) || 0;
    return { brand: b, cur, prev, ago3 };
  });

  let maxVal = 0;
  scored.forEach(s => { if (s.cur > maxVal) maxVal = s.cur; });
  if (!maxVal) maxVal = 1;

  const prevSorted = scored.slice().sort((a, b) => {
    const d = b.prev - a.prev;
    return Math.abs(d) > 0.0001 ? d : b.ago3 - a.ago3;
  });
  const prevRankMap = {};
  prevSorted.forEach((s, i) => { prevRankMap[s.brand.id] = i + 1; });

  const ago3Sorted = scored.slice().sort((a, b) => b.ago3 - a.ago3);
  const ago3RankMap = {};
  ago3Sorted.forEach((s, i) => { ago3RankMap[s.brand.id] = i + 1; });

  scored.sort((a, b) => {
    const d = b.cur - a.cur;
    if (Math.abs(d) > 0.0001) return d;
    const pd = (prevRankMap[a.brand.id] || 9999) - (prevRankMap[b.brand.id] || 9999);
    if (pd !== 0) return pd;
    return (ago3RankMap[a.brand.id] || 9999) - (ago3RankMap[b.brand.id] || 9999);
  });

  /* Also compute previous-period rank for trend arrow */
  const prevRankList = prevSorted.map((s, i) => ({ id: s.brand.id, rank: i + 1 }));
  const prevRankById = {};
  prevRankList.forEach(r => { prevRankById[r.id] = r.rank; });

  const brands = scored.map((item, i) => {
    const currentRank = i + 1;
    const previousRank = prevRankById[item.brand.id] || currentRank;
    let trend = '';
    if (previousRank > currentRank) trend = 'up';
    else if (previousRank < currentRank) trend = 'down';

    return {
      id:            item.brand.id,
      name:          item.brand.name,
      logo:          item.brand.logo || null,
      category:      item.brand.category || '',
      allCategories: item.brand.allCategories || [],
      subCategories: item.brand.subCategories || [],
      rank:          currentRank,
      di:            parseFloat((item.cur / maxVal * 100).toFixed(1)),
      trend,
    };
  });

  console.log(`  Computed rankings for ${brands.length} brands`);

  /* Build brand card HTML — mirrors brandCardHtml() in brands-dir.js, with trend arrow */
  function brandCardHtml(b) {
    const initials = (b.name || '').slice(0, 2).toUpperCase();
    let logoHtml;
    if (b.logo) {
      logoHtml =
        `<div class="brand-dir-logo-wrap">` +
          `<img class="brand-dir-logo" src="${escHtml(b.logo)}" alt="" ` +
          `onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` +
          `<span class="brand-dir-initials" style="display:none">${escHtml(initials)}</span>` +
        `</div>`;
    } else {
      logoHtml =
        `<div class="brand-dir-logo-wrap">` +
          `<span class="brand-dir-initials">${escHtml(initials)}</span>` +
        `</div>`;
    }
    const di       = b.di > 0 ? b.di.toFixed(1) : '—';
    const rank     = '#' + b.rank;
    const cat      = (b.category || '').replace(/\s*;\s*/g, ' · ');
    const subcat   = (b.subCategories || []).join(' · ');
    const arrow    = b.trend === 'up'   ? ' <span class="brand-dir-trend brand-dir-trend--up" aria-label="trending up">↑</span>'
                   : b.trend === 'down' ? ' <span class="brand-dir-trend brand-dir-trend--down" aria-label="trending down">↓</span>'
                   : '';

    /* data-allcats: pipe-separated list of expanded category names.
       mirrors brands-dir.js filter logic: split on ; then trim. */
    const allCatsExpanded = (b.allCategories || [])
      .flatMap(c => c.split(';').map(s => s.trim()))
      .filter(Boolean);
    const dataAllcats = allCatsExpanded.join('|');
    const dataSubcat  = (b.subCategories || []).join('|');

    return (
      `<a href="/brands/${escHtml(b.id)}/" class="brand-dir-card"` +
        ` data-name="${escHtml((b.name || '').toLowerCase())}"` +
        ` data-allcats="${escHtml(dataAllcats)}"` +
        ` data-subcat="${escHtml(dataSubcat)}">` +
        logoHtml +
        `<div class="brand-dir-name">${escHtml(b.name)}</div>` +
        `<div class="brand-dir-cat">${escHtml(cat)}` +
          (subcat ? `<span class="brand-dir-subcat"> · ${escHtml(subcat)}</span>` : '') +
        `</div>` +
        `<div class="brand-dir-stats">` +
          `<span class="brand-dir-rank">${escHtml(rank)}</span>` +
          `<span class="brand-dir-di">DI&nbsp;${escHtml(String(di))}${arrow}</span>` +
        `</div>` +
      `</a>`
    );
  }

  const gridHtml = brands.map(brandCardHtml).join('\n');

  /* Read and update brands/index.html */
  const filePath = path.join(ROOT, 'brands/index.html');
  let html = fs.readFileSync(filePath, 'utf8');

  /* Update title, meta, OG/Twitter */
  html = updateHeadMeta(html, {
    title:       'The Field — Golf Brand Directory | DORMIED',
    description: 'Every golf brand we track on the DORMIED Index. 169 brands across 10 global markets, ranked monthly by attention. Search, filter, see who\'s moving.',
  });

  /* Inject intro copy and subhead into hero section */
  const brandsIntroParagraphs =
    `<p class="hero-desc">The full roster. Every brand DORMIED tracks on the Index, in one place.</p>` +
    `<p class="hero-desc hero-desc--secondary">We watch 169 brands across 10 global markets and rank them every month by where attention is actually going. Equipment, apparel, accessories, training tech, course wear, the lifestyle plays pulling our game in new directions. Some are climbing. Some are fading. Some are coasting on a name that stopped meaning what it used to.</p>` +
    `<p class="hero-desc hero-desc--secondary">Search, filter, sort. The DI score next to each brand is the current month's reading. The arrow tells you which way it's trending. Click into any brand for the trend chart, the recent coverage, and The Read.</p>` +
    `<p class="hero-desc hero-desc--secondary">This is the field as it stands right now. Check back next month and the order will look different.</p>`;

  html = injectHeroContent(html, 'brands-title', 'Golf Brand Directory', brandsIntroParagraphs);

  /* Inject brand grid */
  html = injectIntoId(html, 'brands-grid', gridHtml);

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`  ✔  brands/index.html — ${brands.length} brand cards, title/meta/intro updated`);
}

/* ══════════════════════════════════════════════════════════════════════════
   NEWS  (/news/index.html  +  /news/page/N/index.html)
   ══════════════════════════════════════════════════════════════════════════ */
async function generateNews() {
  console.log('\n── News ─────────────────────────────────────────────────');

  /* mtime check: news articles come from Supabase (no local file to compare),
     so we compare news/index.html against js/data.js (brand map dependency).
     Since article data is remote, we only skip if the user passes no explicit
     --news flag AND data.js hasn't changed. Always regenerates on --news. */
  const newsOutput = path.join(ROOT, 'news/index.html');
  if (!args.includes('--news') && targetVal !== 'news' && isUpToDate(newsOutput, path.join(ROOT, 'js/data.js'))) {
    console.log('  ✔  news/index.html is up to date — skipping');
    return { totalPages: 0 };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('  ✖  SUPABASE_URL / SUPABASE_SERVICE_KEY not set in .env');
    process.exit(1);
  }

  /* Load brand name map from data.js */
  const dataSrc = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
  const dataCtx = { window: {}, console };
  vm.createContext(dataCtx);
  vm.runInContext(dataSrc, dataCtx);
  const brandMap = {};
  ((dataCtx.window.DORMIED_DATA || {}).brands || []).forEach(b => {
    brandMap[b.id] = b.name;
  });

  /* Fetch all published articles from Supabase */
  const apiUrl = `${SUPABASE_URL}/rest/v1/dormied_articles` +
    `?select=id,brand_slug,title,body,meta_description,image_url,slug,category,published_at,author` +
    `&status=eq.published` +
    `&order=published_at.desc` +
    `&limit=200`;

  const resp = await fetch(apiUrl, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    }
  });
  if (!resp.ok) {
    console.error(`  ✖  Supabase error ${resp.status}: ${await resp.text()}`);
    process.exit(1);
  }
  const rows = await resp.json();

  /* Derive author from category (mirrors api/dormied-articles.js) */
  function authorFromCat(cat) {
    const c = (cat || '').toLowerCase();
    if (c.includes('apparel') || c.includes('footwear') || c.includes('bag')) return 'Adam';
    return 'Travis';
  }

  const articles = rows.map(a => ({
    id:          a.id,
    title:       a.title,
    url:         `/news/${a.slug}/`,
    author:      a.author || authorFromCat(a.category),
    pubDate:     a.published_at,
    body:        a.body || '',
    description: a.meta_description || '',
    imageUrl:    a.image_url || null,
    brandSlug:   a.brand_slug || '',
    category:    a.category || '',
    slug:        a.slug,
  }));

  console.log(`  Fetched ${articles.length} articles from Supabase`);

  /* Build article HTML matching the feed-card CSS used by the site.
     Mirrors renderFeedPageCard() in js/feed.js — static and JS output are identical.
     data-brand / data-title kept on the article element for feed-page.js DOM filtering. */
  function articleCardHtml(article) {
    const thumbHtml = article.imageUrl
      ? `<img class="feed-card-thumb feed-card-thumb--lg" src="${escHtml(article.imageUrl)}"` +
          ` width="600" height="375" loading="lazy" alt="" onerror="this.remove()">`
      : '';

    const descPlain = stripHtml(article.description || '');
    let excerpt = descPlain.slice(0, 180);
    if (descPlain.length > 180) excerpt = excerpt.replace(/\s\S+$/, '') + '…';
    const excerptHtml = excerpt ? `<p class="feed-card-excerpt">${escHtml(excerpt)}</p>` : '';

    const bname = brandMap[article.brandSlug] || '';
    const tagsHtml = article.brandSlug && bname
      ? `<div class="feed-card-tags"><a href="/brands/${escHtml(article.brandSlug)}/" class="feed-brand-tag">${escHtml(bname)}</a></div>`
      : '';

    return (
      `<article class="feed-card feed-card--full feed-card--dormied"` +
        ` data-brand="${escHtml(article.brandSlug)}"` +
        ` data-title="${escHtml((article.title || '').toLowerCase())}">` +
        thumbHtml +
        `<div class="feed-card-body">` +
          `<div class="feed-card-meta"><span class="feed-time">${escHtml(formatDate(article.pubDate))}</span></div>` +
          `<a href="${escHtml(article.url)}" class="feed-card-title feed-card-title--lg">${escHtml(article.title)}</a>` +
          `<p class="feed-card-byline">By ${escHtml(article.author || 'Travis')}</p>` +
          excerptHtml +
          tagsHtml +
        `</div>` +
      `</article>`
    );
  }

  const PAGE_SIZE = 25;
  const totalPages = Math.ceil(articles.length / PAGE_SIZE);
  console.log(`  ${articles.length} articles, ${totalPages} pages (${PAGE_SIZE}/page)`);

  /* Intro copy for news — verbatim from spec */
  const newsIntroParagraphs =
    `<p class="hero-desc">This is the desk's daily coverage. Brand moves, marketing plays, retail shifts, athlete deals, the WITB tells, and the what-does-this-mean takes the rest of golf media isn't writing.</p>` +
    `<p class="hero-desc hero-desc--secondary">Other publications cover the players. We cover the companies. The ones writing the checks, signing the deals, missing the moments, reading the room, and occasionally surprising everyone.</p>` +
    `<p class="hero-desc hero-desc--secondary">Filter by brand to track a specific name. Sort by date for the freshest. Every story here gets read against the Index, so when a brand makes a move you can see whether the data agrees.</p>`;

  /* ── Page 1: news/index.html ───────────────────────────────────────────── */
  const page1Articles = articles.slice(0, PAGE_SIZE);
  const feedHtml = page1Articles.map((a, i) => articleCardHtml(a)).join('\n');

  const newsFilePath = path.join(ROOT, 'news/index.html');
  let newsHtml = fs.readFileSync(newsFilePath, 'utf8');

  /* Update title, meta, OG/Twitter */
  newsHtml = updateHeadMeta(newsHtml, {
    title:         'The Feed — Golf Brand News | DORMIED',
    description:   'Daily coverage from golf\'s brand desk. Brand moves, marketing plays, retail shifts, athlete deals, and what they mean for our game.',
    ogTitle:       'The Feed — Golf Brand News | DORMIED',
    ogDescription: 'Daily coverage from golf\'s brand desk. Brand moves, marketing plays, retail shifts, athlete deals, and what they mean for our game.',
  });

  /* Ensure h1 reads "The Feed" */
  newsHtml = newsHtml.replace(
    /(<h1[^>]+id="feed-title"[^>]*>)\s*(?:News|The Feed)\s*(<\/h1>)/,
    '$1The Feed$2'
  );

  /* Inject subhead + intro copy */
  newsHtml = injectHeroContent(newsHtml, 'feed-title', 'Golf Brand News', newsIntroParagraphs);

  /* Inject article list */
  newsHtml = injectIntoId(newsHtml, 'feed-list', feedHtml);

  fs.writeFileSync(newsFilePath, newsHtml, 'utf8');
  console.log(`  ✔  news/index.html — ${page1Articles.length} articles, title/meta/intro updated`);

  /* ── Pages 2–N: news/page/N/index.html ────────────────────────────────── */
  /* Strip feed-page.min.js from paginated pages — the JS would re-fetch and
     overwrite the static content. Paginated pages are for crawlers only.    */
  const paginatedBase = fs.readFileSync(newsFilePath, 'utf8')
    .replace(/<script[^>]+feed-page\.min\.js[^>]*><\/script>\s*/g, '');

  for (let p = 2; p <= totalPages; p++) {
    const pageArticles = articles.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    const pageFeedHtml = pageArticles.map((a, i) => articleCardHtml(a)).join('\n');

    let pageHtml = paginatedBase
      .replace(
        /<title>[^<]+<\/title>/,
        `<title>The Feed — Golf Brand News, Page ${p} | DORMIED</title>`
      )
      .replace(
        /<link rel="canonical"[^>]+>/,
        `<link rel="canonical" href="https://dormied.com/news/page/${p}/">`
      );

    /* Add rel prev/next (clean insert before </head>) */
    pageHtml = dedupeRelLinks(pageHtml, p, totalPages);

    pageHtml = injectIntoId(pageHtml, 'feed-list', pageFeedHtml);

    const dir = path.join(ROOT, `news/page/${p}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), pageHtml, 'utf8');
    console.log(`  ✔  news/page/${p}/index.html — ${pageArticles.length} articles`);
  }

  return { totalPages, articleCount: articles.length };
}

/** Fix up rel prev/next links */
function dedupeRelLinks(html, p, totalPages) {
  html = html
    .replace(/<link rel="prev"[^>]+>\n?/g, '')
    .replace(/<link rel="next"[^>]+>\n?/g, '');

  const prevUrl = p === 2
    ? 'https://dormied.com/news/'
    : `https://dormied.com/news/page/${p - 1}/`;
  const nextUrl = `https://dormied.com/news/page/${p + 1}/`;

  let relLinks = '';
  if (p > 1)          relLinks += `  <link rel="prev" href="${prevUrl}">\n`;
  if (p < totalPages) relLinks += `  <link rel="next" href="${nextUrl}">\n`;

  return html.replace('</head>', relLinks + '</head>');
}

/* ══════════════════════════════════════════════════════════════════════════
   SCORECARD  (/scorecard/index.html)
   ══════════════════════════════════════════════════════════════════════════ */
function generateScorecard() {
  console.log('\n── Scorecard ────────────────────────────────────────────');

  /* mtime check: skip if scorecard/index.html is newer than js/scorecard-data.js */
  const scorecardOutput = path.join(ROOT, 'scorecard/index.html');
  const scorecardSource = path.join(ROOT, 'js/scorecard-data.js');
  if (!args.includes('--scorecard') && targetVal !== 'scorecard' && isUpToDate(scorecardOutput, scorecardSource)) {
    console.log('  ✔  scorecard/index.html is up to date — skipping');
    return;
  }

  /* Load scorecard-data.js */
  const src = fs.readFileSync(path.join(ROOT, 'js/scorecard-data.js'), 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const data = ctx.window.DORMIED_SCORECARD_DATA;
  if (!data || !data.issues || !data.issues.length) {
    console.error('  ✖  Could not load DORMIED_SCORECARD_DATA from js/scorecard-data.js');
    process.exit(1);
  }

  const issues = data.issues;

  /* Extract lede: first 2 sentences from section[0].body (stripped of HTML tags) */
  function extractLede(issue) {
    const intro = Array.isArray(issue.sections) ? issue.sections[0] : null;
    if (!intro) return issue.subtitle || '';
    const body = intro.body || intro.content || '';
    if (!body) return issue.subtitle || '';
    const plain = stripHtml(body);
    return firstSentences(plain, 2);
  }

  /* Format "Apr 8, 2026" → "April 2026" for h2 headline and meta line */
  function scorecardMonthYear(dateStr) {
    const MONTHS = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April',
                     May: 'May',     Jun: 'June',     Jul: 'July',  Aug: 'August',
                     Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };
    const m = String(dateStr).match(/^([A-Za-z]{3})\S*\s+\d+,?\s+(\d{4})/);
    if (!m) return String(dateStr);
    return (MONTHS[m[1]] || m[1]) + ' ' + m[2];
  }

  /* Build image HTML for hero — mirrors scorecard-archive.js buildImageHtml() */
  function buildScImageHtml(issue, isHero) {
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
      return `<div class="sc-image-strip${isHero ? ' sc-image-strip--hero' : ''}">${items}</div>`;
    }
    if (hero) return `<img class="sc-hero-img" src="${escHtml(hero)}" alt="" loading="lazy">`;
    return '';
  }

  /* Hero: latest issue — mirrors renderHero() in scorecard-archive.js */
  const latest  = issues[0];
  const archive = issues.slice(1);

  const heroHtml =
    `<div class="sc-hero-card">` +
      `<div class="sc-hero-label-row">` +
        `<span class="sc-label">THE SCORECARD</span>` +
        `<span class="sc-hero-date">${escHtml(latest.date)}</span>` +
      `</div>` +
      buildScImageHtml(latest, true) +
      `<h2 class="sc-hero-title">${escHtml(latest.title)}</h2>` +
      `<p class="sc-hero-sub">${escHtml(latest.subtitle || '')}</p>` +
      `<a href="/scorecard/${escHtml(latest.slug)}/" class="sc-read-link">Read The Scorecard &#x2192;</a>` +
    `</div>`;

  /* Archive: all other issues — mirrors renderArchive() in scorecard-archive.js */
  const archiveHtml = archive.map(issue => {
    const thumb = issue.images && (issue.images.hero ||
      (issue.images.strip && issue.images.strip[0] && issue.images.strip[0].src));
    const thumbHtml = thumb
      ? `<img class="sc-archive-thumb" src="${escHtml(thumb)}" alt="" loading="lazy">`
      : `<div class="sc-archive-thumb sc-archive-thumb--placeholder"></div>`;
    return (
      `<a href="/scorecard/${escHtml(issue.slug)}/" class="sc-archive-card">` +
        thumbHtml +
        `<div class="sc-archive-card-body">` +
          `<span class="sc-label sc-label--sm">THE SCORECARD</span>` +
          `<div class="sc-archive-date">${escHtml(issue.date)}</div>` +
          `<div class="sc-archive-title">${escHtml(issue.title)}</div>` +
          `<p class="sc-archive-sub">${escHtml(issue.subtitle || '')}</p>` +
        `</div>` +
      `</a>`
    );
  }).join('\n');

  /* Intro copy */
  const scorecardIntroParagraphs =
    `<p class="hero-desc">The Index gives you the numbers. The Scorecard tells you what they mean.</p>` +
    `<p class="hero-desc hero-desc--secondary">Every month we publish one issue from the desk. It opens with the Lede, runs through who's at the top, calls out the biggest move, picks through the rest of the field, drops in on who fell, looks ahead with the long game, files a global dispatch from outside the US, and closes with a note signed by Adam and Travis.</p>` +
    `<p class="hero-desc hero-desc--secondary">Eight sections. One issue. Direct to inbox first, then live on the site a couple of days later. If you want it early, the signup is in the footer.</p>` +
    `<p class="hero-desc hero-desc--secondary">Below: every issue we've published, most recent first.</p>`;

  /* Update scorecard/index.html */
  const filePath = path.join(ROOT, 'scorecard/index.html');
  let html = fs.readFileSync(filePath, 'utf8');

  /* Update title, meta, OG/Twitter */
  html = updateHeadMeta(html, {
    title:         'The Scorecard — Monthly Golf Brand Newsletter | DORMIED',
    description:   'The monthly editorial issue from golf\'s brand desk. What the Index numbers actually mean, who moved, who faded, and what to watch.',
    ogTitle:       'The Scorecard — Monthly Golf Brand Newsletter | DORMIED',
    ogDescription: 'The monthly editorial issue from golf\'s brand desk. What the Index numbers actually mean, who moved, who faded, and what to watch.',
  });

  /* Inject subhead + intro copy */
  html = injectHeroContent(html, 'sc-archive-title', 'Monthly Golf Brand Newsletter', scorecardIntroParagraphs);

  /* Inject hero (latest issue) and archive grid (all older issues) */
  html = injectIntoId(html, 'sc-hero', heroHtml);
  html = injectIntoId(html, 'sc-archive-grid', archiveHtml);

  /* Restore the "Previous Issues" heading text */
  html = html.replace(
    /(<h2[^>]+id="sc-archive-heading"[^>]*>)[^<]*/,
    '$1Previous Issues'
  );

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`  ✔  scorecard/index.html — hero + ${archive.length} archive card(s), title/meta/intro updated`);
}

/* ══════════════════════════════════════════════════════════════════════════
   VERCEL.JSON — add news/page/:n routing
   ══════════════════════════════════════════════════════════════════════════ */
function ensureVercelNewsPageRoutes() {
  const vercelPath = path.join(ROOT, 'vercel.json');
  const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

  const rewrites = vercel.rewrites || [];
  const hasPageRoute = rewrites.some(r => r.source && r.source.includes('/news/page/'));
  if (hasPageRoute) {
    console.log('  ✔  vercel.json already has /news/page/ rewrite');
    return;
  }

  // Insert before the /news/:slug rewrite
  const newsSlugIdx = rewrites.findIndex(r => r.source === '/news/:slug');
  const pageRewrites = [
    { source: '/news/page/:n',  destination: '/news/page/:n/index.html' },
    { source: '/news/page/:n/', destination: '/news/page/:n/index.html' },
  ];

  if (newsSlugIdx >= 0) {
    rewrites.splice(newsSlugIdx, 0, ...pageRewrites);
  } else {
    rewrites.push(...pageRewrites);
  }

  vercel.rewrites = rewrites;
  fs.writeFileSync(vercelPath, JSON.stringify(vercel, null, 2) + '\n', 'utf8');
  console.log('  ✔  vercel.json — added /news/page/:n/ rewrite rules');
}

/* ══════════════════════════════════════════════════════════════════════════
   SITEMAP updates
   ══════════════════════════════════════════════════════════════════════════ */
function updateSitemap(newsPageCount) {
  console.log('\n── Sitemap ──────────────────────────────────────────────');
  const today = new Date().toISOString().slice(0, 10);
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  let xml = fs.readFileSync(sitemapPath, 'utf8');

  /* Update lastmod for the three index pages */
  const indexUrls = [
    'https://dormied.com/brands/',
    'https://dormied.com/news/',
    'https://dormied.com/scorecard/',
  ];

  let changed = 0;
  indexUrls.forEach(url => {
    const re = new RegExp(
      `(<loc>${escapeRegex(url)}<\\/loc>\\s*<lastmod>)[^<]+(</lastmod>)`,
      's'
    );
    if (re.test(xml)) {
      xml = xml.replace(re, `$1${today}$2`);
      changed++;
    } else {
      console.warn(`  ⚠  ${url} not found in sitemap — skipping`);
    }
  });

  /* Add paginated news pages if not already present */
  for (let p = 2; p <= newsPageCount; p++) {
    const pageUrl = `https://dormied.com/news/page/${p}/`;
    if (!xml.includes(`<loc>${pageUrl}</loc>`)) {
      const entry =
        `  <url>\n` +
        `    <loc>${pageUrl}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>0.4</priority>\n` +
        `  </url>\n`;
      xml = xml.replace('</urlset>', entry + '</urlset>');
      console.log(`  ✔  Added /news/page/${p}/ to sitemap`);
      changed++;
    } else {
      const re = new RegExp(
        `(<loc>${escapeRegex(pageUrl)}<\\/loc>\\s*<lastmod>)[^<]+(</lastmod>)`,
        's'
      );
      xml = xml.replace(re, `$1${today}$2`);
      changed++;
    }
  }

  fs.writeFileSync(sitemapPath, xml, 'utf8');
  console.log(`  ✔  sitemap.xml updated (${changed} entries)`);
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════════════════════════════════ */
(async () => {
  const t0 = Date.now();
  console.log('generate-index-pages.js — DORMIED static index pre-render');
  console.log('='.repeat(56));

  let newsResult = { totalPages: 0 };

  try {
    if (doBrands)    generateBrands();
    if (doNews)      newsResult = await generateNews();
    if (doScorecard) generateScorecard();

    if (doAll || doNews) {
      ensureVercelNewsPageRoutes();
      updateSitemap(newsResult.totalPages);
    }
  } catch (err) {
    console.error('\n✖  Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✔  Done in ${elapsed}s`);
})();
