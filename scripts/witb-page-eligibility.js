'use strict';
/**
 * scripts/witb-page-eligibility.js
 *
 * Single source of truth for "does this player get a /witb/players/{slug}/ page".
 *
 * Ranked players (numeric OWGR) always qualify. An UNRANKED player (owgr_rank
 * IS NULL) still qualifies when EITHER:
 *   - their current bag was documented recently (catches manual/fresh additions
 *     of tour players who are not in the world ranking), OR
 *   - they are on the evergreen allowlist (marquee names with no active ranking,
 *     e.g. Tiger Woods, Ian Poulter).
 * Otherwise they are hidden — this is what keeps stale / fallen-off players
 * (e.g. Grayson Murray, Scott Stallings) off the site.
 *
 * Unranked-but-eligible players render "Unranked" (the player page + the
 * Find-a-Player grid already support that label) and are excluded from the
 * tour-usage statistics, which stay ranked-only.
 */

// Evergreen unranked players that always get a page (canonical slugs).
const UNRANKED_ALLOWLIST = new Set([
  'tiger-woods',
  'ian-poulter',
]);

// An unranked player whose current bag is newer than this many days still gets a
// page — this is how a freshly added, not-yet-ranked tour player stays visible.
const UNRANKED_RECENT_DAYS = 120;

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const t = new Date(dateStr).getTime();
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 86400000;
}

// owgr_rank: number|null ; slug: canonical slug ; bagDate: current bag's date (YYYY-MM-DD) or null.
function pageEligible(owgr_rank, slug, bagDate) {
  if (owgr_rank !== null && owgr_rank !== undefined) return true; // ranked
  if (UNRANKED_ALLOWLIST.has(slug)) return true;                  // evergreen
  return daysSince(bagDate) <= UNRANKED_RECENT_DAYS;              // recently updated
}

module.exports = { UNRANKED_ALLOWLIST, UNRANKED_RECENT_DAYS, daysSince, pageEligible };
