/* ─────────────────────────────────────────────────────────────────────────
   home.js  —  DORMIED Homepage
   Self-contained — depends only on window.DORMIED_DATA (data.js).
   Computes: top 3, biggest movers, biggest drops, market pulse, daily H2H.
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── HTML escape ──────────────────────────────────────────────────────── */
  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Format % change ──────────────────────────────────────────────────── */
  function fmtPct(v) {
    if (v === null || v === undefined) return null;
    var sign = v > 0 ? '+' : v < 0 ? '\u2212' : '';
    return sign + Math.abs(v).toFixed(1) + '%';
  }

  /* ── Logo initials fallback ───────────────────────────────────────────── */
  function initials(name) {
    var parts = (name || '').trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (name || '').slice(0, 2).toUpperCase();
  }

  /* ── Logo img HTML (with initials fallback) ───────────────────────────── */
  function logoImg(brand, cls, size) {
    size = size || 20;
    var ini = esc(initials(brand.name));
    var fallback = 'this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'';
    if (brand.logo) {
      return '<img class="' + cls + '" src="' + esc(brand.logo) + '" alt="" '
           + 'width="' + size + '" height="' + size + '" loading="lazy" '
           + 'onerror="' + fallback + '">'
           + '<span class="brand-initials-fallback ' + cls + '-fallback" style="display:none">' + ini + '</span>';
    }
    return '<span class="brand-initials-fallback ' + cls + '-fallback">' + ini + '</span>';
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── COMPUTE HOME RANKINGS ────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function computeHomeRankings() {
    var data    = window.DORMIED_DATA;
    var meta    = data.meta;
    var cur     = meta.currentMonth;
    var prev    = meta.previousMonth;
    var brands  = data.brands;

    // Gather stats for each brand (global market only)
    var stats = brands.map(function (b) {
      var g    = (b.searchesByMarket && b.searchesByMarket.global) || {};
      var curV = g[cur]  || 0;
      var preV = g[prev] || 0;
      var pct  = preV > 0 ? (curV - preV) / preV * 100 : null;
      return {
        id:       b.id,
        name:     b.name,
        logo:     b.logo || '',
        category: b.category || '',
        curV:     curV,
        preV:     preV,
        pct:      pct
      };
    }).filter(function (b) { return b.curV > 0; });

    // Normalise to DI (0–100 relative to max)
    var maxV = 0;
    stats.forEach(function (b) { if (b.curV > maxV) maxV = b.curV; });
    stats.forEach(function (b) { b.di = maxV > 0 ? Math.round(b.curV / maxV * 100) : 0; });

    // Sort by DI desc → assign rank
    stats.sort(function (a, b) { return b.di - a.di; });
    stats.forEach(function (b, i) { b.rank = i + 1; });

    return stats;
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── COMPUTE MARKET PULSE ─────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function computeMarketPulse() {
    var data   = window.DORMIED_DATA;
    var meta   = data.meta;
    var cur    = meta.currentMonth;
    var prev   = meta.previousMonth;
    var brands = data.brands;

    return meta.markets.map(function (mkt) {
      var cSum = 0, pSum = 0;
      brands.forEach(function (b) {
        var g = b.searchesByMarket && b.searchesByMarket[mkt.key];
        if (!g) return;
        cSum += (g[cur]  || 0);
        pSum += (g[prev] || 0);
      });
      var pct = pSum > 0 ? (cSum - pSum) / pSum * 100 : null;
      return { key: mkt.key, label: mkt.label, flag: mkt.flag, pct: pct };
    });
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── DAILY HEAD-TO-HEAD ───────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function getDailyMatchup(ranked) {
    var d    = new Date();
    var seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

    // Group by category — use only primary (first semicolon-delimited) category
    var bycat = {};
    ranked.forEach(function (b) {
      var cat = (b.category || '').split(';')[0].trim();
      if (!cat) return;
      if (!bycat[cat]) bycat[cat] = [];
      bycat[cat].push(b);
    });

    // Only categories with 2+ brands
    var cats = Object.keys(bycat).filter(function (c) { return bycat[c].length >= 2; });
    if (!cats.length) return null;

    // Pick category deterministically from date seed
    var catIdx   = seed % cats.length;
    var cat      = cats[catIdx];
    var catBrands = bycat[cat]; // already sorted by DI desc from computeHomeRankings

    // Pick two adjacent brands — offset shifts within valid range
    var maxOffset = catBrands.length - 2;
    var offset    = Math.floor(((seed * 31337) % (maxOffset + 1)));
    offset        = Math.max(0, Math.min(offset, maxOffset));

    return {
      brand1:   catBrands[offset],
      brand2:   catBrands[offset + 1],
      category: cat
    };
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── RENDER: MARKET PULSE ─────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function renderMarketPulse(markets) {
    var el = document.getElementById('market-pulse');
    if (!el) return;

    el.innerHTML = markets.map(function (m) {
      var pctStr = fmtPct(m.pct);
      var cls    = m.pct === null ? '' : m.pct > 0 ? 'mp-delta--up' : m.pct < 0 ? 'mp-delta--down' : 'mp-delta--flat';
      var delta  = pctStr
        ? '<span class="mp-delta ' + cls + '">' + esc(pctStr) + '</span>'
        : '';
      return '<span class="mp-item">' + esc(m.flag) + ' ' + esc(m.label) + delta + '</span>';
    }).join('');
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── RENDER: SCOREBOARD ───────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function sbCard(brand, badgeHtml, badgeCls) {
    return '<a href="/brands/' + esc(brand.id) + '/" class="sb-card" data-brand-id="' + esc(brand.id) + '">'
         +   '<div class="sb-card-rank ' + badgeCls + '">' + badgeHtml + '</div>'
         +   logoImg(brand, 'sb-card-logo', 20)
         +   '<div class="sb-card-info">'
         +     '<div class="sb-card-name">' + esc(brand.name) + '</div>'
         +   '</div>'
         + '</a>';
  }

  function renderScoreboard(ranked) {
    // Top 5
    var topEl = document.getElementById('sb-top');
    if (topEl) {
      topEl.innerHTML = '<div class="sb-col-title">Top 5</div>'
        + ranked.slice(0, 5).map(function (b) {
            return sbCard(b, '#' + b.rank, '');
          }).join('');
    }

    // Biggest movers (top 5 by % gain, must have prev data)
    var moversEl = document.getElementById('sb-movers');
    if (moversEl) {
      var movers = ranked.filter(function (b) { return b.pct !== null && b.pct > 0; })
                         .sort(function (a, b) { return b.pct - a.pct; })
                         .slice(0, 5);
      moversEl.innerHTML = '<div class="sb-col-title">Biggest Movers</div>'
        + (movers.length
            ? movers.map(function (b) {
                return sbCard(b, '+' + b.pct.toFixed(1) + '%', 'sb-card-rank--up');
              }).join('')
            : '<p class="sb-empty">No data</p>');
    }

    // Biggest drops (top 5 by % fall)
    var dropsEl = document.getElementById('sb-drops');
    if (dropsEl) {
      var drops = ranked.filter(function (b) { return b.pct !== null && b.pct < 0; })
                        .sort(function (a, b) { return a.pct - b.pct; })
                        .slice(0, 5);
      dropsEl.innerHTML = '<div class="sb-col-title">Biggest Drops</div>'
        + (drops.length
            ? drops.map(function (b) {
                return sbCard(b, '\u2212' + Math.abs(b.pct).toFixed(1) + '%', 'sb-card-rank--down');
              }).join('')
            : '<p class="sb-empty">No data</p>');
    }
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── RENDER: DAILY H2H ────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function renderH2H(matchup) {
    var el = document.getElementById('h2h-content');
    if (!el || !matchup) {
      if (el) el.innerHTML = '<p class="sb-empty">No match-up available today.</p>';
      return;
    }

    // Date label
    var dateEl = document.getElementById('h2h-date');
    if (dateEl) {
      var d = new Date();
      dateEl.textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    var meta      = window.DORMIED_DATA.meta;
    var rawBrands = window.DORMIED_DATA.brands;
    var cur       = meta.currentMonth;
    var prev      = meta.previousMonth;

    // 12-months-ago key: parse "Feb 2026" → "Feb 2025"
    var curParts = cur.split(' ');
    var mo12ago  = curParts[0] + ' ' + (parseInt(curParts[1], 10) - 1);

    // Find raw brand object by id
    function findRaw(id) {
      for (var i = 0; i < rawBrands.length; i++) {
        if (rawBrands[i].id === id) return rawBrands[i];
      }
      return null;
    }

    // Get global search value for a given month
    function gVal(raw, month) {
      var g = (raw && raw.searchesByMarket && raw.searchesByMarket.global) || {};
      return g[month] || 0;
    }

    // % change helper
    function pctChange(curV, preV) {
      return preV > 0 ? (curV - preV) / preV * 100 : null;
    }

    // Build a map of { marketKey → maxSearchVolume } across all brands for cur month
    // Used to normalise per-market DI (how dominant this brand is in each country)
    function buildMarketMaxMap() {
      var brands = window.DORMIED_DATA.brands;
      var maxMap = {};
      meta.markets.forEach(function (mkt) {
        if (mkt.key === 'global') return;
        var maxV = 0;
        brands.forEach(function (b) {
          var g = (b.searchesByMarket && b.searchesByMarket[mkt.key]) || {};
          var v = g[cur] || 0;
          if (v > maxV) maxV = v;
        });
        maxMap[mkt.key] = maxV;
      });
      return maxMap;
    }

    // Return top N markets for a brand as [{ flag, label, di }] sorted by di desc
    function topMarkets(raw, maxMap, n) {
      var results = [];
      meta.markets.forEach(function (mkt) {
        if (mkt.key === 'global') return;
        var maxV = maxMap[mkt.key] || 0;
        var g = (raw && raw.searchesByMarket && raw.searchesByMarket[mkt.key]) || {};
        var v = g[cur] || 0;
        if (maxV > 0 && v > 0) {
          results.push({ flag: mkt.flag, label: mkt.label, di: Math.round(v / maxV * 100) });
        }
      });
      results.sort(function (a, b) { return b.di - a.di; });
      return results.slice(0, n || 3);
    }

    // Format top markets as "🇺🇸 95 · 🇨🇦 87 · 🇦🇺 72"
    function fmtTopMarkets(mkts) {
      if (!mkts.length) return '—';
      return mkts.map(function (m) { return m.flag + '\u202f' + m.di.toFixed(1); }).join(' · ');
    }

    var b1 = matchup.brand1, b2 = matchup.brand2;
    var raw1 = findRaw(b1.id), raw2 = findRaw(b2.id);

    var cur1 = gVal(raw1, cur),     cur2 = gVal(raw2, cur);
    var pre1 = gVal(raw1, prev),    pre2 = gVal(raw2, prev);
    var y1   = gVal(raw1, mo12ago), y2   = gVal(raw2, mo12ago);

    var mm1  = pctChange(cur1, pre1), mm2  = pctChange(cur2, pre2);
    var yr1  = pctChange(cur1, y1),   yr2  = pctChange(cur2, y2);

    var maxMap   = buildMarketMaxMap();
    var mkts1    = fmtTopMarkets(topMarkets(raw1, maxMap, 3));
    var mkts2    = fmtTopMarkets(topMarkets(raw2, maxMap, 3));

    var fd1 = (raw1 && raw1.founded)      ? String(raw1.founded)      : '—';
    var fd2 = (raw2 && raw2.founded)      ? String(raw2.founded)      : '—';
    var hq1 = (raw1 && raw1.headquarters) ? raw1.headquarters         : '—';
    var hq2 = (raw2 && raw2.headquarters) ? raw2.headquarters         : '—';

    // ── Row builders ──────────────────────────────────────────────────────

    // DI bar row — bars fill proportionally to each other
    function diRow() {
      var hi = Math.max(b1.di, b2.di) || 1;
      var p1 = Math.round(b1.di / hi * 100);
      var p2 = Math.round(b2.di / hi * 100);
      var win1 = b1.di >= b2.di ? ' h2h-val--win' : '';
      var win2 = b2.di >= b1.di ? ' h2h-val--win' : '';
      return '<div class="h2h-stat-row h2h-stat-row--di">'
           +   '<div class="h2h-di-cell">'
           +     '<span class="h2h-di-num' + win1 + '">' + b1.di.toFixed(1) + '</span>'
           +     '<div class="h2h-bar-track"><div class="h2h-bar-fill" style="width:' + p1 + '%"></div></div>'
           +   '</div>'
           +   '<div class="h2h-stat-label">DI Score</div>'
           +   '<div class="h2h-di-cell h2h-di-cell--right">'
           +     '<div class="h2h-bar-track"><div class="h2h-bar-fill" style="width:' + p2 + '%"></div></div>'
           +     '<span class="h2h-di-num' + win2 + '">' + b2.di.toFixed(1) + '</span>'
           +   '</div>'
           + '</div>';
    }

    // % change row — red/green colour + bold winner
    function pctRow(p1, label, p2) {
      var c1 = p1 === null ? '' : p1 > 0 ? 'h2h-val--up' : p1 < 0 ? 'h2h-val--down' : '';
      var c2 = p2 === null ? '' : p2 > 0 ? 'h2h-val--up' : p2 < 0 ? 'h2h-val--down' : '';
      if (p1 !== null && p2 !== null && p1 > p2) c1 += ' h2h-val--win';
      if (p1 !== null && p2 !== null && p2 > p1) c2 += ' h2h-val--win';
      var s1 = p1 !== null ? fmtPct(p1) : '—';
      var s2 = p2 !== null ? fmtPct(p2) : '—';
      return '<div class="h2h-stat-row">'
           +   '<div class="h2h-val ' + c1.trim() + '">' + esc(s1) + '</div>'
           +   '<div class="h2h-stat-label">' + esc(label) + '</div>'
           +   '<div class="h2h-val h2h-val--right ' + c2.trim() + '">' + esc(s2) + '</div>'
           + '</div>';
    }

    // Numeric row — bold the higher value
    function numRow(n1, label, n2, fmtFn) {
      var c1 = n1 > n2 ? 'h2h-val--win' : '';
      var c2 = n2 > n1 ? 'h2h-val--win' : '';
      return '<div class="h2h-stat-row">'
           +   '<div class="h2h-val ' + c1 + '">' + esc(fmtFn(n1)) + '</div>'
           +   '<div class="h2h-stat-label">' + esc(label) + '</div>'
           +   '<div class="h2h-val h2h-val--right ' + c2 + '">' + esc(fmtFn(n2)) + '</div>'
           + '</div>';
    }

    // Plain info row — no highlighting
    function infoRow(v1, label, v2) {
      return '<div class="h2h-stat-row">'
           +   '<div class="h2h-val">' + esc(v1) + '</div>'
           +   '<div class="h2h-stat-label">' + esc(label) + '</div>'
           +   '<div class="h2h-val h2h-val--right">' + esc(v2) + '</div>'
           + '</div>';
    }

    // ── Assemble ──────────────────────────────────────────────────────────
    el.innerHTML =
        '<span class="h2h-category">' + esc(matchup.category) + '</span>'
      + '<div class="h2h-vs-row">'
      +   '<a href="/brands/' + esc(b1.id) + '/" class="h2h-brand-hd" data-brand-id="' + esc(b1.id) + '">'
      +     logoImg(b1, 'h2h-logo', 40)
      +     '<div class="h2h-brand-hd-name">' + esc(b1.name) + '</div>'
      +     '<div class="h2h-brand-hd-rank">Rank #' + b1.rank + '</div>'
      +   '</a>'
      +   '<div class="h2h-vs-badge">VS</div>'
      +   '<a href="/brands/' + esc(b2.id) + '/" class="h2h-brand-hd h2h-brand-hd--right" data-brand-id="' + esc(b2.id) + '">'
      +     logoImg(b2, 'h2h-logo', 40)
      +     '<div class="h2h-brand-hd-name">' + esc(b2.name) + '</div>'
      +     '<div class="h2h-brand-hd-rank">Rank #' + b2.rank + '</div>'
      +   '</a>'
      + '</div>'
      + '<div class="h2h-footer">'
      +   '<a href="/brands/' + esc(b1.id) + '/" class="h2h-cta">' + esc(b1.name) + ' →</a>'
      +   '<a href="/rankings/" class="h2h-cta h2h-cta--center">Full Index →</a>'
      +   '<a href="/brands/' + esc(b2.id) + '/" class="h2h-cta h2h-cta--right">' + esc(b2.name) + ' →</a>'
      + '</div>'
      + '<div class="h2h-stat-grid">'
      +   diRow()
      +   pctRow(mm1, 'M/M Change', mm2)
      +   pctRow(yr1, '12-Month Trend', yr2)
      +   infoRow(mkts1, 'Top Markets', mkts2)
      +   infoRow(fd1, 'Founded', fd2)
      +   infoRow(hq1, 'HQ', hq2)
      + '</div>'
      + '<div class="h2h-insights">'
      +   '<div class="h2h-insight-box" data-h2h-insight-for="' + esc(b1.id) + '"><div class="h2h-insight-header"><span class="h2h-insight-label">' + esc(b1.name) + '</span><span class="h2h-read-tag">THE READ <span class="h2h-read-month">' + esc(cur) + '</span></span></div><div class="h2h-insight-text"></div></div>'
      +   '<div class="h2h-insight-box h2h-insight-box--right" data-h2h-insight-for="' + esc(b2.id) + '"><div class="h2h-insight-header"><span class="h2h-insight-label">' + esc(b2.name) + '</span><span class="h2h-read-tag">THE READ <span class="h2h-read-month">' + esc(cur) + '</span></span></div><div class="h2h-insight-text"></div></div>'
      + '</div>';
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── RENDER: HERO MONTH LABEL ─────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function renderHeroMeta() {
    var meta    = window.DORMIED_DATA.meta;
    var monthEl = document.getElementById('hero-month');
    if (monthEl) monthEl.textContent = meta.currentMonth;
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── EXPLANATIONS PATCH ────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */

  // After the DOM is rendered, asynchronously fill explanation sections.
  function patchExplanations(monthLabel) {
    if (!window.DORMIED_EXPLANATIONS) return;
    var EXP   = window.DORMIED_EXPLANATIONS;
    var toBullets = (window.DORMIED_UTILS && window.DORMIED_UTILS.explanationToBullets) || function (t) { return '<p>' + t + '</p>'; };

    EXP.preload(monthLabel).then(function () {

      // ── "Why This Month Moved" section ────────────────────────────────
      var whySection = document.getElementById('why-moved-section');
      var whyList    = document.getElementById('why-moved-list');
      var whyMonth   = document.getElementById('why-moved-month');

      if (whySection && whyList) {
        if (whyMonth) whyMonth.textContent = monthLabel;

        // Collect top 3 biggest movers with real (non-fallback) explanations
        var seen = {};
        var items = [];
        var cards = document.querySelectorAll('#sb-movers .sb-card');
        cards.forEach(function (card) {
          if (items.length >= 3) return;
          var brandId = card.dataset.brandId;
          if (!brandId || seen[brandId]) return;
          seen[brandId] = true;
          var row = EXP.getCached(brandId, monthLabel);
          if (!row || EXP.isFallback(row.explanation)) return;
          var nameEl = card.querySelector('.sb-card-name');
          var name   = nameEl ? nameEl.textContent : brandId;
          var pctEl  = card.querySelector('.sb-card-rank');
          var badge  = pctEl ? pctEl.textContent : '';
          items.push({ brandId: brandId, name: name, badge: badge, explanation: row.explanation });
        });

        if (items.length > 0) {
          whyList.innerHTML = items.map(function (item) {
            return '<div class="why-moved-item">'
              + '<div class="why-moved-brand-row">'
              +   '<span class="why-moved-name">' + esc(item.name) + '</span>'
              +   '<span class="why-moved-badge">' + esc(item.badge) + '</span>'
              + '</div>'
              + '<div class="why-moved-bullets">' + toBullets(item.explanation) + '</div>'
              + '</div>';
          }).join('');
          whySection.hidden = false;
        }
      }

    });
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── THE READ: H2H ────────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */

  var MONTH_NAMES_READ = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function shiftMonthRead(label, delta) {
    var parts = label.split(' ');
    var total = parseInt(parts[1]) * 12 + MONTH_NAMES_READ.indexOf(parts[0]) + delta;
    return MONTH_NAMES_READ[((total % 12) + 12) % 12] + ' ' + Math.floor(total / 12);
  }

  function computeH2HBrandStats(brandId, rankedBrand) {
    var data  = window.DORMIED_DATA;
    var meta  = data.meta;
    var cur   = meta.currentMonth;
    var brand = data.brands.find(function (b) { return b.id === brandId; });
    if (!brand) return null;

    var g = (brand.searchesByMarket && brand.searchesByMarket.global) || {};
    var curV  = g[cur] || 0;
    var prevM = shiftMonthRead(cur, -1);
    var prevV = g[prevM] || 0;
    var vsMonth = prevV > 0 ? (curV - prevV) / prevV * 100 : null;

    // Year-over-year
    var yoyM = shiftMonthRead(cur, -12);
    var yoyV = g[yoyM] || 0;
    var yoy  = yoyV > 0 ? (curV - yoyV) / yoyV * 100 : null;

    // 3-month trend
    var last3  = [shiftMonthRead(cur, -2), shiftMonthRead(cur, -1), cur];
    var prior3 = [shiftMonthRead(cur, -5), shiftMonthRead(cur, -4), shiftMonthRead(cur, -3)];
    var l3avg  = last3.reduce(function (s, m) { return s + (g[m] || 0); }, 0) / 3;
    var p3avg  = prior3.reduce(function (s, m) { return s + (g[m] || 0); }, 0) / 3;
    var mom    = p3avg > 0 ? (l3avg - p3avg) / p3avg * 100 : null;

    // Best rank: find month with highest volume, compute rank in that month
    var bestMonth = cur;
    var bestVol   = 0;
    Object.keys(g).forEach(function (m) { if ((g[m] || 0) > bestVol) { bestVol = g[m]; bestMonth = m; } });
    var bestRank = 1;
    data.brands.forEach(function (other) {
      if (other.id === brandId) return;
      var ov = (other.searchesByMarket && other.searchesByMarket.global && other.searchesByMarket.global[bestMonth]) || 0;
      if (ov > bestVol) bestRank++;
    });

    // Top market
    var topMarket = 'Global';
    var topVal    = 0;
    (meta.markets || []).forEach(function (mkt) {
      if (mkt.key === 'global') return;
      var v = (brand.searchesByMarket && brand.searchesByMarket[mkt.key] && brand.searchesByMarket[mkt.key][cur]) || 0;
      if (v > topVal) { topVal = v; topMarket = mkt.label || mkt.key; }
    });

    return {
      name:      brand.name,
      category:  brand.category || '—',
      vsMonth:   vsMonth,
      yoy:       yoy,
      mom:       mom,
      bestRank:  bestRank,
      bestMonth: bestMonth,
      topMarket: topMarket,
    };
  }

  function patchH2HWithReads(b1, b2) {
    var meta    = window.DORMIED_DATA.meta;
    var cm      = meta.currentMonth;
    var fmtChg  = function (v) { return v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—'; };

    [b1, b2].forEach(function (b) {
      var box     = document.querySelector('[data-h2h-insight-for="' + b.id + '"]');
      if (!box) return;
      var textDiv = box.querySelector('.h2h-insight-text');
      if (!textDiv) return;

      var cacheKey = 'dormied_take_' + b.id + '_' + cm;
      var cached   = sessionStorage.getItem(cacheKey);
      if (cached) {
        textDiv.innerHTML = '<p class="h2h-take-text">' + cached + '</p>';
        box.classList.add('h2h-insight-box--loaded');
        return;
      }

      // Show shimmer while loading
      textDiv.innerHTML = '<p class="h2h-take-loading"></p>';
      box.classList.add('h2h-insight-box--loaded');

      var stats = computeH2HBrandStats(b.id, b);
      if (!stats) return;

      fetch('/api/take', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:      b.name,
          rank:      b.rank,
          di:        b.di.toFixed(1),
          vsMonth:   fmtChg(stats.vsMonth),
          mom:       fmtChg(stats.mom),
          yoy:       fmtChg(stats.yoy),
          bestRank:  stats.bestRank,
          bestMonth: stats.bestMonth,
          category:  stats.category,
          topMarket: stats.topMarket,
        }),
      })
        .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
        .then(function (data) {
          if (data.take) {
            sessionStorage.setItem(cacheKey, data.take);
            textDiv.innerHTML = '<p class="h2h-take-text">' + data.take + '</p>';
          } else {
            textDiv.innerHTML = '';
          }
        })
        .catch(function (e) {
          console.warn('[take] H2H fetch failed for ' + b.name + ':', e.message);
          textDiv.innerHTML = '';
        });
    });
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── BOOT ─────────────────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function init() {
    if (!window.DORMIED_DATA) {
      console.warn('[home.js] DORMIED_DATA not found');
      return;
    }

    var ranked  = computeHomeRankings();
    var markets = computeMarketPulse();
    var matchup = getDailyMatchup(ranked);

    renderHeroMeta();
    renderMarketPulse(markets);
    renderScoreboard(ranked);
    renderH2H(matchup);

    // Async: patch explanation text into movers section
    patchExplanations(window.DORMIED_DATA.meta.currentMonth);

    // Async: fill H2H insight boxes with THE READ editorial takes
    if (matchup) patchH2HWithReads(matchup.brand1, matchup.brand2);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
