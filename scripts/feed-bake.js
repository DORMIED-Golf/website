'use strict';
// Server-side port of feed.js rendering functions for baking article feed
// links into generated HTML at build time. Mirrors feed.js markup exactly.

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

function authorFromCategory(category) {
  var cat = (category || '').toLowerCase();
  if (cat.indexOf('apparel') !== -1 || cat.indexOf('footwear') !== -1 || cat.indexOf('bag') !== -1) return 'Adam';
  return 'Travis';
}

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
                        + escHtml(vitUrl(article.imageUrl, 400)) + ' 400w"'
          + ' sizes="(min-width: 1200px) 180px, 80px"'
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

  var byline = 'By ' + escHtml(article.author || 'Travis');

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

  var byline = 'By ' + escHtml(article.author || 'Travis');

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

/* Homepage "Latest from DORMIED" — hero (LCP) + up to 5 supporting cards.
   Mirrors feed.js renderLatestFromDormied so the baked markup equals the
   runtime render (no layout shift when feed.js refreshes). */
function renderHomeLatestHtml(articles, dormiedData) {
  if (!articles || !articles.length) return '';
  var hero       = articles[0];
  var supporting = articles.slice(1, 6);
  return renderFeedPageCard(hero, dormiedData, true)
       + supporting.map(function (a) { return renderArticleCard(a, dormiedData); }).join('');
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
    brandIds:    [a.brand_slug].concat(a.secondary_brand_slugs || []).filter(Boolean),
    slug:        a.slug,
  };
}

async function fetchLatestArticles(supabase, limit, excludeSlug) {
  var fetchLimit = excludeSlug ? limit + 3 : limit;
  const { data, error } = await supabase
    .from('dormied_articles')
    .select('id,brand_slug,secondary_brand_slugs,title,meta_description,image_url,slug,category,published_at,author')
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

async function fetchTopStoriesArticles(supabase, dormiedData, limit) {
  var cutoff    = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  var allBrands = (dormiedData && dormiedData.brands) || [];

  function authorForBrandId(firstBrandId) {
    for (var j = 0; j < allBrands.length; j++) {
      if (allBrands[j].id === firstBrandId) return authorFromCategory(allBrands[j].category);
    }
    return 'Travis';
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
      return dormied.slice(0, limit).map(function (row) {
        var firstBrandId = (row.brand_ids && row.brand_ids[0]) || '';
        return {
          title:    row.title,
          url:      row.url,
          author:   authorForBrandId(firstBrandId),
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

/* ── Sidebar modules: Brands on the Move + Recently Updated Bags ──────────────
   Baked into prerendered HTML at build time (no client-side fetch), text-only,
   fixed reserved height (no CLS), desktop-only via CSS. Optional manual pin per
   module via dormied_sidebar_config.pinned_slug; otherwise pure auto.
   Returns '' on any failure so a data hiccup never breaks a bake.             */
async function fetchSidebarModulesHtml(supabase, dormiedData) {
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

    let html = '<!-- sidebar-mods:start --><div class="sidebar-mods">';
    if (moverRows.length) html += '<section class="sidebar-mod" aria-label="Brands on the move"><h2 class="latest-feed-heading">Brands on the Move</h2><div class="sidebar-mod-rows">' + moversHtml + '</div></section>';
    if (bagRows.length)   html += '<section class="sidebar-mod" aria-label="Recently updated bags"><h2 class="latest-feed-heading">Recently Updated Bags</h2><div class="sidebar-mod-rows">' + bagsHtml + '</div></section>';
    html += '</div><!-- sidebar-mods:end -->';
    return html;
  } catch (e) {
    console.warn('[feed-bake] sidebar modules failed:', e.message);
    return '';
  }
}

module.exports = { fetchLatestArticles, fetchTopStoriesArticles, renderLatestFeedHtml, renderFeedPageCard, renderHomeLatestHtml, fetchSidebarModulesHtml };
