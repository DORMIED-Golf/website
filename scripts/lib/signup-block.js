'use strict';
/**
 * scripts/lib/signup-block.js
 *
 * The one inline "Scorecard by DORMIED" signup block. Every page type renders
 * the same component; only the copy and the proof line differ, and both are
 * resolved at bake time so the block is static HTML with reserved height.
 *
 * THE IDEA
 * A generic signup says "get golf brand insights, monthly", which is a claim.
 * At bake time this site knows the reader is on Titleist's page and that
 * Titleist moved 18.3 percent this month. Showing that number IS the pitch: the
 * block proves the newsletter is worth reading by doing the newsletter's job in
 * one line, on the page the reader already chose.
 *
 * STRUCTURAL SAFETY (this is the important part)
 * The footer signup once stopped reaching Beehiiv and nobody noticed for an
 * unknown period. The dynamic copy here must never become a second way for that
 * to happen, so the split is structural rather than careful:
 *
 *   resolveCopy()  reads the data and returns strings. It may fail, and its
 *                  fallbacks are defined per page type below.
 *   formHtml()     takes NO arguments beyond the endpoint constants. It cannot
 *                  read the data object because it is never handed one.
 *
 * A thrown query, a null rank, an empty changes table: all of them degrade the
 * copy and none of them can alter, disable or skip the form markup.
 *
 * No em dashes anywhere in generated copy. No subscriber count, ever: a number
 * that is not yet impressive is worse than no number and it ages badly in
 * screenshots.
 */

const {
  NEWSLETTER_ENDPOINT,
  NEWSLETTER_METHOD,
  NEWSLETTER_FIELD,
  NEWSLETTER_CONFIRM_PATH,
  assertEndpoint,
} = require('./newsletter-endpoint.js');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Guards against an em dash reaching the page through generated copy. */
function clean(s) {
  return String(s == null ? '' : s).replace(/ — /g, ', ').replace(/—/g, ', ').trim();
}

/** "+18.3%" / "-4.0%". Returns null when there is nothing worth showing. */
function fmtChange(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!isFinite(n) || n === 0) return null;
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
}

function nextMonthLabel(d = new Date()) {
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${MONTHS[n.getMonth()]} ${n.getFullYear()}`;
}

// ── Copy resolvers ───────────────────────────────────────────────────────────
// Each returns { headline, proofLine }. proofLine may be '' and the block then
// renders headline only, which is the documented fallback. Never render a proof
// line built from a zero or a null.

const COPY = {
  witb({ bagCount, changeCount, playerName, changeLabel } = {}) {
    const headline = bagCount
      ? `We track every club in ${bagCount} tour bags.`
      : 'We track every club on tour.';
    let proofLine = '';
    if (changeCount > 0 && playerName && changeLabel) {
      proofLine = `${changeCount} bag changes logged in the last 30 days, including ${playerName}'s ${changeLabel}.`;
    } else if (changeCount > 0) {
      proofLine = `${changeCount} bag changes logged in the last 30 days.`;
    }
    return { headline, proofLine };
  },

  brand({ brandName, rank, momChange } = {}) {
    const headline = brandName ? `Where does ${brandName} go next month?` : 'Which brands move next month?';
    const change = fmtChange(momChange);
    let proofLine = '';
    if (brandName && rank && change) {
      proofLine = `${brandName} is ranked #${rank} of 215 and moved ${change} this month. The Scorecard explains the moves that mattered.`;
    } else if (brandName && rank) {
      proofLine = `${brandName} is ranked #${rank} of 215 brands across 10 markets.`;
    }
    return { headline, proofLine };
  },

  article({ brandName } = {}) {
    return {
      headline: "Golf's brand desk, monthly.",
      proofLine: brandName
        ? `${brandName} is one of 215 brands we track across 10 markets. The Scorecard covers the month's biggest moves and why they happened.`
        : "We track 215 brands across 10 global markets. The Scorecard is the month's biggest moves and what drove them.",
    };
  },

  feature() {
    return {
      headline: 'You read the whole thing. Get the next one.',
      proofLine: 'Long-form brand stories plus the monthly Index rundown. 215 brands, 10 markets, one email.',
    };
  },

  scorecard({ monthLabel } = {}) {
    return {
      headline: monthLabel
        ? `You are reading the ${monthLabel} issue. Get the next one first.`
        : 'Get the next issue first.',
      proofLine: 'The Scorecard lands monthly, sometimes more when there is something worth sharing.',
    };
  },

  home() {
    return {
      headline: "Golf's brand desk, monthly.",
      proofLine: '215 brands. 10 markets. One email. The moves that mattered and what drove them.',
    };
  },
};

/**
 * Resolve copy for a page type. Never throws: a resolver failure degrades to
 * the home copy rather than taking the form down with it.
 */
