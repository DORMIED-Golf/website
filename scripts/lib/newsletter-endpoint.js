'use strict';
/**
 * scripts/lib/newsletter-endpoint.js
 *
 * THE one definition of where a newsletter signup posts. Every form on the
 * site, inline blocks and the footer alike, renders from these constants.
 *
 * Why this exists: the footer signup silently stopped reaching Beehiiv and
 * nobody found out for an unknown period. Separately, the author name lived in
 * five files, drifted, and shipped the wrong byline site-wide until it was
 * extracted into article-authors.js. The same value duplicated across templates
 * is the shape of both bugs, so the endpoint gets one home and no other file is
 * allowed to spell it out.
 *
 * The build asserts these are present (assertEndpoint below). A page carrying a
 * form that posts nowhere must never ship, so a missing constant fails the
 * build rather than degrading quietly at runtime.
 */

/** Where the form posts. Server-side handler lives at api/subscribe.js. */
const NEWSLETTER_ENDPOINT = '/api/subscribe';

/** HTTP method for the form element and the fetch upgrade alike. */
const NEWSLETTER_METHOD = 'POST';

/** Name of the email field. The API reads req.body.email. */
const NEWSLETTER_FIELD = 'email';

/**
 * Where a no-JS native POST lands. api/subscribe.js redirects here (303) when
 * the request is a form submission rather than the fetch upgrade, so a reader
 * with JS blocked still gets a real confirmation instead of raw JSON.
 */
const NEWSLETTER_CONFIRM_PATH = '/scorecard/subscribed/';

/**
 * Fails the build when any constant is missing or blank. Called by every
 * generator that renders a form, before it renders one.
 */
function assertEndpoint() {
  const required = {
    NEWSLETTER_ENDPOINT,
    NEWSLETTER_METHOD,
    NEWSLETTER_FIELD,
    NEWSLETTER_CONFIRM_PATH,
  };
  for (const [name, value] of Object.entries(required)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(
        `[newsletter-endpoint] ${name} is missing or empty. Refusing to render a signup form ` +
        `that posts nowhere. Fix scripts/lib/newsletter-endpoint.js before building.`
      );
    }
  }
  if (!NEWSLETTER_ENDPOINT.startsWith('/')) {
    throw new Error(`[newsletter-endpoint] NEWSLETTER_ENDPOINT must be a root-relative path, got "${NEWSLETTER_ENDPOINT}".`);
  }
  return true;
}

module.exports = {
  NEWSLETTER_ENDPOINT,
  NEWSLETTER_METHOD,
  NEWSLETTER_FIELD,
  NEWSLETTER_CONFIRM_PATH,
  assertEndpoint,
};
