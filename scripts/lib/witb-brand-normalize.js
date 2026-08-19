'use strict';
/**
 * scripts/lib/witb-brand-normalize.js
 *
 * Single source of truth for which golf sub-brands are stored as brands in
 * their own right, shared by the crawler (witb-scrape.js) and the manual
 * updater (witb-manual-update.js) so both paths store a club identically.
 *
 * The rule the site already follows: a sub-brand is promoted to its own
 * witb_brands row IFF it has its own DORMIED brand page. Odyssey has
 * /brands/odyssey-golf/ so it is its own brand, while Toulon (an Odyssey
 * sub-brand with no page) stays a model prefix: "Odyssey" + "Toulon Design
 * Las Vegas". Vokey and Spider likewise stay inside Titleist and TaylorMade.
 *
 * Scotty Cameron has /brands/scotty-cameron/ but was the one violation — the
 * upstream source labels those putters inconsistently, sometimes under a
 * titleist brand link and sometimes a scotty-cameron one, so the stored brand
 * depended on which crawl wrote the row. Normalizing here makes the result
 * deterministic regardless of what the source says on a given week.
 *
 * Add a sub-brand below ONLY when /brands/{dormied_slug}/ exists; otherwise the
 * club renders with no logo and a link to a 404.
 */

// parentBrand + model beginning with `prefix` -> promoted to its own brand.
const PROMOTED_SUB_BRANDS = [
  { parent: 'Titleist', prefix: 'Scotty Cameron', brand: 'Scotty Cameron', slug: 'scotty-cameron' },
];

const normKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * CANONICAL SPELLINGS.
 *
 * Sources spell the same product several ways and each variant becomes its own
 * row, which splits a product across brand pages and tour-usage counts. It had
 * already happened four times: PING appeared as both "PING" and "Ping" across
 * 773 items, Golf Pride's Z-Grip Cord had three spellings, and Lamkin's UTx and
 * UTx Mid had two each. Earlier the same thing produced a duplicate witb_brands
 * row for "Super Stroke" with a null dormied_brand_slug, which silently broke
 * the brand link.
 *
 * Keyed on the normalised form, so any punctuation or casing variant collapses
 * to the manufacturer's own spelling. Applied on every write path, so the
 * weekly crawl and a manual update store a club identically.
 */
const CANONICAL_BRANDS = {
  ping: 'PING',
};

// normKey(brand) -> { normKey(model): canonical model }
const CANONICAL_MODELS = {
  golfpride: {
    zgripcord: 'Z-Grip Cord',
    zgripcordalign: 'Z-Grip Cord Align',
  },
  lamkin: {
    utx: 'UTx',
    utxmid: 'UTx Mid',
    utxmidsize: 'UTx Midsize',
  },
};

/** Apply the canonical spelling for a brand/model pair. */
function canonicalize(brand, model) {
  const b = CANONICAL_BRANDS[normKey(brand)] || brand;
  const byBrand = CANONICAL_MODELS[normKey(b)];
  const m = (byBrand && model != null) ? (byBrand[normKey(model)] || model) : model;
  return { brand: b, model: m };
}

/**
 * Normalize one item's brand/model pair.
 *
 * @param {string|null} rawBrand   brand as the source reported it
 * @param {string|null} rawModel   model as the source reported it
 * @param {string|null} brandSlug  the source's own brand slug, if any
 * @returns {{raw_brand, raw_model, brand_slug, promoted: boolean}}
 */
function normalizeBrandModel(rawBrand, rawModel, brandSlug = null) {
  const model = String(rawModel || '');

  for (const sub of PROMOTED_SUB_BRANDS) {
    const parentMatches = normKey(rawBrand) === normKey(sub.parent);
    const slugMatches   = normKey(brandSlug) === normKey(sub.slug);
    const modelCarries  = normKey(model).startsWith(normKey(sub.prefix));

    // Promote when the model carries the sub-brand (whatever the source called
    // the brand), or when the source already used the sub-brand's own slug.
    if (!(modelCarries && (parentMatches || slugMatches || !rawBrand)) && !slugMatches) continue;

    // Strip the now-redundant prefix: "Scotty Cameron Phantom 9.5R" -> "Phantom 9.5R".
    const stripped = model.replace(new RegExp('^\\s*' + sub.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '').trim();
    const promotedNames = canonicalize(sub.brand, stripped || model || null);
    return {
      raw_brand:  promotedNames.brand,
      // Never strip a model down to nothing — keep the original if that happens.
      raw_model:  promotedNames.model,
      brand_slug: sub.slug,
      promoted:   true,
    };
  }

  const names = canonicalize(rawBrand, rawModel);
  return { raw_brand: names.brand, raw_model: names.model, brand_slug: brandSlug, promoted: false };
}

module.exports = { PROMOTED_SUB_BRANDS, CANONICAL_BRANDS, CANONICAL_MODELS, normalizeBrandModel, canonicalize };
