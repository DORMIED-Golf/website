/* ─────────────────────────────────────────────────────────────────────────
   scorecard-home.js  —  Injects the Scorecard card on the homepage
   Depends on: scorecard-data.js (window.DORMIED_SCORECARD_DATA)
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function init() {
    var el = document.getElementById('scorecard-home-card');
    if (!el) return;

    var data = window.DORMIED_SCORECARD_DATA;
    if (!data || !data.issues || !data.issues.length) {
      el.hidden = true;
      return;
    }

    var issue = data.issues[0]; // Always the latest issue

    var util = window.DORMIED_SCORECARD_UTIL;

    // Build image HTML: the triptych when the issue has one, otherwise the
    // hero. hero is an object on newer issues, so it goes through util.thumb()
    // rather than being escaped straight into src.
    var imgHtml = '';
    if (issue.images) {
      var strip = issue.images.strip || [];
      if (strip.length > 0) {
        var items = strip.map(function (img) {
          return '<div class="sc-strip-item">' +
            '<img class="sc-strip-img" src="' + escHtml(img.src) + '" alt="' + escHtml(img.label || '') + '" loading="lazy">' +
            (img.label ? '<span class="sc-strip-label">' + escHtml(img.label) + '</span>' : '') +
          '</div>';
        }).join('');
        imgHtml = '<div class="sc-image-strip sc-image-strip--home">' + items + '</div>';
      } else {
        var heroSrc = util ? util.thumb(issue) : '';
        if (heroSrc) {
          imgHtml = '<img class="sc-home-img" src="' + escHtml(heroSrc) +
            '" alt="' + escHtml(util ? util.thumbAlt(issue) : '') + '"' +
            (util ? util.sizeAttrs(issue) : '') + ' loading="lazy">';
        }
      }
    }

    // Build a short snippet from the first section body (strip HTML tags, truncate)
    var snippet = '';
    if (issue.sections && issue.sections.length) {
      snippet = (issue.sections[0].body || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (snippet.length > 160) snippet = snippet.slice(0, 157) + '…';
    }

    el.innerHTML =
      '<div class="section-header">' +
        '<h2 class="section-title">The Scorecard</h2>' +
        '<span class="section-month">' + escHtml(issue.monthLabel) + '</span>' +
      '</div>' +
      (imgHtml ? imgHtml : '') +
      // Headline only: the section header already shows the month, so the
      // "| The Scorecard | August 2026" suffix is repeated furniture.
      '<p class="sc-home-article-title">' + escHtml(util ? util.headline(issue) : issue.title) + '</p>' +
      '<p class="sc-home-sub">' + escHtml(issue.subtitle) + '</p>' +
      (snippet ? '<p class="sc-home-snippet">' + escHtml(snippet) + '</p>' : '') +
      '<a href="/scorecard/' + escHtml(issue.slug) + '/" class="hero-cta sc-home-cta">Read The Scorecard →</a>';

    el.hidden = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
