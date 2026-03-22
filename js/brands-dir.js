/* ─────────────────────────────────────────────────────────────────────────
   brands-dir.js  —  DORMIED Brand Directory Page
   Renders the /brands/ grid: 122 brand cards with logo, name, rank, DI.
   Filterable by search query and category. Ads every 24 cards.
   Depends on: data.js (window.DORMIED_DATA)
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var AD_EVERY = 24;   // insert ad every N brand cards

  /* ── shiftMonth: "Feb 2026", -3 → "Nov 2025" ───────────────────────────── */
  var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function shiftMonth(label, delta) {
    var parts = label.split(' ');
    var total = MONTH_NAMES.indexOf(parts[0]) + parseInt(parts[1], 10) * 12 + delta;
    return MONTH_NAMES[((total % 12) + 12) % 12] + ' ' + Math.floor(total / 12);
  }

  var state = {
    query:    '',
    category: '',
    brands:   [],
    filtered: []
  };

  var csCat = null;   // handle to custom select widget for the category filter

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

  /* ── Compute DI rankings from DORMIED_DATA ──────────────────────────────── */
  /* Tiebreaker mirrors app.js calculateRankings(): prev-month rank → ago3 rank */
  function computeRankings() {
    var data = window.DORMIED_DATA;
    if (!data || !data.brands || !data.meta) return [];

    var curMonth  = data.meta.currentMonth;
    var prevMonth = data.meta.previousMonth;
    var ago3Month = shiftMonth(curMonth, -3);
    var brands    = data.brands;

    /* Score each brand with cur / prev / ago3 values */
    var scored = brands.map(function(b) {
      var g    = b.searchesByMarket && b.searchesByMarket.global;
      var cur  = (g && g[curMonth])  || 0;
      var prev = (g && g[prevMonth]) || 0;
      var ago3 = (g && g[ago3Month]) || 0;
      return { brand: b, cur: cur, prev: prev, ago3: ago3 };
    });

    /* Find max for normalisation */
    var max = 0;
    scored.forEach(function(s) { if (s.cur > s.cur) max = s.cur; if (s.cur > max) max = s.cur; });
    if (!max) max = 1;

    /* Build prev-month rank map for tiebreaking */
    var prevSorted = scored.slice().sort(function(a, b) {
      var d = b.prev - a.prev;
      if (Math.abs(d) > 0.0001) return d;
      return b.ago3 - a.ago3;
    });
    var prevRankMap = {};
    prevSorted.forEach(function(s, i) { prevRankMap[s.brand.id] = i + 1; });

    /* Build ago3 rank map for second tiebreak */
    var ago3Sorted = scored.slice().sort(function(a, b) { return b.ago3 - a.ago3; });
    var ago3RankMap = {};
    ago3Sorted.forEach(function(s, i) { ago3RankMap[s.brand.id] = i + 1; });

    /* Sort: cur desc → prevRank asc → ago3Rank asc */
    scored.sort(function(a, b) {
      var d = b.cur - a.cur;
      if (Math.abs(d) > 0.0001) return d;
      var pd = (prevRankMap[a.brand.id] || 9999) - (prevRankMap[b.brand.id] || 9999);
      if (pd !== 0) return pd;
      return (ago3RankMap[a.brand.id] || 9999) - (ago3RankMap[b.brand.id] || 9999);
    });

    /* Assign rank and normalise DI (1 decimal, matching app.js) */
    return scored.map(function(item, i) {
      return {
        id:       item.brand.id,
        name:     item.brand.name,
        logo:     item.brand.logo || null,
        category: item.brand.category || '',
        hq:       item.brand.hq || '',
        rank:     i + 1,
        di:       parseFloat((item.cur / max * 100).toFixed(1))
      };
    });
  }

  /* ── Populate category dropdown + build custom select ───────────────────── */
  function populateCatFilter(brands) {
    var sel = document.getElementById('brands-cat-filter');
    if (!sel) return;
    var cats = {};
    brands.forEach(function(b) { if (b.category) cats[b.category] = true; });
    var sorted = Object.keys(cats).sort();
    var opts = '<option value="">All categories</option>';
    sorted.forEach(function(c) {
      opts += '<option value="' + escHtml(c) + '">' + escHtml(c) + '</option>';
    });
    sel.innerHTML = opts;

    /* Build (or rebuild) the custom dropdown widget */
    if (csCat) {
      csCat.refresh();
    } else {
      csCat = buildCustomSelect(sel);
    }
  }

  /* ── Ad slot HTML ───────────────────────────────────────────────────────── */
  function adSlotHtml() {
    return '<div class="brands-ad-row" aria-hidden="true">' +
             '<div class="ad-in-table desktop-ad">' +
               '<div class="ad-placeholder" data-ad-size="728x90">' +
                 '<span class="ad-label">Advertisement — 728×90</span>' +
               '</div>' +
             '</div>' +
             '<div class="ad-in-table mobile-ad">' +
               '<div class="ad-placeholder" data-ad-size="300x250">' +
                 '<span class="ad-label">Advertisement — 300×250</span>' +
               '</div>' +
             '</div>' +
           '</div>';
  }

  /* ── Render a single brand card ─────────────────────────────────────────── */
  function brandCardHtml(b) {
    var initials = (b.name || '').slice(0, 2).toUpperCase();
    var logoHtml;
    if (b.logo) {
      logoHtml = '<div class="brand-dir-logo-wrap">' +
                   '<img class="brand-dir-logo" src="' + escHtml(b.logo) + '" alt="" ' +
                   'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
                   '<span class="brand-dir-initials" style="display:none">' + escHtml(initials) + '</span>' +
                 '</div>';
    } else {
      logoHtml = '<div class="brand-dir-logo-wrap">' +
                   '<span class="brand-dir-initials">' + escHtml(initials) + '</span>' +
                 '</div>';
    }

    var di    = b.di > 0 ? b.di.toFixed(1) : '—';
    var rank  = '#' + b.rank;

    return '<a href="/brands/' + escHtml(b.id) + '/" class="brand-dir-card">' +
             logoHtml +
             '<div class="brand-dir-name">' + escHtml(b.name) + '</div>' +
             '<div class="brand-dir-cat">'  + escHtml(b.category) + '</div>' +
             '<div class="brand-dir-stats">' +
               '<span class="brand-dir-rank">' + escHtml(rank) + '</span>' +
               '<span class="brand-dir-di">DI&nbsp;' + escHtml(String(di)) + '</span>' +
             '</div>' +
           '</a>';
  }

  /* ── Render grid ────────────────────────────────────────────────────────── */
  function renderGrid(brands) {
    var el = document.getElementById('brands-grid');
    if (!el) return;

    if (!brands.length) {
      el.innerHTML = '<p class="feed-empty" style="grid-column:1/-1">No brands match your search.</p>';
      return;
    }

    var html = '';
    brands.forEach(function(b, i) {
      if (i > 0 && i % AD_EVERY === 0) html += adSlotHtml();
      html += brandCardHtml(b);
    });
    el.innerHTML = html;
  }

  /* ── Apply filters + render ─────────────────────────────────────────────── */
  function applyAndRender() {
    var q   = state.query.toLowerCase().trim();
    var cat = state.category;

    var filtered = state.brands.filter(function(b) {
      if (q && b.name.toLowerCase().indexOf(q) === -1) return false;
      if (cat && b.category !== cat) return false;
      return true;
    });

    state.filtered = filtered;

    var countEl = document.getElementById('brands-count');
    if (countEl) countEl.textContent = filtered.length + ' of ' + state.brands.length + ' brands';

    var totalEl = document.getElementById('brands-total');
    if (totalEl) totalEl.textContent = state.brands.length;

    renderGrid(filtered);
  }

  /* ── Wire up controls ───────────────────────────────────────────────────── */
  function bindControls() {
    var searchEl = document.getElementById('brands-search');
    if (searchEl) {
      searchEl.addEventListener('input', function() {
        state.query = this.value;
        applyAndRender();
      });
    }

    var catEl = document.getElementById('brands-cat-filter');
    if (catEl) {
      catEl.addEventListener('change', function() {
        state.category = this.value;
        applyAndRender();
      });
    }

    var clrEl = document.getElementById('brands-clear');
    if (clrEl) {
      clrEl.addEventListener('click', function() {
        state.query    = '';
        state.category = '';
        var searchEl = document.getElementById('brands-search');
        if (searchEl) searchEl.value = '';
        if (csCat) { csCat.setValue(''); } else {
          var catEl = document.getElementById('brands-cat-filter');
          if (catEl) catEl.value = '';
        }
        applyAndRender();
      });
    }
  }

  /* ── Boot ───────────────────────────────────────────────────────────────── */
  function init() {
    if (!document.getElementById('brands-grid')) return;

    bindControls();

    state.brands = computeRankings();

    if (!state.brands.length) {
      var el = document.getElementById('brands-grid');
      if (el) el.innerHTML = '<p class="feed-empty" style="grid-column:1/-1">Brand data unavailable.</p>';
      return;
    }

    populateCatFilter(state.brands);
    applyAndRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
