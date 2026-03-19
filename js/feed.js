/* ─────────────────────────────────────────────────────────────────────────
   feed.js  —  DORMIED Latest Articles feed
   Fetches /api/feed (Vercel function), caches in localStorage, renders
   article cards on both the index page and individual brand pages.
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────────── */
  var FEED_API    = '/api/feed';
  var CACHE_KEY   = 'dormied_feed_v2';
  var CACHE_TTL   = 6 * 60 * 60 * 1000;   // 6 hours
  var INDEX_LIMIT = 10;
  var BRAND_LIMIT = 30;
  var HOME_LIMIT  = 5;

  /* ── Local dev detection ────────────────────────────────────────────────── */
  function isLocalDev() {
    var h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || window.location.protocol === 'file:';
  }

  /* ── Mock data for local preview ────────────────────────────────────────── */
  var MOCK_DATA = {
    articles: [
      {
        id: 'mock1',
        title: 'TaylorMade Qi35 Irons: The Most Forgiving Clubs We\'ve Ever Tested',
        url: 'https://mygolfspy.com/taylormade-qi35-irons-review/',
        sourceName: 'MyGolfSpy',
        sourceId: 'mygolfspy',
        pubDate: new Date(Date.now() - 2 * 3600000).toISOString(),
        description: 'We put the new Qi35 irons through a full robot and player testing protocol. The numbers are impressive.',
        imageUrl: 'https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&q=80',
        brandIds: ['taylormade']
      },
      {
        id: 'mock2',
        title: 'Titleist Pro V1 vs Pro V1x: Which Ball Is Right for Your Game in 2026?',
        url: 'https://www.golfdigest.com/story/titleist-pro-v1-vs-pro-v1x-2026',
        sourceName: 'Golf Digest',
        sourceId: 'golfdigest',
        pubDate: new Date(Date.now() - 5 * 3600000).toISOString(),
        description: 'Both balls have been updated for 2026. Here\'s how to decide which one belongs in your bag.',
        imageUrl: 'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&q=80',
        brandIds: ['titleist']
      },
      {
        id: 'mock3',
        title: 'Callaway Paradym Ai Smoke vs PING G440: Head-to-Head Driver Test',
        url: 'https://www.golfwrx.com/callaway-paradym-ai-smoke-vs-ping-g440/',
        sourceName: 'GolfWRX',
        sourceId: 'golfwrx',
        pubDate: new Date(Date.now() - 22 * 3600000).toISOString(),
        description: 'Two of the best performing drivers on tour go head to head on a launch monitor.',
        imageUrl: null,
        brandIds: ['callaway', 'ping']
      },
      {
        id: 'mock4',
        title: 'The Masters 2026: Every Brand Worn by the Top 10 Finishers',
        url: 'https://golf.com/gear/the-masters-2026-brands-worn/',
        sourceName: 'Golf.com',
        sourceId: 'golfcom',
        pubDate: new Date(Date.now() - 2 * 86400000).toISOString(),
        description: 'Augusta always delivers a brand showcase. We tracked every club, ball, glove, and shoe worn by the top finishers.',
        imageUrl: 'https://images.unsplash.com/photo-1510674671809-8d72abc8b01e?w=400&q=80',
        brandIds: ['taylormade', 'titleist', 'footjoy', 'under-armour-golf']
      },
      {
        id: 'mock5',
        title: 'Scotty Cameron Special Select vs Bettinardi QB6: Premium Putter Shootout',
        url: 'https://www.pluggedingolf.com/scotty-cameron-vs-bettinardi-putter-test/',
        sourceName: 'Plugged In Golf',
        sourceId: 'pluggedin',
        pubDate: new Date(Date.now() - 3 * 86400000).toISOString(),
        description: 'Two of the most sought-after putters on the market. Which one rolls it better?',
        imageUrl: null,
        brandIds: ['scotty-cameron', 'bettinardi']
      }
    ]
  };

  /* ── UTM helper ────────────────────────────────────────────────────────── */
  function addUTM(url) {
    try {
      var u = new URL(url);
      u.searchParams.set('utm_source',   'dormied');
      u.searchParams.set('utm_medium',   'referral');
      u.searchParams.set('utm_campaign', 'latest-feed');
      return u.toString();
    } catch (e) {
      return url;
    }
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

  /* ── Article card HTML ─────────────────────────────────────────────────── */
  function renderArticleCard(article, showBrandTags, allBrands) {
    var thumb = '';
    if (article.imageUrl) {
      thumb = '<img class="feed-card-thumb" src="' + escHtml(article.imageUrl) +
              '" loading="lazy" alt="" onerror="this.remove()">';
    }

    var tags = '';
    if (showBrandTags && article.brandIds && article.brandIds.length) {
      var chips = article.brandIds.map(function (bid) {
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
      if (chips) tags = '<div class="feed-card-tags">' + chips + '</div>';
    }

    return '<article class="feed-card">' +
      thumb +
      '<div class="feed-card-body">' +
        '<div class="feed-card-meta">' +
          '<span class="feed-source">' + escHtml(article.sourceName) + '</span>' +
          '<span class="feed-time">'   + escHtml(timeAgo(article.pubDate)) + '</span>' +
        '</div>' +
        '<a href="' + escHtml(addUTM(article.url)) + '" ' +
           'target="_blank" rel="noopener noreferrer" class="feed-card-title"' +
           ' data-track-title="' + escHtml(article.title) + '"' +
           ' data-track-source="' + escHtml(article.sourceName) + '">' +
          escHtml(article.title) +
        '</a>' +
        tags +
      '</div>' +
    '</article>';
  }

  /* ── Brand name lookup ─────────────────────────────────────────────────── */
  function brandName(id, allBrands) {
    if (!allBrands) return id;
    for (var i = 0; i < allBrands.length; i++) {
      if (allBrands[i].id === id) return allBrands[i].name;
    }
    return id;
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
        var pct  = (cur - prev) / prev * 100;
        var sign = pct >= 0 ? '+' : '\u2212';   // + or −
        return {
          pct: sign + Math.abs(pct).toFixed(1) + '%',
          cls: pct >= 0 ? 'feed-brand-tag--up' : 'feed-brand-tag--down'
        };
      }
    } catch (e) {}
    return null;
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

  /* ── Feed page card (full card with excerpt) ───────────────────────────── */
  function renderFeedPageCard(article, allBrands) {
    var thumb = '';
    if (article.imageUrl) {
      thumb = '<img class="feed-card-thumb feed-card-thumb--lg" src="' + escHtml(article.imageUrl) +
              '" loading="lazy" alt="" onerror="this.remove()">';
    }

    var excerpt = '';
    if (article.description) {
      var text = article.description.trim();
      if (text.length > 180) text = text.slice(0, 180).replace(/\s\S+$/, '') + '…';
      excerpt = '<p class="feed-card-excerpt">' + escHtml(text) + '</p>';
    }

    var tags = '';
    if (article.brandIds && article.brandIds.length) {
      var chips = article.brandIds.map(function (bid) {
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
      if (chips) tags = '<div class="feed-card-tags">' + chips + '</div>';
    }

    return '<article class="feed-card feed-card--full">' +
      thumb +
      '<div class="feed-card-body">' +
        '<div class="feed-card-meta">' +
          '<span class="feed-source">' + escHtml(article.sourceName) + '</span>' +
          '<span class="feed-time">'   + escHtml(timeAgo(article.pubDate)) + '</span>' +
        '</div>' +
        '<a href="' + escHtml(addUTM(article.url)) + '" ' +
           'target="_blank" rel="noopener noreferrer" class="feed-card-title feed-card-title--lg">' +
          escHtml(article.title) +
        '</a>' +
        excerpt +
        tags +
      '</div>' +
    '</article>';
  }

  /* expose globally for feed-page.js */
  window.renderFeedPageCard = renderFeedPageCard;

  /* ── Render: index page ────────────────────────────────────────────────── */
  function renderLatestIndex(articles, allBrands) {
    var el = document.getElementById('latest-feed-list');
    if (!el) return;
    var slice = articles.filter(function (a) {
      return a.brandIds && a.brandIds.length > 0;
    }).slice(0, INDEX_LIMIT);
    if (!slice.length) {
      el.innerHTML = '<p class="latest-feed-loading">No articles available.</p>';
      return;
    }
    el.innerHTML = slice.map(function (a) {
      return renderArticleCard(a, true, allBrands);
    }).join('');
  }

  /* ── Render: brand page ────────────────────────────────────────────────── */
  function renderLatestBrand(articles, brandId, brandDisplayName) {
    var listEl  = document.getElementById('bp-latest-list');
    var nameEl  = document.getElementById('bp-latest-brand-name');
    if (!listEl) return;
    if (nameEl) nameEl.textContent = brandDisplayName || brandId;

    var filtered = articles.filter(function (a) {
      return a.brandIds && a.brandIds.indexOf(brandId) !== -1;
    }).slice(0, BRAND_LIMIT);

    if (!filtered.length) {
      listEl.innerHTML = '<p class="latest-feed-loading">No recent articles mentioning ' +
                         escHtml(brandDisplayName || brandId) + '.</p>';
      return;
    }
    var allBrands = getAllBrands();
    listEl.innerHTML = filtered.map(function (a) {
      return renderArticleCard(a, true, allBrands);
    }).join('');
  }

  /* ── localStorage cache ────────────────────────────────────────────────── */
  function getCached() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (Date.now() - obj.timestamp > CACHE_TTL) return null;
      return obj.data;
    } catch (e) {
      return null;
    }
  }

  function setCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: data }));
    } catch (e) { /* localStorage full — ignore */ }
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

  /* ── Render: homepage Top Stories ──────────────────────────────────────── */
  function renderHomeStories(articles, allBrands) {
    var el = document.getElementById('home-stories-list');
    if (!el) return;
    var slice = articles.filter(function (a) {
      return a.brandIds && a.brandIds.length > 0;
    }).slice(0, HOME_LIMIT);
    if (!slice.length) {
      el.innerHTML = '<p class="latest-feed-loading">No articles available.</p>';
      return;
    }
    el.innerHTML = slice.map(function (a) {
      return renderArticleCard(a, true, allBrands);
    }).join('');
  }

  /* ── Main init ─────────────────────────────────────────────────────────── */
  function initFeed() {
    var isIndex = !!document.getElementById('latest-feed-list');
    var isBrand = !!document.getElementById('bp-latest-list');
    var isHome  = !!document.getElementById('home-stories-list');
    if (!isIndex && !isBrand && !isHome) return;  // no container found

    // Use mock data on local dev so sections are visible without deploying
    if (isLocalDev()) {
      applyData(MOCK_DATA, isIndex, isBrand, isHome);
      return;
    }

    var cached = getCached();
    if (cached) {
      applyData(cached, isIndex, isBrand, isHome);
      return;
    }

    fetch(FEED_API)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        setCache(data);
        applyData(data, isIndex, isBrand, isHome);
      })
      .catch(function (err) {
        console.warn('[feed.js] Could not load feed:', err);
        var errMsg = '<p class="latest-feed-loading">Could not load articles.</p>';
        if (isIndex) {
          var el = document.getElementById('latest-feed-list');
          if (el) el.innerHTML = errMsg;
        }
        if (isBrand) {
          var bel = document.getElementById('bp-latest-list');
          if (bel) bel.innerHTML = errMsg;
        }
        if (isHome) {
          var hel = document.getElementById('home-stories-list');
          if (hel) hel.innerHTML = errMsg;
        }
      });
  }

  function applyData(data, isIndex, isBrand, isHome) {
    var articles = (data && data.articles) || [];
    if (isIndex) {
      renderLatestIndex(articles, getAllBrands());
    }
    if (isBrand) {
      var slug = window.__BRAND_SLUG__ || '';
      var displayName = getBrandDisplayName(slug);
      renderLatestBrand(articles, slug, displayName);
    }
    if (isHome) {
      renderHomeStories(articles, getAllBrands());
    }
  }

  /* ── Boot ──────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeed);
  } else {
    initFeed();
  }

})();
