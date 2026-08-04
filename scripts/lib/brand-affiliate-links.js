'use strict';
/**
 * scripts/lib/brand-affiliate-links.js
 *
 * Brand-level affiliate links for the "Visit {Brand}" button on /brands/{slug}/.
 *
 * These are storefront-homepage links, not product links. Product links live in
 * affiliate_products and are served through /api/go/{id} so tracking_url never
 * reaches the browser. These are different: they are public vanity redirect
 * URLs with the click id in the path, meant to be clicked directly, so there is
 * nothing to conceal and no per-product row to key off.
 *
 * Deliberately NOT stored in affiliate_programs. That table drives the catalog
 * syncs (sync-affiliate-catalog.js iterates it and fails the job loudly when a
 * catalog fetch comes back short), and Descente has an affiliate link but no
 * product catalog. A row there would be a program the sync cannot satisfy.
 *
 * Every link rendered from this map carries rel="sponsored nofollow", which is
 * the same rule shop-carousel.js follows for product links.
 *
 * To add a brand: paste the network's vanity link exactly as issued. Do not
 * append UTM parameters — the click id is in the path and extra query strings
 * can break attribution on some networks.
 */

const BRAND_AFFILIATE_LINKS = {
  'malbon':        'https://malbon-golf.sjv.io/ZV4jnR',
  'descente':      'https://descentesea.sjv.io/AgGRoK',
  'pins-and-aces': 'https://pinsaces.sjv.io/Gb2Rjn',

  // Cobra and Puma Golf are CJ advertisers (affiliate_programs ids 4 and 5,
  // advertiser 6530791), not Impact, so they have no .sjv.io link. Their
  // brand-level CJ links have not been supplied yet; until they are, both
  // fall through to the plain website URL rather than shipping a guess.
  // 'cobra':     '',
  // 'puma-golf': '',
};

/** Returns the affiliate URL for a brand slug, or null when there isn't one. */
function brandAffiliateLink(slug) {
  return BRAND_AFFILIATE_LINKS[slug] || null;
}

module.exports = { BRAND_AFFILIATE_LINKS, brandAffiliateLink };