function resolveCopy(pageType, data) {
  const fn = COPY[pageType] || COPY.home;
  try {
    const out = fn(data || {}) || {};
    return {
      headline:  clean(out.headline)  || COPY.home().headline,
      proofLine: clean(out.proofLine) || '',
    };
  } catch (err) {
    console.warn(`[signup-block] copy resolver for "${pageType}" failed: ${err.message}. Falling back.`);
    const fb = COPY.home();
    return { headline: clean(fb.headline), proofLine: clean(fb.proofLine) };
  }
}

// ── Testimonial ──────────────────────────────────────────────────────────────
// One quote, one placement, no rotation (rotation needs JS and would undermine
// the bake-everything rule). The ellipsis is an honest elision of a longer
// public post; the full original is kept here so the trim can be checked
// against it and cannot drift into misrepresenting them.
//
// Full original: "They have quickly become one of our favorite X accounts with
// daily stories about golf brands, both upstarts and legacy, that are deeply
// researched and very well written."
const TESTIMONIAL = {
  enabled: true,
  quote: 'One of our favorite X accounts... deeply researched and very well written.',
  source: 'Country Club Confidential',
};

// ── Markup ───────────────────────────────────────────────────────────────────

/**
 * The form. Takes NO data. This is the whole point of 7g: it is not possible
 * for a proof-line query to influence what is rendered here, because nothing
 * about the data is in scope.
 */
function formHtml() {
  return '' +
    `<form class="scb-form" action="${NEWSLETTER_ENDPOINT}" method="${NEWSLETTER_METHOD.toLowerCase()}" novalidate>` +
      `<label class="scb-label" for="{{ID}}-email">Email address</label>` +
      `<div class="scb-row">` +
        `<input class="scb-input" id="{{ID}}-email" type="email" name="${NEWSLETTER_FIELD}" ` +
          `placeholder="Your email" required autocomplete="email" inputmode="email">` +
        `<button class="scb-btn" type="submit">Get The Scorecard</button>` +
      `</div>` +
      `<p class="scb-micro">Monthly, sometimes more. Unsubscribe anytime.</p>` +
    `</form>`;
}

/**
 * Render one inline signup block.
 *
 * @param {object} opts
 * @param {string} opts.slot        witb-primary | witb-secondary | brand | article |
 *                                  feature | scorecard-primary | scorecard-secondary | home
 * @param {string} opts.pageType    witb | brand | article | feature | scorecard | home
 * @param {object} [opts.data]      input for the copy resolver
 * @param {string} [opts.brandSlug] for per-brand conversion analysis
 * @param {string} [opts.latestIssueUrl] where the success state sends the reader
 */
function signupBlockHtml({ slot, pageType, data, brandSlug, latestIssueUrl } = {}) {
  // Fail the BUILD, not the form: a page must never ship a form posting nowhere.
  assertEndpoint();
  if (!slot || !pageType) throw new Error('[signup-block] slot and pageType are required.');

  // 1. Copy first, in its own step, where a failure is contained.
  const { headline, proofLine } = resolveCopy(pageType, data);

  // 2. Then the form, from a template that never saw the data.
  const id = `scb-${slot}`;
  const form = formHtml().replace(/\{\{ID\}\}/g, id);

  const proofHtml = proofLine
    ? `<p class="scb-proof">${esc(proofLine)}</p>`
    : '';

  const testimonialHtml = TESTIMONIAL.enabled
    ? `<figure class="scb-quote">` +
        `<blockquote class="scb-quote-text">${esc(TESTIMONIAL.quote)}</blockquote>` +
        `<figcaption class="scb-quote-src">${esc(TESTIMONIAL.source)}</figcaption>` +
      `</figure>`
    : '';

  return '' +
    `<section class="scb" id="${esc(id)}" ` +
      `data-slot="${esc(slot)}" data-page-type="${esc(pageType)}"` +
      (brandSlug ? ` data-brand-slug="${esc(brandSlug)}"` : '') +
      ` data-next-month="${esc(nextMonthLabel())}"` +
      (latestIssueUrl ? ` data-latest-issue="${esc(latestIssueUrl)}"` : '') +
      ` aria-labelledby="${esc(id)}-heading">` +
      `<p class="scb-eyebrow">The Scorecard by DORMIED</p>` +
      `<h3 class="scb-headline" id="${esc(id)}-heading">${esc(headline)}</h3>` +
      proofHtml +
      form +
      `<div class="scb-status" role="status" aria-live="polite"></div>` +
      testimonialHtml +
    `</section>`;
}

module.exports = {
  signupBlockHtml,
  resolveCopy,
  fmtChange,
  nextMonthLabel,
  TESTIMONIAL,
  NEWSLETTER_CONFIRM_PATH,
};
