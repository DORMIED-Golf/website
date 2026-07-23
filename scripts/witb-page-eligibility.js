'use strict';
/**
 * scripts/witb-page-eligibility.js
 *
 * Single source of truth for "does this player get a /witb/players/{slug}/ page".
 *
 * Ranked players (numeric OWGR) always qualify. UNRANKED players (owgr_rank IS
 * NULL) also qualify — they render "Unranked" — EXCEPT an explicit blocklist of
 * players who should not be featured (fell off tour / no longer appropriate).
 * This is a blocklist, not an allowlist: any unranked player not named here gets
 * a page automatically, including future additions.
 *
 * Unranked players are excluded from the tour-usage statistics, which stay
 * ranked-only, so they never distort the percentages.
 */

// Unranked players that must NOT get a page (everyone else unranked is shown).
const UNRANKED_BLOCKLIST = new Set([
  'grayson-murray',  // passed away May 2024
  'scott-stallings', // long off tour, stale bag
]);

// owgr_rank: number|null ; slug: canonical slug. (Third arg accepted for
// backward-compatible call sites but unused.)
function pageEligible(owgr_rank, slug) {
  if (owgr_rank !== null && owgr_rank !== undefined) return true; // ranked
  return !UNRANKED_BLOCKLIST.has(slug);                           // unranked unless blocklisted
}

module.exports = { UNRANKED_BLOCKLIST, pageEligible };
