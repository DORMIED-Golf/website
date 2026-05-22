/* ─────────────────────────────────────────────────────────────────────────
   da-article.js  —  DORMIED Article Page Enhancements
   Populates "More on [Brand]" and "Latest from DORMIED" bottom sections,
   injects the brand logo, and dynamically populates the brand stats widget.
   Depends on: window.__DA_BRAND_SLUG__ and window.__DA_ARTICLE_SLUG__
   set inline by the article page template.
   Also depends on: window.DORMIED_DATA (loaded via data.js) for brand stats.
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var SB_URL  = 'https://cimmmmnapdthqvtifpzr.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpbW1tbW5hcGR0aHF2dGlmcHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NzE3NTksImV4cCI6MjA4OTM0Nzc1OX0.yejRXgvODw3bMr3oA9IiNA-MIZsHHkxmDZouJmEgDfI';

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var diff  = Date.now() - new Date(dateStr).getTime();
    if (isNaN(diff) || diff < 0) return '';
    var days  = Math.floor(diff / 86400000);
    var hours = Math.floor(diff / 3600000);
    var mins  = Math.floor(diff / 60000);
    if (mins  < 60)  return mins  + 'm ago';
    if (hours < 24)  return hours + 'h ago';
    if (days  < 7)   return days  + 'd ago';
    var d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fetchArticles(params, cb) {
    var qs = Object.keys(params).map(function(k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    var url = SB_URL + '/rest/v1/dormied_articles?select=id,brand_slug,title,meta_description,image_url,slug,published_at&status=eq.published&order=published_at.desc&limit=5&' + qs;
    fetch(url, {
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON }
    })
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(cb)
    .catch(function() { cb([]); });
  }

  /* Render a card matching the site's feed-card style */
  function renderCard(a) {
    var thumb = a.image_url
      ? '<img class="feed-card-thumb" src="' + escHtml(a.image_url) + '" width="400" height="250" loading="lazy" alt="" onerror="this.remove()">'
      : '';
    var excerpt = '';
    if (a.meta_description) {
      var t = a.meta_description.trim();
      if (t.length > 120) t = t.slice(0, 120).replace(/\s\S+$/, '') + '…';
      excerpt = '<p class="feed-card-excerpt">' + escHtml(t) + '</p>';
    }
    return '<article class="feed-card feed-card--dormied">' +
      thumb +
      '<div class="feed-card-body">' +
        '<div class="feed-card-meta">' +
          '<span class="feed-time">' + escHtml(timeAgo(a.published_at)) + '</span>' +
        '</div>' +
        '<a href="/news/' + escHtml(a.slug) + '/" class="feed-card-title">' + escHtml(a.title) + '</a>' +
        excerpt +
      '</div>' +
    '</article>';
  }

  /* Inject brand logo from DORMIED_DATA if available */
  function injectBrandLogo(brandSlug) {
    var logoEl = document.getElementById('da-brand-logo');
    if (!logoEl || !brandSlug) return;

    var data = window.DORMIED_DATA;
    if (!data || !data.brands) return;

    var brand = null;
    for (var i = 0; i < data.brands.length; i++) {
      if (data.brands[i].id === brandSlug) { brand = data.brands[i]; break; }
    }
    if (!brand) return;

    var initials = brand.name.split(/\s+/).map(function(w){ return w[0]; }).join('').slice(0, 2).toUpperCase();
    var bg = '#1a2a1a';

    if (brand.logo) {
      var src = brand.logo.replace(/sz=\d+/, 'sz=48');
      var fallback = '<span class="bp-logo-initials" style="background:' + bg + ';width:48px;height:48px;font-size:1rem">' + escHtml(initials) + '</span>';
      logoEl.innerHTML = '<img src="' + escHtml(src) + '" alt="' + escHtml(brand.name) + '" class="bp-logo-img" width="48" height="48" style="width:48px;height:48px" onerror="this.style.display=\'none\';this.insertAdjacentHTML(\'afterend\',\'' + fallback.replace(/'/g, "\\'") + '\')">';
    } else {
      logoEl.innerHTML = '<span class="bp-logo-initials" style="background:' + bg + ';width:48px;height:48px;font-size:1rem">' + escHtml(initials) + '</span>';
    }
  }

  /* ── Compute and populate brand stats widget from DORMIED_DATA ─────────── */
  function populateBrandStats(brandSlug) {
    var statsEl = document.querySelector('.da-brand-card-stats');
    if (!statsEl || !brandSlug) return;

    var data = window.DORMIED_DATA;
    if (!data || !data.brands || !data.meta) return;

    // Find brand
    var brand = null;
    for (var i = 0; i < data.brands.length; i++) {
      if (data.brands[i].id === brandSlug) { brand = data.brands[i]; break; }
    }
    if (!brand) return;

    var cm    = data.meta.currentMonth;
    var pm    = data.meta.previousMonth;

    // Helper: shift month label by delta months
    var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function shiftMonth(label, delta) {
      var parts = label.split(' ');
      var total = parseInt(parts[1]) * 12 + MONTHS.indexOf(parts[0]) + delta;
      return MONTHS[((total % 12) + 12) % 12] + ' ' + Math.floor(total / 12);
    }

    var ya    = shiftMonth(cm, -12);

    var g = (brand.searchesByMarket && brand.searchesByMarket.global) || {};
    var cur  = g[cm]    || 0;
    var prev = g[pm]    || 0;
    var a12  = g[ya]    || 0;

    // 3M Trend: rolling avg of last 3 months vs prior 3 months — matches brand.js
    var allMonthKeys = Object.keys(g).sort(function(a, b) {
      var pa = parseInt(a.split(' ')[1]) * 12 + MONTHS.indexOf(a.split(' ')[0]);
      var pb = parseInt(b.split(' ')[1]) * 12 + MONTHS.indexOf(b.split(' ')[0]);
      return pa - pb;
    });
    var cmPos   = allMonthKeys.indexOf(cm);
    var last3m  = allMonthKeys.slice(Math.max(0, cmPos - 2), cmPos + 1);
    var prior3m = allMonthKeys.slice(Math.max(0, cmPos - 5), Math.max(0, cmPos - 2));
    var l3avg   = last3m.length  > 0 ? last3m.reduce( function(s, m) { return s + (g[m] || 0); }, 0) / last3m.length  : 0;
    var p3avg   = prior3m.length > 0 ? prior3m.reduce(function(s, m) { return s + (g[m] || 0); }, 0) / prior3m.length : 0;
    var t3m     = p3avg > 0 ? (l3avg - p3avg) / p3avg * 100 : null;

    // Compute global rank and DI score
    var allCur = data.brands.map(function(b) {
      return { id: b.id, v: (b.searchesByMarket && b.searchesByMarket.global && b.searchesByMarket.global[cm]) || 0 };
    });
    var maxVal = 0;
    allCur.forEach(function(x) { if (x.v > maxVal) maxVal = x.v; });

    // Sort with tiebreaker (prev month) — same as brand.js
    var allPrev = {};
    data.brands.forEach(function(b) {
      allPrev[b.id] = (b.searchesByMarket && b.searchesByMarket.global && b.searchesByMarket.global[pm]) || 0;
    });
    allCur.sort(function(a, b) {
      var diff = b.v - a.v;
      if (Math.abs(diff) > 0.0001) return diff;
      return (allPrev[b.id] || 0) - (allPrev[a.id] || 0);
    });

    var rank = 1;
    for (var j = 0; j < allCur.length; j++) {
      if (allCur[j].id === brandSlug) { rank = j + 1; break; }
    }

    var di = maxVal > 0 ? (cur / maxVal * 100) : 0;

    // M/M change
    function fmtPct(val) {
      if (val === null || val === undefined) return '—';
      var sign = val >= 0 ? '+' : '';
      return sign + val.toFixed(1) + '%';
    }
    function pctClass(val) {
      if (val === null || val === undefined) return '';
      if (val > 0.05) return 'da-mom-up';
      if (val < -0.05) return 'da-mom-down';
      return 'da-mom-flat';
    }

    var mom  = prev > 0 ? (cur - prev) / prev * 100 : null;
    var t12m = a12  > 0 ? (cur - a12)  / a12  * 100 : null;

    var momStr  = prev > 0   ? fmtPct(mom)  : '—';
    var t3mStr  = t3m !== null ? fmtPct(t3m) : '—';
    var t12mStr = a12  > 0   ? fmtPct(t12m) : '—';

    statsEl.innerHTML =
      '<div class="bp-metric-card"><span class="bp-metric-label">Global Rank</span><span class="bp-metric-val">#' + rank + '</span></div>' +
      '<div class="bp-metric-card"><span class="bp-metric-label">DI Score</span><span class="bp-metric-val">' + di.toFixed(1) + '</span></div>' +
      '<div class="bp-metric-card"><span class="bp-metric-label">M/M Change</span><span class="bp-metric-val ' + pctClass(mom) + '">' + escHtml(momStr) + '</span></div>' +
      '<div class="bp-metric-card"><span class="bp-metric-label">3M Trend</span><span class="bp-metric-val ' + pctClass(t3m) + '">' + escHtml(t3mStr) + '</span></div>' +
      '<div class="bp-metric-card"><span class="bp-metric-label">12M Trend</span><span class="bp-metric-val ' + pctClass(t12m) + '">' + escHtml(t12mStr) + '</span></div>';
  }

  function init() {
    var brandSlug   = window.__DA_BRAND_SLUG__   || '';
    var articleSlug = window.__DA_ARTICLE_SLUG__ || '';

    /* ── Brand logo ── */
    injectBrandLogo(brandSlug);

    /* ── Brand stats (dynamic from DORMIED_DATA) ── */
    populateBrandStats(brandSlug);

    /* ── More on [Brand] ── */
    var moreEl      = document.getElementById('da-more-brand-list');
    var moreSection = document.getElementById('da-more-brand-section');
    if (moreEl && brandSlug) {
      fetchArticles({ 'brand_slug': 'eq.' + brandSlug, 'slug': 'neq.' + articleSlug }, function(rows) {
        var filtered = (rows || []).filter(function(a) { return a.slug !== articleSlug; }).slice(0, 3);
        if (!filtered.length) {
          if (moreSection) moreSection.hidden = true;
          return;
        }
        if (moreSection) moreSection.hidden = false;
        moreEl.innerHTML = filtered.map(renderCard).join('');
      });
    }

    /* ── Latest from DORMIED sidebar (populated by feed.js renderLatestWidget) ── */
    /* feed.js reads window.__DA_ARTICLE_SLUG__ to exclude the current article.  */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
