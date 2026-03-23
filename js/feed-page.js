/* ─────────────────────────────────────────────────────────────────────────
   feed-page.js  —  DORMIED Feed Page
   Handles the /feed/ page: fetches articles, renders full feed with
   sort/filter controls and Most Mentioned brands widget.
   Depends on: data.js (window.DORMIED_DATA), feed.js (window.renderFeedPageCard)
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var FEED_API  = '/api/feed';
  var CACHE_KEY = 'dormied_feed_v3';          // shared cache key with feed.js
  var CACHE_TTL = 30 * 60 * 1000;             // 30 minutes
  var TOP_BRANDS_COUNT = 10;
  var AD_EVERY = 10;                          // insert ad every N articles

  var PAGE_SIZE = 30;

  var state = {
    articles:    [],
    filtered:    [],
    sort:        'newest',
    brandFilter: '',
    searchQuery: '',
    page:        1
  };

  var csBrand = null;   // handle to custom select widget for the brand filter

  /* ── Custom Select Component (mirrors app.js buildCustomSelect) ─────────── */
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

  /* ── Local dev detection ────────────────────────────────────────────────── */
  function isLocalDev() {
    var h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || window.location.protocol === 'file:';
  }

  /* ── Mock data for local preview ────────────────────────────────────────── */
  var MOCK_ARTICLES = [
    { id:'m1', title:'TaylorMade Qi35 Irons: The Most Forgiving Clubs We\'ve Ever Tested', url:'#', sourceName:'MyGolfSpy', pubDate: new Date(Date.now()-2*3600000).toISOString(), description:'We put the new Qi35 irons through a full robot and player testing protocol. The numbers are impressive across every handicap bracket we tested.', imageUrl:'https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&q=80', brandIds:['taylormade'] },
    { id:'m2', title:'Titleist Pro V1 vs Pro V1x: Which Ball Is Right for Your Game in 2026?', url:'#', sourceName:'Golf Digest', pubDate: new Date(Date.now()-5*3600000).toISOString(), description:'Both balls have been updated for 2026. Here\'s how to decide which one belongs in your bag based on your swing speed, spin preferences and playing style.', imageUrl:'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&q=80', brandIds:['titleist'] },
    { id:'m3', title:'Callaway Paradym Ai Smoke vs PING G440: Head-to-Head Driver Test', url:'#', sourceName:'GolfWRX', pubDate: new Date(Date.now()-22*3600000).toISOString(), description:'Two of the best performing drivers on tour go head to head on a launch monitor. We compared ball speed, spin rate, forgiveness and sound at impact.', imageUrl:null, brandIds:['callaway','ping'] },
    { id:'m4', title:'The Masters 2026: Every Brand Worn by the Top 10 Finishers', url:'#', sourceName:'Golf.com', pubDate: new Date(Date.now()-2*86400000).toISOString(), description:'Augusta always delivers a brand showcase. We tracked every club, ball, glove, and shoe worn by the top finishers across all four rounds.', imageUrl:'https://images.unsplash.com/photo-1510674671809-8d72abc8b01e?w=400&q=80', brandIds:['taylormade','titleist','footjoy','under-armour-golf'] },
    { id:'m5', title:'Scotty Cameron Special Select vs Bettinardi QB6: Premium Putter Shootout', url:'#', sourceName:'Plugged In Golf', pubDate: new Date(Date.now()-3*86400000).toISOString(), description:'Two of the most sought-after putters on the market. Which one rolls it better? We took both to the putting green for an extended comparison test.', imageUrl:null, brandIds:['scotty-cameron','bettinardi'] },
    { id:'m6', title:'PING G440 Max Driver Review: More Distance, Less Drama', url:'#', sourceName:'MyGolfSpy', pubDate: new Date(Date.now()-4*86400000).toISOString(), description:'PING continues to refine the G series. The G440 Max delivers consistent distance with a forgiving profile that suits a wide range of swing types.', imageUrl:'https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&q=80', brandIds:['ping'] },
    { id:'m7', title:'Footjoy HyperFlex Carbon Review: The Most Responsive Golf Shoe Yet?', url:'#', sourceName:'Golf Monthly', pubDate: new Date(Date.now()-5*86400000).toISOString(), description:'FootJoy\'s flagship performance shoe gets a carbon fibre plate for 2026. We tested it across 10 rounds in wet and dry conditions.', imageUrl:null, brandIds:['footjoy'] },
    { id:'m8', title:'Callaway Chrome Soft X vs Pro V1: Which Ball Should You Game?', url:'#', sourceName:'Golf Digest', pubDate: new Date(Date.now()-6*86400000).toISOString(), description:'The eternal battle between two of the most popular tour balls. New data from our robot testing lab reveals some surprising results.', imageUrl:'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&q=80', brandIds:['callaway','titleist'] },
    { id:'m9', title:'Cobra AEROJET LS Driver: Distance Without the Penalties', url:'#', sourceName:'GolfWRX', pubDate: new Date(Date.now()-7*86400000).toISOString(), description:'Cobra\'s low-spin iteration of the AEROJET family promises distance for faster swingers without sacrificing too much forgiveness.', imageUrl:null, brandIds:['cobra'] },
    { id:'m10', title:'Mizuno JPX925 Hot Metal Pro Irons: The Workhorses Return', url:'#', sourceName:'Bunkered', pubDate: new Date(Date.now()-8*86400000).toISOString(), description:'Mizuno\'s evergreen player\'s distance iron gets a refresh for 2026. Better feel, more stability — and still the same trusted Mizuno forge quality.', imageUrl:'https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&q=80', brandIds:['mizuno'] },
    { id:'m11', title:'TaylorMade Stealth 2 vs Qi35: Which Driver Is Right for You?', url:'#', sourceName:'Golf.com', pubDate: new Date(Date.now()-9*86400000).toISOString(), description:'TaylorMade has two very different drivers on shelves this year. We break down who each one is designed for.', imageUrl:null, brandIds:['taylormade'] },
    { id:'m12', title:'Srixon ZX5 Mk2 Irons: Tour Validated, Amateur Friendly', url:'#', sourceName:'Today\'s Golfer', pubDate: new Date(Date.now()-10*86400000).toISOString(), description:'Srixon\'s mid-handicapper iron blends compact shaping with forgiving technology. Players who prioritise look and feel will love these.', imageUrl:'https://images.unsplash.com/photo-1510674671809-8d72abc8b01e?w=400&q=80', brandIds:['srixon'] }
  ];

  /* ── Cache helpers (shared key with feed.js) ────────────────────────────── */
  function getCached() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (Date.now() - obj.timestamp > CACHE_TTL) return null;
      return obj.data;
    } catch (e) { return null; }
  }

  function setCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: data }));
    } catch (e) {}
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function getAllBrands() {
    try { return (window.DORMIED_DATA && window.DORMIED_DATA.brands) || []; } catch(e) { return []; }
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

  /* ── Compute top 10 most-mentioned brands ───────────────────────────────── */
  function computeTopBrands(articles) {
    var counts = {};
    articles.forEach(function(a) {
      if (!a.brandIds) return;
      a.brandIds.forEach(function(bid) {
        counts[bid] = (counts[bid] || 0) + 1;
      });
    });
    var allBrands = getAllBrands();
    return Object.keys(counts)
      .sort(function(a, b) { return counts[b] - counts[a]; })
      .slice(0, TOP_BRANDS_COUNT)
      .map(function(bid) {
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

    el.innerHTML = topBrands.map(function(b) {
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

    /* Click on widget row → set filter */
    el.querySelectorAll('.top-brand-row').forEach(function(row) {
      row.addEventListener('click', function(e) {
        e.preventDefault();
        var bid = this.getAttribute('data-brand-id');
        if (state.brandFilter === bid) {
          /* toggle off */
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
    document.querySelectorAll('.top-brand-row').forEach(function(row) {
      row.classList.toggle('active', row.getAttribute('data-brand-id') === state.brandFilter);
    });
  }

  /* ── Populate brand dropdown + build custom select ─────────────────────── */
  function populateBrandDropdown(topBrands, allBrands) {
    var sel = document.getElementById('feed-brand-filter');
    if (!sel) return;
    /* Collect all brand IDs that appear in any article */
    var seen = {};
    state.articles.forEach(function(a) {
      if (a.brandIds) a.brandIds.forEach(function(bid) { seen[bid] = true; });
    });
    var brandList = Object.keys(seen)
      .map(function(bid) { return { id: bid, name: brandName(bid, allBrands) }; })
      .sort(function(a, b) { return a.name.localeCompare(b.name); });

    var opts = '<option value="">All brands</option>';
    brandList.forEach(function(b) {
      opts += '<option value="' + escHtml(b.id) + '">' + escHtml(b.name) + '</option>';
    });
    sel.innerHTML = opts;

    /* Build (or rebuild) the custom dropdown widget */
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
    var renderer  = window.renderFeedPageCard || function(a) {
      return '<article class="feed-card"><div class="feed-card-body"><a href="' + escHtml(a.url) +
             '" class="feed-card-title" data-track-title="' + escHtml(a.title) + '" data-track-source="' + escHtml(a.sourceName || '') + '">' + escHtml(a.title) + '</a></div></article>';
    };

    var html = '';
    articles.forEach(function(a, i) {
      if (i > 0 && i % AD_EVERY === 0) html += adSlotHtml();
      html += renderer(a, allBrands);
    });
    el.innerHTML = html;

    // Push in-feed ads after DOM insertion
    el.querySelectorAll('.adsbygoogle').forEach(function() {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  }

  /* ── Render pagination controls ────────────────────────────────────────── */
  function renderPagination() {
    var el = document.getElementById('feed-pagination');
    if (!el) return;
    var total = state.filtered.length;
    var pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) { el.innerHTML = ''; return; }

    var html = '';
    if (state.page > 1) {
      html += '<button class="feed-page-btn" data-page="' + (state.page - 1) + '">← Prev</button>';
    }
    // Show up to 5 page buttons around current page
    var start = Math.max(1, state.page - 2);
    var end   = Math.min(pages, state.page + 2);
    for (var p = start; p <= end; p++) {
      var active = p === state.page ? ' feed-page-btn--active' : '';
      html += '<button class="feed-page-btn' + active + '" data-page="' + p + '">' + p + '</button>';
    }
    if (state.page < pages) {
      html += '<button class="feed-page-btn" data-page="' + (state.page + 1) + '">Next →</button>';
    }
    el.innerHTML = html;

    el.querySelectorAll('.feed-page-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.page = parseInt(this.dataset.page, 10);
        renderFeedList(state.filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE));
        renderPagination();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  /* ── Apply filters + sort, then render ─────────────────────────────────── */
  function applyAndRender() {
    // Always filter to brand-tagged articles only
    var filtered = state.articles.filter(function(a) {
      return a.brandIds && a.brandIds.length > 0;
    });

    if (state.brandFilter) {
      filtered = filtered.filter(function(a) {
        return a.brandIds && a.brandIds.indexOf(state.brandFilter) !== -1;
      });
    }

    if (state.searchQuery) {
      var q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(function(a) {
        return (a.title       || '').toLowerCase().includes(q)
            || (a.description || '').toLowerCase().includes(q)
            || (a.sourceName  || '').toLowerCase().includes(q);
      });
    }

    if (state.sort === 'oldest') {
      filtered = filtered.slice().sort(function(a, b) {
        return new Date(a.pubDate || 0) - new Date(b.pubDate || 0);
      });
    }
    /* newest is already sorted by the API */

    state.filtered = filtered;
    state.page = 1;  // reset to first page on any filter/sort change

    var countEl = document.getElementById('feed-count');
    if (countEl) countEl.textContent = filtered.length + ' article' + (filtered.length !== 1 ? 's' : '');

    renderFeedList(filtered.slice(0, PAGE_SIZE));
    renderPagination();
  }

  /* ── Wire up controls ───────────────────────────────────────────────────── */
  function bindControls() {
    /* Sort buttons */
    document.querySelectorAll('.feed-sort-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.feed-sort-btn').forEach(function(b) {
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
      sel.addEventListener('change', function() {
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
        searchTimer = setTimeout(function() {
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
      clr.addEventListener('click', function() {
        state.brandFilter = '';
        state.searchQuery = '';
        state.sort        = 'newest';
        var srch = document.getElementById('feed-search');
        if (srch) srch.value = '';
        if (csBrand) { csBrand.setValue(''); } else {
          var sel = document.getElementById('feed-brand-filter');
          if (sel) sel.value = '';
        }
        document.querySelectorAll('.feed-sort-btn').forEach(function(b) {
          b.classList.toggle('active', b.getAttribute('data-sort') === 'newest');
          b.setAttribute('aria-pressed', b.getAttribute('data-sort') === 'newest' ? 'true' : 'false');
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

    if (isLocalDev()) {
      state.articles = MOCK_ARTICLES;
      var allBrands  = getAllBrands();
      var top        = computeTopBrands(state.articles);
      renderTopBrandsWidget(top);
      populateBrandDropdown(top, allBrands);
      applyAndRender();
      return;
    }

    /* Show loading state */
    var el = document.getElementById('feed-list');
    if (el) el.innerHTML = '<p class="feed-empty">Loading articles…</p>';

    /* Try cache first */
    var cached = getCached();
    if (cached) {
      state.articles = (cached.articles || []);
      var allBrands  = getAllBrands();
      var top        = computeTopBrands(state.articles);
      renderTopBrandsWidget(top);
      populateBrandDropdown(top, allBrands);
      applyAndRender();
      return;
    }

    fetch(FEED_API)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        setCache(data);
        state.articles = (data.articles || []);
        var allBrands  = getAllBrands();
        var top        = computeTopBrands(state.articles);
        renderTopBrandsWidget(top);
        populateBrandDropdown(top, allBrands);
        applyAndRender();
      })
      .catch(function(err) {
        console.warn('[feed-page.js] Could not load feed:', err);
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
