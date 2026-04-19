// DORMIED Index — Application Logic
// Golf leaderboard meets Bloomberg Terminal

(function () {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────────
  const AD_EVERY_N_ROWS = 30;

  const CATEGORY_COLORS = {
    'Clubs & Balls':                  { cls: 'cat-clubs',   color: '#166534' },
    'Apparel & Footwear':             { cls: 'cat-apparel', color: '#1e3a5f' },
    'Tech & Training Aids':           { cls: 'cat-tech',    color: '#7c2d12' },
    'Bags & Accessories':             { cls: 'cat-bags',    color: '#4a1d96' },
  };

  // Custom select handles (populated in init after filters are built)
  const customSelects = {};

  // ─── State ─────────────────────────────────────────────────────────────────
  const state = {
    country: 'global',
    period: null,          // set in init() once data is loaded
    searchQuery: '',
    category: '',
    subCategory: '',
    sortBy: 'rank',
    sortDir: 'asc',
    rankings: [],
    filtered: [],
  };

  // ─── Period Helpers ─────────────────────────────────────────────────────────
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function parseMonthIndex(str) {
    const [mon, year] = str.split(' ');
    return parseInt(year) * 12 + MONTH_NAMES.indexOf(mon);
  }

  function getAllMonths() {
    const s = window.DORMIED_DATA.brands[0].searchesByMarket.global;
    return Object.keys(s).sort((a, b) => parseMonthIndex(a) - parseMonthIndex(b));
  }

  // ─── Projection Engine ──────────────────────────────────────────────────────
  // Shift a "Mon YYYY" label by delta months (positive or negative)
  function shiftMonth(label, delta) {
    const [mon, year] = label.split(' ');
    const total = parseInt(year) * 12 + MONTH_NAMES.indexOf(mon) + delta;
    return `${MONTH_NAMES[((total % 12) + 12) % 12]} ${Math.floor(total / 12)}`;
  }

  // Next calendar month after currentMonth
  function getProjectedMonth() {
    return shiftMonth(window.DORMIED_DATA.meta.currentMonth, 1);
  }

  // Project next month's searches for one market object using seasonal adjustment.
  // Formula: recent_3mo_avg × seasonal_factor
  // seasonal_factor = avg(same month last 2 yrs) ÷ avg(3 months preceding it last 2 yrs)
  // This accounts for golf seasonality (e.g. March is always stronger than Jan-Feb).
  function projectSearches(searches, targetMonth) {
    // Baseline: recent 3 months of actual data
    const recentVals = [shiftMonth(targetMonth, -3), shiftMonth(targetMonth, -2), shiftMonth(targetMonth, -1)]
      .map(m => searches[m] || 0).filter(v => v > 0);
    if (recentVals.length === 0) return 0;
    const recentAvg = recentVals.reduce((a, b) => a + b, 0) / recentVals.length;

    // Seasonal numerator: same calendar month in the last 2 years
    const sameHistVals = [shiftMonth(targetMonth, -12), shiftMonth(targetMonth, -24)]
      .map(m => searches[m] || 0).filter(v => v > 0);

    // Seasonal denominator: 3 months preceding that same month in each of those years
    const precHistVals = [
      shiftMonth(targetMonth, -15), shiftMonth(targetMonth, -14), shiftMonth(targetMonth, -13),
      shiftMonth(targetMonth, -27), shiftMonth(targetMonth, -26), shiftMonth(targetMonth, -25),
    ].map(m => searches[m] || 0).filter(v => v > 0);

    if (sameHistVals.length === 0 || precHistVals.length === 0) return Math.round(recentAvg);

    const sameHistAvg = sameHistVals.reduce((a, b) => a + b, 0) / sameHistVals.length;
    const precHistAvg = precHistVals.reduce((a, b) => a + b, 0) / precHistVals.length;
    const seasonalFactor = precHistAvg > 0 ? sameHistAvg / precHistAvg : 1.0;

    // Cap at 0.3–3.0× to guard against noisy low-volume brands
    const capped = Math.min(3.0, Math.max(0.3, seasonalFactor));
    return Math.round(recentAvg * capped);
  }

  // Inject projected month values into every brand's searchesByMarket at startup.
  // After this runs, getAllMonths() and avgSearches() see the projected month
  // transparently — no other engine changes needed.
  function injectProjections() {
    const projMonth  = getProjectedMonth();
    window.DORMIED_DATA.meta.projectedMonth = projMonth;
    const marketKeys = window.DORMIED_DATA.meta.markets.map(m => m.key);
    window.DORMIED_DATA.brands.forEach(brand => {
      marketKeys.forEach(key => {
        const mkt = brand.searchesByMarket?.[key];
        if (!mkt) return;
        mkt[projMonth] = projectSearches(mkt, projMonth);
      });
    });
  }

  // Build a period descriptor from a select value
  function buildPeriod(value) {
    const allMonths = getAllMonths();
    const currentMonth = window.DORMIED_DATA.meta.currentMonth;
    const curIdx = allMonths.indexOf(currentMonth);

    const projectedMonth = window.DORMIED_DATA.meta.projectedMonth;

    // Range: last N months vs prior N months (never projected)
    const rangeMatch = value.match(/^range-(\d+)$/);
    if (rangeMatch) {
      const n  = parseInt(rangeMatch[1]);
      const months     = allMonths.slice(Math.max(0, curIdx - n + 1), curIdx + 1);
      const prevMonths = allMonths.slice(Math.max(0, curIdx - 2 * n + 1), curIdx - n + 1);
      const ago3Months = allMonths.slice(Math.max(0, curIdx - 3 * n + 1), curIdx - 2 * n + 1);
      const labels = { 'range-3': 'Last 3 Months', 'range-6': 'Last 6 Months', 'range-12': 'Last 12 Months' };
      return { type: 'range', isProjected: false, value, label: labels[value] || `Last ${n} Months`, months, prevMonths, ago3Months };
    }

    // Single month (current or specific past month, or projected)
    const idx = value === 'current' ? curIdx : allMonths.indexOf(value);
    const i   = idx >= 0 ? idx : curIdx;
    const label = allMonths[i];
    return {
      type: 'single',
      isProjected: label === projectedMonth,
      value,
      label,
      months:     [label],
      prevMonths: i >= 1 ? [allMonths[i - 1]] : [],
      ago3Months: i >= 3 ? [allMonths[i - 3]] : [],
    };
  }

  // ─── Ranking Engine ────────────────────────────────────────────────────────
  // Averages search volume across a set of months for one brand/market
  function avgSearches(brand, months) {
    if (!months || !months.length) return 0;
    const s = brand.searchesByMarket?.[state.country] || {};
    return months.reduce((sum, m) => sum + (s[m] || 0), 0) / months.length;
  }

  function calculateRankings(brands) {
    const { months, prevMonths, ago3Months } = state.period;

    // Pre-compute anchors for YoY and 3-month momentum.
    // Always relative to meta.currentMonth (real data only, not projected).
    const projMonth  = window.DORMIED_DATA.meta.projectedMonth;
    const cmLabel    = window.DORMIED_DATA.meta.currentMonth;   // e.g. "Feb 2026"
    const yearAgoLabel = shiftMonth(cmLabel, -12);              // e.g. "Feb 2025"
    const allActual  = getAllMonths().filter(m => m !== projMonth);
    const cmIdx      = allActual.indexOf(cmLabel);
    // Last 3 real months (e.g. Dec 2025, Jan 2026, Feb 2026)
    const mLast3     = allActual.slice(Math.max(0, cmIdx - 2), cmIdx + 1);
    // Prior 3 real months (e.g. Sep, Oct, Nov 2025)
    const mPrior3    = allActual.slice(Math.max(0, cmIdx - 5), Math.max(0, cmIdx - 2));

    const currentMax = Math.max(...brands.map(b => avgSearches(b, months)));
    const prevMax    = Math.max(...brands.map(b => avgSearches(b, prevMonths)));
    const ago3Max    = Math.max(...brands.map(b => avgSearches(b, ago3Months)));

    const withDI = brands.map(b => ({
      ...b,
      currentSearches: avgSearches(b, months),
      prevSearches:    avgSearches(b, prevMonths),
      ago3Searches:    avgSearches(b, ago3Months),
      currentDI: currentMax > 0 ? avgSearches(b, months)     / currentMax * 100 : 0,
      prevDI:    prevMax    > 0 ? avgSearches(b, prevMonths)  / prevMax    * 100 : 0,
      ago3DI:    ago3Max    > 0 ? avgSearches(b, ago3Months)  / ago3Max    * 100 : 0,
    }));

    // Previous-period rank map (tiebreaking)
    const prevSorted = [...withDI].sort((a, b) => {
      const diff = b.prevDI - a.prevDI;
      if (Math.abs(diff) > 0.0001) return diff;
      return b.ago3DI - a.ago3DI;
    });
    const prevRankMap = new Map();
    prevSorted.forEach((brand, i) => prevRankMap.set(brand.id, i + 1));

    // 3-periods-ago rank map (secondary tiebreak)
    const ago3Sorted = [...withDI].sort((a, b) => b.ago3DI - a.ago3DI);
    const ago3RankMap = new Map();
    ago3Sorted.forEach((brand, i) => ago3RankMap.set(brand.id, i + 1));

    // Sort current period with cascading tiebreak
    const currentSorted = [...withDI].sort((a, b) => {
      const diff = b.currentDI - a.currentDI;
      if (Math.abs(diff) > 0.0001) return diff;
      const prevDiff = (prevRankMap.get(a.id) || 9999) - (prevRankMap.get(b.id) || 9999);
      if (prevDiff !== 0) return prevDiff;
      return (ago3RankMap.get(a.id) || 9999) - (ago3RankMap.get(b.id) || 9999);
    });

    return currentSorted.map((brand, i) => {
      const rank     = i + 1;
      const prevRank = prevRankMap.get(brand.id) || null;
      const movement = prevRank !== null ? prevRank - rank : null;
      const interestChange = brand.prevSearches > 0
        ? (brand.currentSearches - brand.prevSearches) / brand.prevSearches * 100
        : null;

      // Year-over-year: currentMonth vs same month a year ago
      const mktS = brand.searchesByMarket?.[state.country] || {};
      const curCM     = mktS[cmLabel]      || 0;
      const yearAgoCM = mktS[yearAgoLabel] || 0;
      const yoyChange = yearAgoCM > 0 ? (curCM - yearAgoCM) / yearAgoCM * 100 : null;

      // 3-month momentum: avg last 3 real months vs avg prior 3 real months
      const last3avg  = mLast3.reduce( (s, m) => s + (mktS[m] || 0), 0) / Math.max(mLast3.length,  1);
      const prior3avg = mPrior3.reduce((s, m) => s + (mktS[m] || 0), 0) / Math.max(mPrior3.length, 1);
      const momentum  = prior3avg > 0 ? (last3avg - prior3avg) / prior3avg * 100 : null;

      return { ...brand, rank, prevRank, movement, diScore: parseFloat(brand.currentDI.toFixed(1)), interestChange, yoyChange, momentum };
    });
  }

  // ─── Filtering ─────────────────────────────────────────────────────────────
  function filterRankings(rankings) {
    return rankings.filter(brand => {
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        if (!brand.name.toLowerCase().includes(q)) return false;
      }
      if (state.category) {
        const brandCats = brand.allCategories.flatMap(c => c.split(';').map(s => s.trim()));
        if (!brandCats.includes(state.category)) return false;
      }
      if (state.subCategory) {
        const sc = state.subCategory.toLowerCase();
        if (!brand.subCategories.some(s => s.toLowerCase().includes(sc))) return false;
      }
      return true;
    });
  }

  // ─── Sorting ───────────────────────────────────────────────────────────────
  function sortFiltered(filtered) {
    const dir = state.sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (state.sortBy) {
        case 'rank':   return (a.rank - b.rank) * dir;
        case 'name':   return a.name.localeCompare(b.name) * dir;
        case 'di':     return (b.diScore - a.diScore) * dir;
        case 'change': {
          const ac = a.interestChange ?? -Infinity;
          const bc = b.interestChange ?? -Infinity;
          return (bc - ac) * dir;
        }
        default: return 0;
      }
    });
  }

  // ─── Logo / Initials ───────────────────────────────────────────────────────
  const LOGO_BG_COLORS = ['#0d2b0d', '#0a2218', '#1a2f00', '#0f1f2e', '#21150a', '#1a0a2e'];

  function getBgColor(id) {
    let hash = 0;
    for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0x7fffffff;
    return LOGO_BG_COLORS[hash % LOGO_BG_COLORS.length];
  }

  function getInitials(name) {
    const words = name.replace(/[^a-zA-Z0-9\s\/]/g, '').split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  // Global error handler for brand favicon images — avoids inline HTML quoting issues
  window._dormiedLogoError = function (img) {
    const id      = img.dataset.id;
    const name    = img.dataset.name;
    const bg      = getBgColor(id);
    const initials = getInitials(name);
    const span    = document.createElement('span');
    span.className   = 'brand-logo-initials';
    span.style.background = bg;
    span.textContent = initials;
    img.parentNode.replaceChild(span, img);
  };

  // ─── HTML Builders ─────────────────────────────────────────────────────────
  function buildLogoHtml(brand) {
    const bg       = getBgColor(brand.id);
    const initials = getInitials(brand.name);
    if (brand.logo) {
      return `<img src="${brand.logo}" alt="${brand.name}" class="brand-logo-img" loading="lazy" data-id="${brand.id}" data-name="${brand.name}" onerror="window._dormiedLogoError(this)">`;
    }
    return `<span class="brand-logo-initials" style="background:${bg}">${initials}</span>`;
  }

  function buildMoveHtml(movement) {
    if (movement === null) return '<span class="move-badge move-new">NEW</span>';
    if (movement > 0)  return `<span class="move-badge move-up">▲${movement}</span>`;
    if (movement < 0)  return `<span class="move-badge move-down">▼${Math.abs(movement)}</span>`;
    return '<span class="move-badge move-same">—</span>';
  }

  // Fire (≥+5 ranks) or ice (≤−5 ranks) badge shown next to brand name
  function buildHeatIcon(movement) {
    if (movement === null) return '';
    if (movement >= 5)  return '<span class="brand-heat brand-heat--fire" title="Hot — jumped ' + movement + ' spots">🔥</span>';
    if (movement <= -5) return '<span class="brand-heat brand-heat--ice"  title="Cold — dropped ' + Math.abs(movement) + ' spots">🧊</span>';
    return '';
  }

  // 3-month momentum trend indicator (▲▲ / ▲ / ─ / ▼ / ▼▼)
  function buildMomentumHtml(momentum) {
    if (momentum === null) return '';
    let icon, cls;
    if      (momentum >= 20)  { icon = '▲▲'; cls = 'momentum-up-strong'; }
    else if (momentum >= 5)   { icon = '▲';  cls = 'momentum-up'; }
    else if (momentum <= -20) { icon = '▼▼'; cls = 'momentum-dn-strong'; }
    else if (momentum <= -5)  { icon = '▼';  cls = 'momentum-dn'; }
    else {
      return '<span class="momentum-trend momentum-flat" title="3-month momentum: flat">─</span>';
    }
    const sign = momentum > 0 ? '+' : '';
    return `<span class="momentum-trend ${cls}" title="3-month momentum">${icon}\u202f${sign}${Math.round(momentum)}%</span>`;
  }

  function buildChangeHtml(change) {
    if (change === null) return '<span class="change-val">—</span>';
    const abs = Math.abs(change);
    const str = abs < 0.5 ? '0.0' : abs.toFixed(1);
    if (change > 0.5)  return `<span class="change-val change-up">+${str}%</span>`;
    if (change < -0.5) return `<span class="change-val change-down">−${str}%</span>`;
    return `<span class="change-val change-flat">0.0%</span>`;
  }

  // After the table is in the DOM, inject "See Why →" links for brands
  // that have a real (non-fallback) explanation for the current month.
  function patchSeeWhyLinks() {
    const EXP = window.DORMIED_EXPLANATIONS;
    if (!EXP) return;
    const curMonth = window.DORMIED_DATA.meta.currentMonth;
    EXP.preload(curMonth).then(function (byBrand) {
      Object.keys(byBrand).forEach(function (brandId) {
        const exp = byBrand[brandId];
        if (!exp || EXP.isFallback(exp.explanation)) return;
        const row = document.querySelector('tbody tr.brand-row[data-id="' + brandId + '"]');
        if (!row) return;
        const cell = row.querySelector('.col-change');
        if (!cell || cell.querySelector('.see-why-link')) return;
        const a = document.createElement('a');
        a.className = 'see-why-link';
        a.href = '/brands/' + brandId + '/#bp-explanation-section';
        a.textContent = 'See Why →';
        a.addEventListener('click', function (e) {
          e.stopPropagation();
          if (window.DORMIED_TRACK) window.DORMIED_TRACK('see_why_click', { brand: exp.explanation ? brandId : brandId });
        });
        cell.appendChild(a);
      });
    });
  }

  function buildDiHtml(diScore) {
    const pct = Math.min(diScore, 100);
    return `
      <div class="di-cell">
        <span class="di-value">${diScore.toFixed(1)}</span>
        <div class="di-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="di-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  function buildCategoryHtml(brand) {
    const primary = brand.category.split(';')[0].trim();
    const meta    = CATEGORY_COLORS[primary] || { cls: 'cat-other', color: '#374151' };
    return `<span class="cat-badge ${meta.cls}">${primary}</span>`;
  }

  function buildSubcatHtml(subCategories) {
    return subCategories
      .map(sc => `<span class="subcat-tag">${sc}</span>`)
      .join('');
  }

  function buildRankNum(rank) {
    if (rank === 1) return `<span class="rank-num rank-gold">${rank}</span>`;
    if (rank === 2) return `<span class="rank-num rank-silver">${rank}</span>`;
    if (rank === 3) return `<span class="rank-num rank-bronze">${rank}</span>`;
    return `<span class="rank-num">${rank}</span>`;
  }

  function createBrandRow(brand) {
    const tr = document.createElement('tr');
    tr.className = 'brand-row';
    tr.dataset.id = brand.id;

    tr.innerHTML = `
      <td class="col-rank" data-label="Rank">${buildRankNum(brand.rank)}</td>
      <td class="col-move" data-label="">${buildMoveHtml(brand.movement)}</td>
      <td class="col-brand" data-label="Brand">
        <div class="brand-cell">
          <div class="brand-logo-wrap">${buildLogoHtml(brand)}</div>
          <div class="brand-info">
            <a href="/brands/${brand.id}/" class="brand-link">
              <span class="brand-name">${brand.name}</span>
              ${buildHeatIcon(brand.movement)}
            </a>
            <div class="brand-sub-row">
              <span class="brand-meta">${brand.headquarters}</span>
              ${buildMomentumHtml(brand.momentum)}
            </div>
          </div>
        </div>
      </td>
      <td class="col-di" data-label="DI">${buildDiHtml(brand.diScore)}</td>
      <td class="col-change" data-label="Change">${buildChangeHtml(brand.interestChange)}</td>
      <td class="col-cat hide-sm" data-label="Category">${buildCategoryHtml(brand)}</td>
      <td class="col-subcat hide-md" data-label="Subcategory">${buildSubcatHtml(brand.subCategories)}</td>
    `;

    // Navigate to brand profile page on row click.
    // Clicking the <a> tag (brand name) is handled natively by the browser
    // (including right-click → open in new tab), so we skip those events.
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      window.location.href = '/brands/' + brand.id + '/';
    });

    return tr;
  }

  function createAdRow() {
    const tr = document.createElement('tr');
    tr.className = 'ad-row';
    tr.setAttribute('aria-hidden', 'true');
    tr.innerHTML = `
      <td colspan="7">
        <div class="ad-in-table desktop-ad">
          <ins class="adsbygoogle"
               style="display:inline-block;width:728px;height:90px"
               data-ad-client="ca-pub-5259693727609263"
               data-ad-slot="2308921645"></ins>
        </div>
        <div class="ad-in-table mobile-ad">
          <ins class="adsbygoogle"
               style="display:inline-block;width:300px;height:250px"
               data-ad-client="ca-pub-5259693727609263"
               data-ad-slot="9821280850"></ins>
        </div>
      </td>`;
    // Do NOT push here — ins elements must be in the DOM first.
    // renderTable() pushes after tbody.appendChild().
    return tr;
  }

  // ─── Table Renderer ────────────────────────────────────────────────────────
  function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;

    // Toggle projected styling on the table and badge visibility
    const isProj = !!state.period.isProjected;
    document.querySelector('.dormied-table')?.classList.toggle('is-projected', isProj);
    const badge = document.getElementById('projected-badge');
    if (badge) badge.hidden = !isProj;

    const sorted   = sortFiltered(state.filtered);

    // Clear first so the loading spinner is always removed before building rows.
    tbody.innerHTML = '';

    const fragment = document.createDocumentFragment();
    let dataRowCount = 0;

    sorted.forEach(brand => {
      if (dataRowCount > 0 && dataRowCount % AD_EVERY_N_ROWS === 0) {
        fragment.appendChild(createAdRow());
      }
      fragment.appendChild(createBrandRow(brand));
      dataRowCount++;
    });

    tbody.appendChild(fragment);

    // Push in-table ads now that the ins elements are in the DOM.
    tbody.querySelectorAll('.adsbygoogle:not([data-adsbygoogle-status])').forEach(() => {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });

    // Update count
    const countEl = document.getElementById('results-count');
    if (countEl) {
      countEl.textContent = `${sorted.length} brand${sorted.length !== 1 ? 's' : ''}`;
    }

    patchSeeWhyLinks();
  }

  // ─── Filter/Search Controls ────────────────────────────────────────────────
  function populateFilters() {
    const brands = window.DORMIED_DATA.brands;

    // Categories — split any semicolon-joined strings to get clean individual values
    const cats = [...new Set(brands.flatMap(b =>
      b.allCategories.flatMap(c => c.split(';').map(s => s.trim()))
    ))].filter(Boolean).sort();
    const catEl = document.getElementById('cat-filter');
    if (catEl) {
      cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        catEl.appendChild(opt);
      });
    }

    // Subcategories
    const subcats = [...new Set(brands.flatMap(b => b.subCategories))].sort();
    const subcatEl = document.getElementById('subcat-filter');
    if (subcatEl) {
      subcats.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        subcatEl.appendChild(opt);
      });
    }
  }

  function bindFilters() {
    const searchEl   = document.getElementById('brand-search');
    const catEl      = document.getElementById('cat-filter');
    const subcatEl   = document.getElementById('subcat-filter');
    const clearBtn   = document.getElementById('clear-filters');

    if (searchEl) {
      let _searchTimer;
      searchEl.addEventListener('input', e => {
        state.searchQuery = e.target.value.trim();
        applyFilters();
        // Debounce: fire after user stops typing for 800ms
        clearTimeout(_searchTimer);
        if (state.searchQuery) {
          _searchTimer = setTimeout(() => {
            if (window.DORMIED_TRACK) window.DORMIED_TRACK('index_search', { search_term: state.searchQuery });
          }, 800);
        }
      });
    }
    if (catEl) {
      catEl.addEventListener('change', e => {
        state.category = e.target.value;
        applyFilters();
        if (window.DORMIED_TRACK && state.category) window.DORMIED_TRACK('index_category', { category: state.category });
      });
    }
    if (subcatEl) {
      subcatEl.addEventListener('change', e => {
        state.subCategory = e.target.value;
        applyFilters();
        if (window.DORMIED_TRACK && state.subCategory) window.DORMIED_TRACK('index_subcategory', { subcategory: state.subCategory });
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        state.searchQuery = '';
        state.category    = '';
        state.subCategory = '';
        if (searchEl) searchEl.value = '';
        if (catEl)    { catEl.value = '';    customSelects['cat-filter']?.setValue(''); }
        if (subcatEl) { subcatEl.value = ''; customSelects['subcat-filter']?.setValue(''); }
        applyFilters();
      });
    }
  }

  function applyFilters() {
    state.filtered = filterRankings(state.rankings);
    renderTable();
  }

  function rerank() {
    const data = window.DORMIED_DATA;
    state.rankings = calculateRankings(data.brands);
    state.filtered  = filterRankings(state.rankings);
    updateHeroStats(state.rankings);
    updateChangeHeader();
    renderTable();
  }

  // ─── Period Filter ─────────────────────────────────────────────────────────
  function populatePeriodFilter() {
    const el = document.getElementById('period-filter');
    if (!el) return;

    const allMonths   = getAllMonths();
    const currentMonth = window.DORMIED_DATA.meta.currentMonth;

    const projectedMonth = window.DORMIED_DATA.meta.projectedMonth;

    // Quick-range options
    el.innerHTML = `
      <optgroup label="Current">
        <option value="current">Current — ${currentMonth}</option>
        <option value="${projectedMonth}">→ ${projectedMonth} — Projected</option>
      </optgroup>
      <optgroup label="Aggregated Ranges">
        <option value="range-3">Last 3 Months</option>
        <option value="range-6">Last 6 Months</option>
        <option value="range-12">Last 12 Months</option>
      </optgroup>
    `;

    // Past individual months (newest first, skip current)
    const group = document.createElement('optgroup');
    group.label = 'Past Months';
    [...allMonths].reverse().slice(1).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      group.appendChild(opt);
    });
    el.appendChild(group);
  }

  function updateChangeHeader() {
    const el = document.getElementById('change-col-label');
    if (!el) return;
    const { type, months } = state.period;
    if (type === 'range') {
      const n = months.length;
      el.textContent = `vs prior ${n}M`;
    } else {
      el.textContent = 'Change';
    }
  }

  function bindPeriodFilter() {
    const el = document.getElementById('period-filter');
    if (!el) return;
    el.addEventListener('change', e => {
      state.period = buildPeriod(e.target.value);
      rerank();
      if (window.DORMIED_TRACK) window.DORMIED_TRACK('index_date', { period: el.options[el.selectedIndex]?.text || e.target.value });
    });
  }

  // ─── Country Tabs ─────────────────────────────────────────────────────────

  // Sum all brand search volumes for a market in a given month
  function marketTotal(countryKey, month) {
    return window.DORMIED_DATA.brands.reduce((sum, b) => {
      return sum + ((b.searchesByMarket?.[countryKey]?.[month]) || 0);
    }, 0);
  }

  // Returns % change (current vs previous month) for the whole index in a market.
  // Returns null if no previous-month data exists (can't compute a meaningful %).
  function calcIndexChange(countryKey) {
    const { currentMonth, previousMonth } = window.DORMIED_DATA.meta;
    const cur  = marketTotal(countryKey, currentMonth);
    const prev = marketTotal(countryKey, previousMonth);
    if (prev === 0) return null;
    return (cur - prev) / prev * 100;
  }

  // Stamp each country tab with a ±X.X% badge showing month-over-month index change
  function updateTabBadges() {
    document.querySelectorAll('.country-tab').forEach(tab => {
      // Remove stale badge (safe to re-call)
      tab.querySelector('.tab-delta')?.remove();

      const pct = calcIndexChange(tab.dataset.country);
      if (pct === null) return;

      // Guard against -0.0 display artifact
      const rounded = Math.round(pct * 10) / 10;
      const span = document.createElement('span');
      const dir = rounded > 0 ? 'tab-delta--up' : rounded < 0 ? 'tab-delta--down' : '';
      span.className   = 'tab-delta' + (dir ? ' ' + dir : '');
      span.textContent = (rounded > 0 ? '+' : '') + rounded.toFixed(1) + '%';
      tab.appendChild(span);
    });
  }

  function bindCountryTabs() {
    const tabs = document.querySelectorAll('.country-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.country = tab.dataset.country;

        // Re-rank using country-specific data
        rerank();
        if (window.DORMIED_TRACK) window.DORMIED_TRACK('index_country', { country: tab.dataset.country });
      });
    });
  }

  // ─── Column Sort ──────────────────────────────────────────────────────────
  function bindSortHeaders() {
    const headers = document.querySelectorAll('th[data-sort]');
    headers.forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (state.sortBy === col) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortBy  = col;
          state.sortDir = col === 'rank' ? 'asc' : 'desc';
        }
        // Update aria
        headers.forEach(h => h.removeAttribute('aria-sort'));
        th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');

        // Update visual indicators
        headers.forEach(h => {
          h.querySelector('.sort-arrow')?.remove();
        });
        const arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        arrow.textContent = state.sortDir === 'asc' ? ' ↑' : ' ↓';
        th.appendChild(arrow);

        renderTable();
        if (window.DORMIED_TRACK) window.DORMIED_TRACK('index_sort', { column: col, direction: state.sortDir });
      });
    });
  }

  // (Keyboard ESC handler removed — brand rows now navigate to /brands/ pages)

  // ─── Year-to-date rank map helper ────────────────────────────────────────
  // Returns a Map<brandId, rank> for a single specific month, using the
  // current state.country. Used to compute year-to-date movement.
  function getRankMapForMonth(month) {
    const vals = window.DORMIED_DATA.brands.map(b => ({
      id:       b.id,
      searches: b.searchesByMarket?.[state.country]?.[month] || 0,
    }));
    const max = Math.max(...vals.map(v => v.searches));
    if (max === 0) return new Map();
    vals.sort((a, b) => b.searches - a.searches);
    const rankMap = new Map();
    vals.forEach((v, i) => rankMap.set(v.id, i + 1));
    return rankMap;
  }

  // ─── Category Leaders ─────────────────────────────────────────────────────
  function renderCategoryLeaders(rankings) {
    const el = document.getElementById('cat-leaders-grid');
    if (!el) return;

    // Find top-ranked brand per category
    const seen = {};
    const leaders = [];
    rankings.forEach(function (b) {
      const cat = b.category || 'Other';
      if (!seen[cat]) {
        seen[cat] = true;
        leaders.push(b);
      }
    });

    if (!leaders.length) return;

    el.innerHTML = leaders.map(function (b) {
      const momSign  = b.interestChange > 0 ? '+' : '';
      const momClass = b.interestChange > 0 ? 'color:#4a7c4a' : b.interestChange < 0 ? 'color:#a04040' : 'color:#6b7a6b';
      const momStr   = b.interestChange != null ? momSign + b.interestChange.toFixed(1) + '%' : '—';
      const logoHtml = b.logo
        ? `<img src="${b.logo.replace(/sz=\d+/, 'sz=32')}" alt="" style="width:32px;height:32px;object-fit:contain" loading="lazy" onerror="this.style.display='none'">`
        : `<span style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.8rem;background:rgba(255,255,255,.08);border-radius:4px">${(b.name||'').slice(0,2).toUpperCase()}</span>`;
      return `<a href="/brands/${b.id}/" style="display:flex;align-items:center;gap:.6rem;padding:.6rem .75rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;text-decoration:none;color:inherit;transition:border-color .15s" onmouseover="this.style.borderColor='rgba(255,255,255,.2)'" onmouseout="this.style.borderColor='rgba(255,255,255,.08)'">
        ${logoHtml}
        <div style="min-width:0">
          <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--clr-muted,#6b7a6b);line-height:1;margin-bottom:.2rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.category || 'Other'}</div>
          <div style="font-weight:600;font-size:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.name}</div>
          <div style="font-size:.75rem;margin-top:.1rem"><span style="color:var(--clr-muted,#6b7a6b)">#${b.globalRank} &nbsp;</span><span style="${momClass}">${momStr}</span></div>
        </div>
      </a>`;
    }).join('');
  }

  // ─── Stats in hero ────────────────────────────────────────────────────────
  function updateHeroStats(rankings) {
    const totalEl = document.getElementById('stat-brands');
    if (totalEl) totalEl.textContent = rankings.length;

    // Top mover (biggest positive rank movement this period)
    const topMover = rankings.filter(b => b.movement > 0).sort((a, b) => b.movement - a.movement)[0];
    const moverEl  = document.getElementById('stat-top-mover');
    if (moverEl && topMover) {
      moverEl.textContent = topMover.name;
    }

    // Biggest gainer (highest % interest change this period)
    const topGainer = rankings.filter(b => b.interestChange > 0).sort((a, b) => b.interestChange - a.interestChange)[0];
    const gainerEl  = document.getElementById('stat-top-gainer');
    if (gainerEl && topGainer) {
      gainerEl.textContent = `${topGainer.name} +${topGainer.interestChange.toFixed(0)}%`;
    }

    // YTD Climber — biggest positive rank move since Jan 1 of current year
    const ytdMoverEl = document.getElementById('stat-year-mover');
    if (ytdMoverEl) {
      const currentYear   = window.DORMIED_DATA.meta.currentMonth.split(' ')[1]; // "2026"
      const yearStartMonth = `Jan ${currentYear}`;
      const ytdRankMap    = getRankMapForMonth(yearStartMonth);
      if (ytdRankMap.size > 0) {
        const ytdMover = rankings
          .filter(b => ytdRankMap.has(b.id))
          .map(b => ({ ...b, ytdMove: (ytdRankMap.get(b.id) || b.rank) - b.rank }))
          .filter(b => b.ytdMove > 0)
          .sort((a, b) => b.ytdMove - a.ytdMove)[0];
        if (ytdMover) {
          ytdMoverEl.textContent = `${ytdMover.name} +${ytdMover.ytdMove}`;
        } else {
          ytdMoverEl.textContent = '—';
        }
      }
    }
  }

  // ─── Scorecard Banner ────────────────────────────────────────────────────
  function renderScorecardBanner(rankings) {
    const banner = document.getElementById('scorecard-banner');
    if (!banner || !window.DORMIED_EXPLANATIONS) return;

    const EXP  = window.DORMIED_EXPLANATIONS;
    const meta = window.DORMIED_DATA.meta;
    const curMonth = meta.currentMonth; // "Feb 2026"

    // Find brand with highest absolute MoM % change (must exceed 15%)
    const mover = rankings
      .filter(b => b.interestChange !== null && Math.abs(b.interestChange) > 15)
      .sort((a, b) => Math.abs(b.interestChange) - Math.abs(a.interestChange))[0];
    if (!mover) return;

    EXP.get(mover.id, curMonth).then(row => {
      if (!row) return;

      const monthEl = document.getElementById('scorecard-month');
      const textEl  = document.getElementById('scorecard-text');
      const linkEl  = document.getElementById('scorecard-link');

      if (monthEl) monthEl.textContent = curMonth;
      if (textEl)  textEl.textContent  = row.explanation;

      // Show scorecard link only if meta.scorecardUrl is set
      if (linkEl && meta.scorecardUrl) {
        linkEl.href   = meta.scorecardUrl;
        linkEl.hidden = false;
      }

      banner.hidden = false;
    });
  }

  // ─── Custom Select Component ──────────────────────────────────────────────
  function buildCustomSelect(selectEl) {
    if (!selectEl) return null;

    // Reads current options from the native select and builds the panel
    function buildPanel() {
      const frag = document.createDocumentFragment();
      for (const child of selectEl.children) {
        if (child.tagName === 'OPTGROUP') {
          const group = document.createElement('div');
          group.className = 'cs-group';
          const lbl = document.createElement('div');
          lbl.className = 'cs-group-label';
          lbl.textContent = child.label;
          group.appendChild(lbl);
          for (const opt of child.children) group.appendChild(makeOption(opt));
          frag.appendChild(group);
        } else if (child.tagName === 'OPTION') {
          frag.appendChild(makeOption(child));
        }
      }
      return frag;
    }

    function makeOption(opt) {
      const div = document.createElement('div');
      div.className = 'cs-option' + (opt.value === selectEl.value ? ' cs-selected' : '');
      div.dataset.value = opt.value;
      div.textContent   = opt.textContent;
      div.addEventListener('mousedown', e => { e.preventDefault(); selectValue(opt.value, opt.textContent); });
      return div;
    }

    function selectValue(value, label) {
      selectEl.value = value;
      valueSpan.textContent = label ?? value;
      panel.querySelectorAll('.cs-option').forEach(o =>
        o.classList.toggle('cs-selected', o.dataset.value === value)
      );
      close();
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function open() {
      // Close any other open custom selects first
      document.querySelectorAll('.cs-wrap.cs-open').forEach(w => { if (w !== wrap) w.classList.remove('cs-open'); });
      wrap.classList.add('cs-open');
      trigger.setAttribute('aria-expanded', 'true');
      // Flip upward if dropdown would overflow viewport bottom.
      // Must use 'auto' (not '') to override the stylesheet's default top value.
      const rect = wrap.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const flipUp = spaceBelow < 240;
      panel.style.top    = flipUp ? 'auto'              : 'calc(100% + 4px)';
      panel.style.bottom = flipUp ? 'calc(100% + 4px)' : 'auto';
      panel.querySelector('.cs-selected')?.scrollIntoView({ block: 'nearest' });
    }

    function close() {
      wrap.classList.remove('cs-open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    // Build DOM
    const wrap = document.createElement('div');
    wrap.className = 'cs-wrap' + (selectEl.classList.contains('period-select') ? ' cs-period' : '');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const valueSpan = document.createElement('span');
    valueSpan.className = 'cs-value';
    const initOpt = selectEl.options[selectEl.selectedIndex];
    valueSpan.textContent = initOpt ? initOpt.textContent : '';

    const arrow = document.createElement('span');
    arrow.className = 'cs-arrow';
    arrow.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1.5 3.5l3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    trigger.append(valueSpan, arrow);

    const panel = document.createElement('div');
    panel.className = 'cs-dropdown';
    panel.setAttribute('role', 'listbox');
    panel.appendChild(buildPanel());

    wrap.append(trigger, panel);

    // Toggle open/close
    trigger.addEventListener('click', () => wrap.classList.contains('cs-open') ? close() : open());

    // Close on outside click
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); }, true);

    // Keyboard: Escape closes, Enter/Space/ArrowDown opens
    trigger.addEventListener('keydown', e => {
      if (e.key === 'Escape')                              { close(); }
      else if (['Enter',' ','ArrowDown'].includes(e.key)) { e.preventDefault(); open(); }
    });

    // Insert after the native select and hide it
    selectEl.hidden = true;
    selectEl.parentNode.insertBefore(wrap, selectEl.nextSibling);

    // Public API
    return {
      setValue(value) {
        const opt = [...selectEl.options].find(o => o.value === value);
        if (opt) selectValue(value, opt.textContent);
      },
      // Re-read options from native select (call after repopulating)
      refresh() {
        panel.innerHTML = '';
        panel.appendChild(buildPanel());
        const sel = selectEl.options[selectEl.selectedIndex];
        if (sel) valueSpan.textContent = sel.textContent;
      },
    };
  }

  // ─── Main Init ────────────────────────────────────────────────────────────
  function init() {
    const data = window.DORMIED_DATA;
    if (!data) {
      console.error('DORMIED_DATA not found. Ensure data.js is loaded before app.js.');
      return;
    }

    // Compute and inject projected month values before anything reads allMonths()
    injectProjections();

    // Set default period to current month
    state.period = buildPeriod('current');

    state.rankings = calculateRankings(data.brands);
    state.filtered = [...state.rankings];

    populatePeriodFilter();
    populateFilters();
    bindPeriodFilter();
    bindFilters();
    bindCountryTabs();
    updateTabBadges();
    bindSortHeaders();

    // Replace native selects with custom styled dropdowns
    customSelects['period-filter']  = buildCustomSelect(document.getElementById('period-filter'));
    customSelects['cat-filter']     = buildCustomSelect(document.getElementById('cat-filter'));
    customSelects['subcat-filter']  = buildCustomSelect(document.getElementById('subcat-filter'));

    renderTable();
    updateHeroStats(state.rankings);
    renderScorecardBanner(state.rankings);
    renderCategoryLeaders(state.rankings);

    // Expose for debugging
    window._dormied = state;
  }

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
