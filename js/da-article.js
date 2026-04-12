/* ─────────────────────────────────────────────────────────────────────────
   da-article.js  —  DORMIED Article Page Enhancements
   Populates "More on [Brand]" and "Latest from DORMIED" bottom sections,
   and injects the brand logo into the brand card.
   Depends on: window.__DA_BRAND_SLUG__ and window.__DA_ARTICLE_SLUG__
   set inline by the article page template.
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
      ? '<img class="feed-card-thumb" src="' + escHtml(a.image_url) + '" loading="lazy" alt="" onerror="this.remove()">'
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
          '<span class="feed-source feed-source--dormied">DORMIED</span>' +
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

  function init() {
    var brandSlug   = window.__DA_BRAND_SLUG__   || '';
    var articleSlug = window.__DA_ARTICLE_SLUG__ || '';

    /* ── Brand logo ── */
    injectBrandLogo(brandSlug);

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

    /* ── Latest from DORMIED ── */
    var latestEl      = document.getElementById('da-latest-dormied-list');
    var latestSection = document.getElementById('da-latest-dormied-section');
    if (latestEl) {
      fetchArticles({ 'brand_slug': 'neq.' + brandSlug }, function(rows) {
        var latest = (rows || []).filter(function(a) { return a.slug !== articleSlug; }).slice(0, 3);
        if (!latest.length) {
          if (latestSection) latestSection.hidden = true;
          return;
        }
        if (latestSection) latestSection.hidden = false;
        latestEl.innerHTML = latest.map(renderCard).join('');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
