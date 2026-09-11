/* ─────────────────────────────────────────────────────────────────────────
   ticker.js  —  DORMIED homepage market ticker

   The tape is prerendered for Global by scripts/generate-ticker-data.js, so
   this file's job is only: resolve the visitor's market, re-render if it is
   not Global, and run the picker / rail interactions.

   The render functions below MUST produce the same DOM as the same-named
   functions in scripts/generate-ticker-data.js. (The same DOM, not the same
   string: a browser reserialises <path/> as <path></path> and re-escapes
   attribute values, so the two will never match byte for byte once one has been
   through the parser. Verified equal node-for-node, attributes and text
   included, apart from the arrows' runtime disabled state.) If they drift, the
   prerendered and hydrated tapes stop being interchangeable.

   Depends only on window.DORMIED_TICKER (js/ticker-data.js).
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var DATA = window.DORMIED_TICKER;
  var root = document.getElementById('dt-tape');
  if (!DATA || !DATA.markets || !root) return;

  var KEY_MARKET = 'dormied.market';   // an explicit pick, which always wins
  var KEY_GEO    = 'dormied.geo';      // cached IP country, so we ask once
  var GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var RAIL_STEP  = 440;

  /** ISO country → market key. Anything unlisted falls back to Global. */
  var COUNTRY_TO_MARKET = {
    US: 'us', CA: 'ca', GB: 'uk', JP: 'jp', KR: 'kr',
    AU: 'au', CN: 'cn', DE: 'de', FR: 'fr', SE: 'se'
  };

  var state = { market: 'global', open: false };

  /* ── Storage helpers — private browsing throws on access, not just on write ─ */
  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* no-op */ }
  }

  function findMarket(key) {
    for (var i = 0; i < DATA.markets.length; i++) {
      if (DATA.markets[i].key === key) return DATA.markets[i];
    }
    return null;
  }

  /* ── Formatting — mirrors scripts/generate-ticker-data.js ─────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function sparkline(series, w, h, stroke, pad) {
    var min = Math.min.apply(null, series);
    var max = Math.max.apply(null, series);
    var span = (max - min) || 1;
    var pts = series.map(function (v, i) {
      return [
        i / (series.length - 1) * w,
        h - pad - (v - min) / span * (h - pad * 2)
      ];
    });
    var out = '';
    for (var i = 1; i < pts.length; i++) {
      var rising = series[i] >= series[i - 1];
      out += '<path d="M' + pts[i - 1][0].toFixed(1) + ' ' + pts[i - 1][1].toFixed(1)
           + 'L' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1) + '" fill="none" stroke="'
           + (rising ? '#22c55e' : '#ef4444') + '" stroke-width="' + stroke + '" stroke-linecap="round"/>';
    }
    return out;
  }

  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    var rounded = Math.round(Math.abs(v) * 10) / 10;
    var sign = rounded === 0 ? '' : v > 0 ? '+' : '−';
    return sign + rounded.toFixed(1) + '%';
  }

  function deltaClass(v) {
    if (v === null || v === undefined) return 'dt-flat';
    return Math.round(Math.abs(v) * 10) / 10 === 0 ? 'dt-flat' : v > 0 ? 'dt-up' : 'dt-down';
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/);
    return (parts.length >= 2
      ? parts[0][0] + parts[parts.length - 1][0]
      : String(name || '').slice(0, 2)).toUpperCase();
  }

  // Hide-and-reveal rather than outerHTML replacement — see the note on the
  // same function in scripts/generate-ticker-data.js.
  // NOT size*2: /_vercel/image only serves the widths listed in vercel.json
  // images.sizes and 400s on anything else. See the note in
  // scripts/generate-ticker-data.js.
  var LOGO_OPTIMIZER_WIDTH = 80;

  function logoHtml(brand, size) {
    var ini = esc(initials(brand.name));
    if (!brand.logo) return '<span class="dt-logo dt-logo--ini">' + ini + '</span>';
    var src = '/_vercel/image?url=' + encodeURIComponent(brand.logo)
            + '&w=' + LOGO_OPTIMIZER_WIDTH + '&q=75';
    return '<img class="dt-logo" src="' + esc(src) + '" alt="" width="' + size + '" height="' + size
         + '" loading="lazy" decoding="async"'
         + ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
         + '<span class="dt-logo dt-logo--ini" style="display:none">' + ini + '</span>';
  }

  function renderBrands(market) {
    return market.brands.map(function (b) {
      return '<a class="dt-brand" href="/brands/' + esc(b.id) + '/">'
        +   '<span class="dt-brand-head">' + logoHtml(b, 18)
        +     '<span class="dt-brand-name">' + esc(b.name) + '</span></span>'
        +   '<span class="dt-brand-body">'
        +     '<span class="dt-brand-nums">'
        +       '<span class="dt-brand-di">' + b.di.toFixed(1) + '</span>'
        +       '<span class="dt-delta ' + deltaClass(b.mom) + '">' + fmtPct(b.mom) + '</span>'
        +     '</span>'
        +     '<svg class="dt-spark dt-spark--brand" viewBox="0 0 60 28" width="60" height="28" aria-hidden="true">'
        +       sparkline(b.s, 60, 28, 1.2, 4) + '</svg>'
        +   '</span>'
        + '</a>';
    }).join('');
  }

  /* ── Apply a market to the DOM ────────────────────────────────────────────── */
  function applyMarket(key, opts) {
    var m = findMarket(key);
    if (!m) return;
    state.market = key;

    var name = document.getElementById('dt-market-name');
    if (name) name.textContent = m.label;

    var eyebrow = document.getElementById('dt-index-eyebrow');
    if (eyebrow) eyebrow.textContent = 'DORMIED Index · ' + m.code;

    var railMarket = document.getElementById('dt-rail-market');
    if (railMarket) railMarket.textContent = m.label;

    var delta = root.querySelector('.dt-index-delta');
    if (delta) {
      delta.className = 'dt-index-delta dt-delta ' + deltaClass(m.mom);
      delta.textContent = fmtPct(m.mom);
    }

    var indexSpark = root.querySelector('.dt-spark--index');
    if (indexSpark) indexSpark.innerHTML = sparkline(m.s, 64, 30, 1.3, 4);

    var rail = document.getElementById('dt-rail');
    if (rail) {
      rail.innerHTML = renderBrands(m);
      rail.scrollLeft = 0;
    }

    // Selected row: tick and aria-selected move together or the listbox lies.
    var opts_ = root.querySelectorAll('.dt-opt');
    for (var i = 0; i < opts_.length; i++) {
      var isActive = opts_[i].getAttribute('data-market') === key;
      opts_[i].classList.toggle('is-active', isActive);
      opts_[i].setAttribute('aria-selected', isActive ? 'true' : 'false');
      var tick = opts_[i].querySelector('.dt-opt-tick');
      if (tick) tick.textContent = isActive ? '✓' : '';
    }

    if (opts && opts.persist) writeStore(KEY_MARKET, key);
    syncArrows();
  }

  /* ── Picker ───────────────────────────────────────────────────────────────── */
  var btn  = document.getElementById('dt-picker-btn');
  var menu = document.getElementById('dt-picker-menu');

  function openMenu() {
    if (!menu || !btn) return;
    state.open = true;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    var active = menu.querySelector('.dt-opt.is-active') || menu.querySelector('.dt-opt');
    if (active) { active.classList.add('is-focus'); active.focus(); }
  }

  function closeMenu(refocus) {
    if (!menu || !btn) return;
    state.open = false;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    var focused = menu.querySelector('.dt-opt.is-focus');
    if (focused) focused.classList.remove('is-focus');
    if (refocus) btn.focus();
  }

  /** step: +1/-1 to move relative, or the strings 'first'/'last'. */
  function moveFocus(step) {
    if (!menu) return;
    var rows = Array.prototype.slice.call(menu.querySelectorAll('.dt-opt'));
    if (!rows.length) return;
    var current = rows.indexOf(menu.querySelector('.dt-opt.is-focus'));
    var next;
    if (step === 'first')     next = 0;
    else if (step === 'last') next = rows.length - 1;
    else if (current < 0)     next = 0;
    else                      next = (current + step + rows.length) % rows.length;
    rows.forEach(function (r) { r.classList.remove('is-focus'); });
    rows[next].classList.add('is-focus');
    rows[next].focus();
  }

  if (btn && menu) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.open ? closeMenu(false) : openMenu();
    });

    menu.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.dt-opt') : null;
      if (!row) return;
      e.stopPropagation();
      applyMarket(row.getAttribute('data-market'), { persist: true });
      closeMenu(true);
    });

    menu.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown')      { e.preventDefault(); moveFocus(1); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); moveFocus(-1); }
      else if (e.key === 'Home')      { e.preventDefault(); moveFocus('first'); }
      else if (e.key === 'End')       { e.preventDefault(); moveFocus('last'); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var row = menu.querySelector('.dt-opt.is-focus');
        if (row) { applyMarket(row.getAttribute('data-market'), { persist: true }); closeMenu(true); }
      }
    });

    document.addEventListener('click', function () { if (state.open) closeMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) closeMenu(true);
    });
  }

  /* ── Rail arrows ──────────────────────────────────────────────────────────── */
  var rail = document.getElementById('dt-rail');
  var prev = document.getElementById('dt-prev');
  var next = document.getElementById('dt-next');

  function syncArrows() {
    if (!rail || !prev || !next) return;
    // 2px of slack: scrollWidth and clientWidth are rounded independently, so an
    // exactly-scrolled-to-the-end rail can report a 1px remainder forever.
    var max = rail.scrollWidth - rail.clientWidth;
    prev.disabled = rail.scrollLeft <= 2;
    next.disabled = rail.scrollLeft >= max - 2;
  }

  if (rail && prev && next) {
    prev.addEventListener('click', function () { rail.scrollBy({ left: -RAIL_STEP, behavior: 'smooth' }); });
    next.addEventListener('click', function () { rail.scrollBy({ left:  RAIL_STEP, behavior: 'smooth' }); });
    rail.addEventListener('scroll', syncArrows, { passive: true });
    window.addEventListener('resize', syncArrows);
    syncArrows();
  }

  /* ── Market resolution ────────────────────────────────────────────────────── */
  function marketForCountry(code) {
    return COUNTRY_TO_MARKET[String(code || '').toUpperCase()] || 'global';
  }

  function resolveMarket() {
    // 1. An explicit pick always wins, and never triggers a lookup.
    var manual = readStore(KEY_MARKET);
    if (manual && findMarket(manual)) { applyMarket(manual); return; }

    // 2. A cached country, so a returning visitor pays no round trip.
    var cached = readStore(KEY_GEO);
    if (cached) {
      var parts = cached.split('|');
      if (parts.length === 2 && (Date.now() - parseInt(parts[1], 10)) < GEO_TTL_MS) {
        applyMarket(marketForCountry(parts[0]));
        return;
      }
    }

    // 3. Ask the edge. index.html starts this request inline at first paint and
    //    parks the promise on window.__dtGeo, so by the time this file runs (it
    //    loads after the load event, with the rest of the first-party JS) the
    //    round trip has usually already finished. Falling back to starting it
    //    here keeps the module usable on its own.
    var pending = window.__dtGeo;
    if (!pending) {
      if (!window.fetch) return;
      pending = fetch('/api/geo', { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; });
    }
    pending
      .then(function (j) {
        if (!j || !j.country) return;
        writeStore(KEY_GEO, j.country + '|' + Date.now());
        var key = marketForCountry(j.country);
        if (key !== state.market) applyMarket(key);
      })
      .catch(function () { /* Global stands */ });
  }

  resolveMarket();
})();
