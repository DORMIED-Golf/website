/* ─────────────────────────────────────────────────────────────────────────
   scorecard-archive.js  —  DORMIED Scorecard Archive Page (/scorecard/)
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
    var data = window.DORMIED_SCORECARD_DATA;
    if (!data || !data.issues || !data.issues.length) return;

    var issues  = data.issues;
    var latest  = issues[0];
    var archive = issues.slice(1);

    renderHero(latest);
    renderArchive(archive);
  }

  function renderHero(issue) {
    var el = document.getElementById('sc-hero');
    if (!el) return;

    var imgHtml = buildImageHtml(issue, true);

    el.innerHTML =
      '<div class="sc-hero-card">' +
        '<div class="sc-hero-label-row">' +
          '<span class="sc-label">THE SCORECARD</span>' +
          '<span class="sc-hero-date">' + escHtml(issue.date) + '</span>' +
        '</div>' +
        imgHtml +
        '<h2 class="sc-hero-title">' + escHtml(issue.title) + '</h2>' +
        '<p class="sc-hero-sub">' + escHtml(issue.subtitle) + '</p>' +
        '<a href="/scorecard/' + escHtml(issue.slug) + '/" class="sc-read-link">Read The Scorecard →</a>' +
      '</div>';
  }

  function renderArchive(issues) {
    var el = document.getElementById('sc-archive-grid');
    if (!el) return;

    if (!issues.length) {
      el.hidden = true;
      var heading = document.getElementById('sc-archive-heading');
      if (heading) heading.hidden = true;
      return;
    }

    el.innerHTML = issues.map(function (issue) {
      var thumb = issue.images && (issue.images.hero || (issue.images.strip && issue.images.strip[0] && issue.images.strip[0].src));
      var thumbHtml = thumb
        ? '<img class="sc-archive-thumb" src="' + escHtml(thumb) + '" alt="" loading="lazy">'
        : '<div class="sc-archive-thumb sc-archive-thumb--placeholder"></div>';

      return '<a href="/scorecard/' + escHtml(issue.slug) + '/" class="sc-archive-card">' +
        thumbHtml +
        '<div class="sc-archive-card-body">' +
          '<span class="sc-label sc-label--sm">THE SCORECARD</span>' +
          '<div class="sc-archive-date">' + escHtml(issue.date) + '</div>' +
          '<div class="sc-archive-title">' + escHtml(issue.title) + '</div>' +
          '<p class="sc-archive-sub">' + escHtml(issue.subtitle) + '</p>' +
        '</div>' +
      '</a>';
    }).join('');
  }

  function buildImageHtml(issue, isHero) {
    if (!issue.images) return '';

    var strip = issue.images.strip || [];
    var hero  = issue.images.hero;

    if (strip.length > 0) {
      var items = strip.map(function (img) {
        return '<div class="sc-strip-item">' +
          '<img class="sc-strip-img" src="' + escHtml(img.src) + '" alt="' + escHtml(img.label || '') + '" loading="lazy">' +
          (img.label ? '<span class="sc-strip-label">' + escHtml(img.label) + '</span>' : '') +
        '</div>';
      }).join('');
      return '<div class="sc-image-strip' + (isHero ? ' sc-image-strip--hero' : '') + '">' + items + '</div>';
    }

    if (hero) {
      return '<img class="sc-hero-img" src="' + escHtml(hero) + '" alt="" loading="lazy">';
    }

    return '';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
