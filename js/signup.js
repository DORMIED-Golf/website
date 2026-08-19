/**
 * DORMIED Email Signup
 *
 * Handles two form shapes, one code path:
 *   1. Inline "Scorecard" blocks  (section.scb, baked per page type)
 *   2. Footer signup form         (.footer-signup-form, the persistent control)
 *
 * THERE IS NO POPUP. The modal was removed: it converted badly, cost
 * main-thread work on mobile, and exposed the site to Google's intrusive
 * interstitial treatment on mobile search landings. The inline blocks replace
 * it and are baked into the HTML with reserved height, so nothing here inserts
 * markup or changes layout.
 *
 * PROGRESSIVE ENHANCEMENT
 * Every form already has action + method and submits natively without JS,
 * landing on a real confirmation page. This file only UPGRADES that to an
 * in-place success state. A script error must never be able to swallow a
 * signup, which is why the markup works on its own first.
 *
 * NO SILENT CATCHES
 * The footer form once stopped reaching Beehiiv and nobody found out for an
 * unknown period. Every failure path here fires scorecard_signup_error with an
 * error_type and logs to console. Nothing shows success without confirmation.
 */
(function () {
  'use strict';

  var LS_SUBSCRIBED = 'dormied_subscribed';
  var EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var ERROR_MSG     = 'Something went wrong. Try again or email us at dormiedgolf@gmail.com';

  /* ── GA4 via the existing GTM dataLayer (no new analytics library) ────────── */
  function track(event, ctx, extra) {
    try {
      window.dataLayer = window.dataLayer || [];
      var payload = {
        event:      event,
        slot:       ctx.slot,
        page_type:  ctx.pageType,
        page_path:  location.pathname
      };
      if (ctx.brandSlug) payload.brand_slug = ctx.brandSlug;
      if (extra) for (var k in extra) if (extra.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
      window.dataLayer.push(payload);
    } catch (e) {
      // Tracking must never break a signup.
      if (window.console) console.warn('[signup] track failed', e);
    }
  }

  /* Map a server response to the error_type vocabulary the GA4 alarm reads. */
  function errorType(status, body) {
    if (status === 400) return 'invalid_email';
    if (status === 409) return 'already_subscribed';
    if (status === 502 || status === 500) return 'endpoint_error';
    if (body && /already/i.test(body.error || '')) return 'already_subscribed';
    return 'unknown';
  }

  /* ── Context for a form, read from the baked data attributes ─────────────── */
  function contextFor(form) {
    var block = form.closest ? form.closest('.scb') : null;
    if (block) {
      return {
        slot:      block.getAttribute('data-slot')       || 'inline',
        pageType:  block.getAttribute('data-page-type')  || 'unknown',
        brandSlug: block.getAttribute('data-brand-slug') || '',
        nextMonth: block.getAttribute('data-next-month') || '',
        latestIssue: block.getAttribute('data-latest-issue') || '',
        block:     block,
        status:    block.querySelector('.scb-status'),
        btn:       form.querySelector('.scb-btn'),
        input:     form.querySelector('.scb-input')
      };
    }
    // Footer: the control, instrumented identically so the two are comparable.
    return {
      slot:      'footer',
      pageType:  document.body.getAttribute('data-page-type') || 'footer',
      brandSlug: '',
      nextMonth: '',
      latestIssue: '',
      block:     form,
      status:    form.querySelector('.footer-signup-msg'),
      btn:       form.querySelector('.footer-signup-btn'),
      input:     form.querySelector('.footer-signup-input')
    };
  }

  function setStatus(ctx, text, kind, htmlSuffix) {
    var el = ctx.status;
    if (!el) return;
    el.textContent = text;
    if (htmlSuffix) el.innerHTML = el.innerHTML + htmlSuffix;
    el.className = (ctx.slot === 'footer' ? 'footer-signup-msg' : 'scb-status') +
                   (kind ? ' ' + (ctx.slot === 'footer' ? 'footer-signup-msg--' : 'scb-status--') + kind : '');
    el.style.display = 'block';
  }

  /* Success swaps content INSIDE the same box, so height never moves.
     The CSS min-height reserves space for the INITIAL render, but it cannot know
     the natural height at every breakpoint, and hiding the form on success would
     otherwise collapse the box by hundreds of pixels. So freeze the measured
     height first: that is exact at any viewport and needs no guessed value. */
  function freezeHeight(el) {
    if (!el || !el.getBoundingClientRect) return;
    var h = el.getBoundingClientRect().height;
    if (h > 0) el.style.minHeight = h + 'px';
  }

  function showSuccess(ctx) {
    freezeHeight(ctx.block);
    try { localStorage.setItem(LS_SUBSCRIBED, '1'); } catch (e) {}
    var line = ctx.nextMonth
      ? 'You are in. The next issue lands ' + ctx.nextMonth + '.'
      : 'You are in. The next issue lands soon.';
    var link = ctx.latestIssue
      ? ' <a href="' + ctx.latestIssue + '">Read the latest issue</a>'
      : '';
    if (ctx.block && ctx.block.classList) ctx.block.classList.add('scb--done');
    setStatus(ctx, line, 'ok', link);
  }

  /* ── Submit ──────────────────────────────────────────────────────────────── */
  function wire(form) {
    var ctx = contextFor(form);
    if (!ctx.input || !ctx.btn) return;   // markup we do not recognise: leave the native submit alone

    form.addEventListener('submit', function (e) {
      var email = (ctx.input.value || '').trim();

      if (!EMAIL_RE.test(email)) {
        e.preventDefault();
        setStatus(ctx, 'Please enter a valid email address.', 'err');
        track('scorecard_signup_error', ctx, { error_type: 'invalid_email' });
        return;
      }

      e.preventDefault();   // only after validation, so a no-JS submit is untouched
      track('scorecard_signup_submit', ctx);

      ctx.btn.disabled = true;
      var original = ctx.btn.textContent;
      ctx.btn.textContent = 'Sending...';
      setStatus(ctx, '', '');

      fetch(form.getAttribute('action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: email })
      })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
      })
      .then(function (res) {
        if (res.ok && res.data && res.data.success) {
          track('scorecard_signup_success', ctx);
          showSuccess(ctx);
          return;
        }
        ctx.btn.disabled = false;
        ctx.btn.textContent = original;
        var type = errorType(res.status, res.data);
        setStatus(ctx, (res.data && res.data.error) || ERROR_MSG, 'err');
        track('scorecard_signup_error', ctx, { error_type: type });
        if (window.console) console.warn('[signup] submission rejected', res.status, res.data);
      })
      .catch(function (err) {
        ctx.btn.disabled = false;
        ctx.btn.textContent = original;
        setStatus(ctx, ERROR_MSG, 'err');
        track('scorecard_signup_error', ctx, { error_type: 'network' });
        if (window.console) console.error('[signup] network failure', err);
      });
    });
  }

  /* ── View tracking ───────────────────────────────────────────────────────────
     Gives a real conversion rate (signups per block SEEN) rather than per
     pageview, which is the number that decides whether the WITB placement earns
     its space. Observes only the signup blocks and disconnects after firing. */
  function observeViews(blocks) {
    if (!('IntersectionObserver' in window) || !blocks.length) return;
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i];
        if (!en.isIntersecting) continue;
        var form = en.target.querySelector('form');
        if (form) track('scorecard_signup_view', contextFor(form));
        io.unobserve(en.target);
      }
    }, { threshold: 0.5 });
    for (var i = 0; i < blocks.length; i++) io.observe(blocks[i]);
  }

  function init() {
    var forms = document.querySelectorAll('.scb-form, .footer-signup-form');
    for (var i = 0; i < forms.length; i++) wire(forms[i]);
    observeViews(document.querySelectorAll('.scb'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
