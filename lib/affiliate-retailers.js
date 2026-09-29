'use strict';
/**
 * lib/affiliate-retailers.js
 *
 * Multi-brand retailers we earn commission through: one affiliate program that
 * sells many brands, so its affiliate_programs row has no dormied_brand_slug
 * and each product is assigned to a brand page by the sync (see
 * scripts/lib/retailer-brand-map.js). Shared by scripts/sync-affiliate-catalog.js
 * and api/shop.js, so config lives in code here, the same way CJ's Cobra/Puma
 * split and the pinned-product lists do.
 *
 *   match       tested against the Impact advertiser name on the catalog
 *   name        what a product card says: "Check price at Global Golf". A card
 *               for a TaylorMade putter sold by a retailer must not say "Check
 *               price at TaylorMade".
 *   enabled     false = the nightly sync fetches and reports the brand mapping
 *               but writes nothing. Flip only after reviewing that report.
 *   usedOnlyInBag  pre-owned items are stored, but only "Shop This Bag" on WITB
 *               pages may show them (often the only way to buy a model a player
 *               still carries). Brand and article carousels are new-only.
 */

const RETAILERS = [
  {
    key: 'global-golf',
    name: 'Global Golf',
    // Impact lists the advertiser as "Global Value Commerce Inc." (Global
    // Golf - U.S. in the marketplace).
    match: /global\s*value\s*commerce|global\s*golf/i,
    // Enabled 2026-09-29 after the brand mapping report was reviewed, then
    // paused the same day: the first load plus a day of heavy queries used up
    // the database's Disk IO budget, and the nightly sync rewrites all ~47k
    // rows. Existing products stay live. Re-enable once the sync writes only
    // changed rows.
    enabled: false,
    usedOnlyInBag: true,
  },
];

function retailerForAdvertiser(advertiserName) {
  const n = String(advertiserName || '');
  return RETAILERS.find(r => r.match.test(n)) || null;
}

/** True for a feed condition that is not new ("Used", "Pre-Owned", "Refurbished"...). */
function isPreOwned(condition) {
  const c = String(condition || '').trim().toLowerCase();
  return !!c && c !== 'new';
}

module.exports = { RETAILERS, retailerForAdvertiser, isPreOwned };
