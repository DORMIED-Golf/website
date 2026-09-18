'use strict';
/**
 * scripts/lib/brand-pinned-products.js
 *
 * The one product that leads a brand's Shop carousel, by EXACT product name.
 *
 * /api/shop has taken a `pin` parameter since it was written, but nothing baked
 * one, so every carousel led with whatever the default sort produced (in stock,
 * then cheapest). A hero product a brand is actually pushing deserves the first
 * card.
 *
 * The match is exact and unnormalised on purpose, the same rule /api/shop
 * applies: a renamed product simply stops pinning and the carousel falls back
 * to its normal order, which is the safe failure. It never pins the wrong item.
 *
 * Names must match affiliate_products.name, which for Shopify programs is the
 * merchant's product title verbatim ("Tour V7 Shift", not "TOUR V7 SHIFT").
 */

const BRAND_PINNED_PRODUCTS = {
  'bushnell-golf': 'Tour V7 Shift',
};

/** Exact product name to lead this brand's carousel, or null. */
function pinnedProductName(slug) {
  return BRAND_PINNED_PRODUCTS[slug] || null;
}

/** ` data-pin="..."` for the carousel mount, or '' when the brand has no pin. */
function pinnedProductAttr(slug, escHtml) {
  const name = pinnedProductName(slug);
  return name ? ` data-pin="${escHtml(name)}"` : '';
}

module.exports = { BRAND_PINNED_PRODUCTS, pinnedProductName, pinnedProductAttr };
