'use strict';

/**
 * DB rest switch (server side). The browser scripts carry a matching
 * `DB_REST` constant at the top of each file.
 *
 * When true, the site stops sending routine traffic to Supabase so an
 * exhausted disk-IO budget can refill: /api/shop answers 503 at once (the
 * carousels fall back to the static shop snapshot), and /api/go skips its
 * click-log insert. /api/go still looks up the tracking URL, because a buy
 * click has nowhere else to go, but with a short deadline.
 *
 * Turned on 23 Oct 2026: the budget stayed at zero for three days because
 * ordinary page traffic kept querying it. Set back to false (here and in the
 * js/ files) once a one-row query answers quickly again.
 */
module.exports = { DB_REST: false };
