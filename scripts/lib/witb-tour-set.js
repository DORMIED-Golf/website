'use strict';
/**
 * scripts/lib/witb-tour-set.js
 *
 * The one definition of "the tour" behind every WITB usage figure: RANKED
 * players (owgr_rank not null) whose CURRENT bag is dated within the stats
 * window (12 months by default, WITB_STATS_WINDOW_MONTHS to override).
 *
 * is_current says a bag is a player's latest, not that it is recent: a player
 * who has not been re-crawled keeps a 2021 bag forever. The /witb hub has used
 * this window since it was built; the player pages ("N of 195") and brand
 * On Tour sections counted every ranked player instead, so the same question
 * got two answers depending on the page. All three now read this module.
 */

const STATS_WINDOW_MONTHS = Number(process.env.WITB_STATS_WINDOW_MONTHS || 12);

function statsCutoff(now = new Date()) {
  const d = new Date(now);
  d.setMonth(d.getMonth() - STATS_WINDOW_MONTHS);
  return d;
}

/** True when a bag_date falls inside the stats window. */
function isActiveBagDate(bagDate, cutoff = statsCutoff()) {
  return !!bagDate && new Date(bagDate) >= cutoff;
}

module.exports = { STATS_WINDOW_MONTHS, statsCutoff, isActiveBagDate };
