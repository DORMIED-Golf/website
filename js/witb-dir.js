/* ─────────────────────────────────────────────────────────────────────────
   witb-dir.js  --  DORMIED WITB Player Directory
   Filters /witb/players/ grid by name search, club type, and brand.
   Data is pre-rendered in the DOM; this script shows/hides cards.
   Depends on: window.WITB_DIR_DATA.brandNames (injected by generator)
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var state = {
    query:     '',
    clubType:  '',
    brand:     ''
  };

  var csType  = null;
  var csBrand = null;

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* ── Custom Select (copied from brands-dir.js) ──────────────────────────── */
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

  /* ── Parse data-bag JSON safely ─────────────────────────────────────────── */
  function parseBag(card) {
    try { return JSON.parse(card.getAttribute('data-bag') || '{}'); }
    catch (e) { return {}; }
  }

  /* ── Populate brand dropdown based on selected club type ────────────────── */
  function refreshBrandDropdown() {
    var brandSel = document.getElementById('players-brand-filter');
    if (!brandSel) return;

    var brandNames = (window.WITB_DIR_DATA && window.WITB_DIR_DATA.brandNames) || {};
    var type       = state.clubType;

    // Collect all brands visible under the current type filter
    var seen    = {};
    var cards   = document.querySelectorAll('#players-grid .player-dir-card');
    cards.forEach(function (card) {
      var bag = parseBag(card);
      if (type) {
        var slugs = bag[type] || [];
        slugs.forEach(function (s) { seen[s] = true; });
      } else {
        Object.keys(bag).forEach(function (cat) {
          (bag[cat] || []).forEach(function (s) { seen[s] = true; });
        });
      }
    });

    var sorted = Object.keys(seen).sort(function (a, b) {
      var na = brandNames[a] || a;
      var nb = brandNames[b] || b;
      return na < nb ? -1 : na > nb ? 1 : 0;
    });

    var prevVal = brandSel.value;
    var html = '<option value="">All brands</option>';
    sorted.forEach(function (slug) {
      var name = brandNames[slug] || slug;
      var sel  = slug === prevVal ? ' selected' : '';
      html += '<option value="' + escHtml(slug) + '"' + sel + '>' + escHtml(name) + '</option>';
    });
    brandSel.innerHTML = html;

    // If previously selected brand no longer in list, reset
    if (prevVal && brandSel.value !== prevVal) {
      state.brand = '';
      brandSel.value = '';
    }

    if (csBrand) csBrand.refresh();
  }

  /* ── Apply filters and update counts ────────────────────────────────────── */
  function applyAndRender() {
    var q      = state.query.toLowerCase().trim();
    var type   = state.clubType;
    var brand  = state.brand;

    var el = document.getElementById('players-grid');
    if (!el) return;

    var cards   = el.querySelectorAll('.player-dir-card');
    var visible = 0;
    var total   = cards.length;

    cards.forEach(function (card) {
      var show = true;

      // Name search
      if (q) {
        var name = (card.getAttribute('data-name') || '').toLowerCase();
        if (name.indexOf(q) === -1) show = false;
      }

      if (show) {
        var bag = parseBag(card);

        // Club type filter
        if (type && !bag[type]) show = false;

        // Brand filter
        if (show && brand) {
          if (type) {
            var inType = bag[type] || [];
            if (inType.indexOf(brand) === -1) show = false;
          } else {
            // Check across all types
            var found = false;
            var cats  = Object.keys(bag);
            for (var i = 0; i < cats.length; i++) {
              if ((bag[cats[i]] || []).indexOf(brand) !== -1) { found = true; break; }
            }
            if (!found) show = false;
          }
        }
      }

      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });

    var countEl = document.getElementById('players-count');
    if (countEl) {
      countEl.textContent = (q || type || brand)
        ? visible + ' of ' + total + ' players'
        : total + ' of ' + total + ' players';
    }
  }

  /* ── Wire up controls ───────────────────────────────────────────────────── */
  function bindControls() {
    var searchEl = document.getElementById('players-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        state.query = this.value;
        applyAndRender();
      });
    }

    var typeEl = document.getElementById('players-type-filter');
    if (typeEl) {
      typeEl.addEventListener('change', function () {
        state.clubType = this.value;
        // Reset brand when type changes, then repopulate
        state.brand = '';
        refreshBrandDropdown();
        applyAndRender();
      });
      csType = buildCustomSelect(typeEl);
    }

    var brandEl = document.getElementById('players-brand-filter');
    if (brandEl) {
      brandEl.addEventListener('change', function () {
        state.brand = this.value;
        applyAndRender();
      });
      csBrand = buildCustomSelect(brandEl);
    }

    var clrEl = document.getElementById('players-clear');
    if (clrEl) {
      clrEl.addEventListener('click', function () {
        state.query    = '';
        state.clubType = '';
        state.brand    = '';
        var se = document.getElementById('players-search');
        if (se) se.value = '';
        if (csType)  csType.setValue('');
        if (csBrand) csBrand.setValue('');
        refreshBrandDropdown();
        applyAndRender();
      });
    }
  }

  /* ── Boot ───────────────────────────────────────────────────────────────── */
  function init() {
    if (!document.getElementById('players-grid')) return;
    bindControls();
    refreshBrandDropdown();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
