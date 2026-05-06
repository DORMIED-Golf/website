#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   scripts/generate-index-pages.js
   Converts /brands/, /news/, /scorecard/ from client-rendered shells to
   statically pre-rendered HTML so crawlers see content without JavaScript.

   Usage:
     node scripts/generate-index-pages.js          # all three pages
     node scripts/generate-index-pages.js --brands  # brands only
     node scripts/generate-index-pages.js --news    # news only
     node scripts/generate-index-pages.js --scorecard # scorecard only

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
const args     = process.argv.slice(2);
const doAll    = args.length === 0 || args.includes('--all');
const doBrands    = doAll || args.includes('--brands');
const doNews      = doAll || args.includes('--news');
const doScorecard = doAll || args.includes('--scorecard');

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

/** Replace the inner content of a specific id'd element in an HTML string.
 *  Handles: <div id="foo" ...>...old...</div>  or  <section id="foo" ...>...old...</section>
 *  Uses a simple balanced-tag approach scoped to the id attribute.
 */
function injectIntoId(html, elementId, newContent) {
  // Match the opening tag with this id (any tag name, any attributes)
  const openTagRe = new RegExp(
    `(<(?:div|section|ul|ol|nav|article|aside|main)[^>]+\\bid=["\']${escapeRegex(elementId)}["\'][^>]*>)`,
    's'
  );
  const m = openTagRe.exec(html);
  if (!m) {
    console.warn(`  ⚠  Could not find element #${elementId}`);
    return html;
  }

  const openTagStart = m.index;
  const openTag      = m[1];
  const tagName      = openTag.match(/^<([a-z]+)/i)[1];
  const contentStart = openTagStart + openTag.length;

  // Find the matching close tag using a balanced counter
  let depth   = 1;
  let pos     = contentStart;
  const openRe  = new RegExp(`<${tagName}[\\s>]`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');

  while (depth > 0 && pos < html.length) {
    openRe.lastIndex  = pos;
    closeRe.lastIndex = pos;
    const nextOpen  = openRe.exec(html);
    const nextClose = closeRe.exec(html);

    if (!nextClose) break;  // malformed HTML

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        // Replace content between openTag and this </tagName>
        return html.slice(0, contentStart) + '\n' + newContent + '\n' + html.slice(nextClose.index);
      }
      pos = nextClose.index + nextClose[0].length;
    }
  }

  console.warn(`  ⚠  Could not find closing tag for #${elementId}`);
  return html;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ══════════════════════════════════════════════════════════════════════════
   BRANDS  (/brands/index.html)
   ══════════════════════════════════════════════════════════════════════════ */
function generateBrands() {
  console.log('\n── Brands ──────────────────────────────────────────────');

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

  const brands = scored.map((item, i) => ({
    id:       item.brand.id,
    name:     item.brand.name,
    logo:     item.brand.logo || null,
    category: item.brand.category || '',
    rank:     i + 1,
    di:       parseFloat((item.cur / maxVal * 100).toFixed(1)),
  }));

  console.log(`  Computed rankings for ${brands.length} brands`);

  /* Build brand card HTML — mirrors brandCardHtml() in brands-dir.js */
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
    const di   = b.di > 0 ? b.di.toFixed(1) : '—';
    const rank = '#' + b.rank;
    const cat  = (b.category || '').replace(/\s*;\s*/g, ' · ');
    return (
      `<a href="/brands/${escHtml(b.id)}/" class="brand-dir-card">` +
        logoHtml +
        `<div class="brand-dir-name">${escHtml(b.name)}</div>` +
        `<div class="brand-dir-cat">${escHtml(cat)}</div>` +
        `<div class="brand-dir-stats">` +
          `<span class="brand-dir-rank">${escHtml(rank)}</span>` +
          `<span class="brand-dir-di">DI&nbsp;${escHtml(String(di))}</span>` +
        `</div>` +
      `</a>`
    );
  }

  const gridHtml = brands.map(brandCardHtml).join('\n');

  /* Inject into brands/index.html */
  const filePath = path.join(ROOT, 'brands/index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  html = injectIntoId(html, 'brands-grid', gridHtml);
  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`  ✔  brands/index.html — ${brands.length} brand cards injected`);
}

/* ══════════════════════════════════════════════════════════════════════════
   NEWS  (/news/index.html  +  /news/page/N/index.html)
   ══════════════════════════════════════════════════════════════════════════ */
