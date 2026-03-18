/**
 * DORMIED — Shared Utilities
 * window.DORMIED_UTILS
 *
 * Loaded before all other DORMIED scripts on every page.
 * All other JS files reference these via window.DORMIED_UTILS, with a
 * local fallback so pages still work even if this file somehow fails.
 */
(function () {
  'use strict';

  // ── HTML escaping ──────────────────────────────────────────────────────────
  function escHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  // ── Brand colour palette ───────────────────────────────────────────────────
  // Deterministic colour based on brand id — same brand always gets same colour.
  var LOGO_BG_COLORS = [
    '#0f2d1a', '#1a1a2e', '#1a2e1a', '#2d1a0f',
    '#1a0f2d', '#2d2d0f', '#0f1a2d', '#2d0f1a',
  ];

  function getBgColor(id) {
    if (!id) return LOGO_BG_COLORS[0];
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
    return LOGO_BG_COLORS[Math.abs(hash) % LOGO_BG_COLORS.length];
  }

  // ── Brand initials ─────────────────────────────────────────────────────────
  function getInitials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // ── Brand logo HTML ────────────────────────────────────────────────────────
  // size: pixel size for width/height attrs
  // Returns an <img> that falls back to initials on error,
  // or a plain initials <span> if no logo URL is set.
  function buildLogoImg(brand, size) {
    size = size || 64;
    var bg       = getBgColor(brand.id);
    var initials = getInitials(brand.name);
    var name     = escHtml(brand.name);
    var fallback = '<span class="logo-initials" style="background:' + bg
      + ';width:' + size + 'px;height:' + size + 'px">' + initials + '</span>';

    if (!brand.logo) return fallback;

    var src = brand.logo;

    // For large sizes with Google Favicon URLs, try Clearbit first for sharper art
    if (size >= 96 && src.includes('googleusercontent.com/s2/favicons')) {
      var domMatch = src.match(/domain=([^&]+)/);
      if (domMatch) {
        var clearbit = 'https://logo.clearbit.com/' + domMatch[1];
        var gSrc     = src.replace(/sz=\d+/, 'sz=' + size);
        var iFb      = fallback.replace(/"/g, '\\"');
        var gFb      = iFb;
        return '<img src="' + clearbit + '" alt="' + name + '"'
          + ' class="logo-img" width="' + size + '" height="' + size + '"'
          + ' style="width:' + size + 'px;height:' + size + 'px"'
          + ' onerror="this.src=\'' + gSrc + '\';this.onerror=function(){'
          + 'this.style.display=\'none\';this.insertAdjacentHTML(\'afterend\',\'' + gFb + '\')}">';
      }
    }

    var finalSrc = src.replace(/sz=\d+/, 'sz=' + size);
    var iFb2 = fallback.replace(/"/g, '\\"');
    return '<img src="' + finalSrc + '" alt="' + name + '"'
      + ' class="logo-img" width="' + size + '" height="' + size + '"'
      + ' style="width:' + size + 'px;height:' + size + 'px"'
      + ' onerror="this.style.display=\'none\';this.insertAdjacentHTML(\'afterend\',\'' + iFb2 + '\')">';
  }

  // ── Number formatting ──────────────────────────────────────────────────────
  function formatNum(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  // ── Month key helpers ──────────────────────────────────────────────────────
  // Convert "Feb 2026" → "2026-02"
  var MONTH_MAP = {
    Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
    Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12'
  };
  var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function labelToYYYYMM(label) {
    var p = label.split(' ');
    return p[1] + '-' + (MONTH_MAP[p[0]] || '01');
  }

  // Offset a "Mon YYYY" label by N months (negative = back in time)
  function offsetMonth(label, months) {
    var p    = label.split(' ');
    var mon  = MONTH_NAMES.indexOf(p[0]);
    var year = parseInt(p[1], 10);
    var total = mon + months;
    var newMon  = ((total % 12) + 12) % 12;
    var newYear = year + Math.floor(total / 12);
    return MONTH_NAMES[newMon] + ' ' + newYear;
  }

  // ── Explanation → bullet list ──────────────────────────────────────────────
  // Converts stored explanation text to an HTML <ul> bullet list.
  // Handles two formats:
  //   • New format: text contains "•" separators → split on "•"
  //   • Old format: plain paragraph → split on sentence boundaries
  function explanationToBullets(text) {
    if (!text) return '';
    var items;
    if (text.indexOf('\u2022') !== -1) {
      items = text.split('\u2022').map(function (s) { return s.trim(); }).filter(Boolean);
    } else {
      var sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
      items = sentences.map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 15; });
    }
    if (!items.length) return '<p>' + escHtml(text) + '</p>';
    return '<ul class="exp-bullets">'
      + items.map(function (s) { return '<li>' + escHtml(s) + '</li>'; }).join('')
      + '</ul>';
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  window.DORMIED_UTILS = {
    escHtml:               escHtml,
    getBgColor:            getBgColor,
    getInitials:           getInitials,
    buildLogoImg:          buildLogoImg,
    formatNum:             formatNum,
    labelToYYYYMM:         labelToYYYYMM,
    offsetMonth:           offsetMonth,
    explanationToBullets:  explanationToBullets,
    MONTH_NAMES:           MONTH_NAMES,
    MONTH_MAP:             MONTH_MAP,
  };

}());
