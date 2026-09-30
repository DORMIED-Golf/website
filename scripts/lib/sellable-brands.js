'use strict';
/**
 * scripts/lib/sellable-brands.js
 *
 * The set of brand slugs that should get a shop carousel.
 *
 * Three generators each ran their own copy of "select dormied_brand_slug from
 * affiliate_programs where status = active and slug is not null":
 * generate-brand-page.js, generate-article.js and the Shop This Bag block in
 * generate-witb-player-page.js. That definition breaks the moment a program
 * spans more than one brand, which is exactly what the Amazon Associates row
 * does: it is a single program covering many brands, so its dormied_brand_slug
 * is NULL and every one of those queries misses it.
 *
 * Sellability is really a question about products, not programs, so that is
 * what this asks. Kept as two cheap queries rather than a DISTINCT over the
 * whole 11k-row product table:
 *
 *   A. programs with their own brand slug   (the direct deals, unchanged)
 *   B. brands with at least one active Amazon product  (small, hand-curated)
 *   C. brands a multi-brand retailer (Global Golf) holds active products for,
 *      via the retailer_brand_slugs() SQL function (a DISTINCT server-side,
 *      so the ~35k retailer rows are never paged through here)
 */

/**
 * @param {object} supabase Supabase client
 * @returns {Promise<Set<string>>} brand slugs eligible for a shop carousel
 */
async function fetchOnce(supabase, includeUsed) {
  const slugs = new Set();

  const { data: progRows, error: progErr } = await supabase
    .from('affiliate_programs')
    .select('dormied_brand_slug')
    .eq('status', 'active')
    .not('dormied_brand_slug', 'is', null);
  if (progErr) throw new Error(`affiliate_programs: ${progErr.message}`);
  for (const r of progRows || []) slugs.add(r.dormied_brand_slug);

  // Amazon rows are curated by hand and few, so a plain paged read is fine and
  // avoids needing an RPC for DISTINCT.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('affiliate_products')
      .select('dormied_brand_slug')
      .eq('source', 'amazon')
      .eq('is_active', true)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`affiliate_products: ${error.message}`);
    if (!data || !data.length) break;
    for (const r of data) if (r.dormied_brand_slug) slugs.add(r.dormied_brand_slug);
    if (data.length < 1000) break;
  }

  // includeUsed: Shop This Bag may show pre-owned retailer stock, so it also
  // counts brands whose retailer stock is all used; carousels do not.
  const { data: retailerSlugs, error: rErr } = await supabase.rpc('retailer_brand_slugs', { p_include_used: !!includeUsed });
  if (rErr) throw new Error(`retailer_brand_slugs: ${rErr.message}`);
  for (const s of retailerSlugs || []) {
    const slug = typeof s === 'string' ? s : s && s.retailer_brand_slugs;
    if (slug) slugs.add(slug);
  }

  return slugs;
}

/**
 * Retried, because every caller treats a failure as "no brand is sellable": a
 * single transient error during a --force brand rebuild wrote all 215 pages
 * without a carousel (Sep 2026).
 */
async function fetchSellableBrandSlugs(supabase, { includeUsed = false, attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fetchOnce(supabase, includeUsed); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1000 * (i + 1))); }
  }
  throw lastErr;
}

module.exports = { fetchSellableBrandSlugs };
