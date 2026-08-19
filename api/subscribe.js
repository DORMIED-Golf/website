/**
 * DORMIED — Beehiiv Email Subscription Handler
 *
 * POST /api/subscribe
 * Body: { email: string }
 *
 * Environment variables required (set in Vercel dashboard + .env locally):
 *   BEEHIIV_PUBLICATION_ID
 *   BEEHIIV_API_KEY
 */

'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * subscribeToBeehiiv — shared server-side subscription logic.
 * Returns { success: true } or throws with a user-safe message.
 */
/**
 * Slots the site actually renders. The value is forwarded to Beehiiv as
 * utm_source so conversion can be analysed per placement, and the open question
 * (does equipment-intent WITB traffic convert for a brand newsletter at all?)
 * cannot be answered from a blended number. Allowlisted rather than passed
 * through, so nothing arbitrary from a request body reaches the vendor.
 */
const SLOTS = new Set([
  'witb-primary', 'witb-secondary', 'brand', 'article', 'feature',
  'scorecard-primary', 'scorecard-secondary', 'home', 'footer',
]);
const PAGE_TYPES = new Set(['witb', 'brand', 'article', 'feature', 'scorecard', 'home', 'footer']);

async function subscribeToBeehiiv(email, slot, pageType) {
  const publicationId = process.env.BEEHIIV_PUBLICATION_ID;
  const apiKey        = process.env.BEEHIIV_API_KEY;

  if (!publicationId || !apiKey) {
    console.error('[subscribe] Missing BEEHIIV_PUBLICATION_ID or BEEHIIV_API_KEY env vars');
    throw new Error('Server configuration error');
  }

  const url = `https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      email,
      reactivate_existing: true,
      send_welcome_email:  true,
      utm_source:   slot     || 'unknown',
      utm_medium:   pageType || 'unknown',
      utm_campaign: 'scorecard-signup',
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    console.error('[subscribe] Beehiiv API error:', response.status, body);
    throw new Error('Subscription failed');
  }

  return { success: true };
}

/**
 * A browser with JS disabled submits the form natively, which arrives as
 * application/x-www-form-urlencoded and expects a PAGE back, not JSON. Handing
 * that reader a raw JSON body would look broken and lose their signup, so those
 * requests get a 303 to a real confirmation page instead. The fetch upgrade in
 * js/signup.js sends JSON and still gets JSON.
 */
const CONFIRM_PATH = '/scorecard/subscribed/';

function wantsHtml(req) {
  const ct = String(req.headers['content-type'] || '');
  const accept = String(req.headers['accept'] || '');
  if (ct.includes('application/json')) return false;
  return ct.includes('application/x-www-form-urlencoded')
      || ct.includes('multipart/form-data')
      || (accept.includes('text/html') && !accept.includes('application/json'));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const html = wantsHtml(req);
  const { email } = req.body || {};
  const slot     = SLOTS.has(req.body && req.body.slot) ? req.body.slot : (html ? 'no-js' : 'unknown');
  const pageType = PAGE_TYPES.has(req.body && req.body.page_type) ? req.body.page_type : 'unknown';

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    if (html) return res.redirect(303, `${CONFIRM_PATH}?status=invalid`);
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const result = await subscribeToBeehiiv(email.trim().toLowerCase(), slot, pageType);
    if (html) return res.redirect(303, `${CONFIRM_PATH}?status=ok`);
    return res.status(200).json(result);
  } catch (err) {
    if (html) return res.redirect(303, `${CONFIRM_PATH}?status=error`);
    return res.status(502).json({ error: 'Something went wrong. Try again or email us at dormiedgolf@gmail.com' });
  }
};
