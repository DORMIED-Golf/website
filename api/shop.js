'use strict';

/**
 * DORMIED — Affiliate Shop Feed (read-only JSON for the product carousel)
 *
 * GET /api/shop?brand=pins-and-aces&limit=10&offset=0
 * GET /api/shop?brand=pins-and-aces&pin=<exact product name>
 *
 * Returns displayable products for a brand. No HTML, no rendering.
 *
 * Rules enforced here:
 *   - is_active = true AND stock_availability = 'InStock' (exact string).
 *   - Filter to in-stock FIRST, then collapse variants. (Collapsing first would
 *     drop the ~7.7% of groups whose parent is out of stock but whose child
 *     variants are still available.)
 *   - One row per item_group_id. Winner within a group, deterministically:
 *       1. is_parent = true first
 *       2. then lowest current_price
 *       3. then lowest id   <- required tiebreaker; 40 groups tie on price
 *     No group has more than one in-stock parent, so no extra branching.
 *   - Order: first_seen_at DESC, id DESC. The id is required: first_seen_at has
 *     only 6 distinct values across the catalog, so without a unique tiebreaker
 *     LIMIT/OFFSET can repeat and skip rows across pages.
 *   - NEVER returns tracking_url / mobile_tracking_url (the client must go via
 *     /api/go/{id}), nor category / sub_category (opaque codes / empty).
 *   - Empty array on no results, never an error.
 *
 * Uses SUPABASE_SERVICE_KEY: these tables are RLS deny-all, so an anon key would
 * silently return an empty array rather than erroring.
 */

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT     = 24;

// Columns needed to collapse + render. Deliberately excludes description,
// tracking_url, mobile_tracking_url, category, sub_category.
const SELECT_COLS = [
  'id', 'name', 'image_url', 'current_price', 'original_price',
  'discount_percentage', 'currency', 'promo_code', 'promo_title',
  'feed_updated_at', 'item_group_id', 'is_parent', 'first_seen_at',
].join(',');

function shape(row) {
  return {
    id:                  row.id,
    name:                row.name,
    image_url:           row.image_url,
    current_price:       row.current_price,
    original_price:      row.original_price,
    discount_percentage: row.discount_percentage,
    currency:            row.currency,
    promo_code:          row.promo_code,
    promo_title:         row.promo_title,
    feed_updated_at:     row.feed_updated_at,
    go_url:              `/api/go/${row.id}`,
  };
}

// Deterministic winner within one item_group_id.
function betterOf(a, b) {
  if (!a) return b;
  const ap = a.is_parent === true, bp = b.is_parent === true;
  if (ap !== bp) return ap ? a : b;                       // 1. parent wins
  const apr = a.current_price, bpr = b.current_price;     // 2. lowest price
  const aNull = apr === null || apr === undefined, bNull = bpr === null || bpr === undefined;
  if (!aNull && !bNull && Number(apr) !== Number(bpr)) return Number(apr) < Number(bpr) ? a : b;
  if (aNull !== bNull) return aNull ? b : a;              // a priced row beats an unpriced one
  return a.id <= b.id ? a : b;                            // 3. lowest id
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q      = req.query || {};
  const brand  = typeof q.brand === 'string' ? q.brand.trim() : '';
  const pin    = typeof q.pin === 'string' ? q.pin.trim() : '';
  const limit  = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit, 10) || DEFAULT_LIMIT));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);

  if (!brand) return res.status(400).json({ error: 'brand required' });

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'DB not configured' });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Per-program price floor. Excludes add-on service SKUs (e.g. "Item
    // Personalization" at $0.01) without any name/keyword/category matching.
    // Unmapped brand -> no program row -> fall back to the column default.
    const { data: programRow } = await supabase
      .from('affiliate_programs')
      .select('min_display_price')
      .eq('dormied_brand_slug', brand)
      .maybeSingle();
    const minPrice = programRow && programRow.min_display_price !== null
      ? Number(programRow.min_display_price) : 1.00;

    // Pull every in-stock, active row for the brand, then collapse in code.
    // Paginating in SQL before collapsing would give wrong page sizes, since a
    // page of rows can contain many variants of the same product.
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('affiliate_products')
        .select(SELECT_COLS)
        .eq('dormied_brand_slug', brand)
        .eq('is_active', true)
        .eq('stock_availability', 'InStock')
        .gte('current_price', minPrice)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }

    if (!rows.length) return res.status(200).json({ brand, count: 0, limit, offset, products: [] });

    // Collapse: one winner per item_group_id. A null group is its own group
    // (defensive — item_group_id is populated on 100% of current rows).
    const winners = new Map();
    for (const row of rows) {
      const key = row.item_group_id ? `g:${row.item_group_id}` : `i:${row.id}`;
      winners.set(key, betterOf(winners.get(key), row));
    }

    // Total order: first_seen_at DESC, id DESC (id makes the sort unique, so
    // LIMIT/OFFSET is stable across pages).
    const ordered = [...winners.values()].sort((a, b) => {
      if (a.first_seen_at !== b.first_seen_at) return a.first_seen_at < b.first_seen_at ? 1 : -1;
      return b.id - a.id;
    });

    const total = ordered.length;

    // pin: EXACT name match (whitespace-trimmed only). No fuzzy matching, no
    // normalization. Hit -> pinned first and removed from the remainder.
    // Miss -> default ordering, unchanged.
    let pinned = null, rest = ordered;
    if (pin) {
      const idx = ordered.findIndex(r => (r.name || '').trim() === pin);
      if (idx !== -1) { pinned = ordered[idx]; rest = ordered.slice(0, idx).concat(ordered.slice(idx + 1)); }
    }

    // Translate the requested offset into a remainder offset. The pinned card
    // consumes one slot on page 0, so every later page starts one earlier in
    // the remainder — otherwise remainder[limit-1] would never be returned.
    const remainderOffset = (pinned && offset > 0) ? offset - 1 : offset;
    const remainderLimit  = (pinned && offset === 0) ? Math.max(0, limit - 1) : limit;
    const slice = rest.slice(remainderOffset, remainderOffset + remainderLimit);
    const page  = (pinned && offset === 0) ? [pinned, ...slice] : slice;

    return res.status(200).json({
      brand,
      count: total,
      limit,
      offset,
      pinned: pinned ? pinned.id : null,
      products: page.map(shape),
    });
  } catch (err) {
    console.error('[shop] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
