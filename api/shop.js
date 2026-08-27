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
  'source_published_at',
  // source drives the card variant (Amazon rows render price-free).
  // tracking_url is selected ONLY so the Amazon branch of shape() can emit it;
  // it is never returned for any other source. See the note in shape().
  'source', 'tracking_url',
].join(',');

function shape(row) {
  const isAmazon = row.source === 'amazon';
  return {
    id:                  row.id,
    name:                row.name,
    image_url:           row.image_url,
    // Amazon rows carry no price on purpose. The Associates agreement only
    // licenses prices obtained through their API, which needs 10 qualifying
    // sales in 30 days that DORMIED does not have yet. A "Check price on
    // Amazon" card sidesteps the whole price-freshness regime rather than
    // displaying a number we are not entitled to show or able to refresh.
    current_price:       isAmazon ? null : row.current_price,
    original_price:      isAmazon ? null : row.original_price,
    discount_percentage: isAmazon ? null : row.discount_percentage,
    currency:            row.currency,
    promo_code:          row.promo_code,
    promo_title:         row.promo_title,
    feed_updated_at:     row.feed_updated_at,
    source:              row.source,
    // Every other network's tracking_url stays server-side and is only ever
    // reachable through /api/go/{id}. Amazon is the deliberate exception: the
    // value is a public amzn.to share link carrying the tag, so there is
    // nothing to conceal, and Amazon's policy on redirecting links is strict
    // enough that sending the click straight to them is the safer read. The
    // cost is that Amazon clicks are not logged; flip this back to go_url if
    // Associates support confirms the redirect is acceptable.
    go_url:              isAmazon ? row.tracking_url : `/api/go/${row.id}`,
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

  // ids= serves an explicit, ordered set of products — used by "Shop This Bag",
  // where the page has already decided WHICH products (the ones actually in the
  // player's bag) and only needs them rendered. Ids are already public: every
  // card links through /api/go/{id}. Capped and integer-only so this cannot be
  // used to enumerate the table.
  const idsRaw = typeof q.ids === 'string' ? q.ids.trim() : '';
  const ids = idsRaw
    ? [...new Set(idsRaw.split(',').map(x => parseInt(x, 10)).filter(Number.isInteger))].slice(0, MAX_LIMIT)
    : [];

  if (!brand && !ids.length) return res.status(400).json({ error: 'brand or ids required' });

  if (ids.length) {
    const { SUPABASE_URL: U, SUPABASE_SERVICE_KEY: K } = process.env;
    if (!U || !K) return res.status(500).json({ error: 'DB not configured' });
    const sb = createClient(U, K);
    try {
      const { data, error } = await sb.from('affiliate_products')
        .select(SELECT_COLS).in('id', ids).eq('is_active', true);
      if (error) throw new Error(error.message);
      // Preserve the caller's order — bag order is meaningful (driver first).
      const byId = new Map((data || []).map(r => [r.id, r]));
      const ordered = ids.map(i => byId.get(i)).filter(Boolean);
      return res.status(200).json({
        ids: ids.length, count: ordered.length, limit: ordered.length, offset: 0,
        products: ordered.map(shape),
      });
    } catch (e) {
      return res.status(500).json({ error: 'lookup failed' });
    }
  }

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

    // ── Direct-deal precedence ────────────────────────────────────────────
    // Where DORMIED has its own affiliate relationship (Cobra, Puma, Malbon,
    // Pins & Aces today) the commission is materially better than Amazon's, so
    // those brands must never surface an Amazon link. Decided on the products
    // actually held rather than on affiliate_programs rows, so it stays correct
    // if a program exists but its catalogue is empty, and it needs no upkeep
    // when a new direct deal is signed.
    const { count: directCount } = await supabase
      .from('affiliate_products')
      .select('*', { count: 'exact', head: true })
      .eq('dormied_brand_slug', brand)
      .eq('is_active', true)
      .neq('source', 'amazon');
    const amazonOnly = !directCount;

    // Pull every in-stock, active row for the brand, then collapse in code.
    // Paginating in SQL before collapsing would give wrong page sizes, since a
    // page of rows can contain many variants of the same product.
    const rows = [];
    for (let from = 0; ; from += 1000) {
      let q = supabase
        .from('affiliate_products')
        .select(SELECT_COLS)
        .eq('dormied_brand_slug', brand)
        .eq('is_active', true)
        .eq('stock_availability', 'InStock');
      // The price floor exists to strip $0.01 add-on SKUs out of a real feed.
      // Amazon rows are hand-curated and deliberately carry a NULL price, and
      // `NULL >= 1.00` is NULL in Postgres, so applying the floor to them would
      // silently drop every one.
      q = amazonOnly ? q.eq('source', 'amazon')
                     : q.neq('source', 'amazon').gte('current_price', minPrice);
      const { data, error } = await q.range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }

    // Gift cards are catalogue items but never a product we want to feature.
    // Arccos ships 10 of them (up to $500), Pins & Aces 4 and Malbon 1, and a
    // "Digital Gift Card - $500.00" card in a Shop Arccos carousel reads as a
    // filler listing. Filtered here rather than in a sync because the syncs set
    // is_active:true on every upsert, so a hand deactivation is undone nightly,
    // and because this one place covers the Impact, Shopify, CJ and Amazon
    // sources at once. Explicit ids= requests are unaffected: a gift card can
    // only get into that list if someone put it there deliberately.
    const GIFT_CARD = /(gift\s*card|e-?gift|giftcard)/i;
    const productRows = rows.filter(r =>
      !(GIFT_CARD.test(r.name || '') || /gift\s*cards?/i.test(r.category || '')));

    if (!productRows.length) return res.status(200).json({ brand, count: 0, limit, offset, products: [] });

    // Collapse: one winner per item_group_id. A null group is its own group
    // (defensive — item_group_id is populated on 100% of current rows).
    const winners = new Map();
    for (const row of productRows) {
      const key = row.item_group_id ? `g:${row.item_group_id}` : `i:${row.id}`;
      winners.set(key, betterOf(winners.get(key), row));
    }

    // Total order: newest first, id DESC (id makes the sort unique, so
    // LIMIT/OFFSET is stable across pages).
    //
    // Prefer the MERCHANT's publish date where we have it. A feed-sourced
    // catalog is ingested in one pass, so every row shares a first_seen_at and
    // sorting on it alone would collapse to insertion order. Impact rows have
    // no source_published_at and fall back to first_seen_at exactly as before.
    const recencyOf = r => r.source_published_at || r.first_seen_at;
    const ordered = [...winners.values()].sort((a, b) => {
      const ra = recencyOf(a), rb = recencyOf(b);
      if (ra !== rb) return ra < rb ? 1 : -1;
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
