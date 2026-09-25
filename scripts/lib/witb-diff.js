'use strict';
/**
 * scripts/lib/witb-diff.js
 *
 * The witb_changes rows between two bags, shared by the weekly crawler
 * (witb-scrape.js) and the manual updater (witb-manual-update.js).
 *
 * WHY A SET PER CLUB TYPE
 * Both callers used to key each bag by club_type and keep whichever item came
 * last. A bag holds several irons, wedges, grips and sometimes putters, so the
 * "value" of a club type was just the last row returned, and two bags with the
 * same clubs in a different order logged a swap. The Presidents Cup import of
 * Sep 2026 recorded "Justin Thomas: 621.JT -> T200" and a dozen more like it
 * for bags whose clubs had not changed at all, straight into This Week's Bag
 * Moves. Comparing the set of brand+model per club type removes that: order
 * never matters, and only a model that genuinely left or arrived is recorded.
 *
 * Within a club type, a model that left and one that arrived pair up as a
 * 'swapped' row; any surplus is 'added' or 'removed'. Names compare without
 * case or spacing differences ("Z-Grip Cord" == "Z-grip  cord").
 *
 * A DEBUT (no old bag) keeps its original shape, one 'added' row per club type
 * with a null old_bag_date: backfill-debut-changes.js writes the same shape and
 * the renderers read the null date as "new bag".
 */

const label = i => `${i.raw_brand || ''} ${i.raw_model || ''}`.trim();
const norm  = s => s.toLowerCase().replace(/\s+/g, ' ');

function groupByType(items) {
  const m = new Map();
  for (const i of items || []) {
    const v = label(i);
    if (!v) continue;
    if (!m.has(i.club_type)) m.set(i.club_type, new Map());
    const byKey = m.get(i.club_type);
    if (!byKey.has(norm(v))) byKey.set(norm(v), v);
  }
  return m;
}

/**
 * @returns {Array<object>} witb_changes rows (not yet inserted)
 */
function diffBags(oldItems, newItems, { player_id, oldBagDate, newBagDate, debut }) {
  const row = (club_type, change_type, old_value, new_value) =>
    ({ player_id, club_type, change_type, old_value, new_value, old_bag_date: debut ? null : oldBagDate, new_bag_date: newBagDate });

  if (debut) {
    const last = {};
    for (const i of newItems || []) { const v = label(i); if (v) last[i.club_type] = v; }
    return Object.entries(last).map(([t, v]) => row(t, 'added', null, v));
  }

  const oldG = groupByType(oldItems), newG = groupByType(newItems);
  const changes = [];
  for (const t of new Set([...oldG.keys(), ...newG.keys()])) {
    const o = oldG.get(t) || new Map(), n = newG.get(t) || new Map();
    const gone = [...o.keys()].filter(k => !n.has(k)).map(k => o.get(k));
    const came = [...n.keys()].filter(k => !o.has(k)).map(k => n.get(k));
    const pairs = Math.min(gone.length, came.length);
    for (let k = 0; k < pairs; k++) changes.push(row(t, 'swapped', gone[k], came[k]));
    for (const v of gone.slice(pairs)) changes.push(row(t, 'removed', v, null));
    for (const v of came.slice(pairs)) changes.push(row(t, 'added', null, v));
  }
  return changes;
}

module.exports = { diffBags };
