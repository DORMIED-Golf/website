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
  +     '<h2 class="signup-popup-heading" id="popup-heading">Golf\'s Brand Story. Told With Data.</h2>'
  +     '<p class="signup-popup-body">Every month, The Scorecard breaks down which golf brands are winning attention across 11 global markets, who just spiked and why, and which brands are quietly fading before anyone notices. One email. No fluff. Built for people who actually pay attention.</p>'
  +     '<form class="signup-popup-form" id="popup-form" novalidate>'
  +       '<input class="signup-popup-input" id="popup-email" type="email" placeholder="Your email" required autocomplete="email">'
  +       '<button class="signup-popup-btn" id="popup-btn" type="submit">Send Me The Scorecard</button>'
  +       '<p class="signup-popup-error" id="popup-error"></p>'
  +     '</form>'
  +     '<p class="signup-popup-fine">Monthly. No spam. Unsubscribe anytime.</p>'
  +     '<button class="signup-popup-dismiss" id="popup-dismiss">I\'ll just check GolfWRX like everyone else.</button>'
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
    document.getElementById('popup-dismiss').addEventListener('click', function () {
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
