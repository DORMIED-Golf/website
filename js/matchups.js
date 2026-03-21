/* ─────────────────────────────────────────────────────────────────────────
   matchups.js  —  DORMIED Match-Up Archive listing page
   Fetches all records from Supabase matchup_archive, renders cards in
   reverse chronological order. No API calls — display only.
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // ── Supabase (public anon key — read-only) ─────────────────────────────────
  var SB_URL  = 'https://cimmmmnapdthqvtifpzr.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpbW1tbW5hcGR0aHF2dGlmcHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NzE3NTksImV4cCI6MjA4OTM0Nzc1OX0.yejRXgvODw3bMr3oA9IiNA-MIZsHHkxmDZouJmEgDfI';

  // ── HTML escape ────────────────────────────────────────────────────────────
  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }

  // ── Format date "2026-03-20" → "March 20, 2026" ───────────────────────────
  function fmtDate(iso) {
    try {
      var parts = iso.split('-');
      var d = new Date(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10)
      );
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  // ── Logo HTML ──────────────────────────────────────────────────────────────
  function logoHtml(src, name) {
    var ini = (name || '').trim().split(/\s+/).map(function (w) { return w[0] || ''; }).join('').toUpperCase().slice(0, 2);
    if (src) {
      return '<img class="matchup-archive-logo" src="' + esc(src) + '" alt="" '
           + 'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
           + '<div class="matchup-archive-logo-initial" style="display:none">' + esc(ini) + '</div>';
    }
    return '<div class="matchup-archive-logo-initial">' + esc(ini) + '</div>';
  }

  // ── Render a single archive card ───────────────────────────────────────────
  function renderCard(row) {
    var resultLine = row.result_winner
      ? esc(row.result_winner) + ' def. ' + esc(row.result_winner === row.brand_a_name ? row.brand_b_name : row.brand_a_name) + ' ' + esc(row.result_score)
      : 'EVEN';

    var catHtml = row.category
      ? '<div class="matchup-archive-cat">' + esc(row.category) + '</div>'
      : '';

    var writeupHtml = row.result_writeup
      ? '<p class="matchup-archive-writeup">' + esc(row.result_writeup) + '</p>'
      : '';

    return '<a href="/matchups/' + esc(row.date) + '/" class="matchup-archive-card">'
         +   '<div class="matchup-archive-date">' + esc(fmtDate(row.date)) + '</div>'
         +   catHtml
         +   '<div class="matchup-archive-brands">'
         +     logoHtml(row.brand_a_logo, row.brand_a_name)
         +     '<span class="matchup-archive-brand-name">' + esc(row.brand_a_name) + '</span>'
         +     '<span class="matchup-archive-vs">VS</span>'
         +     '<span class="matchup-archive-brand-name">' + esc(row.brand_b_name) + '</span>'
         +     logoHtml(row.brand_b_logo, row.brand_b_name)
         +   '</div>'
         +   '<div class="matchup-archive-result">' + resultLine + '</div>'
         +   writeupHtml
         + '</a>';
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    var listEl = document.getElementById('matchups-list');
    if (!listEl) return;

    fetch(SB_URL + '/rest/v1/matchup_archive'
        + '?select=date,brand_a_name,brand_a_logo,brand_b_name,brand_b_logo,'
        + 'result_score,result_winner,result_writeup,category'
        + '&order=date.desc'
        + '&limit=90', {
      headers: {
        'apikey':        SB_ANON,
        'Authorization': 'Bearer ' + SB_ANON,
      },
    })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (rows) {
      if (!rows || !rows.length) {
        listEl.innerHTML = '<p class="matchups-empty">No match-ups archived yet. Check back tomorrow.</p>';
        return;
      }
      listEl.innerHTML = rows.map(renderCard).join('');
    })
    .catch(function (err) {
      console.warn('[matchups.js] Failed to load archive:', err.message);
      listEl.innerHTML = '<p class="matchups-empty">Could not load match-ups right now.</p>';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