async function generateNews() {
  console.log('\n── News ─────────────────────────────────────────────────');

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
    `?select=id,brand_slug,title,meta_description,image_url,slug,category,published_at,author` +
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
    description: a.meta_description || '',
    imageUrl:    a.image_url || null,
    brandIds:    [a.brand_slug],
    category:    a.category || '',
    slug:        a.slug,
  }));

  console.log(`  Fetched ${articles.length} articles from Supabase`);

  /* Build article card HTML — simplified version of renderFeedPageCard()
     Uses formatted date instead of timeAgo() since this is static HTML.
     The dynamic JS will replace this with live time when it loads.         */
  function articleCardHtml(article, isFirst) {
    let thumb = '';
    if (article.imageUrl) {
      const imgAttrs = isFirst
        ? 'loading="eager" fetchpriority="high"'
        : 'loading="lazy"';
      thumb = `<img class="feed-card-thumb feed-card-thumb--lg" src="${escHtml(article.imageUrl)}" ` +
              `width="600" height="375" ${imgAttrs} alt="" onerror="this.remove()">`;
    }

    let excerpt = '';
    if (article.description) {
      let text = article.description.trim();
      if (text.length > 180) text = text.slice(0, 180).replace(/\s\S+$/, '') + '…';
      excerpt = `<p class="feed-card-excerpt">${escHtml(text)}</p>`;
    }

    let tags = '';
    if (article.brandIds && article.brandIds.length) {
      const chips = article.brandIds.map(bid => {
        const bname = brandMap[bid];
        if (!bname) return '';
        return `<a href="/brands/${escHtml(bid)}/" class="feed-brand-tag">${escHtml(bname)}</a>`;
      }).filter(Boolean).join('');
      if (chips) tags = `<div class="feed-card-tags">${chips}</div>`;
    }

    const byline  = `By ${escHtml(article.author || 'Travis')}`;
    const dateStr = escHtml(formatDate(article.pubDate));

    return (
      `<article class="feed-card feed-card--full feed-card--dormied">` +
        thumb +
        `<div class="feed-card-body">` +
          `<div class="feed-card-meta">` +
            `<span class="feed-time">${dateStr}</span>` +
          `</div>` +
          `<a href="${escHtml(article.url)}" class="feed-card-title feed-card-title--lg"` +
            ` data-track-title="${escHtml(article.title)}"` +
            ` data-track-source="DORMIED"` +
            ` data-track-url="${escHtml(article.url)}"` +
            ` data-track-brands="${escHtml(JSON.stringify(article.brandIds || []))}"` +
            ` data-track-image="${escHtml(article.imageUrl || '')}"` +
            ` data-track-pubdate="${escHtml(article.pubDate || '')}">` +
            escHtml(article.title) +
          `</a>` +
          `<p class="feed-card-byline">${byline}</p>` +
          excerpt +
          tags +
        `</div>` +
      `</article>`
    );
  }

  const PAGE_SIZE = 25;
  const totalPages = Math.ceil(articles.length / PAGE_SIZE);
  console.log(`  ${articles.length} articles → ${totalPages} pages (${PAGE_SIZE}/page)`);

  /* ── Page 1: news/index.html ───────────────────────────────────────────── */
  const page1Articles = articles.slice(0, PAGE_SIZE);
  const feedHtml = page1Articles.map((a, i) => articleCardHtml(a, i === 0)).join('\n');

  const newsFilePath = path.join(ROOT, 'news/index.html');
  let newsHtml = fs.readFileSync(newsFilePath, 'utf8');

  /* Change h1 text from "News" to "The Feed" if not already done */
  newsHtml = newsHtml.replace(
    /(<h1[^>]+id="feed-title"[^>]*>)\s*News\s*(<\/h1>)/,
    '$1The Feed$2'
  );

  newsHtml = injectIntoId(newsHtml, 'feed-list', feedHtml);
  fs.writeFileSync(newsFilePath, newsHtml, 'utf8');
  console.log(`  ✔  news/index.html — ${page1Articles.length} articles injected`);

  /* ── Pages 2–N: news/page/N/index.html ────────────────────────────────── */
  /* Read the base template from news/index.html — but strip feed-page.min.js
     because it would re-fetch from the API and override our static content.
     The paginated pages are for crawlers; JS users use the main page.        */
  const paginatedBase = fs.readFileSync(newsFilePath, 'utf8')
    .replace(/<script[^>]+feed-page\.min\.js[^>]*><\/script>\s*/g, '');

  for (let p = 2; p <= totalPages; p++) {
    const pageArticles = articles.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    const pageFeedHtml = pageArticles.map((a, i) => articleCardHtml(a, i === 0)).join('\n');

    /* Tweak title/canonical for paginated page */
    let pageHtml = paginatedBase
      .replace(
        /<title>([^<]+)<\/title>/,
        `<title>Golf Brand News — Page ${p} | DORMIED</title>`
      )
      .replace(
        /<link rel="canonical"[^>]+>/,
        `<link rel="canonical" href="https://dormied.com/news/page/${p}/">`
      )
      /* Add prev/next rel links (insert before </head>) */
      .replace(
        /<\/head>/,
        (p > 2     ? `  <link rel="prev" href="https://dormied.com/news/page/${p - 1}/">\n` : '') +
        (p > 1     ? `  <link rel="prev" href="https://dormied.com/news/${p === 2 ? '' : `page/${p - 1}/`}">\n` : '') +
        (p < totalPages ? `  <link rel="next" href="https://dormied.com/news/page/${p + 1}/">\n` : '') +
        `</head>`
      )
      /* Remove duplicate prev links: above logic adds two for p===2, fix it */
      /* (actually handled by the ternary above — safe) */;

    /* Fix prev link — clean up the double-insertion above */
    pageHtml = dedupeRelLinks(pageHtml, p, totalPages);

    pageHtml = injectIntoId(pageHtml, 'feed-list', pageFeedHtml);

    const dir = path.join(ROOT, `news/page/${p}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), pageHtml, 'utf8');
    console.log(`  ✔  news/page/${p}/index.html — ${pageArticles.length} articles`);
  }

  return { totalPages, articleCount: articles.length };
}

/** Fix up rel prev/next links that the replace above may have doubled */
function dedupeRelLinks(html, p, totalPages) {
  // Remove all existing rel prev/next, then add exactly the right ones
  html = html
    .replace(/<link rel="prev"[^>]+>\n?/g, '')
    .replace(/<link rel="next"[^>]+>\n?/g, '');

  const prevUrl = p === 2
    ? 'https://dormied.com/news/'
    : `https://dormied.com/news/page/${p - 1}/`;
  const nextUrl = `https://dormied.com/news/page/${p + 1}/`;

  let relLinks = '';
  if (p > 1)           relLinks += `  <link rel="prev" href="${prevUrl}">\n`;
  if (p < totalPages)  relLinks += `  <link rel="next" href="${nextUrl}">\n`;

  return html.replace('</head>', relLinks + '</head>');
}

/* ══════════════════════════════════════════════════════════════════════════
   SCORECARD  (/scorecard/index.html)
   ══════════════════════════════════════════════════════════════════════════ */
function generateScorecard() {
  console.log('\n── Scorecard ────────────────────────────────────────────');

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

  const issues  = data.issues;
  const latest  = issues[0];
  const archive = issues.slice(1);

  /* Build image strip HTML — mirrors buildImageHtml() in scorecard-archive.js */
  function buildImageHtml(issue, isHero) {
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
    if (hero) {
      return `<img class="sc-hero-img" src="${escHtml(hero)}" alt="" loading="lazy">`;
    }
    return '';
  }

  /* Hero section — mirrors renderHero() in scorecard-archive.js */
  const heroHtml =
    `<div class="sc-hero-card">` +
      `<div class="sc-hero-label-row">` +
        `<span class="sc-label">THE SCORECARD</span>` +
        `<span class="sc-hero-date">${escHtml(latest.date)}</span>` +
      `</div>` +
      buildImageHtml(latest, true) +
      `<h2 class="sc-hero-title">${escHtml(latest.title)}</h2>` +
      `<p class="sc-hero-sub">${escHtml(latest.subtitle)}</p>` +
      `<a href="/scorecard/${escHtml(latest.slug)}/" class="sc-read-link">Read The Scorecard →</a>` +
    `</div>`;

  /* Archive grid — mirrors renderArchive() in scorecard-archive.js */
  const archiveHtml = archive.map(issue => {
    const thumb = issue.images && (
      issue.images.hero ||
      (issue.images.strip && issue.images.strip[0] && issue.images.strip[0].src)
    );
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
          `<p class="sc-archive-sub">${escHtml(issue.subtitle)}</p>` +
        `</div>` +
      `</a>`
    );
  }).join('\n');

  /* Inject into scorecard/index.html */
  const filePath = path.join(ROOT, 'scorecard/index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  html = injectIntoId(html, 'sc-hero', heroHtml);
  if (archive.length > 0) {
    html = injectIntoId(html, 'sc-archive-grid', archiveHtml);
  }
  fs.writeFileSync(filePath, html, 'utf8');

  console.log(`  ✔  scorecard/index.html — latest: "${latest.title}" + ${archive.length} archive card(s)`);
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
      /* Insert before the closing </urlset> */
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
      /* Update existing lastmod */
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
