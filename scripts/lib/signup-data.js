'use strict';
/**
 * scripts/lib/signup-data.js
 *
 * Data for the inline signup block's proof line, fetched ONCE per build and
 * cached in module scope. A 195-page WITB bake must not issue 195 identical
 * queries for the same two numbers.
 *
 * Every function here resolves to a plain object and NEVER throws. A failed
 * query returns nulls, the copy resolver in signup-block.js falls back, and the
 * form is unaffected: the form template is never handed this data at all.
 */

let witbCache = null;

/**
 * { bagCount, changeCount, playerName, changeLabel }
 * bagCount    players holding a current bag
 * changeCount rows in witb_changes over the trailing 30 days
 * playerName  + changeLabel describe the most recent logged change
 *
 * Returns zeros/nulls rather than throwing. The block then renders its
 * headline with no proof line, which is the documented fallback: never render
 * "0 changes".
 */
async function witbSignupData(supabase) {
  if (witbCache) return witbCache;
  const empty = { bagCount: 0, changeCount: 0, playerName: null, changeLabel: null };
  if (!supabase) return (witbCache = empty);

  try {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();

    const [{ count: bagCount }, { count: changeCount }] = await Promise.all([
      supabase.from('witb_players').select('*', { count: 'exact', head: true }).not('current_bag_id', 'is', null),
      supabase.from('witb_changes').select('*', { count: 'exact', head: true }).gte('detected_at', since),
    ]);

    let playerName = null, changeLabel = null;
    const { data: latest } = await supabase
      .from('witb_changes')
      .select('player_id, club_type, change_type, new_value, old_value')
      .gte('detected_at', since)
      .order('detected_at', { ascending: false })
      .limit(1);

    const row = latest && latest[0];
    // Only an ADDED or SWAPPED club reads naturally in the sentence. A removal
    // would render "including X's nothing", so it is skipped rather than forced.
    if (row && row.new_value) {
      const { data: p } = await supabase
        .from('witb_players').select('name').eq('id', row.player_id).maybeSingle();
      if (p && p.name) {
        playerName  = p.name;
        changeLabel = String(row.new_value).trim();
      }
    }

    witbCache = {
      bagCount:    bagCount    || 0,
      changeCount: changeCount || 0,
      playerName,
      changeLabel,
    };
  } catch (err) {
    console.warn(`[signup-data] witb proof query failed: ${err.message}. Block will render headline only.`);
    witbCache = empty;
  }
  return witbCache;
}

/** Test seam: forget the cached values so a fresh build re-queries. */
function _resetCache() { witbCache = null; }

module.exports = { witbSignupData, _resetCache };
