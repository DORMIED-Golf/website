/* ─────────────────────────────────────────────────────────────────────────
   feed.js  —  DORMIED Articles feed (original content only)
   Fetches published articles from Supabase, renders article cards on the
   homepage and individual brand pages. All content is DORMIED originals.
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────────── */
  var BRAND_LIMIT  = 10;
  var HOME_LIMIT   = 10;
  var LATEST_LIMIT = 10;

  // Supabase — public anon key, read-only
  var SB_URL  = 'https://cimmmmnapdthqvtifpzr.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpbW1tbW5hcGR0aHF2dGlmcHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NzE3NTksImV4cCI6MjA4OTM0Nzc1OX0.yejRXgvODw3bMr3oA9IiNA-MIZsHHkxmDZouJmEgDfI';

  /* ── Author derivation ─────────────────────────────────────────────────── */
  function authorFromCategory(category) {
    var cat = (category || '').toLowerCase();
    if (cat.indexOf('apparel') !== -1 || cat.indexOf('footwear') !== -1 || cat.indexOf('bag') !== -1) return 'Adam';
    return 'Travis';
  }

  /* ── Time formatting ───────────────────────────────────────────────────── */
  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var now   = Date.now();
    var then  = new Date(dateStr).getTime();
    var diff  = now - then;
    if (isNaN(diff) || diff < 0) return '';
    var mins  = Math.floor(diff / 60000);
    var hours = Math.floor(diff / 3600000);
    var days  = Math.floor(diff / 86400000);
    if (mins  < 60)  return mins  + 'm ago';
    if (hours < 24)  return hours + 'h ago';
    if (days  < 7)   return days  + 'd ago';
    var d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /* ── HTML escape ───────────────────────────────────────────────────────── */
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  /* ── Brand name lookup ─────────────────────────────────────────────────── */
  function brandName(id, allBrands) {
    if (!allBrands) return id;
    for (var i = 0; i < allBrands.length; i++) {
      if (allBrands[i].id === id) return allBrands[i].name;
    }
    return id;
  }

  /* ── Vercel Image Optimization proxy ────────────────────────────────────── */
  function vitUrl(src, w) {
    if (!src) return src;
    return '/_vercel/image?url=' + encodeURIComponent(src) + '&w=' + w + '&q=75';
  }

  /* ── Brand month-over-month change from DORMIED_DATA ───────────────────── */
  function getBrandChange(id) {
    try {
      var data    = window.DORMIED_DATA;
      if (!data) return null;
      var meta    = data.meta;
      var curKey  = meta && meta.currentMonth;
      var prevKey = meta && meta.previousMonth;
      if (!curKey || !prevKey) return null;
      var brands  = data.brands;
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
        var sign    = rounded === 0 ? '' : pct > 0 ? '+' : '\u2212';
        var cls     = rounded === 0 ? 'feed-brand-tag--flat' : pct > 0 ? 'feed-brand-tag--up' : 'feed-brand-tag--down';
        return {
          pct: sign + rounded.toFixed(1) + '%',
          cls: cls
        };
      }
    } catch (e) {}
    return null;
  }

  /* ── Article card HTML (compact — used on homepage and brand pages) ─────── */
  function renderArticleCard(article, showBrandTags, allBrands) {
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
    if (showBrandTags && article.brandIds && article.brandIds.length) {
      var MAX_CHIPS = 3;
      var visibleIds = article.brandIds.slice(0, MAX_CHIPS);
      var overflowCount = Math.max(0, article.brandIds.length - MAX_CHIPS);
      var chips = visibleIds.map(function (bid) {
        var bname = brandName(bid, allBrands);
        if (!bname) return '';
        var change  = getBrandChange(bid);
        var cls     = 'feed-brand-tag' + (change ? ' ' + change.cls : '');
        var pctHtml = change
          ? ' <span class="feed-tag-pct">' + escHtml(change.pct) + '</span>'
          : '';
        return '<a href="/brands/' + escHtml(bid) + '/" class="' + cls + '">' +
               escHtml(bname) + pctHtml + '</a>';
      }).filter(Boolean).join('');
      var overflowHtml = overflowCount > 0
        ? '<span class="feed-brand-tag-overflow">+' + overflowCount + ' more</span>'
        : '';
      if (chips) tags = '<div class="feed-card-tags">' + chips + overflowHtml + '</div>';
    }

    // All articles are DORMIED originals — always internal links
    var byline = 'By ' + escHtml(article.author || 'Travis');

    return '<article class="feed-card feed-card--dormied">' +
      thumb +
      '<div class="feed-card-body">' +
        '<div class="feed-card-meta">' +
          '<span class="feed-time">' + escHtml(timeAgo(article.pubDate)) + '</span>' +
        '</div>' +
        '<a href="' + escHtml(article.url) + '" class="feed-card-title"' +
           ' data-track-title="'   + escHtml(article.title) + '"' +
           ' data-track-source="DORMIED"' +
           ' data-track-url="'     + escHtml(article.url) + '"' +
           ' data-track-brands="'  + escHtml(JSON.stringify(article.brandIds || [])) + '"' +
           ' data-track-image="'   + escHtml(article.imageUrl  || '') + '"' +
           ' data-track-pubdate="' + escHtml(article.pubDate   || '') + '">' +
          escHtml(article.title) +
        '</a>' +
        '<p class="feed-card-byline">' + byline + '</p>' +
        tags +
      '</div>' +
    '</article>';
  }

  /* ── Feed page card (full card with excerpt — used on /news/ page) ─────── */
  function renderFeedPageCard(article, allBrands, isLCP) {
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
            + ' width="600" height="375" ' + imgAttrs + ' alt="" onerror="this.remove()">';
    }

    var excerpt = '';
    if (article.description) {
      var text = article.description.trim();
      if (text.length > 180) text = text.slice(0, 180).replace(/\s\S+$/, '') + '\u2026';
      excerpt = '<p class="feed-card-excerpt">' + escHtml(text) + '</p>';
    }

    var tags = '';
    if (article.brandIds && article.brandIds.length) {
      var MAX_CHIPS2 = 3;
      var visibleIds2 = article.brandIds.slice(0, MAX_CHIPS2);
      var overflowCount2 = Math.max(0, article.brandIds.length - MAX_CHIPS2);
      var chips = visibleIds2.map(function (bid) {
        var bname = brandName(bid, allBrands);
        if (!bname) return '';
        var change  = getBrandChange(bid);
        var cls     = 'feed-brand-tag' + (change ? ' ' + change.cls : '');
        var pctHtml = change
          ? ' <span class="feed-tag-pct">' + escHtml(change.pct) + '</span>'
          : '';
        return '<a href="/brands/' + escHtml(bid) + '/" class="' + cls + '">' +
               escHtml(bname) + pctHtml + '</a>';
      }).filter(Boolean).join('');
      var overflowHtml2 = overflowCount2 > 0
        ? '<span class="feed-brand-tag-overflow">+' + overflowCount2 + ' more</span>'
        : '';
      if (chips) tags = '<div class="feed-card-tags">' + chips + overflowHtml2 + '</div>';
    }

    // All articles are DORMIED originals — always internal links
    var byline2 = 'By ' + escHtml(article.author || 'Travis');

    return '<article class="feed-card feed-card--full feed-card--dormied">' +
      thumb +
      '<div class="feed-card-body">' +
        '<div class="feed-card-meta">' +
          '<span class="feed-time">' + escHtml(timeAgo(article.pubDate)) + '</span>' +
        '</div>' +
        '<a href="' + escHtml(article.url) + '" class="feed-card-title feed-card-title--lg"' +
           ' data-track-title="'   + escHtml(article.title) + '"' +
           ' data-track-source="DORMIED"' +
           ' data-track-url="'     + escHtml(article.url) + '"' +
           ' data-track-brands="'  + escHtml(JSON.stringify(article.brandIds || [])) + '"' +
           ' data-track-image="'   + escHtml(article.imageUrl  || '') + '"' +
           ' data-track-pubdate="' + escHtml(article.pubDate   || '') + '">' +
          escHtml(article.title) +
        '</a>' +
        '<p class="feed-card-byline">' + byline2 + '</p>' +
        excerpt +
        tags +
      '</div>' +
    '</article>';
  }

  /* expose globally for feed-page.js */
  window.renderFeedPageCard = renderFeedPageCard;

  /* ── Fetch DORMIED originals from Supabase (public anon read) ──────────── */
  function fetchDormiedArticles(brandSlug, limit, cb) {
    var lim     = limit || 10;
    var headers = { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON };
    var base    = SB_URL + '/rest/v1/dormied_articles' +
      '?select=id,brand_slug,secondary_brand_slugs,title,meta_description,image_url,slug,category,published_at,author' +
      '&status=eq.published' +
      '&order=published_at.desc';

    function transform(rows) {
      return (rows || []).map(function (a) {
        var author = a.author || authorFromCategory(a.category);
        return {
          id:          a.id,
          title:       a.title,
          url:         '/news/' + a.slug + '/',
          author:      author,
          sourceName:  'DORMIED',
          sourceId:    'dormied',
          pubDate:     a.published_at,
          description: a.meta_description || '',
          imageUrl:    a.image_url || null,
          brandIds:    [a.brand_slug].concat(a.secondary_brand_slugs || []).filter(Boolean),
          isDormied:   true,
          category:    a.category || '',
          slug:        a.slug,
        };
      });
    }

    if (!brandSlug) {
      // No brand filter — simple single fetch (homepage / news feed)
      fetch(base + '&limit=' + lim, { headers: headers })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (rows) { cb(transform(rows)); })
        .catch(function () { cb([]); });
      return;
    }

    // Brand page: two parallel fetches — primary brand and secondary brand —
    // then merge, deduplicate, and re-sort. Avoids PostgREST or=() complexity.
    var primaryUrl   = base + '&brand_slug=eq.' + encodeURIComponent(brandSlug) + '&limit=' + lim;
    var secondaryUrl = base + '&secondary_brand_slugs=cs.%7B' + encodeURIComponent(brandSlug) + '%7D&limit=' + lim;

    function safeFetch(url) {
      return fetch(url, { headers: headers })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; });
    }

    Promise.all([ safeFetch(primaryUrl), safeFetch(secondaryUrl) ])
      .then(function (results) {
        var seen = {}, merged = [];
        (results[0] || []).concat(results[1] || []).forEach(function (a) {
          if (!seen[a.id]) { seen[a.id] = true; merged.push(a); }
        });
        merged.sort(function (a, b) { return a.published_at > b.published_at ? -1 : 1; });
        cb(transform(merged.slice(0, lim)));
      })
      .catch(function () { cb([]); });
  }

  /* ── Render: homepage "Latest from DORMIED" hero section ───────────────── */
  function renderLatestFromDormied() {
    var listEl  = document.getElementById('home-dormied-list');
    var section = document.getElementById('home-dormied-section');
    if (!listEl) return;

    fetchDormiedArticles(null, 6, function (articles) {
      if (!articles.length) {
        if (section) section.hidden = true;
        return;
      }
      if (section) section.hidden = false;

      var allBrands  = getAllBrands();
      var hero       = articles[0];
      var supporting = articles.slice(1, 6);

      listEl.innerHTML =
        renderFeedPageCard(hero, allBrands, true) +  // isLCP=true: eager + fetchpriority=high
        supporting.map(function (a) { return renderArticleCard(a, true, allBrands); }).join('');
    });
  }

  /* ── Helper: get current brand slug from window var or URL path ─────────── */
  function getCurrentBrandSlug() {
    var forced = window.__BRAND_SLUG__ || '';
    if (forced) return forced;
    var parts = window.location.pathname.replace(/\/$/, '').split('/');
    var last  = parts[parts.length - 1];
    return (last && last !== 'brand.html' && last !== 'brands') ? last : '';
  }

  /* ── Brand name lookup from DORMIED_DATA ───────────────────────────────── */
  function getBrandDisplayName(slug) {
    try {
      var brands = window.DORMIED_DATA && window.DORMIED_DATA.brands;
      if (!brands) return slug;
      for (var i = 0; i < brands.length; i++) {
        if (brands[i].id === slug) return brands[i].name;
      }
    } catch (e) {}
    return slug;
  }

  function getAllBrands() {
    try {
      return (window.DORMIED_DATA && window.DORMIED_DATA.brands) || [];
    } catch (e) {
      return [];
    }
  }

  /* ── Render: homepage Top Stories (DORMIED, ranked by click count) ─────── */
  function renderHomeStories() {
    var el = document.getElementById('home-stories-list');
    if (!el) return;

    var cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    fetch(SB_URL + '/rest/v1/article_clicks' +
          '?select=url,title,source_name,image_url,brand_ids,pub_date,click_count,last_clicked' +
          '&last_clicked=gte.' + encodeURIComponent(cutoff) +
          '&order=click_count.desc' +
          '&limit=20', {
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON }
    })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (rows) {
      // Only show DORMIED articles (internal /news/ URLs)
      var dormied = (rows || []).filter(function (row) {
        return row.url && row.url.indexOf('/news/') === 0;
      });

      if (dormied.length >= 3) {
        var allBrands = getAllBrands();
        var articles  = dormied.slice(0, HOME_LIMIT).map(function (row) {
          // Derive author from the primary brand's category
          var firstBrandId = row.brand_ids && row.brand_ids[0] || '';
          var firstBrand   = null;
          for (var j = 0; j < allBrands.length; j++) {
            if (allBrands[j].id === firstBrandId) { firstBrand = allBrands[j]; break; }
          }
          var derivedAuthor = firstBrand ? authorFromCategory(firstBrand.category) : 'Travis';
          return {
            title:     row.title,
            url:       row.url,
            author:    derivedAuthor,
            pubDate:   row.pub_date || row.last_clicked || '',
            imageUrl:  row.image_url || null,
            brandIds:  row.brand_ids || [],
            isDormied: true,
          };
        });
        el.innerHTML = articles.map(function (a) {
          return renderArticleCard(a, true, allBrands);
        }).join('');
        appendHomeStoriesSeeAll(el);
      } else {
        // Not enough click data — fall back to latest DORMIED articles
        renderHomeStoriesFallback(el);
      }
    })
    .catch(function () {
      renderHomeStoriesFallback(el);
    });
  }

  function renderHomeStoriesFallback(el) {
    fetchDormiedArticles(null, HOME_LIMIT, function (articles) {
      var allBrands = getAllBrands();
      if (!articles.length) {
        el.innerHTML = '<p class="latest-feed-loading">No articles available.</p>';
        return;
      }
      el.innerHTML = articles.map(function (a) {
        return renderArticleCard(a, true, allBrands);
      }).join('');
      appendHomeStoriesSeeAll(el);
    });
  }

  function appendHomeStoriesSeeAll(el) {
    if (document.getElementById('home-stories-see-all')) return;
    var div = document.createElement('div');
    div.id = 'home-stories-see-all';
    div.className = 'bp-latest-see-all';
    div.innerHTML = '<a href="/news/">See All News</a>';
    el.parentNode.appendChild(div);
  }

  /* ── Render: LATEST widget (10 most-recent articles, shared across pages) ─
     targetId    – id of the <div> to populate
     excludeSlug – optional article slug to exclude (used on article pages)    */
  function renderLatestWidget(targetId, excludeSlug) {
    var el = document.getElementById(targetId);
    if (!el) return;

    // Fetch a few extra so we can filter out the excluded article
    var fetchLimit = excludeSlug ? LATEST_LIMIT + 3 : LATEST_LIMIT;

    fetchDormiedArticles(null, fetchLimit, function (articles) {
      var allBrands = getAllBrands();
      var filtered  = (articles || []);
      if (excludeSlug) {
        filtered = filtered.filter(function (a) { return a.slug !== excludeSlug; });
      }
      filtered = filtered.slice(0, LATEST_LIMIT);

      if (!filtered.length) {
        el.innerHTML = '<p class="latest-feed-loading">No articles available.</p>';
        return;
      }

      el.innerHTML = filtered.map(function (a) {
        return renderArticleCard(a, true, allBrands);
      }).join('');

      var seeAllId = targetId + '-see-all';
      if (!document.getElementById(seeAllId)) {
        var div = document.createElement('div');
        div.id        = seeAllId;
        div.className = 'bp-latest-see-all';
        div.innerHTML = '<a href="/news/">See All News</a>';
        el.parentNode.appendChild(div);
      }
    });
  }

  /* ── Render: brand page (DORMIED originals only) ──────────────────────── */
  function renderLatestBrand(brandId, brandDisplayName) {
    var listEl    = document.getElementById('bp-latest-list');
    var section   = document.getElementById('bp-latest');
    var nameEl    = document.getElementById('bp-latest-brand-name');
    if (!listEl) return;
    if (nameEl) nameEl.textContent = brandDisplayName || brandId;

    var allBrands = getAllBrands();

    fetchDormiedArticles(brandId, BRAND_LIMIT, function (articles) {
      if (!articles.length) {
        // Keep section hidden when there are genuinely no articles
        return;
      }

      // Unhide the section — it may have been rendered hidden at build time
      // if the brand had no coverage yet when the page was generated.
      if (section) section.hidden = false;

      listEl.innerHTML = articles.map(function (a) {
        return renderArticleCard(a, true, allBrands);
      }).join('');

      var seeAll = document.getElementById('bp-latest-see-all');
      if (!seeAll) {
        seeAll = document.createElement('div');
        seeAll.id = 'bp-latest-see-all';
        seeAll.className = 'bp-latest-see-all';
        seeAll.innerHTML = '<a href="/news/">See All News</a>';
        listEl.parentNode.appendChild(seeAll);
      }
    });
  }

  /* ── Fetch: featured articles (curated, featured 1-5 asc) ─────────────── */
  function fetchFeaturedArticles(cb) {
    var headers = { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON };
    var url = SB_URL + '/rest/v1/dormied_articles'
      + '?select=id,brand_slug,secondary_brand_slugs,title,meta_description,image_url,slug,category,published_at,author,featured'
      + '&status=eq.published'
      + '&featured=not.is.null'
      + '&order=featured.asc'
      + '&limit=5';
    fetch(url, { headers: headers })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (rows) {
        cb((rows || []).map(function (a) {
          return {
            id:          a.id,
            title:       a.title,
            url:         '/news/' + a.slug + '/',
            author:      a.author || authorFromCategory(a.category),
            sourceName:  'DORMIED',
            sourceId:    'dormied',
            pubDate:     a.published_at,
            description: a.meta_description || '',
            imageUrl:    a.image_url || null,
            brandIds:    [a.brand_slug].concat(a.secondary_brand_slugs || []).filter(Boolean),
            isDormied:   true,
            category:    a.category || '',
            slug:        a.slug,
            featured:    a.featured,
          };
        }));
      })
      .catch(function () { cb([]); });
  }

  /* ── Render: homepage FEATURED section (slots 1-2 large, 3-5 compact 3-up) */
  function renderFeaturedSection() {
    var contentEl = document.getElementById('home-featured-section');
    var wrapEl    = document.getElementById('home-featured');
    if (!contentEl) return;

    fetchFeaturedArticles(function (articles) {
      if (!articles.length) {
        if (wrapEl) wrapEl.hidden = true;
        return;
      }
      var allBrands = getAllBrands();
      var large     = articles.slice(0, 2);
      var compact   = articles.slice(2, 5);

      var html = large.map(function (a) {
        // Same as Latest from DORMIED lead card but lazy (below fold)
        return renderFeedPageCard(a, allBrands, false);
      }).join('');

      if (compact.length) {
        html += '<div class="home-featured-3up">'
          + compact.map(function (a) {
              return renderArticleCard(a, true, allBrands);
            }).join('')
          + '</div>';
      }

      contentEl.innerHTML = html;
      if (wrapEl) wrapEl.hidden = false;
    });
  }

  /* ── Render: sidebar FEATURED widget (/rankings, /brands) ─────────────── */
  function renderFeaturedWidget() {
    var el      = document.getElementById('featured-list');
    var wrapEl  = document.getElementById('featured-widget');
    if (!el) return;

    fetchFeaturedArticles(function (articles) {
      if (!articles.length) {
        if (wrapEl) wrapEl.hidden = true;
        return;
      }
      var allBrands = getAllBrands();
      el.innerHTML = articles.map(function (a) {
        return renderArticleCard(a, true, allBrands);
      }).join('');
      if (wrapEl) wrapEl.hidden = false;
    });
  }

  /* ── Main init ─────────────────────────────────────────────────────────── */
  function initFeed() {
    var isBrand        = !!document.getElementById('bp-latest-list');
    var isHome         = !!document.getElementById('home-stories-list');
    var hasHomeDormied = !!document.getElementById('home-dormied-list');
    var hasLatest      = !!document.getElementById('dormied-latest-list');
    var hasFeatured    = !!document.getElementById('home-featured-section');
    var hasFeatWidget  = !!document.getElementById('featured-list');
    if (!isBrand && !isHome && !hasHomeDormied && !hasLatest && !hasFeatured && !hasFeatWidget) return;

    if (hasHomeDormied) renderLatestFromDormied();
    if (isHome)         renderHomeStories();
    if (hasLatest)      renderLatestWidget('dormied-latest-list', window.__DA_ARTICLE_SLUG__ || '');
    if (hasFeatured)    renderFeaturedSection();
    if (hasFeatWidget)  renderFeaturedWidget();
    if (isBrand) {
      var slug = getCurrentBrandSlug();
      renderLatestBrand(slug, getBrandDisplayName(slug));
    }
  }

  /* ── Boot ──────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeed);
  } else {
    initFeed();
  }

})();
