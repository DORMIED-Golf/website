'use strict';
// Server-side port of feed.js rendering functions for baking article feed
// links into generated HTML at build time. Mirrors feed.js markup exactly.

var fs   = require('fs');
var path = require('path');
var vm   = require('vm');
var ROOT = path.resolve(__dirname, '..');
var scorecardIssue = require('./lib/scorecard-issue.js');

// On image error, swap to a fixed-dimension neutral placeholder (keeps the
// element and its reserved box) rather than removing it. Removing the img
// collapses the thumbnail box and shifts sidebar layout (CLS). The SVG scales
// to whatever CSS box the thumb has via object-fit:cover, so one placeholder
// serves both the 80x60 and larger thumb variants. Self-clears to avoid loops.
var THUMB_FALLBACK = "this.onerror=null;this.removeAttribute('srcset');"
  + "this.src='data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%2740%27%20height%3D%2730%27%3E%3Crect%20width%3D%2740%27%20height%3D%2730%27%20fill%3D%27%23e8eaed%27%2F%3E%3C%2Fsvg%3E'";

function timeAgo(dateStr) {
  if (!dateStr) return '';
  var now  = Date.now();
  var then = new Date(dateStr).getTime();
  var diff = now - then;
  if (isNaN(diff) || diff < 0) return '';
  var mins  = Math.floor(diff / 60000);
  var hours = Math.floor(diff / 3600000);
  var days  = Math.floor(diff / 86400000);
  if (mins  < 60) return mins  + 'm ago';
  if (hours < 24) return hours + 'h ago';
  if (days  < 7)  return days  + 'd ago';
  var d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function vitUrl(src, w) {
  if (!src) return src;
  return '/_vercel/image?url=' + encodeURIComponent(src) + '&w=' + w + '&q=75';
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// Shared with the article generator so a card can never render a byline the
// article page does not. Cards frequently need the derived form: the Top
// Stories module reads article_clicks, which has no author column at all.
var articleAuthors  = require('./lib/article-authors');
var authorFromCategory = articleAuthors.authorFromCategory;
var authorForBrandRec  = articleAuthors.authorForBrand;
var AUTHOR_DEFAULT     = articleAuthors.AUTHOR_DEFAULT;

function getBrandChange(dormiedData, id) {
  try {
    if (!dormiedData) return null;
    var meta    = dormiedData.meta;
    var curKey  = meta && meta.currentMonth;
    var prevKey = meta && meta.previousMonth;
    if (!curKey || !prevKey) return null;
    var brands  = dormiedData.brands;
    if (!brands) return null;
    for (var i = 0; i < brands.length; i++) {
      if (brands[i].id !== id) continue;
      var g    = brands[i].searchesByMarket && brands[i].searchesByMarket.global;
      if (!g) return null;
      var cur  = g[curKey]  || 0;
      var prev = g[prevKey] || 0;
      if (!prev) return null;
      var pct     = (cur - prev) / prev * 100;
      var rounded = parseFloat(Math.abs(pct).toFixed(1));
      var sign    = rounded === 0 ? '' : pct > 0 ? '+' : '−';
      var cls     = rounded === 0 ? 'feed-brand-tag--flat' : pct > 0 ? 'feed-brand-tag--up' : 'feed-brand-tag--down';
      return { pct: sign + rounded.toFixed(1) + '%', cls: cls };
    }
  } catch (e) {}
  return null;
}

function brandNameFromData(dormiedData, id) {
  if (!dormiedData || !dormiedData.brands) return id;
  for (var i = 0; i < dormiedData.brands.length; i++) {
    if (dormiedData.brands[i].id === id) return dormiedData.brands[i].name;
  }
  return id;
}

function renderArticleCard(article, dormiedData) {
  var thumb = '';
  if (article.imageUrl) {
    thumb = '<img class="feed-card-thumb"'
          + ' src="'    + escHtml(vitUrl(article.imageUrl, 160)) + '"'
          + ' srcset="' + escHtml(vitUrl(article.imageUrl,  80)) + ' 80w,'
                        + escHtml(vitUrl(article.imageUrl, 160)) + ' 160w,'
                        + escHtml(vitUrl(article.imageUrl, 400)) + ' 400w,'
                        + escHtml(vitUrl(article.imageUrl, 600)) + ' 600w,'
                        + escHtml(vitUrl(article.imageUrl, 800)) + ' 800w"'
          + ' sizes="(min-width: 1200px) 300px, 80px"'
          + ' width="80" height="60" loading="lazy" alt="" onerror="' + THUMB_FALLBACK + '">';
  }

  var tags = '';
  if (article.brandIds && article.brandIds.length) {
    var MAX_CHIPS = 3;
    var visibleIds    = article.brandIds.slice(0, MAX_CHIPS);
    var overflowCount = Math.max(0, article.brandIds.length - MAX_CHIPS);
    var chips = visibleIds.map(function (bid) {
      var bname = brandNameFromData(dormiedData, bid);
      if (!bname) return '';
      var change  = getBrandChange(dormiedData, bid);
      var cls     = 'feed-brand-tag' + (change ? ' ' + change.cls : '');
      var pctHtml = change
        ? ' <span class="feed-tag-pct">' + escHtml(change.pct) + '</span>'
        : '';
      return '<a href="/brands/' + escHtml(bid) + '/" class="' + cls + '">'
           + escHtml(bname) + pctHtml + '</a>';
    }).filter(Boolean).join('');
    var overflowHtml = overflowCount > 0
      ? '<span class="feed-brand-tag-overflow">+' + overflowCount + ' more</span>'
      : '';
    if (chips) tags = '<div class="feed-card-tags">' + chips + overflowHtml + '</div>';
  }

  var byline = 'By ' + escHtml(article.author || AUTHOR_DEFAULT);

  return '<article class="feed-card feed-card--dormied">'
       + thumb
       + '<div class="feed-card-body">'
       +   '<div class="feed-card-meta">'
       +     '<span class="feed-time">' + escHtml(timeAgo(article.pubDate)) + '</span>'
       +   '</div>'
       +   '<a href="' + escHtml(article.url) + '" class="feed-card-title"'
       +      ' data-track-title="'   + escHtml(article.title) + '"'
       +      ' data-track-source="DORMIED"'
       +      ' data-track-url="'     + escHtml(article.url) + '"'
       +      ' data-track-brands="'  + escHtml(JSON.stringify(article.brandIds || [])) + '"'
       +      ' data-track-image="'   + escHtml(article.imageUrl  || '') + '"'
       +      ' data-track-pubdate="' + escHtml(article.pubDate   || '') + '">'
       +     escHtml(article.title)
       +   '</a>'
       +   '<p class="feed-card-byline">' + byline + '</p>'
       +   tags
       + '</div>'
       + '</article>';
}

/* ── Feed page card (full card with excerpt — homepage LATEST hero) ──────────
   Mirrors feed.js renderFeedPageCard(article, allBrands, isLCP) exactly so the
   baked hero matches the runtime render and does not shift when feed.js
   refreshes it. */
function renderFeedPageCard(article, dormiedData, isLCP) {
  var thumb = '';
  if (article.imageUrl) {
    var imgAttrs = isLCP
      ? 'loading="eager" fetchpriority="high"'
      : 'loading="lazy"';
    thumb = '<img class="feed-card-thumb feed-card-thumb--lg"'
          + ' src="'    + escHtml(vitUrl(article.imageUrl,  800)) + '"'
          + ' srcset="' + escHtml(vitUrl(article.imageUrl,  400)) + ' 400w,'
                        + escHtml(vitUrl(article.imageUrl,  800)) + ' 800w,'
                        + escHtml(vitUrl(article.imageUrl, 1200)) + ' 1200w"'
          + ' sizes="(min-width:1200px) 750px,(min-width:600px) 600px,100vw"'
          + ' width="600" height="375" ' + imgAttrs + ' alt="" onerror="' + THUMB_FALLBACK + '">';
  }

  var excerpt = '';
  if (article.description) {
    var text = article.description.trim();
    if (text.length > 180) text = text.slice(0, 180).replace(/\s\S+$/, '') + '…';
    excerpt = '<p class="feed-card-excerpt">' + escHtml(text) + '</p>';
  }

  var tags = '';
  if (article.brandIds && article.brandIds.length) {
    var MAX_CHIPS = 3;
    var visibleIds    = article.brandIds.slice(0, MAX_CHIPS);
    var overflowCount = Math.max(0, article.brandIds.length - MAX_CHIPS);
    var chips = visibleIds.map(function (bid) {
      var bname = brandNameFromData(dormiedData, bid);
      if (!bname) return '';
      var change  = getBrandChange(dormiedData, bid);
      var cls     = 'feed-brand-tag' + (change ? ' ' + change.cls : '');
      var pctHtml = change
        ? ' <span class="feed-tag-pct">' + escHtml(change.pct) + '</span>'
        : '';
      return '<a href="/brands/' + escHtml(bid) + '/" class="' + cls + '">'
           + escHtml(bname) + pctHtml + '</a>';
    }).filter(Boolean).join('');
    var overflowHtml = overflowCount > 0
      ? '<span class="feed-brand-tag-overflow">+' + overflowCount + ' more</span>'
      : '';
    if (chips) tags = '<div class="feed-card-tags">' + chips + overflowHtml + '</div>';
  }

  var byline = 'By ' + escHtml(article.author || AUTHOR_DEFAULT);

  return '<article class="feed-card feed-card--full feed-card--dormied">'
       + thumb
       + '<div class="feed-card-body">'
       +   '<div class="feed-card-meta">'
       +     '<span class="feed-time">' + escHtml(timeAgo(article.pubDate)) + '</span>'
       +   '</div>'
       +   '<a href="' + escHtml(article.url) + '" class="feed-card-title feed-card-title--lg"'
       +      ' data-track-title="'   + escHtml(article.title) + '"'
       +      ' data-track-source="DORMIED"'
       +      ' data-track-url="'     + escHtml(article.url) + '"'
       +      ' data-track-brands="'  + escHtml(JSON.stringify(article.brandIds || [])) + '"'
       +      ' data-track-image="'   + escHtml(article.imageUrl  || '') + '"'
       +      ' data-track-pubdate="' + escHtml(article.pubDate   || '') + '">'
       +     escHtml(article.title)
       +   '</a>'
       +   '<p class="feed-card-byline">' + byline + '</p>'
       +   excerpt
       +   tags
       + '</div>'
       + '</article>';
}

/* Homepage "Latest from DORMIED" — 12 stories: a hero (LCP), a trio of the
   next 3 (side-by-side on desktop, stacked on mobile), then the next 8 as a
   list. Mirrors feed.js renderLatestFromDormied so the baked markup equals the
   runtime render (no layout shift when feed.js refreshes). */
/**
 * Minimum intrinsic width to headline the homepage.
 *
 * The hero is the only slot that blows a thumbnail up: CSS gives
 * .home-dormied-section .feed-card--full .feed-card-thumb--lg a full-width box
 * 200 to 260px tall, roughly 750px across on desktop. Everywhere else the same
 * --lg class is a 120x90 chip, which even a 200px source fills sharply.
 *
 * 35% of published articles have an image under 900px and 71 are under 500px,
 * including two at 72x72, because the sources publish small og:images and the
 * scraper takes what it is given. Putting one of those in the hero is a ~10x
 * upscale on the LCP element. 1200 is the floor that still looks sharp at the
 * 750px slot without starving the picker.
 */
var HERO_MIN_IMAGE_WIDTH = 1200;

function renderHomeLatestHtml(articles, dormiedData) {
  if (!articles || !articles.length) return '';
  // Headline the newest article whose image can actually fill the hero box.
  // Only the first four are eligible so the homepage still leads with
  // something current; if none qualifies, take the widest of those four and
  // fall back to the newest when nothing has been measured at all.
  var pool = articles.slice(0, 4);
  var hero = null;
  for (var h = 0; h < pool.length; h++) {
    if (pool[h].imageUrl && pool[h].imageWidth >= HERO_MIN_IMAGE_WIDTH) { hero = pool[h]; break; }
  }
  if (!hero) {
    var widest = pool.filter(function (a) { return a.imageUrl && a.imageWidth; })
                     .sort(function (a, b) { return b.imageWidth - a.imageWidth; })[0];
    hero = widest || articles[0];
  }
  var rest = articles.filter(function (a) { return a !== hero; });
  var trio = rest.slice(0, 3);    // items 2-4: desktop 3-across, mobile listed
  var list = rest.slice(3, 11);   // items 5-12: standard list
  var trioHtml = trio.length
    ? '<div class="home-latest-trio">'
      + trio.map(function (a) { return renderArticleCard(a, dormiedData); }).join('')
      + '</div>'
    : '';
  return renderFeedPageCard(hero, dormiedData, true)
       + trioHtml
       + list.map(function (a) { return renderArticleCard(a, dormiedData); }).join('');
}

function normalizeDormiedRow(a) {
  return {
    id:          a.id,
    title:       a.title,
    url:         '/news/' + a.slug + '/',
    author:      a.author || authorFromCategory(a.category),
    pubDate:     a.published_at,
    description: a.meta_description || '',
    imageUrl:    a.image_url || null,
    imageWidth:  a.image_width || null,
    brandIds:    [a.brand_slug].concat(a.secondary_brand_slugs || []).filter(Boolean),
    slug:        a.slug,
  };
}

async function fetchLatestArticles(supabase, limit, excludeSlug) {
  var fetchLimit = excludeSlug ? limit + 3 : limit;
  const { data, error } = await supabase
    .from('dormied_articles')
    .select('id,brand_slug,secondary_brand_slugs,title,meta_description,image_url,image_width,slug,category,published_at,author')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(fetchLimit);
  if (error) {
    console.warn('[feed-bake] dormied_articles fetch error:', error.message);
    return [];
  }
  var articles = (data || []).map(normalizeDormiedRow);
  if (excludeSlug) {
    articles = articles.filter(function (a) { return a.slug !== excludeSlug; });
  }
  return articles.slice(0, limit);
}

// Curated Featured articles (featured column set, ascending). Mirrors the
// client featured widget so the baked list matches what feed.js renders.
async function fetchFeaturedArticles(supabase, limit) {
  const { data, error } = await supabase
    .from('dormied_articles')
    .select('id,brand_slug,secondary_brand_slugs,title,meta_description,image_url,image_width,slug,category,published_at,author,featured')
    .eq('status', 'published')
    .not('featured', 'is', null)
    .order('featured', { ascending: true })
    .limit(limit || 10);
  if (error) {
    console.warn('[feed-bake] featured fetch error:', error.message);
    return [];
  }
  return (data || []).map(normalizeDormiedRow);
}

async function fetchTopStoriesArticles(supabase, dormiedData, limit) {
  var cutoff    = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  var allBrands = (dormiedData && dormiedData.brands) || [];

  function authorForBrandId(firstBrandId) {
    for (var j = 0; j < allBrands.length; j++) {
      if (allBrands[j].id === firstBrandId) return authorForBrandRec(allBrands[j], null);
    }
    return AUTHOR_DEFAULT;
  }

  try {
    const { data, error } = await supabase
      .from('article_clicks')
      .select('url,title,source_name,image_url,brand_ids,pub_date,click_count,last_clicked')
      .gte('last_clicked', cutoff)
      .order('click_count', { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);

    var dormied = (data || []).filter(function (row) {
      return row.url && row.url.indexOf('/news/') === 0;
    });

    if (dormied.length >= 3) {
      // Validate BEFORE slicing, so dropping an unpublished story does not
      // leave the module short.
      var picked = dormied;

      // article_clicks has no author column, so this module used to derive one
      // from the article's first brand. That guess disagrees with the byline on
      // the article itself whenever a piece was not written by the desk that
      // owns its brand: "Who Owns Pins & Aces" and "Why Is Malbon So Popular"
      // are both Adam's, but both brands are Bags & Accessories, so the derived
      // value read James K. on the homepage and Adam R. on the article.
      //
      // The real byline is one lookup away, so take it. Derivation stays only
      // as the fallback for a click row with no matching article.
      var slugs = picked
        .map(function (r) { return (r.url.match(/^\/news\/([^/]+)\/?$/) || [])[1]; })
        .filter(Boolean);

      // This lookup is AUTHORITATIVE, not just an author enrichment.
      //
      // Top Stories ranks article_clicks, which is a log: rows survive the
      // article they point at. Suppressing /news/vessel-missing-shipping-window
      // -season/ removed the page, the dormied_articles publish state, the
      // sitemap entry and every baked link, but its click history stayed, so
      // this module kept re-baking a link to it into the tail of every page.
      // Ahrefs found 1,023 pages pointing at one 404 and the site health score
      // fell from 100 to 35. A click log must never be the only thing deciding
      // what gets linked.
      //
      // On a lookup failure we fall through to Latest rather than rendering
      // unverified URLs: a wrong-but-live module beats 1,000 broken links.
      var authorBySlug = {};
      var publishedSlugs = new Set();
      if (slugs.length) {
        var res = await supabase
          .from('dormied_articles')
          .select('slug,author')
          .eq('status', 'published')
          .in('slug', slugs);
        if (res.error) {
          console.warn('[feed-bake] top-stories validation failed, falling back to Latest:', res.error.message);
          return fetchLatestArticles(supabase, limit, null);
        }
        (res.data || []).forEach(function (a) {
          publishedSlugs.add(a.slug);
          if (a.author) authorBySlug[a.slug] = a.author;
        });
      }

      var dropped = picked.length;
      picked = picked.filter(function (row) {
        var sl = (row.url.match(/^\/news\/([^/]+)\/?$/) || [])[1];
        return sl && publishedSlugs.has(sl);
      });
      dropped -= picked.length;
      if (dropped) console.warn(`[feed-bake] top-stories: dropped ${dropped} click row(s) whose article is no longer published`);
      if (picked.length < 3) return fetchLatestArticles(supabase, limit, null);
      picked = picked.slice(0, limit);

      return picked.map(function (row) {
        var slug = (row.url.match(/^\/news\/([^/]+)\/?$/) || [])[1];
        var firstBrandId = (row.brand_ids && row.brand_ids[0]) || '';
        return {
          title:    row.title,
          url:      row.url,
          author:   authorBySlug[slug] || authorForBrandId(firstBrandId),
          pubDate:  row.pub_date || row.last_clicked || '',
          imageUrl: row.image_url || null,
          brandIds: row.brand_ids || [],
        };
      });
    }
  } catch (e) {
    console.warn('[feed-bake] article_clicks fetch error:', e.message);
  }

  return fetchLatestArticles(supabase, limit, null);
}

function renderLatestFeedHtml(articles, dormiedData) {
  if (!articles || !articles.length) return '<p class="latest-feed-loading">No articles available.</p>';
  return articles.map(function (a) { return renderArticleCard(a, dormiedData); }).join('');
}

/* ── Latest Scorecard sidebar card ───────────────────────────────────────────
   One card for the newest issue, sitting directly under Top Stories, with a
   link through to the archive. It reads js/scorecard-data.js, so publishing an
   issue moves this card on the next bake with no edit here.

   Deliberately NOT inside .sidebar-mods. That container is display:none below
   1200px, and the entire point of this module is Scorecard traffic, most of
   which is mobile. As a sibling it stays visible at every width: under Top
   Stories in the aside on desktop, and at the foot of the page on mobile where
   the aside reflows.

   currentSlug suppresses the card on the very issue page it would link to.   */
var _scorecardIssuesCache = null;
function loadScorecardIssues() {
  if (_scorecardIssuesCache) return _scorecardIssuesCache;
  _scorecardIssuesCache = [];
  try {
    var src = fs.readFileSync(path.join(ROOT, 'js/scorecard-data.js'), 'utf8');
    var ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    _scorecardIssuesCache = (ctx.window.DORMIED_SCORECARD_DATA || {}).issues || [];
  } catch (e) {
    console.warn('[feed-bake] scorecard data load failed:', e.message);
  }
  return _scorecardIssuesCache;
}

function latestScorecardSectionHtml(currentSlug) {
  var issues = loadScorecardIssues();
  var issue  = issues[0];
  if (!issue) return '';
  if (currentSlug && issue.slug === currentSlug) return '';

  var url      = '/scorecard/' + issue.slug + '/';
  var headline = scorecardIssue.issueHeadline(issue);
  var thumbSrc = scorecardIssue.issueThumb(issue);

  var thumb = '';
  if (thumbSrc) {
    thumb = '<img class="feed-card-thumb"'
          + ' src="'    + escHtml(vitUrl(thumbSrc, 160)) + '"'
          + ' srcset="' + escHtml(vitUrl(thumbSrc,  80)) + ' 80w,'
                        + escHtml(vitUrl(thumbSrc, 160)) + ' 160w,'
                        + escHtml(vitUrl(thumbSrc, 400)) + ' 400w,'
                        + escHtml(vitUrl(thumbSrc, 600)) + ' 600w,'
                        + escHtml(vitUrl(thumbSrc, 800)) + ' 800w"'
          + ' sizes="(min-width: 1200px) 300px, 80px"'
          + ' width="80" height="60" loading="lazy" alt=""'
          + ' onerror="' + THUMB_FALLBACK + '">';
  }

  return '<section class="sidebar-scorecard" aria-labelledby="sidebar-scorecard-heading">'
       +   '<h2 class="latest-feed-heading" id="sidebar-scorecard-heading">Latest Scorecard</h2>'
       +   '<article class="feed-card feed-card--dormied">'
       +     thumb
       +     '<div class="feed-card-body">'
       +       '<div class="feed-card-meta">'
       +         '<span class="feed-time">' + escHtml(issue.monthLabel || '') + '</span>'
       +       '</div>'
       +       '<a href="' + escHtml(url) + '" class="feed-card-title"'
       +          ' data-track-title="'  + escHtml(headline) + '"'
       +          ' data-track-source="DORMIED"'
       +          ' data-track-url="'    + escHtml(url) + '">'
       +         escHtml(headline)
       +       '</a>'
       +       '<p class="feed-card-byline">By Adam R. &amp; Travis R.</p>'
       +     '</div>'
       +   '</article>'
       +   '<div class="sidebar-scorecard-more"><a href="/scorecard/">Read Past Issues &#x2192;</a></div>'
       + '</section>';
}

/* Wrap the module core in its markers, with the Scorecard card ahead of it.
   Split out from the fetch so refresh-modules can vary the card per page
   without re-querying Supabase for the parts that do not change. */
function composeSidebarMods(coreHtml, currentSlug) {
  var card = latestScorecardSectionHtml(currentSlug);
  if (!card && !coreHtml) return '';
  return '<!-- sidebar-mods:start -->' + card + (coreHtml || '') + '<!-- sidebar-mods:end -->';
}

/* ── Sidebar modules: Brands on the Move + Recently Updated Bags ──────────────
   Baked into prerendered HTML at build time (no client-side fetch), text-only,
   fixed reserved height (no CLS), desktop-only via CSS. Optional manual pin per
   module via dormied_sidebar_config.pinned_slug; otherwise pure auto.
   Returns '' on any failure so a data hiccup never breaks a bake.             */
async function fetchSidebarModulesCore(supabase, dormiedData) {
  try {
    // Manual pins (optional)
    const { data: cfgRows } = await supabase.from('dormied_sidebar_config').select('module_key, pinned_slug');
    const pins = {};
    (cfgRows || []).forEach(function (r) { pins[r.module_key] = r.pinned_slug || null; });

    // Brands on the Move: top 5 by |mom_change_pct| from the latest snapshot
    const { data: latestRow } = await supabase
      .from('dormied_monthly_brand_summary')
      .select('snapshot_month').order('snapshot_month', { ascending: false }).limit(1).maybeSingle();
    let moverRows = [];
    if (latestRow) {
      const { data: summary } = await supabase
        .from('dormied_monthly_brand_summary')
        .select('brand_slug, mom_change_pct')
        .eq('snapshot_month', latestRow.snapshot_month)
        .not('mom_change_pct', 'is', null);
      const sorted = (summary || []).sort(function (a, b) { return Math.abs(b.mom_change_pct) - Math.abs(a.mom_change_pct); });
      const pin = pins.brands_on_move ? sorted.find(function (r) { return r.brand_slug === pins.brands_on_move; }) : null;
      moverRows = (pin ? [pin] : []).concat(sorted.filter(function (r) { return !pin || r.brand_slug !== pin.brand_slug; })).slice(0, 5);
    }

    // Recently Updated Bags: 5 most recent distinct players from witb_changes
    const { data: changes } = await supabase
      .from('witb_changes')
      .select('player_id, club_type, change_type, detected_at, witb_players!player_id(name, slug)')
      .order('detected_at', { ascending: false })
      .limit(60);
    const seen = new Set();
    let bagRows = [];
    for (const c of (changes || [])) {
      const p = c.witb_players;
      if (!p || !p.slug || seen.has(p.slug)) continue;
      seen.add(p.slug);
      const verb = c.change_type === 'added' ? 'added' : c.change_type === 'removed' ? 'dropped' : 'new';
      bagRows.push({ slug: p.slug, name: p.name, note: (verb + ' ' + (c.club_type || 'club')).toUpperCase() });
    }
    if (pins.recent_bags) {
      const idx = bagRows.findIndex(function (r) { return r.slug === pins.recent_bags; });
      if (idx > 0) bagRows.unshift(bagRows.splice(idx, 1)[0]);
    }
    bagRows = bagRows.slice(0, 5);

    if (!moverRows.length && !bagRows.length) return '';

    const nameOf = function (slug) { return brandNameFromData(dormiedData, slug) || slug; };
    const moversHtml = moverRows.map(function (r) {
      const up  = r.mom_change_pct >= 0;
      const pct = (up ? '+' : '') + r.mom_change_pct.toFixed(1) + '%';
      return '<a href="/brands/' + escHtml(r.brand_slug) + '/" class="sidebar-mod-row feed-brand-tag ' + (up ? 'feed-brand-tag--up' : 'feed-brand-tag--down') + '">'
        + escHtml(nameOf(r.brand_slug)) + ' <span class="feed-tag-pct">' + escHtml(pct) + '</span></a>';
    }).join('');
    const bagsHtml = bagRows.map(function (r) {
      return '<a href="/witb/players/' + escHtml(r.slug) + '/" class="sidebar-mod-row sidebar-mod-row--bag">'
        + escHtml(r.name) + ' <span class="sidebar-mod-note">' + escHtml(r.note) + '</span></a>';
    }).join('');

    let html = '<div class="sidebar-mods">';
    if (moverRows.length) html += '<section class="sidebar-mod" aria-label="Brands on the move"><h2 class="latest-feed-heading">Brands on the Move</h2><div class="sidebar-mod-rows">' + moversHtml + '</div></section>';
    if (bagRows.length)   html += '<section class="sidebar-mod" aria-label="Recently updated bags"><h2 class="latest-feed-heading">Recently Updated Bags</h2><div class="sidebar-mod-rows">' + bagsHtml + '</div></section>';
    html += '</div>';
    return html;
  } catch (e) {
    console.warn('[feed-bake] sidebar modules failed:', e.message);
    return '';
  }
}

/* Existing signature, preserved for the nine generators that call it. Pass
   { currentSlug } from a scorecard issue page so the card does not link to the
   page it is sitting on. */
async function fetchSidebarModulesHtml(supabase, dormiedData, opts) {
  const core = await fetchSidebarModulesCore(supabase, dormiedData);
  return composeSidebarMods(core, opts && opts.currentSlug);
}

module.exports = { fetchLatestArticles, fetchTopStoriesArticles, fetchFeaturedArticles, renderLatestFeedHtml, renderFeedPageCard, renderHomeLatestHtml, fetchSidebarModulesHtml, fetchSidebarModulesCore, composeSidebarMods };
