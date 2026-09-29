'use strict';
/**
 * scripts/lib/retailer-brand-map.js
 *
 * Assigns a multi-brand retailer's product (Global Golf via Impact) to one of
 * DORMIED's brand pages, or to none. A product on the wrong brand page is worse
 * than a product missing, so the rule is: match the feed's Manufacturer to a
 * tracked brand exactly (after normalising spelling), promote to a sub-brand
 * only on an explicit rule, and otherwise return null. Unmatched manufacturers
 * are counted by the sync and printed, so the list can be reviewed and aliases
 * added deliberately rather than guessed.
 *
 * Brands come from js/data.js, the same list the brand pages are built from,
 * so a mapped product always has a page to land on.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// "TaylorMade Golf", "Taylormade", "TAYLORMADE GOLF COMPANY" -> "taylormade".
// Accents stripped (Röhnisch), & -> and, and a trailing corporate/"golf" suffix
// removed so both "Cleveland" and "Cleveland Golf" reach cleveland-golf.
const SUFFIX_RE = /(golfcompany|golfco|golfinc|golfllc|golfusa|golf|company|inc|llc|usa|sportswear)$/;
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}
const stem = s => { const n = norm(s); const t = n.replace(SUFFIX_RE, ''); return t || n; };

// Manufacturer spellings that are not a plain variant of the brand name.
// Keys are stem()'d. Add only what a real feed report shows.
const ALIASES = {
  wilsonstaff:  'wilson',
  lab:          'l-a-b-golf',
  underarmour:  'under-armour-golf',
  newbalance:   'new-balance-golf',
  bridgestone:  'bridgestone-golf',
  // From the first Global Golf report (2026-09-29), each checked against
  // sample product names before adding:
  gregnorman:         'greg-norman-collection',  // polos, pants, skorts
  mitsubishichemical: 'mitsubishi-golf',          // Tensei, Diamana, Kai'li shafts
  mitsubishirayon:    'mitsubishi-golf',          // older name, same shafts
  toulondesign:       'toulon-golf',              // Memphis, San Diego, Atlanta putters
  jonessports:        'jones-sports-co',          // "Jones Sports Company" bags
};

// Parent manufacturer -> sub-brands that have their own page, promoted when the
// product name says so. Mirrors PROMOTED_SUB_BRANDS in witb-brand-normalize.js.
const SUB_BRANDS = {
  titleist: [{ phrase: 'scotty cameron', slug: 'scotty-cameron' }],
  acushnet: [{ phrase: 'scotty cameron', slug: 'scotty-cameron' },
             { phrase: 'footjoy', slug: 'footjoy' },
             { phrase: 'pinnacle', slug: 'pinnacle' },
             { phrase: 'titleist', slug: 'titleist' }],
  callaway: [{ phrase: 'odyssey', slug: 'odyssey-golf' },
             { phrase: 'toulon', slug: 'toulon-golf' },
             { phrase: 'ogio', slug: 'ogio-golf' },
             { phrase: 'travismathew', slug: 'travismathew' }],
  topgolfcallaway: [{ phrase: 'odyssey', slug: 'odyssey-golf' },
             { phrase: 'toulon', slug: 'toulon-golf' },
             { phrase: 'callaway', slug: 'callaway' }],
  dunlop:   [{ phrase: 'srixon', slug: 'srixon' },
             { phrase: 'cleveland', slug: 'cleveland-golf' },
             { phrase: 'xxio', slug: 'xxio' }],
  sumitomorubber: [{ phrase: 'srixon', slug: 'srixon' },
             { phrase: 'cleveland', slug: 'cleveland-golf' },
             { phrase: 'xxio', slug: 'xxio' }],
};

let INDEX = null;
function loadIndex() {
  if (INDEX) return INDEX;
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'data.js'), 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const byKey = new Map();
  for (const b of ctx.window.DORMIED_DATA.brands || []) {
    for (const k of [stem(b.name), stem(b.id.replace(/-/g, ' ')), norm(b.name)]) {
      if (k && !byKey.has(k)) byKey.set(k, b.id);
    }
  }
  INDEX = byKey;
  return INDEX;
}

/**
 * @param {string} manufacturer  the feed's Manufacturer (or brand) field
 * @param {string} productName   the feed's Name, used only for sub-brand promotion
 * @returns {string|null} a DORMIED brand slug, or null when no confident match
 */
function brandSlugForProduct(manufacturer, productName) {
  const idx = loadIndex();
  const key = stem(manufacturer);
  if (!key) return null;
  const name = String(productName || '').toLowerCase();

  const subs = SUB_BRANDS[key];
  if (subs) {
    const hit = subs.find(s => name.includes(s.phrase));
    if (hit) return hit.slug;
  }
  if (ALIASES[key]) return ALIASES[key];
  return idx.get(key) || idx.get(norm(manufacturer)) || null;
}

module.exports = { brandSlugForProduct, _norm: norm, _stem: stem };
