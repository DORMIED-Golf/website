/**
 * DORMIED — Email Signup Module
 *
 * Handles:
 *  1. Footer signup form (`.footer-signup-form`)
 *  2. Scroll-triggered popup (injected dynamically)
 *
 * Depends on: nothing (vanilla JS, no framework).
 * Loaded on every page.
 */
(function () {
  'use strict';

  var LS_SEEN        = 'dormied_popup_seen';
  var LS_SUBSCRIBED  = 'dormied_subscribed';
  var EMAIL_RE       = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var SUCCESS_MSG = 'You are in. First Scorecard lands next month.';
  var ERROR_MSG   = 'Something went wrong. Try again or email us at dormiedgolf@gmail.com';

  /* ── Shared: call /api/subscribe ──────────────────────────────────────── */
  function submitEmail(email, btn, onSuccess, onError) {
    btn.disabled = true;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = 'Sending…';

    fetch('/api/subscribe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: email }),
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (res.ok && res.data.success) {
        try { localStorage.setItem(LS_SUBSCRIBED, '1'); } catch (e) {}
        onSuccess();
      } else {
        btn.disabled    = false;
        btn.textContent = btn.dataset.originalText;
        onError(res.data.error || ERROR_MSG);
      }
    })
    .catch(function () {
      btn.disabled    = false;
      btn.textContent = btn.dataset.originalText;
      onError(ERROR_MSG);
    });
  }

  /* ── Footer form ──────────────────────────────────────────────────────── */
  function initFooterForm() {
    var form  = document.querySelector('.footer-signup-form');
    if (!form) return;

    var input = form.querySelector('.footer-signup-input');
    var btn   = form.querySelector('.footer-signup-btn');
    var msg   = form.querySelector('.footer-signup-msg');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (input.value || '').trim();
      if (!EMAIL_RE.test(email)) {
        showMsg(msg, 'Please enter a valid email address.', false);
        return;
      }
      clearMsg(msg);
      submitEmail(
        email, btn,
        function () { // success
          form.innerHTML = '<p class="footer-signup-success">' + SUCCESS_MSG + '</p>';
          if (window.DORMIED_TRACK) window.DORMIED_TRACK('scorecard_signup', { source: 'footer' });
        },
        function (err) { // error
          showMsg(msg, err || ERROR_MSG, false);
        }
      );
    });
  }

  function showMsg(el, text, isSuccess) {
    if (!el) return;
    el.textContent  = text;
    el.className    = 'footer-signup-msg ' + (isSuccess ? 'footer-signup-msg--ok' : 'footer-signup-msg--err');
    el.style.display = 'block';
  }
  function clearMsg(el) {
    if (!el) return;
    el.textContent   = '';
    el.style.display = 'none';
  }

  /* ── Popup ────────────────────────────────────────────────────────────── */
  var POPUP_HTML =
    '<div id="signup-overlay" class="signup-overlay" role="dialog" aria-modal="true" aria-labelledby="popup-heading">'
  +   '<div class="signup-popup">'
  +     '<button class="signup-popup-close" id="popup-close" aria-label="Close">&times;</button>'
  +     '<div class="signup-popup-inner">'
  +       '<img class="signup-popup-img" src="/_vercel/image?url=%2Fimages%2Fscorecard-cover.jpg&w=400&q=75" alt="DORMIED, The Scorecard" width="180" height="320" loading="lazy">'
  +       '<div class="signup-popup-content">'
  +         '<h2 class="signup-popup-heading" id="popup-heading">Get The Scorecard.</h2>'
  +         '<p class="signup-popup-body">Your group chat will be talking about these brands next month. You\'ll already know why.</p>'
  +         '<ul class="signup-popup-bullets">'
  +           '<li>The biggest brand moves in golf, explained</li>'
  +           '<li>Data from 175 brands across 10 global markets</li>'
  +           '<li>Once a month. Free. No filler.</li>'
  +         '</ul>'
  +         '<form class="signup-popup-form" id="popup-form" novalidate>'
  +           '<input class="signup-popup-input" id="popup-email" type="email" placeholder="Your email" required autocomplete="email">'
  +           '<button class="signup-popup-btn" id="popup-btn" type="submit">Subscribe</button>'
  +           '<p class="signup-popup-error" id="popup-error"></p>'
  +         '</form>'
  +       '</div>'
  +     '</div>'
  +   '</div>'
  + '</div>';

  function injectPopup() {
    var div = document.createElement('div');
    div.innerHTML = POPUP_HTML;
    document.body.appendChild(div.firstChild);
  }

  function closePopup(markSeen) {
    var overlay = document.getElementById('signup-overlay');
    if (!overlay) return;
    overlay.classList.remove('signup-overlay--visible');
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 320);
    if (markSeen) {
      try { localStorage.setItem(LS_SEEN, '1'); } catch (e) {}
    }
  }

  function openPopup() {
    var overlay = document.getElementById('signup-overlay');
    if (!overlay) return;
    // Small delay so the CSS transition fires
    requestAnimationFrame(function () {
      overlay.classList.add('signup-overlay--visible');
    });
  }

  function initPopup() {
    // Skip on mobile viewports < 480px
    if (window.innerWidth < 480) return;

    // Skip if already seen or subscribed
    try {
      if (localStorage.getItem(LS_SEEN) || localStorage.getItem(LS_SUBSCRIBED)) return;
    } catch (e) {}

    injectPopup();

    // Wire up close/dismiss
    document.getElementById('popup-close').addEventListener('click', function () {
      closePopup(true);
    });
    document.getElementById('signup-overlay').addEventListener('click', function (e) {
      if (e.target === this) closePopup(true);
    });

    // Form submit
    document.getElementById('popup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var emailInput = document.getElementById('popup-email');
      var btn        = document.getElementById('popup-btn');
      var errEl      = document.getElementById('popup-error');
      var email      = (emailInput.value || '').trim();

      if (!EMAIL_RE.test(email)) {
        errEl.textContent   = 'Please enter a valid email address.';
        errEl.style.display = 'block';
        return;
      }
      errEl.style.display = 'none';

      submitEmail(
        email, btn,
        function () { // success — replace content, auto-close after 3s
          var popup = document.querySelector('.signup-popup');
          popup.innerHTML = '<p class="signup-popup-success">' + SUCCESS_MSG + '</p>';
          setTimeout(function () { closePopup(false); }, 3000);
          if (window.DORMIED_TRACK) window.DORMIED_TRACK('scorecard_signup', { source: 'popup' });
        },
        function (err) { // error
          errEl.textContent   = err || ERROR_MSG;
          errEl.style.display = 'block';
        }
      );
    });

    // Scroll trigger at 60%
    var triggered = false;
    function onScroll() {
      if (triggered) return;
      var scrolled = window.scrollY + window.innerHeight;
      var total    = document.documentElement.scrollHeight;
      if (scrolled / total >= 0.60) {
        triggered = true;
        window.removeEventListener('scroll', onScroll);
        openPopup();
        try { localStorage.setItem(LS_SEEN, '1'); } catch (e) {}
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── Boot ─────────────────────────────────────────────────────────────── */
  function init() {
    initFooterForm();
    initPopup();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
