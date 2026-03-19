/**
 * DORMIED — GA4 Event Tracking via GTM dataLayer
 *
 * All events are pushed to window.dataLayer, which GTM picks up and
 * forwards to GA4. Zero performance impact — dataLayer.push() is
 * fire-and-forget and never blocks the main thread.
 *
 * GTM setup required (one-time):
 *   For each event name below, create a Custom Event trigger in GTM
 *   matching that event name, then attach a GA4 Event Tag to it.
 *   Map the desired parameters (e.g. {{dlv - country}}) to GA4 event
 *   parameters of the same name.
 *
 * Events fired by this file:
 *   social_click        — footer X / Instagram link
 *
 * Events fired by other JS files (using window.DORMIED_TRACK):
 *   scorecard_signup    — signup.js    — source: 'popup' | 'footer'
 *   index_country       — app.js       — country: e.g. 'us'
 *   index_date          — app.js       — period: e.g. 'Current — Feb 2026'
 *   index_category      — app.js       — category: e.g. 'Clubs & Balls'
 *   index_subcategory   — app.js       — subcategory: e.g. 'Irons'
 *   index_search        — app.js       — search_term: user's query
 *   index_sort          — app.js       — column: e.g. 'di'
 *   see_why_click       — app.js       — brand: brand name
 *   h2h_comparison      — app.js       — brand_a, brand_b
 *   article_click       — feed.js      — article_title, source
 *   news_brand_filter   — feed.js      — brand: brand name
 *   brand_view          — brand.js     — brand, rank, di
 *   brand_country       — brand.js     — brand, country
 *   brand_date_range    — brand.js     — brand, period: '3M'|'6M'|'1Y'|'ALL'
 *   brand_outbound      — brand.js     — brand, url
 */

'use strict';

(function () {

  // ── Core helper ────────────────────────────────────────────────────────────
  // Safe wrapper — works even if GTM hasn't initialised yet.
  function track(eventName, params) {
    window.dataLayer = window.dataLayer || [];
    var payload = { event: eventName };
    if (params) {
      Object.keys(params).forEach(function (k) { payload[k] = params[k]; });
    }
    window.dataLayer.push(payload);
  }

  // Expose globally so other JS files can call window.DORMIED_TRACK(...)
  window.DORMIED_TRACK = track;

  // ── Footer social links (present on every page) ────────────────────────────
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a.footer-social-link');
    if (!link) return;
    var label = (link.getAttribute('aria-label') || '').toLowerCase();
    var platform = label.includes('instagram') ? 'Instagram'
                 : label.includes('x')         ? 'X'
                 : 'Unknown';
    track('social_click', { platform: platform });
  });

})();
