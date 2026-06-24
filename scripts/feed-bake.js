'use strict';
// Server-side port of feed.js rendering functions for baking article feed
// links into generated HTML at build time. Mirrors feed.js markup exactly.

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
          + ' width="80" height="60" loading="lazy" alt="" onerror="this.remove()">';
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

function normalizeDormiedRow(a) {
  return {
    id:       a.id,
    title:    a.title,
    url:      '/news/' + a.slug + '/',
    author:   a.author || authorFromCategory(a.category),
    pubDate:  a.published_at,
    imageUrl: a.image_url || null,
    brandIds: [a.brand_slug].concat(a.secondary_brand_slugs || []).filter(Boolean),
    slug:     a.slug,
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

module.exports = { fetchLatestArticles, fetchTopStoriesArticles, renderLatestFeedHtml };
