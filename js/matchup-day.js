/* ─────────────────────────────────────────────────────────────────────────
   matchup-day.js  —  DORMIED Individual Match-Up page
   Reads the date from the URL path (/matchups/YYYY-MM-DD/), fetches the
   archived record from Supabase, and renders the full match-up card.
   No API re-calls — all data comes from the stored archive row.
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
      var p = iso.split('-');
      var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) { return iso; }
  }

  // ── Format % ──────────────────────────────────────────────────────────────
  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    var sign = Number(v) > 0 ? '+' : Number(v) < 0 ? '\u2212' : '';
    return sign + Math.abs(Number(v)).toFixed(1) + '%';
  }

  // ── Logo HTML ──────────────────────────────────────────────────────────────
  function logoHtml(src, name, size) {
    size = size || 40;
    var ini = (name || '').trim().split(/\s+/).map(function (w) { return w[0] || ''; }).join('').toUpperCase().slice(0, 2);
    var style = 'width:' + size + 'px;height:' + size + 'px;border-radius:6px;object-fit:contain;background:var(--bg-raised);display:block;';
    if (src) {
      return '<img src="' + esc(src) + '" alt="" style="' + style + '" '
           + 'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
           + '<span class="brand-initials-fallback" style="display:none;width:' + size + 'px;height:' + size + 'px;">' + esc(ini) + '</span>';
    }
    return '<span class="brand-initials-fallback" style="width:' + size + 'px;height:' + size + 'px;">' + esc(ini) + '</span>';
  }

  // ── Checkmark span ────────────────────────────────────────────────────────
  var CK = '<span class="h2h-check" aria-hidden="true">&#10003;</span>';

  // ── Stat row ──────────────────────────────────────────────────────────────
  function pctRow(v1, label, v2, scored) {
    var c1   = v1 === null ? '' : Number(v1) > 0 ? 'h2h-val--up' : Number(v1) < 0 ? 'h2h-val--down' : '';
    var c2   = v2 === null ? '' : Number(v2) > 0 ? 'h2h-val--up' : Number(v2) < 0 ? 'h2h-val--down' : '';
    var win1 = scored && v1 !== null && v2 !== null && Number(v1) > Number(v2);
    var win2 = scored && v1 !== null && v2 !== null && Number(v2) > Number(v1);
    if (win1) c1 += ' h2h-val--win';
    if (win2) c2 += ' h2h-val--win';
    return '<div class="h2h-stat-row">'
         +   '<div class="h2h-val-wrap"><div class="h2h-val ' + c1.trim() + '">' + fmtPct(v1) + '</div>' + (win1 ? CK : '') + '</div>'
         +   '<div class="h2h-stat-label">' + esc(label) + '</div>'
         +   '<div class="h2h-val-wrap h2h-val-wrap--right">' + (win2 ? CK : '') + '<div class="h2h-val h2h-val--right ' + c2.trim() + '">' + fmtPct(v2) + '</div></div>'
         + '</div>';
  }

  function diRow(di1, di2) {
    var hi   = Math.max(Number(di1) || 0, Number(di2) || 0) || 1;
    var p1   = Math.round((Number(di1) || 0) / hi * 100);
    var p2   = Math.round((Number(di2) || 0) / hi * 100);
    var win1 = Number(di1) > Number(di2);
    var win2 = Number(di2) > Number(di1);
    var cls1 = 'h2h-di-num' + (win1 ? ' h2h-val--win' : '');
    var cls2 = 'h2h-di-num' + (win2 ? ' h2h-val--win' : '');
    return '<div class="h2h-stat-row h2h-stat-row--di">'
         +   '<div class="h2h-di-cell">'
         +     '<div class="h2h-di-top"><span class="' + cls1 + '">' + (Number(di1) || 0).toFixed(1) + '</span>' + (win1 ? CK : '') + '</div>'
         +     '<div class="h2h-bar-track"><div class="h2h-bar-fill" style="width:' + p1 + '%"></div></div>'
         +   '</div>'
         +   '<div class="h2h-stat-label">DI Score</div>'
         +   '<div class="h2h-di-cell h2h-di-cell--right">'
         +     '<div class="h2h-bar-track"><div class="h2h-bar-fill" style="width:' + p2 + '%"></div></div>'
         +     '<div class="h2h-di-top h2h-di-top--right">' + (win2 ? CK : '') + '<span class="' + cls2 + '">' + (Number(di2) || 0).toFixed(1) + '</span></div>'
         +   '</div>'
         + '</div>';
  }

  // ── Render the full day card from archived data ────────────────────────────
  function renderDay(row, cardEl) {
    var resultLine = row.result_winner
      ? esc(row.result_winner) + ' def. ' + esc(row.result_winner === row.brand_a_name ? row.brand_b_name : row.brand_a_name) + ' ' + esc(row.result_score)
      : 'EVEN';

    var shareUrl   = 'https://dormied.com/matchups/' + esc(row.date);
    var shareTweet = row.result_winner
      ? row.result_winner + ' def. ' + (row.result_winner === row.brand_a_name ? row.brand_b_name : row.brand_a_name) + ' ' + row.result_score + ' on the DORMIED Index. ' + shareUrl
      : row.brand_a_name + ' vs ' + row.brand_b_name + ' — EVEN on the DORMIED Index. ' + shareUrl;
    var shareHref  = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareTweet);

    var catHtml = row.category
      ? '<span class="h2h-category">' + esc(row.category) + '</span>'
      : '';

    cardEl.innerHTML =
        catHtml
      + '<div class="h2h-category" style="margin-bottom:4px">' + esc(fmtDate(row.date)) + '</div>'
      + '<div class="h2h-vs-row">'
      +   '<a href="/brands/' + esc(row.brand_a_id || '') + '/" class="h2h-brand-hd">'
      +     logoHtml(row.brand_a_logo, row.brand_a_name, 40)
      +     '<div class="h2h-brand-hd-name">' + esc(row.brand_a_name) + '</div>'
      +   '</a>'
      +   '<div class="h2h-vs-badge">VS</div>'
      +   '<a href="/brands/' + esc(row.brand_b_id || '') + '/" class="h2h-brand-hd h2h-brand-hd--right">'
      +     logoHtml(row.brand_b_logo, row.brand_b_name, 40)
      +     '<div class="h2h-brand-hd-name">' + esc(row.brand_b_name) + '</div>'
      +   '</a>'
      + '</div>'
      + '<div class="h2h-stat-grid">'
      +   diRow(row.brand_a_di, row.brand_b_di)
      +   pctRow(row.brand_a_mom,  'M/M Change', row.brand_b_mom,  true)
      +   pctRow(row.brand_a_3m,   '3M Trend',   row.brand_b_3m,   true)
      +   pctRow(row.brand_a_12m,  '12M Trend',  row.brand_b_12m,  true)
      + '</div>'
      + '<div class="h2h-result">'
      +   '<div class="h2h-result-score-row">'
      +     '<div class="h2h-result-score">' + resultLine + '</div>'
      +     '<a href="' + esc(shareHref) + '" class="h2h-share-btn" target="_blank" rel="noopener noreferrer" aria-label="Share on X">'
      +       '<svg class="h2h-share-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>'
      +     '</a>'
      +   '</div>'
      +   (row.result_writeup ? '<p class="h2h-writeup-text">' + esc(row.result_writeup) + '</p>' : '')
      + '</div>';

    // Update page <title> and meta description dynamically
    var winner = row.result_winner || null;
    var loser  = winner === row.brand_a_name ? row.brand_b_name : row.brand_a_name;
    var score  = row.result_score || 'EVEN';
    var titleTxt = row.brand_a_name + ' vs ' + row.brand_b_name + ' ' + fmtDate(row.date) + ' | DORMIED';
    var descTxt  = winner
      ? row.brand_a_name + ' def. ' + row.brand_b_name + ' ' + score + ' on the DORMIED Index on ' + fmtDate(row.date) + '. See the full data breakdown.'
      : row.brand_a_name + ' vs ' + row.brand_b_name + ' — EVEN on the DORMIED Index on ' + fmtDate(row.date) + '.';

    document.title = titleTxt;
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', descTxt);
  }

  // ── Extract date from URL ─────────────────────────────────────────────────
  function getDateFromUrl() {
    // Path: /matchups/2026-03-20 or /matchups/2026-03-20/
    var parts = window.location.pathname.replace(/\/+$/, '').split('/');
    var last  = parts[parts.length - 1];
    // Validate YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(last)) return last;
    return null;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    var cardEl = document.getElementById('matchup-day-card');
    if (!cardEl) return;

    var dateStr = getDateFromUrl();
    if (!dateStr) {
      cardEl.innerHTML = '<p class="matchup-day-error">Invalid match-up URL.</p>';
      return;
    }

    fetch(SB_URL + '/rest/v1/matchup_archive'
        + '?select=*'
        + '&date=eq.' + encodeURIComponent(dateStr)
        + '&limit=1', {
      headers: {
        'apikey':        SB_ANON,
        'Authorization': 'Bearer ' + SB_ANON,
      },
    })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (rows) {
      if (!rows || !rows.length) {
        cardEl.innerHTML = '<p class="matchup-day-error">No match-up found for this date.</p>';
        return;
      }
      renderDay(rows[0], cardEl);
    })
    .catch(function (err) {
      console.warn('[matchup-day.js] Failed to load:', err.message);
      cardEl.innerHTML = '<p class="matchup-day-error">Could not load this match-up.</p>';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
