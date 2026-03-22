/* ═══════════════════════════════════════════════════════════════════════════
   DORMIED Brand Page — brand.js
   Golf leaderboard meets Bloomberg Terminal
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Golf's major calendar events — used for chart overlays.
  // monthIdx is 0-based (0=Jan, 2=Mar, etc.).
  // `recurring: true` = appears every year; `years` = specific years only.
  const GOLF_EVENTS = [
    { name: 'The Players',      abbr: 'PLY', monthIdx: 2, color: 'rgba(74,222,128,0.7)',  recurring: true },
    { name: 'The Masters',      abbr: 'MAS', monthIdx: 3, color: 'rgba(34,197,94,0.9)',   recurring: true },
    { name: 'PGA Championship', abbr: 'PGA', monthIdx: 4, color: 'rgba(134,239,172,0.7)', recurring: true },
    { name: 'US Open',          abbr: 'USO', monthIdx: 5, color: 'rgba(74,222,128,0.7)',  recurring: true },
    { name: 'The Open',         abbr: 'OPN', monthIdx: 6, color: 'rgba(134,239,172,0.7)', recurring: true },
    { name: "Presidents Cup",   abbr: 'PRC', monthIdx: 8, years: [2024, 2026],             color: 'rgba(96,165,250,0.8)' },
    { name: 'Ryder Cup',        abbr: 'RYD', monthIdx: 9, years: [2023, 2025],             color: 'rgba(245,158,11,0.8)' },
  ];

  // ─── State ────────────────────────────────────────────────────────────────

  let brand       = null;   // current brand object
  let rankings    = [];     // global rankings for current month (all brands sorted)
  let chartInst   = null;   // Chart.js instance
  let chartMarket = 'global';
  let chartMonths = 0;      // 0 = ALL; 3/6/12 = slice

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function shiftMonth(label, delta) {
    const [mon, year] = label.split(' ');
    const total = parseInt(year) * 12 + MONTH_NAMES.indexOf(mon) + delta;
    return `${MONTH_NAMES[((total % 12) + 12) % 12]} ${Math.floor(total / 12)}`;
  }

  function getAllMonths() {
    const data = window.DORMIED_DATA;
    const s = data.brands[0]?.searchesByMarket?.global || {};
    return Object.keys(s).sort((a, b) => {
      const [am, ay] = a.split(' ');
      const [bm, by] = b.split(' ');
      return (parseInt(ay) * 12 + MONTH_NAMES.indexOf(am)) -
             (parseInt(by) * 12 + MONTH_NAMES.indexOf(bm));
    });
  }

  function projectSearches(searches, targetMonth) {
    const recentVals = [shiftMonth(targetMonth, -3), shiftMonth(targetMonth, -2), shiftMonth(targetMonth, -1)]
      .map(m => searches[m] || 0).filter(v => v > 0);
    if (recentVals.length === 0) return 0;
    const recentAvg = recentVals.reduce((a, b) => a + b, 0) / recentVals.length;
    const sameHistVals = [shiftMonth(targetMonth, -12), shiftMonth(targetMonth, -24)]
      .map(m => searches[m] || 0).filter(v => v > 0);
    const precHistVals = [
      shiftMonth(targetMonth, -15), shiftMonth(targetMonth, -14), shiftMonth(targetMonth, -13),
      shiftMonth(targetMonth, -27), shiftMonth(targetMonth, -26), shiftMonth(targetMonth, -25),
    ].map(m => searches[m] || 0).filter(v => v > 0);
    if (sameHistVals.length === 0 || precHistVals.length === 0) return Math.round(recentAvg);
    const sameHistAvg = sameHistVals.reduce((a, b) => a + b, 0) / sameHistVals.length;
    const precHistAvg = precHistVals.reduce((a, b) => a + b, 0) / precHistVals.length;
    const factor = precHistAvg > 0 ? Math.min(3.0, Math.max(0.3, sameHistAvg / precHistAvg)) : 1.0;
    return Math.round(recentAvg * factor);
  }

  function getInitials(name) {
    return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  // Format a raw search volume into a compact readable string.
  function fmtVol(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return n.toLocaleString();
  }

  const BG_PALETTE = [
    '#14532d','#1e3a5f','#7c2d12','#4a1d96',
    '#064e3b','#1e1b4b','#7f1d1d','#1c1917',
    '#0c4a6e','#365314','#6b21a8','#831843',
  ];

  function getBgColor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return BG_PALETTE[h % BG_PALETTE.length];
  }

  function fmtPct(val, decimals = 1) {
    if (val === null || val === undefined) return '—';
    const s = (val > 0 ? '+' : '') + val.toFixed(decimals) + '%';
    return s;
  }

  function pctClass(val, threshold = 0) {
    if (val === null || val === undefined) return 'change-flat';
    return val > threshold ? 'change-up' : val < -threshold ? 'change-down' : 'change-flat';
  }

  // ─── Projected month injection ─────────────────────────────────────────────

  function injectProjections() {
    const data = window.DORMIED_DATA;
    const projMonth = shiftMonth(data.meta.currentMonth, 1);
    data.meta.projectedMonth = projMonth;
    const marketKeys = data.meta.markets.map(m => m.key);
    data.brands.forEach(b => {
      marketKeys.forEach(key => {
        const mkt = b.searchesByMarket?.[key];
        if (!mkt) return;
        mkt[projMonth] = projectSearches(mkt, projMonth);
      });
    });
    return projMonth;
  }

  // ─── Rankings computation ──────────────────────────────────────────────────

  // Returns array of brand objects sorted by global DI for currentMonth,
  // each augmented with { rank, diScore }.
  // Tiebreaker mirrors app.js calculateRankings(): prev-month DI → 3-months-ago DI.
  function computeGlobalRankings() {
    const data  = window.DORMIED_DATA;
    const cm    = data.meta.currentMonth;
    const pm    = data.meta.previousMonth;
    const ago3m = shiftMonth(cm, -3);
    const vals  = data.brands.map(b => ({
      ...b,
      cur:   b.searchesByMarket?.global?.[cm]    || 0,
      prev:  b.searchesByMarket?.global?.[pm]    || 0,
      ago3:  b.searchesByMarket?.global?.[ago3m] || 0,
    }));
    const max      = Math.max(...vals.map(v => v.cur));
    const prevMax  = Math.max(...vals.map(v => v.prev));
    const ago3Max  = Math.max(...vals.map(v => v.ago3));

    // Build previous-period rank map for tiebreaking (same logic as app.js)
    const prevSorted = [...vals].sort((a, b) => {
      const diff = b.prev - a.prev;
      if (Math.abs(diff) > 0.0001) return diff;
      return b.ago3 - a.ago3;
    });
    const prevRankMap = new Map();
    prevSorted.forEach((b, i) => prevRankMap.set(b.id, i + 1));

    const ago3Sorted = [...vals].sort((a, b) => b.ago3 - a.ago3);
    const ago3RankMap = new Map();
    ago3Sorted.forEach((b, i) => ago3RankMap.set(b.id, i + 1));

    const sorted = [...vals].sort((a, b) => {
      const diff = b.cur - a.cur;
      if (Math.abs(diff) > 0.0001) return diff;
      const prevDiff = (prevRankMap.get(a.id) || 9999) - (prevRankMap.get(b.id) || 9999);
      if (prevDiff !== 0) return prevDiff;
      return (ago3RankMap.get(a.id) || 9999) - (ago3RankMap.get(b.id) || 9999);
    });

    return sorted.map((b, i) => ({
      ...b,
      rank:    i + 1,
      diScore: max > 0 ? parseFloat((b.cur / max * 100).toFixed(1)) : 0,
    }));
  }

  // Compute per-market stats for the current brand.
  // Returns array of { market, rank, di, vsMonth, vsYear } for all 11 markets.
  function computeMarketStats() {
    const data  = window.DORMIED_DATA;
    const cm    = data.meta.currentMonth;
    const pm    = data.meta.previousMonth;
    const ago3m = shiftMonth(cm, -3);
    const yam   = shiftMonth(cm, -12);
    return data.meta.markets.map(mkt => {
      const key = mkt.key;
      const mktSearches = brand.searchesByMarket?.[key] || {};
      const allVals = data.brands.map(b => b.searchesByMarket?.[key]?.[cm] || 0);
      const max = Math.max(...allVals);
      const cur  = mktSearches[cm]  || 0;
      const prev = mktSearches[pm]  || 0;
      const ya   = mktSearches[yam] || 0;

      // Build prev-month rank map for tiebreaking — mirrors app.js calculateRankings()
      const prevSortedMkt = [...data.brands].sort((a, b) => {
        const diff = (b.searchesByMarket?.[key]?.[pm] || 0) - (a.searchesByMarket?.[key]?.[pm] || 0);
        if (Math.abs(diff) > 0.0001) return diff;
        return (b.searchesByMarket?.[key]?.[ago3m] || 0) - (a.searchesByMarket?.[key]?.[ago3m] || 0);
      });
      const prevRankMkt = new Map();
      prevSortedMkt.forEach((b, i) => prevRankMkt.set(b.id, i + 1));

      const ago3SortedMkt = [...data.brands].sort((a, b) =>
        (b.searchesByMarket?.[key]?.[ago3m] || 0) - (a.searchesByMarket?.[key]?.[ago3m] || 0)
      );
      const ago3RankMkt = new Map();
      ago3SortedMkt.forEach((b, i) => ago3RankMkt.set(b.id, i + 1));

      const sorted = [...data.brands].sort((a, b) => {
        const diff = (b.searchesByMarket?.[key]?.[cm] || 0) - (a.searchesByMarket?.[key]?.[cm] || 0);
        if (Math.abs(diff) > 0.0001) return diff;
        const prevDiff = (prevRankMkt.get(a.id) || 9999) - (prevRankMkt.get(b.id) || 9999);
        if (prevDiff !== 0) return prevDiff;
        return (ago3RankMkt.get(a.id) || 9999) - (ago3RankMkt.get(b.id) || 9999);
      });
      const rank         = sorted.findIndex(b => b.id === brand.id) + 1;
      const di           = max > 0 ? parseFloat((cur / max * 100).toFixed(1)) : 0;
      const totalSearches = data.brands.reduce((s, b) => s + (b.searchesByMarket?.[key]?.[cm] || 0), 0);
      return {
        key, label: mkt.label, flag: mkt.flag,
        rank: rank || null,
        di,
        vsMonth: prev > 0 ? (cur - prev) / prev * 100 : null,
        vsYear:  ya   > 0 ? (cur - ya)   / ya   * 100 : null,
        totalSearches,
      };
    });
  }

  // Compute best rank and month across all 36 historical months (global).
  function computeAllTimeStats() {
    const data     = window.DORMIED_DATA;
    const projM    = data.meta.projectedMonth;
    const allM     = getAllMonths().filter(m => m !== projM);
    let bestRank   = Infinity, bestMonth = null;
    let w52High = 0, w52Low = Infinity, w52LowMonth = null;
    const last12   = allM.slice(-12);

    allM.forEach(month => {
      const vals = data.brands.map(b => b.searchesByMarket?.global?.[month] || 0);
      vals.sort((a, b) => b - a);
      const bVal  = brand.searchesByMarket?.global?.[month] || 0;
      const rank  = vals.indexOf(bVal) + 1;
      if (rank > 0 && rank < bestRank) { bestRank = rank; bestMonth = month; }
    });

    last12.forEach(month => {
      const v = brand.searchesByMarket?.global?.[month] || 0;
      if (v > w52High) w52High = v;
      if (v < w52Low)  { w52Low = v; w52LowMonth = month; }
    });

    return {
      bestRank:    bestRank === Infinity ? null : bestRank,
      bestMonth,
      w52High,
      w52Low:     w52Low === Infinity ? 0 : w52Low,
    };
  }

  // Compute country dominance: markets where brand over-indexes by ≥30%.
  function computeDominance() {
    const data = window.DORMIED_DATA;
    const cm   = data.meta.currentMonth;
    const globalTotal = data.brands.reduce((s, b) => s + (b.searchesByMarket?.global?.[cm] || 0), 0);
    const brandGlobal = brand.searchesByMarket?.global?.[cm] || 0;
    if (globalTotal === 0 || brandGlobal === 0) return [];

    return data.meta.markets
      .filter(mkt => mkt.key !== 'global')
      .filter(mkt => {
        const mktTotal  = data.brands.reduce((s, b) => s + (b.searchesByMarket?.[mkt.key]?.[cm] || 0), 0);
        const brandMkt  = brand.searchesByMarket?.[mkt.key]?.[cm] || 0;
        if (mktTotal === 0) return false;
        const brandShare = brandMkt  / mktTotal;
        const indexShare = globalTotal > 0 ? (data.brands.reduce((s, b) => s + (b.searchesByMarket?.[mkt.key]?.[cm] || 0), 0) / globalTotal) : 0;
        // Simpler: brand's fraction of this market vs brand's fraction of global
        const brandFracMkt    = brandMkt    / mktTotal;
        const brandFracGlobal = brandGlobal / globalTotal;
        return brandFracMkt > 0 && brandFracMkt / brandFracGlobal >= 1.3;
      })
      .map(mkt => ({ flag: mkt.flag, label: mkt.label }));
  }

  // Category rank for this brand in its primary category.
  // Tiebreaker mirrors app.js: prev-month rank → ago3 rank.
  function computeCategoryRank() {
    const data    = window.DORMIED_DATA;
    const cm      = data.meta.currentMonth;
    const pm      = data.meta.previousMonth;
    const ago3m   = shiftMonth(cm, -3);
    const primary = brand.category;

    function canonicalSort(list) {
      const prevS = [...list].sort((a, b) => {
        const d = (b.searchesByMarket?.global?.[pm] || 0) - (a.searchesByMarket?.global?.[pm] || 0);
        if (Math.abs(d) > 0.0001) return d;
        return (b.searchesByMarket?.global?.[ago3m] || 0) - (a.searchesByMarket?.global?.[ago3m] || 0);
      });
      const prevRank = new Map(prevS.map((b, i) => [b.id, i + 1]));
      const ago3S = [...list].sort((a, b) =>
        (b.searchesByMarket?.global?.[ago3m] || 0) - (a.searchesByMarket?.global?.[ago3m] || 0));
      const ago3Rank = new Map(ago3S.map((b, i) => [b.id, i + 1]));
      return [...list].sort((a, b) => {
        const d = (b.searchesByMarket?.global?.[cm] || 0) - (a.searchesByMarket?.global?.[cm] || 0);
        if (Math.abs(d) > 0.0001) return d;
        const pd = (prevRank.get(a.id) || 9999) - (prevRank.get(b.id) || 9999);
        if (pd !== 0) return pd;
        return (ago3Rank.get(a.id) || 9999) - (ago3Rank.get(b.id) || 9999);
      });
    }

    const inCat   = canonicalSort(data.brands.filter(b => b.category === primary));
    const catRank = inCat.findIndex(b => b.id === brand.id) + 1;

    // Also compute per-subcategory rank
    const subcatRanks = (brand.subCategories || []).map(sc => {
      const inSC = canonicalSort(data.brands.filter(b => (b.subCategories || []).includes(sc)));
      return { name: sc, rank: inSC.findIndex(b => b.id === brand.id) + 1, total: inSC.length };
    });

    return { primary, catRank, catTotal: inCat.length, subcatRanks };
  }

  // Similar brands: same primary category, closest current DI.
  function computeSimilarBrands() {
    const data   = window.DORMIED_DATA;
    const cm     = data.meta.currentMonth;
    const max    = Math.max(...data.brands.map(b => b.searchesByMarket?.global?.[cm] || 0));
    const myDI   = max > 0 ? (brand.searchesByMarket?.global?.[cm] || 0) / max * 100 : 0;
    return data.brands
      .filter(b => b.id !== brand.id && b.category === brand.category)
      .map(b => {
        const rankRef = rankings.find(r => r.id === b.id);
        return {
          ...b,
          rank:    rankRef ? rankRef.rank : null,
          diScore: max > 0 ? parseFloat(((b.searchesByMarket?.global?.[cm] || 0) / max * 100).toFixed(1)) : 0,
          dist:    Math.abs(((b.searchesByMarket?.global?.[cm] || 0) / max * 100) - myDI),
        };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 4);
  }

  // YoY and 3M momentum for the brand (global).
  function computeBrandMetrics() {
    const data   = window.DORMIED_DATA;
    const cm     = data.meta.currentMonth;
    const pm     = data.meta.previousMonth;
    const yam    = shiftMonth(cm, -12);
    const projM  = data.meta.projectedMonth;
    const globalS = brand.searchesByMarket?.global || {};
    const allActual = getAllMonths().filter(m => m !== projM);
    const cmIdx  = allActual.indexOf(cm);
    const last3  = allActual.slice(Math.max(0, cmIdx - 2), cmIdx + 1);
    const prior3 = allActual.slice(Math.max(0, cmIdx - 5), Math.max(0, cmIdx - 2));

    const cur  = globalS[cm]  || 0;
    const prev = globalS[pm]  || 0;
    const ya   = globalS[yam] || 0;

    const yoy  = ya > 0 ? (cur - ya) / ya * 100 : null;
    const mom  = (() => {
      const l3avg = last3.reduce((s, m)  => s + (globalS[m] || 0), 0) / Math.max(last3.length,  1);
      const p3avg = prior3.reduce((s, m) => s + (globalS[m] || 0), 0) / Math.max(prior3.length, 1);
      return p3avg > 0 ? (l3avg - p3avg) / p3avg * 100 : null;
    })();

    return { yoy, mom, cur, prev, vsMonth: prev > 0 ? (cur - prev) / prev * 100 : null };
  }

  // ─── Logo builder ──────────────────────────────────────────────────────────

  function buildLogoHtml(b, size = 64) {
    const bg       = getBgColor(b.id);
    const initials = getInitials(b.name);
    if (b.logo) {
      const faviconSrc = b.logo.replace(/sz=\d+/, `sz=${size}`);
      const initialsHtml = `<span class=\\'bp-logo-initials\\' style=\\'background:${bg};width:${size}px;height:${size}px\\'>${initials}</span>`;

      // For large display sizes (brand page header), try Clearbit Logo API first —
      // it serves proper vector-derived PNGs, far sharper than the Google Favicon
      // service which just upscales whatever small favicon the site has registered.
      // Fallback chain: Clearbit → Google Favicon → initials block.
      if (size >= 96 && b.logo.includes('googleusercontent.com/s2/favicons')) {
        const domainMatch = b.logo.match(/domain=([^&]+)/);
        if (domainMatch) {
          const clearbitSrc = `https://logo.clearbit.com/${domainMatch[1]}`;
          return `<img src="${clearbitSrc}" alt="${b.name}" class="bp-logo-img" width="${size}" height="${size}"
               style="width:${size}px;height:${size}px"
               onerror="this.src='${faviconSrc}';this.onerror=function(){this.style.display='none';this.insertAdjacentHTML('afterend','${initialsHtml}')}">`;
        }
      }

      // Small sizes (index table): Google Favicon is fine, no need for extra request
      return `<img src="${faviconSrc}" alt="${b.name}" class="bp-logo-img" width="${size}" height="${size}"
               style="width:${size}px;height:${size}px"
               onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${initialsHtml}')">`;
    }
    return `<span class="bp-logo-initials" style="background:${bg};width:${size}px;height:${size}px">${initials}</span>`;
  }

  // ─── Chart ────────────────────────────────────────────────────────────────

  function buildChartData() {
    const data    = window.DORMIED_DATA;
    const projM   = data.meta.projectedMonth;
    const allM    = getAllMonths(); // includes projected
    const mktS    = brand.searchesByMarket?.[chartMarket] || {};

    // Slice based on period
    let months = allM;
    if (chartMonths > 0) months = allM.slice(-chartMonths);

    // If chartMonths slices into actual range, always include the projected month at the end
    const projIdx = months.indexOf(projM);
    if (chartMonths > 0 && projIdx === -1 && months.length > 0) {
      months = [...months, projM];
    }

    const labels    = months;
    const brandRaw  = months.map(m => mktS[m] || 0);

    // ── Normalise to 0–100 index (brand's own all-time peak = 100) ──────────
    // Peak is derived from actual months only (not the projection) so the
    // scale stays stable regardless of which period tab is selected.
    const actualVals = months.filter(m => m !== projM).map(m => mktS[m] || 0);
    const peakBrand  = Math.max(...actualVals, 1);
    const brandData  = brandRaw.map(v => parseFloat((v / peakBrand * 100).toFixed(1)));

    // Global index average: each month's avg across all brands, normalised to
    // that average's own peak so it sits on the same 0–100 y-axis.
    const globalAvgRaw = months.map(m => {
      const vals = data.brands.map(b => b.searchesByMarket?.[chartMarket]?.[m] || 0);
      const nonZero = vals.filter(v => v > 0);
      return nonZero.length ? vals.reduce((a, b) => a + b, 0) / nonZero.length : 0;
    });
    const peakAvg       = Math.max(...globalAvgRaw, 1);
    const globalAvgData = globalAvgRaw.map(v => parseFloat((v / peakAvg * 100).toFixed(1)));

    // Split brand index into actual vs projected segments
    const projDataActual = months.map((m, i) => m !== projM ? brandData[i] : null);
    const projDataProj   = months.map((m, i) => {
      if (m === projM) return brandData[i];
      // bridge: connect last real point → projected point
      if (i === months.indexOf(projM) - 1) return brandData[i];
      return null;
    });

    return { labels, projDataActual, projDataProj, globalAvgData, projM, months };
  }

  // Plugin: draw vertical dashed lines + rotated 3-char abbreviations for tournament events.
  // Abbreviations are drawn along the bottom of each line reading upward — no horizontal
  // overlap even when 5 majors fall in adjacent spring months.
  const tournamentPlugin = {
    id: 'tournamentLines',
    afterDraw(chart) {
      const { ctx, scales: { x }, chartArea } = chart;
      if (!x) return;
      const labels = chart.data.labels;
      GOLF_EVENTS.forEach(ev => {
        labels.forEach((label, idx) => {
          const [mon, yr] = label.split(' ');
          const month = MONTH_NAMES.indexOf(mon);
          const year  = parseInt(yr);
          const isMatch = month === ev.monthIdx &&
            (ev.recurring || (ev.years || []).includes(year));
          if (!isMatch) return;
          const xPos = x.getPixelForValue(idx);

          // Dashed vertical line
          ctx.save();
          ctx.beginPath();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = ev.color;
          ctx.lineWidth   = 1.5;
          ctx.moveTo(xPos, chartArea.top);
          ctx.lineTo(xPos, chartArea.bottom);
          ctx.stroke();
          ctx.restore();

          // 3-char abbreviation drawn in the top-padding area (above chartArea.top).
          // Rotating +90° (CW) makes the +x axis point DOWN on screen, so the text
          // hangs downward from the anchor point — fully contained in the 28px padding
          // band above the chart data area. Each label takes only ~9px of horizontal
          // space (font em height), so adjacent-month events never overlap.
          ctx.save();
          ctx.translate(xPos + 3, chartArea.top - 26);
          ctx.rotate(Math.PI / 2);
          ctx.fillStyle    = ev.color;
          ctx.globalAlpha  = 0.95;
          ctx.font         = 'bold 8px JetBrains Mono, monospace';
          ctx.textAlign    = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(ev.abbr, 0, 0);
          ctx.restore();
        });
      });
    },
  };

  // Update the subtitle line below the market tabs:
  // e.g. "🌎 Global · 122 brands · 1.3M searches tracked"
  function updateChartSubtitle() {
    const el = document.getElementById('bp-chart-subtitle');
    if (!el) return;
    const data   = window.DORMIED_DATA;
    const cm     = data.meta.currentMonth;
    const market = data.meta.markets.find(m => m.key === chartMarket);
    const total  = data.brands.reduce((s, b) => s + (b.searchesByMarket?.[chartMarket]?.[cm] || 0), 0);
    el.textContent = `${market.flag} ${market.label} · ${data.brands.length} brands · ${fmtVol(total)} searches tracked`;
  }

  // Populate the tournament portion of the chart legend.
  // Shows only the event types that actually appear in the current label range.
  function updateTournamentLegend(labels) {
    const el = document.querySelector('.bp-chart-legend');
    if (!el) return;
    // Remove any previously injected tournament items
    el.querySelectorAll('.bp-legend-tournament').forEach(n => n.remove());

    const seen = new Set();
    labels.forEach(label => {
      const [mon, yr] = label.split(' ');
      const month = MONTH_NAMES.indexOf(mon);
      const year  = parseInt(yr);
      GOLF_EVENTS.forEach(ev => {
        if (seen.has(ev.abbr)) return;
        const isMatch = month === ev.monthIdx &&
          (ev.recurring || (ev.years || []).includes(year));
        if (isMatch) seen.add(ev.abbr);
      });
    });

    GOLF_EVENTS.forEach(ev => {
      if (!seen.has(ev.abbr)) return;
      const span = document.createElement('span');
      span.className = 'bp-legend-item bp-legend-tournament';
      span.innerHTML =
        `<span class="bp-legend-event-swatch" style="background:${ev.color}"></span>` +
        `<span class="bp-legend-event-abbr">${ev.abbr}</span>` +
        `<span class="bp-legend-event-name">${ev.name}</span>`;
      el.appendChild(span);
    });
  }

  function renderChart() {
    const { labels, projDataActual, projDataProj, globalAvgData, projM } = buildChartData();
    const canvas = document.getElementById('bp-chart');
    if (!canvas) return;

    if (chartInst) { chartInst.destroy(); chartInst = null; }

    // Update subtitle and tournament legend for the current market/period
    updateChartSubtitle();
    updateTournamentLegend(labels);

    const isProjected = labels.includes(projM);

    chartInst = new Chart(canvas, {
      type: 'line',
      plugins: [tournamentPlugin],
      data: {
        labels,
        datasets: [
          {
            label: 'Brand searches',
            data: projDataActual,
            borderColor:     '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.06)',
            fill: true,
            tension: 0.35,
            pointRadius: labels.length > 24 ? 0 : 3,
            pointHoverRadius: 5,
            borderWidth: 2,
            spanGaps: false,
          },
          {
            label: 'Projected',
            data: projDataProj,
            borderColor:     '#f59e0b',
            backgroundColor: 'rgba(245,158,11,0.04)',
            fill: false,
            tension: 0.35,
            borderDash: [8, 4],
            pointRadius: 4,
            pointBackgroundColor: '#f59e0b',
            borderWidth: 2,
            spanGaps: false,
          },
          {
            label: 'Global index avg',
            data: globalAvgData,
            borderColor:     '#4d6b4d',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            borderDash: [4, 4],
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 28 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0c140c',
            borderColor:     '#1a2e1a',
            borderWidth: 1,
            titleColor:  '#22c55e',
            bodyColor:   '#8aa88a',
            titleFont:   { family: 'JetBrains Mono', size: 11 },
            bodyFont:    { family: 'JetBrains Mono', size: 11 },
            callbacks: {
              title(items) { return items[0].label; },
              label(item) {
                const label = item.dataset.label;
                const val   = item.parsed.y;
                if (val === null) return null;
                return `${label}: ${val.toFixed(1)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid:  { color: 'rgba(26,46,26,0.5)', drawTicks: false },
            ticks: {
              color:   '#4d6b4d',
              font:    { family: 'JetBrains Mono', size: 9 },
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: 12,
              callback(val, idx) {
                const lbl = this.getLabelForValue(idx);
                const [mon, yr] = lbl.split(' ');
                return mon === 'Jan' ? `${mon} ${yr}` : mon;
              },
            },
          },
          y: {
            grid:  { color: 'rgba(26,46,26,0.5)', drawTicks: false },
            min: 0,
            max: 100,
            ticks: {
              color:    '#4d6b4d',
              font:     { family: 'JetBrains Mono', size: 10 },
              stepSize: 25,
              callback(v) { return v === 100 ? '100' : v; },
            },
          },
        },
      },
    });
  }

  // ─── Render functions ──────────────────────────────────────────────────────

  function renderHeader(metrics, allTimeStats, globalRank) {
    const data = window.DORMIED_DATA;
    const cm   = data.meta.currentMonth;
    const pm   = data.meta.previousMonth;

    document.getElementById('bp-logo').innerHTML = buildLogoHtml(brand, 128);

    const nameEl = document.getElementById('bp-name');
    nameEl.textContent = brand.name;

    // Heat icon (≥±5 rank movement)
    const prevRankMap = (() => {
      const vals = data.brands.map(b => ({
        id: b.id, v: b.searchesByMarket?.global?.[pm] || 0
      })).sort((a, b) => b.v - a.v);
      const m = new Map();
      vals.forEach((v, i) => m.set(v.id, i + 1));
      return m;
    })();
    const prevRank = prevRankMap.get(brand.id) || globalRank;
    const movement = prevRank - globalRank;
    const heatEl   = document.getElementById('bp-heat');
    if (movement >= 5)       heatEl.textContent = '🔥';
    else if (movement <= -5) heatEl.textContent = '🧊';
    else                     heatEl.hidden = true;

    // Meta line
    const parts = [brand.headquarters];
    if (brand.founded)       parts.push(`Est. ${brand.founded}`);
    if (brand.parentCompany && brand.parentCompany !== 'Independent') parts.push(brand.parentCompany);
    document.getElementById('bp-meta').textContent = parts.join(' · ');

    // Category + subcategory badges
    const badgesEl = document.getElementById('bp-badges');
    const CATEGORY_COLORS = {
      'Clubs & Balls':        { cls: 'cat-clubs' },
      'Apparel & Footwear':   { cls: 'cat-apparel' },
      'Tech & Training Aids': { cls: 'cat-tech' },
      'Bags & Accessories':   { cls: 'cat-bags' },
    };
    const catMeta = CATEGORY_COLORS[brand.category] || { cls: 'cat-other' };
    let html = `<span class="cat-badge ${catMeta.cls}">${brand.category}</span>`;
    (brand.subCategories || []).forEach(sc => {
      html += `<span class="subcat-tag">${sc}</span>`;
    });
    badgesEl.innerHTML = html;

    document.getElementById('bp-description').textContent = brand.description || '';

    // Rank block
    document.getElementById('bp-rank').textContent = `#${globalRank}`;
    const moveEl = document.getElementById('bp-move');
    if      (movement > 0)  moveEl.innerHTML = `<span class="move-badge move-up">▲${movement}</span>`;
    else if (movement < 0)  moveEl.innerHTML = `<span class="move-badge move-down">▼${Math.abs(movement)}</span>`;
    else                    moveEl.innerHTML = `<span class="move-badge move-same">—</span>`;
  }

  function renderMetrics(metrics, allTimeStats) {
    const data = window.DORMIED_DATA;
    const cm   = data.meta.currentMonth;
    const r    = rankings.find(b => b.id === brand.id);
    const di   = r ? r.diScore : 0;

    // vs 52W High: how far current searches sit below the 52-week peak (always ≤ 0,
    // or 0 when the current month IS the peak).
    const curSearches = brand.searchesByMarket?.global?.[cm] || 0;
    const vs52wh = allTimeStats.w52High > 0
      ? (curSearches - allTimeStats.w52High) / allTimeStats.w52High * 100
      : null;
    const vs52whLabel = vs52wh !== null && vs52wh >= -0.5 ? 'At 52W Peak' : fmtPct(vs52wh);

    const items = [
      {
        icon: '◆',
        label: 'DI Score',
        value: di.toFixed(1),
        cls: 'green-text',
        hint: 'DORMIED Index score (0–100)',
      },
      {
        icon: '↔',
        label: `vs ${data.meta.previousMonth}`,
        value: fmtPct(metrics.vsMonth),
        cls: pctClass(metrics.vsMonth),
      },
      {
        icon: '⟳',
        label: 'Year-over-Year',
        value: fmtPct(metrics.yoy),
        cls: pctClass(metrics.yoy),
      },
      {
        icon: '〜',
        label: '3-Month Trend',
        value: fmtPct(metrics.mom),
        cls: pctClass(metrics.mom, 5),
      },
      {
        icon: '🏆',
        label: 'Best Rank Ever',
        value: allTimeStats.bestRank ? `#${allTimeStats.bestRank}` : '—',
        sub: allTimeStats.bestMonth || '',
        cls: allTimeStats.bestRank === 1 ? 'gold-text' : 'green-text',
      },
      {
        icon: '↕',
        label: 'vs 52W High',
        value: vs52wh !== null ? vs52whLabel : '—',
        sub: '52-week range',
        cls: vs52wh !== null && vs52wh >= -0.5 ? 'green-text' : pctClass(vs52wh),
      },
      {
        icon: '⭐',
        label: 'Peak Month',
        value: allTimeStats.bestMonth || '—',
        sub: 'best rank achieved',
        cls: '',
      },
    ];

    // Website link as last item
    const websiteHtml = brand.website
      ? `<div class="bp-metric-card bp-metric-link">
           <a href="${brand.website}?utm_source=dormied&utm_medium=referral&utm_campaign=brand-index"
              target="_blank" rel="noopener noreferrer" class="bp-visit-link"
              data-track-brand="${brand.name}" data-track-url="${brand.website}">
             Visit ${brand.name}
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
           </a>
         </div>`
      : '';

    document.getElementById('bp-metrics').innerHTML =
      items.map(item => `
        <div class="bp-metric-card">
          <span class="bp-metric-icon">${item.icon}</span>
          <span class="bp-metric-label">${item.label}${item.hint ? ` <span class="th-hint" title="${item.hint}">?</span>` : ''}</span>
          <span class="bp-metric-val ${item.cls}">${item.value}</span>
          ${item.sub ? `<span class="bp-metric-sub">${item.sub}</span>` : ''}
        </div>`).join('') + websiteHtml;
  }

  function renderCountryTable(marketStats) {
    const tbody = document.getElementById('bp-country-tbody');
    tbody.innerHTML = marketStats.map(mkt => {
      const rankStr  = mkt.rank ? `#${mkt.rank}` : '—';
      const diStr    = mkt.di  ? mkt.di.toFixed(1) : '—';
      const momStr   = fmtPct(mkt.vsMonth);
      const yoyStr   = fmtPct(mkt.vsYear);
      const momCls   = pctClass(mkt.vsMonth);
      const yoyCls   = pctClass(mkt.vsYear);
      const volStr   = mkt.totalSearches > 0 ? fmtVol(mkt.totalSearches) : '—';
      const isGlobal = mkt.key === 'global';
      return `<tr class="${isGlobal ? 'bp-ct-global' : ''}">
        <td class="bp-ct-market"><span class="bp-ct-flag">${mkt.flag}</span> ${mkt.label}</td>
        <td class="bp-ct-rank"><span class="rank-num">${rankStr}</span></td>
        <td class="bp-ct-di"><span class="di-value">${diStr}</span></td>
        <td class="bp-ct-change"><span class="change-val ${momCls}">${momStr}</span></td>
        <td class="bp-ct-yoy"><span class="change-val ${yoyCls}">${yoyStr}</span></td>
        <td class="bp-ct-vol"><span class="bp-ct-vol-val">${volStr}</span></td>
      </tr>`;
    }).join('');
  }

  function renderDominance(dominanceMarkets) {
    const el = document.getElementById('bp-dominance');
    if (!dominanceMarkets.length) { el.hidden = true; return; }
    el.innerHTML = `
      <span class="bp-dominance-label">Over-indexes in:</span>
      ${dominanceMarkets.map(m => `<span class="bp-dominance-flag" title="${m.label}">${m.flag}</span>`).join('')}`;
  }

  function renderCategoryStanding(catData) {
    const { primary, catRank, catTotal, subcatRanks } = catData;
    const CATEGORY_COLORS = {
      'Clubs & Balls':        { cls: 'cat-clubs' },
      'Apparel & Footwear':   { cls: 'cat-apparel' },
      'Tech & Training Aids': { cls: 'cat-tech' },
      'Bags & Accessories':   { cls: 'cat-bags' },
    };
    const catMeta = CATEGORY_COLORS[primary] || { cls: 'cat-other' };
    let html = `
      <div class="bp-cat-primary">
        <span class="cat-badge ${catMeta.cls}">${primary}</span>
        <span class="bp-cat-rank">#${catRank} of ${catTotal} brands</span>
      </div>`;
    if (subcatRanks.length) {
      html += `<div class="bp-cat-subcats">` +
        subcatRanks.map(sc =>
          `<div class="bp-cat-subcat-row">
             <span class="subcat-tag">${sc.name}</span>
             <span class="bp-cat-sub-rank">#${sc.rank} of ${sc.total}</span>
           </div>`
        ).join('') +
        `</div>`;
    }
    document.getElementById('bp-cat-grid').innerHTML = html;
  }

  // renderRecords() removed — Best Rank, vs 52W High and Peak Month
  // are now surfaced directly in the metrics strip above the chart.

  function renderSimilarBrands(similar) {
    const data = window.DORMIED_DATA;
    const cm   = data.meta.currentMonth;
    const max  = Math.max(...data.brands.map(b => b.searchesByMarket?.global?.[cm] || 0));
    document.getElementById('bp-similar-grid').innerHTML = similar.map(b => {
      const bg       = getBgColor(b.id);
      const initials = getInitials(b.name);
      const logoHtml = b.logo
        ? `<img src="${b.logo}" alt="${b.name}" class="bp-sim-logo"
               onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span class=\\'bp-sim-initials\\' style=\\'background:${bg}\\'>${initials}</span>')">`
        : `<span class="bp-sim-initials" style="background:${bg}">${initials}</span>`;
      return `<a href="/brands/${b.id}/" class="bp-sim-card">
        <div class="bp-sim-logo-wrap">${logoHtml}</div>
        <div class="bp-sim-info">
          <span class="bp-sim-name">${b.name}</span>
          <span class="bp-sim-di">DI ${b.diScore.toFixed(1)} · #${b.rank || '—'}</span>
        </div>
      </a>`;
    }).join('');
  }

  // ─── Market + Period tabs ──────────────────────────────────────────────────

  function renderMarketTabs(marketStats) {
    const data = window.DORMIED_DATA;
    const el   = document.getElementById('bp-market-tabs');
    el.innerHTML = data.meta.markets.map(mkt => {
      const stat    = (marketStats || []).find(s => s.key === mkt.key);
      const delta   = stat ? stat.vsMonth : null;
      const deltaCls = delta === null ? ''
        : delta > 0 ? 'bp-tab-delta--up'
        : delta < 0 ? 'bp-tab-delta--down'
        : '';
      const deltaHtml = delta !== null
        ? `<span class="bp-tab-delta ${deltaCls}">${fmtPct(delta, 1)}</span>`
        : '';
      return `
      <button class="bp-market-btn ${mkt.key === chartMarket ? 'bp-market-btn--active' : ''}"
              data-market="${mkt.key}" role="tab"
              aria-selected="${mkt.key === chartMarket}">
        ${mkt.flag} ${mkt.label}${deltaHtml}
      </button>`;
    }).join('');

    el.querySelectorAll('.bp-market-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        chartMarket = btn.dataset.market;
        el.querySelectorAll('.bp-market-btn').forEach(b => {
          b.classList.toggle('bp-market-btn--active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        renderChart();
        if (window.DORMIED_TRACK) window.DORMIED_TRACK('brand_country', { brand: brand.name, country: chartMarket });
      });
    });
  }

  function bindPeriodTabs() {
    document.getElementById('bp-period-tabs').querySelectorAll('.bp-period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        chartMonths = parseInt(btn.dataset.months) || 0;
        document.querySelectorAll('.bp-period-btn').forEach(b => {
          b.classList.toggle('bp-period-btn--active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        renderChart();
        renderExplanationForPeriod();
        if (window.DORMIED_TRACK) window.DORMIED_TRACK('brand_date_range', { brand: brand.name, period: btn.textContent.trim() });
      });
    });
  }

  // ─── Explanation section ───────────────────────────────────────────────────

  // _expRows: all explanation rows for this brand, loaded once. null = not loaded yet.
  let _expRows = null;

  function renderExplanationForPeriod() {
    if (!window.DORMIED_EXPLANATIONS || !brand) return;
    const EXP     = window.DORMIED_EXPLANATIONS;
    const section = document.getElementById('bp-explanation-section');
    const body    = document.getElementById('bp-explanation-body');
    if (!section || !body) return;

    const meta    = window.DORMIED_DATA.meta;
    const curMon  = meta.currentMonth;

    // Determine which rows to show
    const rows = _expRows || [];
    const curRow = rows.find(r => r.month === EXP.toYYYYMM(curMon));

    // Use timeline when: period tab is 3M+ AND there are at least 2 stored months
    const useTimeline = chartMonths > 0 && rows.length >= 2;

    const toBullets = (window.DORMIED_UTILS && window.DORMIED_UTILS.explanationToBullets) || (t => `<p>${t}</p>`);

    if (useTimeline) {
      // Chronological list of all stored months
      const items = rows.map(row => {
        const [y, m] = row.month.split('-');
        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const label  = `${MONTHS[parseInt(m,10)-1]} ${y}`;
        return `<div class="bp-exp-timeline-item">
          <span class="bp-exp-timeline-month">${label}</span>
          <div class="bp-exp-timeline-text">${toBullets(row.explanation)}</div>
        </div>`;
      }).join('');
      body.innerHTML = `<div class="bp-exp-timeline">${items}</div>`;
      section.hidden = false;
    } else if (curRow) {
      body.innerHTML = `<div class="bp-exp-current">${toBullets(curRow.explanation)}</div>`;
      section.hidden = false;
    } else {
      section.hidden = true;
    }
  }

  async function loadExplanations() {
    if (!window.DORMIED_EXPLANATIONS || !brand) return;
    const EXP = window.DORMIED_EXPLANATIONS;
    try {
      _expRows = await EXP.fetchBrand(brand.id);
    } catch (e) {
      _expRows = [];
    }
    renderExplanationForPeriod();
  }

  // ─── The Take ─────────────────────────────────────────────────────────────

  async function loadTake(globalRank, metrics, allTimeStats) {
    const section = document.getElementById('bp-take-section');
    const textEl  = document.getElementById('bp-take-text');
    if (!section || !textEl) return;

    const data = window.DORMIED_DATA;
    const r    = rankings.find(b => b.id === brand.id);
    const di   = r ? r.diScore.toFixed(1) : '—';

    // Determine strongest market by current DI
    const markets = data.meta.markets || [];
    const cm      = data.meta.currentMonth;
    let topMarket = 'Global';
    let topVal    = 0;
    markets.forEach(mkt => {
      if (mkt.key === 'global') return;
      const v = brand.searchesByMarket?.[mkt.key]?.[cm] || 0;
      if (v > topVal) { topVal = v; topMarket = mkt.label || mkt.key; }
    });

    // Cache key: brand + current month so it refreshes each new data cycle
    const cacheKey = `dormied_take_${brand.id}_${cm}`;
    const cached   = sessionStorage.getItem(cacheKey);
    if (cached) {
      textEl.textContent = cached;
      section.hidden = false;
      return;
    }

    // Set month label
    const monthEl = document.getElementById('bp-take-month');
    if (monthEl) monthEl.textContent = data.meta.currentMonth;

    // Show shimmer while loading
    textEl.className = 'bp-take-text is-loading';
    textEl.textContent = 'Generating editorial take…';
    section.hidden = false;

    const fmtChange = v => v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—';

    try {
      const resp = await fetch('/api/take', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         brand.name,
          rank:         globalRank,
          di:           di,
          vsMonth:      fmtChange(metrics.vsMonth),
          mom:          fmtChange(metrics.mom),
          yoy:          fmtChange(metrics.yoy),
          bestRank:     allTimeStats.bestRank || '—',
          bestMonth:    allTimeStats.bestMonth || '—',
          category:     brand.category || '—',
          topMarket:    topMarket,
          currentMonth: data.meta.currentMonth,
        }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { take } = await resp.json();

      if (take) {
        textEl.className   = 'bp-take-text';
        textEl.textContent = take;
        sessionStorage.setItem(cacheKey, take);
      } else {
        section.hidden = true;
      }
    } catch (e) {
      console.warn('[take] Failed to load editorial take:', e.message);
      section.hidden = true;
    }
  }

  // ─── SEO ──────────────────────────────────────────────────────────────────

  function updateSEO(globalRank, di) {
    const title = `${brand.name} | DORMIED Index — Golf Brand Profile`;
    const desc  = `${brand.name} ranks #${globalRank} on the DORMIED Index with a DI score of ${di}. Track their 36-month search trend across 10 global golf markets.`;
    const url   = `https://dormied.com/brands/${brand.id}/`;

    document.title = title;
    document.querySelector('meta[name="description"]').content = desc;
    document.getElementById('meta-canonical').href = url;

    document.getElementById('og-url').content   = url;
    document.getElementById('og-title').content = title;
    document.getElementById('og-desc').content  = desc;

    document.getElementById('tw-title').content = title;
    document.getElementById('tw-desc').content  = desc;

    // JSON-LD
    const jsonld = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: brand.name,
      url:  brand.website || url,
      description: brand.description || `${brand.name} is tracked on the DORMIED Index.`,
      foundingDate: brand.founded ? String(brand.founded) : undefined,
      ...(brand.logo ? { logo: brand.logo } : {}),
    };
    document.getElementById('brand-jsonld').textContent = JSON.stringify(jsonld, null, 2);
  }

  // ─── Prev / Next navigation ────────────────────────────────────────────────

  function renderPrevNext(globalRank) {
    const sorted = rankings; // already sorted by rank
    const idx    = sorted.findIndex(b => b.id === brand.id);
    const prev   = sorted[idx - 1] || null;
    const next   = sorted[idx + 1] || null;

    const prevEl     = document.getElementById('nav-prev');
    const nextEl     = document.getElementById('nav-next');
    const prevNameEl = document.getElementById('nav-prev-name');
    const nextNameEl = document.getElementById('nav-next-name');

    if (prev) {
      prevEl.href = `/brands/${prev.id}/`;
      prevNameEl.textContent = `#${prev.rank} ${prev.name}`;
    } else {
      prevEl.style.visibility = 'hidden';
    }

    if (next) {
      nextEl.href = `/brands/${next.id}/`;
      nextNameEl.textContent = `#${next.rank} ${next.name}`;
    } else {
      nextEl.style.visibility = 'hidden';
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  function init() {
    // Priority 1: set by stub index.html via fetch+document.write (preserves clean URL)
    // Priority 2: URL pathname  — /brands/cobra/  → "cobra"  (production w/ routing)
    // Priority 3: ?brand= query param              — fallback for direct brand.html access
    const forcedSlug = window.__BRAND_SLUG__ || '';
    const pathParts  = window.location.pathname.replace(/\/$/, '').split('/');
    const pathSlug   = pathParts[pathParts.length - 1];
    const qpSlug     = new URLSearchParams(window.location.search).get('brand') || '';
    const slug       = forcedSlug ||
                       (pathSlug && pathSlug !== 'brand.html' && pathSlug !== 'brands'
                         ? pathSlug : qpSlug);

    const data = window.DORMIED_DATA;
    if (!data || !slug) {
      showError();
      return;
    }

    // Inject projected month into data (same formula as app.js)
    injectProjections();

    // Find brand by id (slug)
    brand = data.brands.find(b => b.id === slug);
    if (!brand) {
      showError();
      return;
    }

    // Compute rankings
    rankings = computeGlobalRankings();
    const r  = rankings.find(b => b.id === brand.id);
    const globalRank = r ? r.rank : '—';
    const di         = r ? r.diScore : 0;

    // Compute all metrics
    const metrics    = computeBrandMetrics();
    const allTimeStats = computeAllTimeStats();
    const marketStats  = computeMarketStats();
    const dominance    = computeDominance();
    const catData      = computeCategoryRank();
    const similar      = computeSimilarBrands();

    // Update SEO
    updateSEO(globalRank, di);

    // Track brand page view (fire-and-forget)
    (function (brandId) {
      var SB_URL = 'https://cimmmmnapdthqvtifpzr.supabase.co';
      var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpbW1tbW5hcGR0aHF2dGlmcHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NzE3NTksImV4cCI6MjA4OTM0Nzc1OX0.yejRXgvODw3bMr3oA9IiNA-MIZsHHkxmDZouJmEgDfI';
      fetch(SB_URL + '/rest/v1/brand_page_views', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ brand_id: brandId })
      }).catch(function () {});
    })(brand.id);

    // Show content
    document.getElementById('brand-loading').hidden = true;
    document.getElementById('brand-content').hidden = false;

    // Render all sections
    renderHeader(metrics, allTimeStats, globalRank);
    renderMetrics(metrics, allTimeStats);
    renderMarketTabs(marketStats);
    bindPeriodTabs();
    renderChart();
    renderCountryTable(marketStats);
    renderDominance(dominance);
    renderCategoryStanding(catData);
    renderSimilarBrands(similar);
    renderPrevNext(globalRank);
    loadExplanations(); // async — fills explanation section after fetch
    loadTake(globalRank, metrics, allTimeStats); // async — generates AI editorial take

    // Analytics: brand page view
    if (window.DORMIED_TRACK) window.DORMIED_TRACK('brand_view', {
      brand: brand.name,
      rank:  globalRank,
      di:    di,
    });
  }

  function showError() {
    document.getElementById('brand-loading').hidden = true;
    document.getElementById('brand-error').hidden   = false;
  }

  // Boot once data.js is loaded (data.js loads synchronously before this script)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
