/* ─────────────────────────────────────────────────────────────────────────
   home.js  —  DORMIED Homepage
   Self-contained — depends only on window.DORMIED_DATA (data.js).
   Computes: top 5, biggest movers, biggest drops, market pulse, daily H2H.
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
    var rounded = parseFloat(Math.abs(v).toFixed(1));
    var sign = rounded === 0 ? '' : v > 0 ? '+' : '\u2212';
    return sign + rounded.toFixed(1) + '%';
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
    var ini      = esc(initials(brand.name));
    var fallback = 'this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'';
    if (brand.logo) {
      return '<img class="' + cls + '" src="' + esc(brand.logo) + '" alt="" '
           + 'width="' + size + '" height="' + size + '" loading="lazy" '
           + 'onerror="' + fallback + '">'
           + '<span class="brand-initials-fallback ' + cls + '-fallback" style="display:none">' + ini + '</span>';
    }
    return '<span class="brand-initials-fallback ' + cls + '-fallback">' + ini + '</span>';
  }

  /* ── Month shift helper ("Feb 2026" + delta → "Nov 2025") ────────────── */
  var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function shiftMonth(label, delta) {
    var parts = label.split(' ');
    var total = parseInt(parts[1], 10) * 12 + MONTH_NAMES.indexOf(parts[0]) + delta;
    return MONTH_NAMES[((total % 12) + 12) % 12] + ' ' + Math.floor(total / 12);
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

    var ago3 = shiftMonth(cur, -3); // 3 months before current (matches app.js ago3Months)

    // Compute over ALL brands (matching app.js — filter for display later)
    var all = brands.map(function (b) {
      var g     = (b.searchesByMarket && b.searchesByMarket.global) || {};
      var curV  = g[cur]  || 0;
      var preV  = g[prev] || 0;
      var ago3V = g[ago3] || 0;
      var pct   = preV > 0 ? (curV - preV) / preV * 100 : null;
      return { id: b.id, name: b.name, logo: b.logo || '', category: b.category || '',
               curV: curV, preV: preV, ago3V: ago3V, pct: pct };
    });

    var maxV = 0, maxPreV = 0, maxAgo3V = 0;
    all.forEach(function (b) {
      if (b.curV  > maxV)     maxV     = b.curV;
      if (b.preV  > maxPreV)  maxPreV  = b.preV;
      if (b.ago3V > maxAgo3V) maxAgo3V = b.ago3V;
    });
    all.forEach(function (b) {
      b.di     = maxV     > 0 ? b.curV  / maxV     * 100 : 0;
      b.prevDI = maxPreV  > 0 ? b.preV  / maxPreV  * 100 : 0;
      b.ago3DI = maxAgo3V > 0 ? b.ago3V / maxAgo3V * 100 : 0;
    });

    // Previous rank over all brands — sort from original order (matches app.js)
    var prevSorted = all.slice().sort(function (a, b) {
      var d = b.prevDI - a.prevDI;
      if (Math.abs(d) > 0.0001) return d;
      return b.ago3DI - a.ago3DI;
    });
    var prevRankMap = {};
    prevSorted.forEach(function (b, i) { prevRankMap[b.id] = i + 1; });

    // Build ago3 rank map for second tiebreak
    var ago3Sorted = all.slice().sort(function (a, b) { return b.ago3DI - a.ago3DI; });
    var ago3RankMap = {};
    ago3Sorted.forEach(function (b, i) { ago3RankMap[b.id] = i + 1; });

    // Sort current: DI desc, tiebreak by prevRank pos then ago3Rank pos (mirrors app.js exactly)
    all.sort(function (a, b) {
      var d = b.di - a.di;
      if (Math.abs(d) > 0.0001) return d;
      var pd = (prevRankMap[a.id] || 9999) - (prevRankMap[b.id] || 9999);
      if (pd !== 0) return pd;
      return (ago3RankMap[a.id] || 9999) - (ago3RankMap[b.id] || 9999);
    });
    all.forEach(function (b, i) { b.rank = i + 1; });

    all.forEach(function (b) {
      var pr = prevRankMap[b.id];
      b.rankChange = (pr != null && b.preV > 0) ? pr - b.rank : null;
      b.di = parseFloat(b.di.toFixed(1));
    });

    // Filter to brands with current data for display
    var stats = all.filter(function (b) { return b.curV > 0; });

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

    var bycat = {};
    ranked.forEach(function (b) {
      var cat = (b.category || '').split(';')[0].trim();
      if (!cat) return;
      if (!bycat[cat]) bycat[cat] = [];
      bycat[cat].push(b);
    });

    var cats = Object.keys(bycat).filter(function (c) { return bycat[c].length >= 2; });
    if (!cats.length) return null;

    var catIdx    = seed % cats.length;
    var cat       = cats[catIdx];
    var catBrands = bycat[cat];

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
      var cls    = m.pct === null ? '' : parseFloat(Math.abs(m.pct).toFixed(1)) === 0 ? 'mp-delta--flat' : m.pct > 0 ? 'mp-delta--up' : 'mp-delta--down';
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
         +   (brand.rankChange != null && brand.rankChange !== 0
               ? '<div class="sb-card-rc ' + (brand.rankChange > 0 ? 'sb-card-rc--up' : 'sb-card-rc--down') + '">'
                 + (brand.rankChange > 0 ? '▲' : '▼') + Math.abs(brand.rankChange)
                 + '</div>'
               : (brand.rankChange === 0 ? '<div class="sb-card-rc sb-card-rc--flat">—</div>' : ''))
         +   '<div class="sb-card-di">' + (brand.di != null ? brand.di.toFixed(1) : '—') + '</div>'
         + '</a>';
  }

  function renderScoreboard(ranked) {
    var topEl = document.getElementById('sb-top');
    if (topEl) {
      topEl.innerHTML = '<div class="sb-col-title">Top 5</div>'
        + ranked.slice(0, 5).map(function (b) {
            return sbCard(b, '#' + b.rank, '');
          }).join('');
    }

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
  function renderH2H(matchup, ranked) {
    var el = document.getElementById('h2h-content');
    if (!el || !matchup) {
      if (el) el.innerHTML = '<p class="sb-empty">No match-up available today.</p>';
      return;
    }

    // Date label + ISO string
    var d       = new Date();
    var dateEl  = document.getElementById('h2h-date');
    if (dateEl) {
      dateEl.textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }
    var todayStr = d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');

    var meta      = window.DORMIED_DATA.meta;
    var rawBrands = window.DORMIED_DATA.brands;
    var cur       = meta.currentMonth;
    var prev      = meta.previousMonth;
    var mo12ago   = shiftMonth(cur, -12);

    function findRaw(id) {
      for (var i = 0; i < rawBrands.length; i++) {
        if (rawBrands[i].id === id) return rawBrands[i];
      }
      return null;
    }

    function gVal(raw, month) {
      var g = (raw && raw.searchesByMarket && raw.searchesByMarket.global) || {};
      return g[month] || 0;
    }

    function pctChange(curV, preV) {
      return preV > 0 ? (curV - preV) / preV * 100 : null;
    }

    // 3-month trend: avg(cur, cur-1, cur-2) vs avg(cur-3, cur-4, cur-5)
    function threeMoTrend(raw) {
      var g      = (raw && raw.searchesByMarket && raw.searchesByMarket.global) || {};
      var last3  = [shiftMonth(cur, -2), shiftMonth(cur, -1), cur];
      var prior3 = [shiftMonth(cur, -5), shiftMonth(cur, -4), shiftMonth(cur, -3)];
      var l3avg  = last3.reduce(function (s, m) { return s + (g[m] || 0); }, 0) / 3;
      var p3avg  = prior3.reduce(function (s, m) { return s + (g[m] || 0); }, 0) / 3;
      return p3avg > 0 ? (l3avg - p3avg) / p3avg * 100 : null;
    }

    // Category rank within sorted ranked list
    function getCatRank(b) {
      var cat = (b.category || '').split(';')[0].trim();
      if (!cat) return null;
      var catBrands = ranked.filter(function (r) {
        return (r.category || '').split(';')[0].trim() === cat;
      });
      for (var i = 0; i < catBrands.length; i++) {
        if (catBrands[i].id === b.id) {
          return { rank: i + 1, category: cat, total: catBrands.length };
        }
      }
      return null;
    }

    var b1   = matchup.brand1, b2 = matchup.brand2;
    var raw1 = findRaw(b1.id), raw2 = findRaw(b2.id);

    var cur1 = gVal(raw1, cur),     cur2 = gVal(raw2, cur);
    var pre1 = gVal(raw1, prev),    pre2 = gVal(raw2, prev);
    var y1   = gVal(raw1, mo12ago), y2   = gVal(raw2, mo12ago);

    var mm1 = pctChange(cur1, pre1), mm2 = pctChange(cur2, pre2);
    var tm1 = threeMoTrend(raw1),    tm2 = threeMoTrend(raw2);
    var yr1 = pctChange(cur1, y1),   yr2 = pctChange(cur2, y2);

    var fd1 = (raw1 && raw1.founded)      ? String(raw1.founded)      : null;
    var fd2 = (raw2 && raw2.founded)      ? String(raw2.founded)      : null;
    var hq1 = (raw1 && raw1.headquarters) ? raw1.headquarters          : null;
    var hq2 = (raw2 && raw2.headquarters) ? raw2.headquarters          : null;

    var cr1 = getCatRank(b1);
    var cr2 = getCatRank(b2);

    // ── Match result calculation ─────────────────────────────────────────
    // Award 1 pt to higher numeric value per stat (higher = better, even for negatives)
    var pts1 = 0, pts2 = 0;

    function awardPt(v1, v2) {
      if (v1 === null || v2 === null) return;
      if (v1 > v2) pts1++;
      else if (v2 > v1) pts2++;
    }

    awardPt(b1.di, b2.di);
    awardPt(mm1, mm2);
    awardPt(tm1, tm2);
    awardPt(yr1, yr2);

    var resultScore, resultWinner, resultDisplay;
    if (pts1 > pts2) {
      resultWinner  = b1.name;
      resultScore   = pts1 + 'UP';
      resultDisplay = esc(b1.name) + ' def. ' + esc(b2.name) + ' ' + resultScore;
    } else if (pts2 > pts1) {
      resultWinner  = b2.name;
      resultScore   = pts2 + 'UP';
      resultDisplay = esc(b2.name) + ' def. ' + esc(b1.name) + ' ' + resultScore;
    } else {
      resultWinner  = null;
      resultScore   = 'EVEN';
      resultDisplay = 'EVEN';
    }

    // Share to X
    var shareUrl, shareTweet;
    if (resultWinner) {
      var loserName = resultWinner === b1.name ? b2.name : b1.name;
      shareUrl   = 'https://dormied.com/matchups/' + todayStr;
      shareTweet = resultWinner + ' def. ' + loserName + ' ' + resultScore +
                   ' on the DORMIED Index. ' + shareUrl;
    } else {
      shareUrl   = 'https://dormied.com/matchups/' + todayStr;
      shareTweet = b1.name + ' vs ' + b2.name + ' — EVEN on the DORMIED Index. ' + shareUrl;
    }
    var shareHref = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareTweet);

    // ── Row builders ─────────────────────────────────────────────────────
    var CK = '<span class="h2h-check" aria-hidden="true">&#10003;</span>';

    // DI bar row with checkmark
    function diRow() {
      var hi   = Math.max(b1.di, b2.di) || 1;
      var p1   = Math.round(b1.di / hi * 100);
      var p2   = Math.round(b2.di / hi * 100);
      var win1 = b1.di > b2.di;
      var win2 = b2.di > b1.di;
      var cls1 = ' h2h-di-num' + (win1 ? ' h2h-val--win' : '');
      var cls2 = ' h2h-di-num' + (win2 ? ' h2h-val--win' : '');
      return '<div class="h2h-stat-row h2h-stat-row--di">'
           +   '<div class="h2h-di-cell">'
           +     '<div class="h2h-di-top">'
           +       '<span class="' + cls1.trim() + '">' + b1.di.toFixed(1) + '</span>'
           +       (win1 ? CK : '')
           +     '</div>'
           +     '<div class="h2h-bar-track"><div class="h2h-bar-fill" style="width:' + p1 + '%"></div></div>'
           +   '</div>'
           +   '<div class="h2h-stat-label">DI Score</div>'
           +   '<div class="h2h-di-cell h2h-di-cell--right">'
           +     '<div class="h2h-bar-track"><div class="h2h-bar-fill" style="width:' + p2 + '%"></div></div>'
           +     '<div class="h2h-di-top h2h-di-top--right">'
           +       (win2 ? CK : '')
           +       '<span class="' + cls2.trim() + '">' + b2.di.toFixed(1) + '</span>'
           +     '</div>'
           +   '</div>'
           + '</div>';
    }

    // % change row with optional checkmark for scored stats
    function pctRow(p1, label, p2, scored) {
      var c1   = p1 === null ? '' : p1 > 0 ? 'h2h-val--up' : p1 < 0 ? 'h2h-val--down' : '';
      var c2   = p2 === null ? '' : p2 > 0 ? 'h2h-val--up' : p2 < 0 ? 'h2h-val--down' : '';
      var win1 = scored && p1 !== null && p2 !== null && p1 > p2;
      var win2 = scored && p1 !== null && p2 !== null && p2 > p1;
      if (win1) c1 += ' h2h-val--win';
      if (win2) c2 += ' h2h-val--win';
      var s1 = p1 !== null ? fmtPct(p1) : '\u2014';
      var s2 = p2 !== null ? fmtPct(p2) : '\u2014';
      return '<div class="h2h-stat-row">'
           +   '<div class="h2h-val-wrap">'
           +     '<div class="h2h-val ' + c1.trim() + '">' + esc(s1) + '</div>'
           +     (win1 ? CK : '')
           +   '</div>'
           +   '<div class="h2h-stat-label">' + esc(label) + '</div>'
           +   '<div class="h2h-val-wrap h2h-val-wrap--right">'
           +     (win2 ? CK : '')
           +     '<div class="h2h-val h2h-val--right ' + c2.trim() + '">' + esc(s2) + '</div>'
           +   '</div>'
           + '</div>';
    }

    // ── Brand header with rank, cat rank, and founded/HQ context ─────────
    function brandHd(b, cr, fd, hq, isRight) {
      var cls    = 'h2h-brand-hd' + (isRight ? ' h2h-brand-hd--right' : '');
      var crHtml = cr
        ? '<div class="h2h-brand-hd-catrank">Rank ' + cr.rank + ' in ' + esc(cr.category) + '</div>'
        : '';
      var ctxParts = [];
      if (fd) ctxParts.push(esc(fd));
      if (hq) ctxParts.push(esc(hq));
      var ctxHtml = ctxParts.length
        ? '<div class="h2h-brand-hd-context">' + ctxParts.join(' &middot; ') + '</div>'
        : '';
      return '<a href="/brands/' + esc(b.id) + '/" class="' + cls + '" data-brand-id="' + esc(b.id) + '">'
           +   logoImg(b, 'h2h-logo', 40)
           +   '<div class="h2h-brand-hd-name">' + esc(b.name) + '</div>'
           +   '<div class="h2h-brand-hd-rank">Rank #' + b.rank + '</div>'
           +   crHtml
           +   ctxHtml
           + '</a>';
    }

    // Copy-link URL for this match-up
    var copyUrl = 'https://dormied.com/matchups/' + todayStr + '/';

    // ── Assemble ──────────────────────────────────────────────────────────
    el.innerHTML =
        '<span class="h2h-category">' + esc(matchup.category) + '</span>'
      + '<div class="h2h-vs-row">'
      +   brandHd(b1, cr1, fd1, hq1, false)
      +   '<div class="h2h-vs-badge">VS</div>'
      +   brandHd(b2, cr2, fd2, hq2, true)
      + '</div>'
      + '<div class="h2h-stat-grid">'
      +   diRow()
      +   pctRow(mm1, 'M/M Change',    mm2, true)
      +   pctRow(tm1, '3M Trend',      tm2, true)
      +   pctRow(yr1, '12M Trend',     yr2, true)
      + '</div>'
      + '<div class="h2h-footer">'
      +   '<a href="/brands/' + esc(b1.id) + '/" class="h2h-cta">' + esc(b1.name) + ' \u2192</a>'
      +   '<a href="/brands/' + esc(b2.id) + '/" class="h2h-cta h2h-cta--right">' + esc(b2.name) + ' \u2192</a>'
      + '</div>'
      + '<div class="h2h-result" id="h2h-result-panel">'
      +   '<div class="h2h-result-score-row">'
      +     '<div class="h2h-result-score">' + resultDisplay + '</div>'
      +   '</div>'
      +   '<div class="h2h-result-writeup" id="h2h-result-writeup">'
      +     '<span class="h2h-writeup-loading"></span>'
      +   '</div>'
      + '</div>';

    // ── Fetch result writeup (async) ──────────────────────────────────────
    fetchMatchupResult({
      brand_a_id:   b1.id,   brand_a_name: b1.name,  brand_a_logo: b1.logo || '',
      brand_b_id:   b2.id,   brand_b_name: b2.name,  brand_b_logo: b2.logo || '',
      brand_a_di:   b1.di,   brand_b_di:   b2.di,
      brand_a_mom:  mm1,     brand_b_mom:  mm2,
      brand_a_3m:   tm1,     brand_b_3m:   tm2,
      brand_a_12m:  yr1,     brand_b_12m:  yr2,
      result_score: resultScore,
      result_winner: resultWinner,
      pts_a: pts1, pts_b: pts2,
      category: matchup.category,
      date: todayStr,
    });
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── FETCH MATCH-UP RESULT WRITE-UP ──────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function fetchMatchupResult(payload) {
    var cacheKey  = 'dormied_matchup_result_' + payload.date;
    var writeupEl = document.getElementById('h2h-result-writeup');
    if (!writeupEl) return;

    var cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      writeupEl.innerHTML = '<p class="h2h-writeup-text">' + esc(cached) + '</p>';
      return;
    }

    fetch('/api/matchup-result', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      if (data.writeup) {
        sessionStorage.setItem(cacheKey, data.writeup);
        if (writeupEl) {
          writeupEl.innerHTML = '<p class="h2h-writeup-text">' + esc(data.writeup) + '</p>';
        }
      } else {
        if (writeupEl) writeupEl.innerHTML = '';
      }
    })
    .catch(function (err) {
      console.warn('[matchup-result] fetch failed:', err.message);
      if (writeupEl) writeupEl.innerHTML = '';
    });
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── RENDER: HERO MONTH LABEL ─────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function renderHeroMeta() {
    var meta    = window.DORMIED_DATA.meta;
    var monthEl = document.getElementById('hero-month');
    if (monthEl) monthEl.textContent = meta.currentMonth;
    var monthEl2 = document.getElementById('hero-month-2');
    if (monthEl2) monthEl2.textContent = meta.currentMonth;
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── EXPLANATIONS PATCH ────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function patchExplanations(monthLabel) {
    if (!window.DORMIED_EXPLANATIONS) return;
    var EXP        = window.DORMIED_EXPLANATIONS;
    var toBullets  = (window.DORMIED_UTILS && window.DORMIED_UTILS.explanationToBullets)
                     || function (t) { return '<p>' + t + '</p>'; };

    EXP.preload(monthLabel).then(function () {
      var whySection = document.getElementById('why-moved-section');
      var whyList    = document.getElementById('why-moved-list');
      var whyMonth   = document.getElementById('why-moved-month');

      if (whySection && whyList) {
        if (whyMonth) whyMonth.textContent = monthLabel;

        var seen  = {};
        var items = [];
        var cards = document.querySelectorAll('#sb-movers .sb-card');
        cards.forEach(function (card) {
          if (items.length >= 5) return;
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
  /* ── BOOT ─────────────────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── MOST VIEWED BRANDS ───────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  var SUPABASE_URL      = 'https://cimmmmnapdthqvtifpzr.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpbW1tbW5hcGR0aHF2dGlmcHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NzE3NTksImV4cCI6MjA4OTM0Nzc1OX0.yejRXgvODw3bMr3oA9IiNA-MIZsHHkxmDZouJmEgDfI';

  function fetchMostViewedBrands() {
    return fetch(SUPABASE_URL + '/rest/v1/brand_views_7d?limit=20', {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      }
    })
    .then(function (r) { return r.ok ? r.json() : []; })
    .catch(function () { return []; });
  }

  function renderMostViewed(viewData, ranked) {
    var el = document.getElementById('most-viewed-list');
    var section = document.querySelector('.most-viewed-section');
    if (!el) return;

    // Build a lookup from ranked for DI + pct
    var rankMap = {};
    ranked.forEach(function (b) { rankMap[b.id] = b; });

    // Fall back to top 15 by DI when no view data yet
    var displayData;
    if (!viewData || viewData.length < 3) {
      displayData = ranked.slice(0, 15).map(function (b) { return { brand_id: b.id }; });
    } else {
      displayData = viewData;
    }

    var cards = displayData.map(function (v, i) {
      var r = rankMap[v.brand_id];
      if (!r) return '';
      var pct = r.pct !== null ? fmtPct(r.pct) : null;
      var pctCls = r.pct > 0 ? 'mv-pct--up' : r.pct < 0 ? 'mv-pct--down' : 'mv-pct--flat';
      return '<a href="/brands/' + esc(r.id) + '/" class="mv-card">'
        + logoImg(r, 'mv-logo', 100)
        + '<div class="mv-name">' + esc(r.name) + '</div>'
        + '<div class="mv-stats">'
        +   '<span class="mv-rank">#' + r.rank + '</span>'
        +   '<span class="mv-dot">·</span>'
        +   '<span class="mv-di">' + (r.di != null ? r.di.toFixed(1) : '—') + '</span>'
        +   (pct ? '<span class="mv-dot">·</span><span class="mv-pct ' + pctCls + '">' + pct + '</span>' : '')
        + '</div>'
        + '</a>';
    }).join('');

    el.innerHTML = cards;
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── FLAG EMOJI ───────────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  // Asset-based flags: home nations use SVG images (NIR = Ulster Banner),
  // all others use ISO 3166-1 regional indicator emoji.
  var HOME_NATIONS_IMG = {
    ENG: { file: 'eng', label: 'England' },
    NIR: { file: 'nir', label: 'Northern Ireland' },
    SCO: { file: 'sco', label: 'Scotland' },
    WAL: { file: 'wal', label: 'Wales' }
  };
  function flagHtml(countryCode, nation) {
    if (nation && HOME_NATIONS_IMG[nation]) {
      var n = HOME_NATIONS_IMG[nation];
      return '<img src="/images/flags/' + n.file + '.svg" alt="' + esc(n.label) + ' flag" width="20" height="12" style="display:inline-block;border-radius:1px;vertical-align:middle">';
    }
    if (!countryCode || countryCode.length !== 2) return '';
    var base = 0x1F1E6;
    var c1 = countryCode.charCodeAt(0) - 65;
    var c2 = countryCode.charCodeAt(1) - 65;
    if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) return '';
    return String.fromCodePoint(base + c1) + String.fromCodePoint(base + c2);
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── MOST VIEWED WITBs ────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function fetchMostViewedPlayers() {
    var hdrs = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY };

    // Step 1: top 10 by view_count descending
    return fetch(SUPABASE_URL + '/rest/v1/player_views_7d?select=player_id,view_count&order=view_count.desc&limit=10', {
      headers: hdrs
    })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      if (!rows || !rows.length) return [];

      // Step 2: fetch player details for these IDs
      // player_views_7d.player_id is text; witb_players.id is uuid — Supabase casts automatically
      var ids = rows.map(function (v) { return v.player_id; }).join(',');
      return fetch(SUPABASE_URL + '/rest/v1/witb_players?select=id,name,slug,owgr_rank,country_code,nation&id=in.(' + ids + ')', {
        headers: hdrs
      })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (players) {
        var pm = {};
        players.forEach(function (p) { pm[p.id] = p; });

        // Step 3: join and sort by view_count desc, owgr_rank asc for ties
        var joined = rows.map(function (v) {
          return { view_count: v.view_count, player: pm[v.player_id] };
        }).filter(function (x) { return x.player; });

        joined.sort(function (a, b) {
          if (b.view_count !== a.view_count) return b.view_count - a.view_count;
          return (a.player.owgr_rank || 9999) - (b.player.owgr_rank || 9999);
        });

        return joined;
      });
    })
    .catch(function () { return []; });
  }

  function renderMostViewedPlayers(viewData) {
    var el = document.getElementById('most-viewed-witb-list');
    if (!el) return;
    if (!viewData || !viewData.length) {
      el.innerHTML = '';
      return;
    }

    var cards = viewData.map(function (item) {
      var p      = item.player;
      var flag   = flagHtml(p.country_code, p.nation);
      var parts  = (p.name || '').trim().split(/\s+/);
      var first  = parts[0] || '';
      var last   = parts.slice(1).join(' ') || '';
      return '<a href="/witb/players/' + esc(p.slug) + '/" class="mv-card mv-witb-card">'
        + '<div class="mv-name mv-name--first">' + esc(first) + '</div>'
        + (last ? '<div class="mv-name mv-name--last">' + esc(last) + '</div>' : '')
        + '<div class="mv-witb-meta">'
        + (flag ? '<span class="mv-witb-flag">' + flag + '</span>' : '')
        + (p.owgr_rank ? '<span class="mv-witb-rank">#' + p.owgr_rank + '</span>' : '')
        + '</div>'
        + '</a>';
    }).filter(Boolean).join('');

    el.innerHTML = cards;
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /* ── WITB LEADERS ─────────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────────────── */
  function renderWitbLeaders(leaders) {
    if (!leaders) return;

    // Brand logo lookup by dormied slug (same key as DORMIED_DATA.brands[].id)
    var brandMap = {};
    if (window.DORMIED_DATA && window.DORMIED_DATA.brands) {
      window.DORMIED_DATA.brands.forEach(function (b) { brandMap[b.id] = b; });
    }

    function modelCard(d) {
      var b    = d.dormiedSlug ? brandMap[d.dormiedSlug] : null;
      var logo = b ? logoImg(b, 'witb-ldr-logo', 20) : '<span class="witb-ldr-brand-text">' + esc(d.brand) + '</span>';
      var inner = logo
        + '<span class="sb-card-name">' + esc(d.brand + ' ' + d.model) + '</span>'
        + '<span class="witb-ldr-count">' + d.count + '</span>';
      return d.dormiedSlug
        ? '<a href="/brands/' + esc(d.dormiedSlug) + '/" class="sb-card" style="color:var(--text)">' + inner + '</a>'
        : '<div class="sb-card">' + inner + '</div>';
    }

    var topCol = document.getElementById('witb-leaders-top');
    if (topCol) {
      var rows1 = (leaders.topPlayers || []).map(function (p) {
        var flag  = flagHtml(p.country_code, p.nation);
        return '<a href="/witb/players/' + esc(p.slug) + '/" class="sb-card" style="color:var(--text)">'
          + '<span class="witb-ldr-flag">' + flag + '</span>'
          + '<span class="sb-card-name">' + esc(p.name) + '</span>'
          + '<span class="witb-ldr-rank">#' + p.owgr_rank + '</span>'
          + '</a>';
      }).join('');
      topCol.innerHTML = '<div class="sb-col-title">World Ranking</div>' + rows1;
    }

    var driverCol = document.getElementById('witb-leaders-drivers');
    if (driverCol) {
      driverCol.innerHTML = '<div class="sb-col-title">Drivers</div>'
        + (leaders.topDrivers || []).map(modelCard).join('');
    }

    var putterCol = document.getElementById('witb-leaders-putters');
    if (putterCol) {
      putterCol.innerHTML = '<div class="sb-col-title">Putters</div>'
        + (leaders.topPutters || []).map(modelCard).join('');
    }
  }

  function init() {
    if (!window.DORMIED_DATA) {
      console.warn('[home.js] DORMIED_DATA not found');
      return;
    }

    // Update CTA button with live brand count from data
    var ctaBtn = document.getElementById('home-cta-brands-btn');
    if (ctaBtn && window.DORMIED_DATA.meta && window.DORMIED_DATA.meta.totalBrands) {
      ctaBtn.textContent = 'See all ' + window.DORMIED_DATA.meta.totalBrands + ' brands in the full Index →';
    }

    var ranked  = computeHomeRankings();
    var markets = computeMarketPulse();
    var matchup = getDailyMatchup(ranked);

    renderHeroMeta();
    renderMarketPulse(markets);
    renderScoreboard(ranked);
    renderH2H(matchup, ranked);

    // Most viewed brands — async, non-blocking
    fetchMostViewedBrands().then(function (data) {
      renderMostViewed(data, ranked);
    });

    // WITB Leaders (pre-computed at build time) + Most Viewed WITBs (live)
    var witbLeaders = window.DORMIED_WITB_LEADERS;
    if (witbLeaders) {
      renderWitbLeaders(witbLeaders);
      fetchMostViewedPlayers().then(function (data) {
        renderMostViewedPlayers(data);
      });
    }

    patchExplanations(window.DORMIED_DATA.meta.currentMonth);

    if (matchup && window.DORMIED_TRACK) {
      window.DORMIED_TRACK('h2h_comparison', {
        brand_a: matchup.brand1.name,
        brand_b: matchup.brand2.name,
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
