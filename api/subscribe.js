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
async function subscribeToBeehiiv(email) {
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
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    console.error('[subscribe] Beehiiv API error:', response.status, body);
    throw new Error('Subscription failed');
  }

  return { success: true };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const result = await subscribeToBeehiiv(email.trim().toLowerCase());
    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({ error: 'Something went wrong. Try again or email us at dormiedgolf@gmail.com' });
  }
};
