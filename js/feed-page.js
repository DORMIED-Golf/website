/* ─────────────────────────────────────────────────────────────────────────
   feed-page.js  —  DORMIED News Page (/news/)
   Fetches DORMIED original articles from /api/dormied-articles, renders
   full feed with sort/filter controls and Most Mentioned brands widget.
   Depends on: data.js (window.DORMIED_DATA), feed.js (window.renderFeedPageCard)
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var DORMIED_API      = '/api/dormied-articles?limit=100';
  var TOP_BRANDS_COUNT = 10;
  var AD_EVERY         = 10;   // insert ad every N articles
  var PAGE_SIZE        = 30;

  var state = {
    articles:    [],
    filtered:    [],
    sort:        'newest',
    brandFilter: '',
    searchQuery: '',
    page:        1
  };

  var csBrand = null;   // handle to custom select widget

  /* ── Author derivation (mirrors api/dormied-articles.js) ───────────────── */
  function authorFromCategory(category) {
    var cat = (category || '').toLowerCase();
    if (cat === 'apparel & footwear' || cat === 'bags & accessories') return 'Adam';
    return 'Travis';
  }

  /* ── Custom Select Component ─────────────────────────────────────────────── */
  function buildCustomSelect(selectEl) {
    if (!selectEl) return null;

    function buildPanel() {
      var frag = document.createDocumentFragment();
      for (var i = 0; i < selectEl.children.length; i++) {
        var child = selectEl.children[i];
        if (child.tagName === 'OPTGROUP') {
          var group = document.createElement('div');
          group.className = 'cs-group';
          var lbl = document.createElement('div');
          lbl.className = 'cs-group-label';
          lbl.textContent = child.label;
          group.appendChild(lbl);
          for (var j = 0; j < child.children.length; j++) group.appendChild(makeOption(child.children[j]));
          frag.appendChild(group);
        } else if (child.tagName === 'OPTION') {
          frag.appendChild(makeOption(child));
        }
      }
      return frag;
    }

    function makeOption(opt) {
      var div = document.createElement('div');
      div.className = 'cs-option' + (opt.value === selectEl.value ? ' cs-selected' : '');
      div.dataset.value = opt.value;
      div.textContent   = opt.textContent;
      div.addEventListener('mousedown', function (e) {
        e.preventDefault();
        selectValue(opt.value, opt.textContent);
      });
      return div;
    }

    function selectValue(value, label) {
      selectEl.value = value;
      valueSpan.textContent = label != null ? label : value;
      panel.querySelectorAll('.cs-option').forEach(function (o) {
        o.classList.toggle('cs-selected', o.dataset.value === value);
      });
      close();
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function open() {
      document.querySelectorAll('.cs-wrap.cs-open').forEach(function (w) {
        if (w !== wrap) w.classList.remove('cs-open');
      });
      wrap.classList.add('cs-open');
      trigger.setAttribute('aria-expanded', 'true');
      var rect       = wrap.getBoundingClientRect();
      var spaceBelow = window.innerHeight - rect.bottom - 8;
      var header     = document.querySelector('.site-header');
      var headerH    = header ? header.getBoundingClientRect().bottom : 0;
      var spaceAbove = rect.top - headerH - 8;
      var flipUp     = spaceBelow < 240 && spaceAbove > spaceBelow;
      panel.style.top       = flipUp ? 'auto'              : 'calc(100% + 4px)';
      panel.style.bottom    = flipUp ? 'calc(100% + 4px)' : 'auto';
      panel.style.maxHeight = flipUp ? Math.max(80, spaceAbove) + 'px' : '';
      var sel = panel.querySelector('.cs-selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    function close() {
      wrap.classList.remove('cs-open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    var wrap = document.createElement('div');
    wrap.className = 'cs-wrap';

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    var valueSpan = document.createElement('span');
    valueSpan.className = 'cs-value';
    var initOpt = selectEl.options[selectEl.selectedIndex];
    valueSpan.textContent = initOpt ? initOpt.textContent : '';

    var arrow = document.createElement('span');
    arrow.className = 'cs-arrow';
    arrow.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1.5 3.5l3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    trigger.appendChild(valueSpan);
    trigger.appendChild(arrow);

    var panel = document.createElement('div');
    panel.className = 'cs-dropdown';
    panel.setAttribute('role', 'listbox');
    panel.appendChild(buildPanel());

    wrap.appendChild(trigger);
    wrap.appendChild(panel);

    trigger.addEventListener('click', function () {
      wrap.classList.contains('cs-open') ? close() : open();
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) close();
    }, true);

    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(); }
    });

    selectEl.hidden = true;
    selectEl.parentNode.insertBefore(wrap, selectEl.nextSibling);

    return {
      setValue: function (value) {
        var opt = Array.prototype.find.call(selectEl.options, function (o) { return o.value === value; });
        if (opt) selectValue(value, opt.textContent);
      },
      refresh: function () {
        panel.innerHTML = '';
        panel.appendChild(buildPanel());
        var sel = selectEl.options[selectEl.selectedIndex];
        if (sel) valueSpan.textContent = sel.textContent;
      }
    };
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function getAllBrands() {
    try { return (window.DORMIED_DATA && window.DORMIED_DATA.brands) || []; } catch (e) { return []; }
  }

  function brandName(id, allBrands) {
    for (var i = 0; i < allBrands.length; i++) {
      if (allBrands[i].id === id) return allBrands[i].name;
    }
    return id;
  }

  function brandLogoPath(id, allBrands) {
    for (var i = 0; i < allBrands.length; i++) {
      if (allBrands[i].id === id) return allBrands[i].logo || null;
    }
    return null;
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* ── Compute top N most-mentioned brands ────────────────────────────────── */
  function computeTopBrands(articles) {
    var counts = {};
    articles.forEach(function (a) {
      if (!a.brandIds) return;
      a.brandIds.forEach(function (bid) {
        counts[bid] = (counts[bid] || 0) + 1;
      });
    });
    var allBrands = getAllBrands();
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, TOP_BRANDS_COUNT)
      .map(function (bid) {
        return {
          id:    bid,
          name:  brandName(bid, allBrands),
          logo:  brandLogoPath(bid, allBrands),
          count: counts[bid]
        };
      });
  }

  /* ── Render Most Mentioned widget ───────────────────────────────────────── */
  function renderTopBrandsWidget(topBrands) {
    var el = document.getElementById('top-brands-list');
    if (!el) return;
    if (!topBrands.length) { el.innerHTML = '<p class="latest-feed-loading">No data yet.</p>'; return; }

    el.innerHTML = topBrands.map(function (b) {
      var logoHtml;
      if (b.logo) {
        logoHtml = '<img class="top-brand-logo" src="' + escHtml(b.logo) + '" alt="" ' +
                   'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
                   '<span class="top-brand-initials" style="display:none">' + escHtml((b.name||'').slice(0,2).toUpperCase()) + '</span>';
      } else {
        logoHtml = '<span class="top-brand-initials">' + escHtml((b.name||'').slice(0,2).toUpperCase()) + '</span>';
      }
      return '<a href="/brands/' + escHtml(b.id) + '/" class="top-brand-row" data-brand-id="' + escHtml(b.id) + '">' +
               logoHtml +
               '<span class="top-brand-name">' + escHtml(b.name) + '</span>' +
               '<span class="top-brand-count">' + b.count + '</span>' +
             '</a>';
    }).join('');

    el.querySelectorAll('.top-brand-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        e.preventDefault();
        var bid = this.getAttribute('data-brand-id');
        if (state.brandFilter === bid) {
          state.brandFilter = '';
          if (csBrand) { csBrand.setValue(''); } else {
            var s = document.getElementById('feed-brand-filter');
            if (s) s.value = '';
          }
        } else {
          state.brandFilter = bid;
          if (csBrand) { csBrand.setValue(bid); } else {
            var s = document.getElementById('feed-brand-filter');
            if (s) s.value = bid;
          }
        }
        syncWidgetActive();
        applyAndRender();
      });
    });
  }

  function syncWidgetActive() {
    document.querySelectorAll('.top-brand-row').forEach(function (row) {
      row.classList.toggle('active', row.getAttribute('data-brand-id') === state.brandFilter);
    });
  }

  /* ── Populate brand dropdown + build custom select ──────────────────────── */
  function populateBrandDropdown(allBrands) {
    var sel = document.getElementById('feed-brand-filter');
    if (!sel) return;

    var seen = {};
    state.articles.forEach(function (a) {
      if (a.brandIds) a.brandIds.forEach(function (bid) { seen[bid] = true; });
    });
    var brandList = Object.keys(seen)
      .map(function (bid) { return { id: bid, name: brandName(bid, allBrands) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    var opts = '<option value="">All brands</option>';
    brandList.forEach(function (b) {
      opts += '<option value="' + escHtml(b.id) + '">' + escHtml(b.name) + '</option>';
    });
    sel.innerHTML = opts;

    if (csBrand) {
      csBrand.refresh();
    } else {
      csBrand = buildCustomSelect(sel);
    }
  }

  /* ── In-feed ad slot HTML ────────────────────────────────────────────────── */
  function adSlotHtml() {
    return '<div class="feed-ad-slot" aria-hidden="true">' +
             '<div class="ad-in-table desktop-ad">' +
               '<ins class="adsbygoogle"' +
               ' style="display:inline-block;width:728px;height:90px"' +
               ' data-ad-client="ca-pub-5259693727609263"' +
               ' data-ad-slot="4704685543"></ins>' +
             '</div>' +
             '<div class="ad-in-table mobile-ad">' +
               '<ins class="adsbygoogle"' +
               ' style="display:inline-block;width:300px;height:250px"' +
               ' data-ad-client="ca-pub-5259693727609263"' +
               ' data-ad-slot="8108043234"></ins>' +
             '</div>' +
           '</div>';
  }

  /* ── Render article list ────────────────────────────────────────────────── */
  function renderFeedList(articles) {
    var el = document.getElementById('feed-list');
    if (!el) return;

    if (!articles.length) {
      el.innerHTML = '<p class="feed-empty">No articles found. Try clearing the filter.</p>';
      return;
    }

    var allBrands = getAllBrands();
    var renderer  = window.renderFeedPageCard || function (a) {
      return '<article class="feed-card feed-card--dormied"><div class="feed-card-body">' +
             '<a href="' + escHtml(a.url) + '" class="feed-card-title">' + escHtml(a.title) + '</a>' +
             '</div></article>';
    };

    var html = '';
    articles.forEach(function (a, i) {
      if (i > 0 && i % AD_EVERY === 0) html += adSlotHtml();
      html += renderer(a, allBrands);
    });
    el.innerHTML = html;

    // Push in-feed ads after DOM insertion
    el.querySelectorAll('.adsbygoogle').forEach(function () {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  }

  /* ── Render pagination controls ─────────────────────────────────────────── */
  function renderPagination() {
    var el = document.getElementById('feed-pagination');
    if (!el) return;
    var total = state.filtered.length;
    var pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) { el.innerHTML = ''; return; }

    var html = '';
    if (state.page > 1) {
      html += '<button class="feed-page-btn" data-page="' + (state.page - 1) + '">\u2190 Prev</button>';
    }
    var start = Math.max(1, state.page - 2);
    var end   = Math.min(pages, state.page + 2);
    for (var p = start; p <= end; p++) {
      var active = p === state.page ? ' feed-page-btn--active' : '';
      html += '<button class="feed-page-btn' + active + '" data-page="' + p + '">' + p + '</button>';
    }
    if (state.page < pages) {
      html += '<button class="feed-page-btn" data-page="' + (state.page + 1) + '">Next \u2192</button>';
    }
    el.innerHTML = html;

    el.querySelectorAll('.feed-page-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.page = parseInt(this.dataset.page, 10);
        var from = (state.page - 1) * PAGE_SIZE + 1;
        var to   = Math.min(state.page * PAGE_SIZE, state.filtered.length);
        var countEl = document.getElementById('feed-count');
        if (countEl && state.filtered.length > PAGE_SIZE) {
          countEl.textContent = 'Showing ' + from + '\u2013' + to + ' of ' + state.filtered.length + ' articles';
        }
        renderFeedList(state.filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE));
        renderPagination();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  /* ── Apply filters + sort, then render ──────────────────────────────────── */
  function applyAndRender() {
    var filtered = state.articles.filter(function (a) {
      return a.brandIds && a.brandIds.length > 0;
    });

    if (state.brandFilter) {
      filtered = filtered.filter(function (a) {
        return a.brandIds && a.brandIds.indexOf(state.brandFilter) !== -1;
      });
    }

    if (state.searchQuery) {
      var q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(function (a) {
        return (a.title       || '').toLowerCase().indexOf(q) !== -1
            || (a.description || '').toLowerCase().indexOf(q) !== -1
            || (a.author      || '').toLowerCase().indexOf(q) !== -1;
      });
    }

    if (state.sort === 'oldest') {
      filtered = filtered.slice().sort(function (a, b) {
        return new Date(a.pubDate || 0) - new Date(b.pubDate || 0);
      });
    }
    /* newest is already sorted by the API */

    state.filtered = filtered;
    state.page = 1;

    var countEl = document.getElementById('feed-count');
    if (countEl) {
      var total = filtered.length;
      if (total === 0) {
        countEl.textContent = '0 articles';
      } else if (total <= PAGE_SIZE) {
        countEl.textContent = total + ' article' + (total !== 1 ? 's' : '');
      } else {
        countEl.textContent = 'Showing 1\u2013' + PAGE_SIZE + ' of ' + total + ' articles';
      }
    }

    renderFeedList(filtered.slice(0, PAGE_SIZE));
    renderPagination();
  }

  /* ── Wire up controls ───────────────────────────────────────────────────── */
  function bindControls() {
    /* Sort buttons */
    document.querySelectorAll('.feed-sort-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.feed-sort-btn').forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        this.classList.add('active');
        this.setAttribute('aria-pressed', 'true');
        state.sort = this.getAttribute('data-sort');
        applyAndRender();
      });
    });

    /* Brand dropdown */
    var sel = document.getElementById('feed-brand-filter');
    if (sel) {
      sel.addEventListener('change', function () {
        state.brandFilter = this.value;
        syncWidgetActive();
        applyAndRender();
        if (window.DORMIED_TRACK && state.brandFilter) {
          var selOpt = sel.options[sel.selectedIndex];
          window.DORMIED_TRACK('news_brand_filter', { brand: selOpt ? selOpt.text : state.brandFilter });
        }
      });
    }

    /* Search input */
    var srch = document.getElementById('feed-search');
    if (srch) {
      var searchTimer;
      function onSearchChange() {
        clearTimeout(searchTimer);
        var val = srch.value;
        searchTimer = setTimeout(function () {
          var q = val.trim();
          if (q === state.searchQuery) return;
          state.searchQuery = q;
          applyAndRender();
        }, 200);
      }
      srch.addEventListener('input', onSearchChange);
      srch.addEventListener('keyup', onSearchChange);
    }

    /* Clear button */
    var clr = document.getElementById('feed-clear');
    if (clr) {
      clr.addEventListener('click', function () {
        state.brandFilter = '';
        state.searchQuery = '';
        state.sort        = 'newest';
        var srch = document.getElementById('feed-search');
        if (srch) srch.value = '';
        if (csBrand) { csBrand.setValue(''); } else {
          var s = document.getElementById('feed-brand-filter');
          if (s) s.value = '';
        }
        document.querySelectorAll('.feed-sort-btn').forEach(function (b) {
          var isNewest = b.getAttribute('data-sort') === 'newest';
          b.classList.toggle('active', isNewest);
          b.setAttribute('aria-pressed', isNewest ? 'true' : 'false');
        });
        syncWidgetActive();
        applyAndRender();
      });
    }
  }

  /* ── Boot ───────────────────────────────────────────────────────────────── */
  function init() {
    if (!document.getElementById('feed-list')) return;

    bindControls();

    var el = document.getElementById('feed-list');
    if (el) el.innerHTML = '<p class="feed-empty">Loading articles\u2026</p>';

    fetch(DORMIED_API)
      .then(function (r) { return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
      .then(function (data) {
        var raw = (data && data.articles) || [];

        // Ensure author is populated
        state.articles = raw.map(function (a) {
          return Object.assign({}, a, {
            author: a.author || authorFromCategory(a.category)
          });
        });

        var allBrands = getAllBrands();
        var top       = computeTopBrands(state.articles);
        renderTopBrandsWidget(top);
        populateBrandDropdown(allBrands);
        applyAndRender();
      })
      .catch(function (err) {
        console.warn('[feed-page.js] Could not load articles:', err);
        var el = document.getElementById('feed-list');
        if (el) el.innerHTML = '<p class="feed-empty">Could not load articles. Please try again later.</p>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
