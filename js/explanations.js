/**
 * DORMIED Explanations — Frontend module
 *
 * Fetches brand movement explanations from Supabase and exposes
 * window.DORMIED_EXPLANATIONS for use by home.js, brand.js, and app.js.
 *
 * Fill in your Supabase project URL and anon key below.
 * The anon key is safe to expose publicly — it only grants read access.
 */
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  // Fill these in once your Supabase project is created.
  // Both values are safe to commit — the anon key is read-only public access.
  // Find them in: Supabase dashboard → Project Settings → API
  var SUPABASE_URL      = 'YOUR_SUPABASE_URL';       // e.g. https://abcdefgh.supabase.co
  var SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';  // starts with eyJ...

  var FALLBACK_TEXT =
    'No single catalyst is obvious from available coverage this month. ' +
    'The movement may reflect broader seasonal trends or organic brand momentum.';

  var MONTH_MAP = {
    Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6,
    Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12
  };

  // ── Internal cache ─────────────────────────────────────────────────────────
  // Structure: { 'YYYY-MM': { 'brand-id': { explanation, change_percentage, top_market } } }
  var _cache = {};

  function _toYYYYMM(label) {
    // "Feb 2026" → "2026-02"
    var parts = label.split(' ');
    return parts[1] + '-' + String(MONTH_MAP[parts[0]]).padStart(2, '0');
  }

  function _fetchMonth(yyyymm) {
    if (_cache[yyyymm]) return Promise.resolve(_cache[yyyymm]);

    var url = SUPABASE_URL
      + '/rest/v1/brand_explanations'
      + '?select=brand_id,explanation,change_percentage,top_market'
      + '&month=eq.' + yyyymm;

    return fetch(url, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      },
    })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (rows) {
      var byBrand = {};
      (rows || []).forEach(function (row) {
        byBrand[row.brand_id] = {
          explanation:       row.explanation,
          change_percentage: row.change_percentage,
          top_market:        row.top_market,
        };
      });
      _cache[yyyymm] = byBrand;
      return byBrand;
    })
    .catch(function (err) {
      console.warn('[DORMIED Explanations] fetch failed for ' + yyyymm + ':', err.message);
      _cache[yyyymm] = {};
      return {};
    });
  }

  function _fetchBrand(brandId) {
    // Fetch all rows for a single brand across all months (for timeline view)
    var url = SUPABASE_URL
      + '/rest/v1/brand_explanations'
      + '?select=brand_id,month,explanation,change_percentage,top_market'
      + '&brand_id=eq.' + encodeURIComponent(brandId)
      + '&order=month.asc';

    return fetch(url, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      },
    })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (rows) {
      (rows || []).forEach(function (row) {
        if (!_cache[row.month]) _cache[row.month] = {};
        _cache[row.month][row.brand_id] = {
          explanation:       row.explanation,
          change_percentage: row.change_percentage,
          top_market:        row.top_market,
        };
      });
      return rows || [];
    })
    .catch(function (err) {
      console.warn('[DORMIED Explanations] brand fetch failed:', err.message);
      return [];
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.DORMIED_EXPLANATIONS = {

    FALLBACK_TEXT: FALLBACK_TEXT,

    isFallback: function (text) {
      return text === FALLBACK_TEXT;
    },

    toYYYYMM: _toYYYYMM,

    /** Pre-load all explanations for a given month label ("Feb 2026"). */
    preload: function (monthLabel) {
      return _fetchMonth(_toYYYYMM(monthLabel));
    },

    /** Async: get explanation row for a brand+month. Resolves to row or null. */
    get: function (brandId, monthLabel) {
      return _fetchMonth(_toYYYYMM(monthLabel)).then(function (byBrand) {
        return byBrand[brandId] || null;
      });
    },

    /** Sync: get from cache (call after preload resolves). Returns row or null. */
    getCached: function (brandId, monthLabel) {
      var m = _cache[_toYYYYMM(monthLabel)];
      return (m && m[brandId]) || null;
    },

    /** Fetch all months for a single brand (for brand-page timeline). Returns promise of array. */
    fetchBrand: function (brandId) {
      return _fetchBrand(brandId);
    },

    /** Get cached timeline for a brand (sorted by month asc). */
    getTimeline: function (brandId) {
      var results = [];
      Object.keys(_cache).forEach(function (yyyymm) {
        var row = _cache[yyyymm][brandId];
        if (row) results.push(Object.assign({ month: yyyymm }, row));
      });
      return results.sort(function (a, b) { return a.month.localeCompare(b.month); });
    },
  };

}());
