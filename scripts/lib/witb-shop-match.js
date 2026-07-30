'use strict';
/**
 * scripts/lib/witb-shop-match.js
 *
 * Matches a player's actual bag items to sellable products, for the
 * "Shop This Bag" carousel on /witb/players/{slug}/.
 *
 * The governing constraint: sending a reader to the WRONG club is worse than
 * sending them nowhere. A missed match costs a click; a wrong match costs
 * trust, and on a page whose whole value is equipment accuracy. So this is
 * deliberately conservative — it would rather return nothing than guess.
 *
 * Three gates, all of which must pass:
 *
 *   1. CLUB TYPE. The product title must name the club type the bag item is
 *      ("iron" for an iron, "wedge" for a wedge). This alone kills the common
 *      failure — "King Forged" the wedge matching "King Forged TEC" the iron.
 *   2. FULL TOKEN COVERAGE. Every significant token of the bag model must
 *      appear in the product title. "King Tour" may match "KING TOUR IRONS
 *      (2023)", but "King Tour" must never match "KING IRONS".
 *   3. MINIMUM SPECIFICITY. Models too short to be distinctive ("SB") are
 *      refused outright unless an explicit override names the product, because
 *      a two-letter token matches almost anything.
 *
 * Ties break toward the product with the least extra noise in its title, so
 * "KING TOUR IRONS" wins over "KING TOUR IRONS LIMITED EDITION GIFT SET".
 */

// Club type -> words that must appear in a product title for that type.
const TYPE_KEYWORDS = {
  'driver':        ['driver'],
  'mini-driver':   ['mini driver', 'mini-driver'],
  '3-wood':        ['fairway', 'wood'],
  '4-wood':        ['fairway', 'wood'],
  '5-wood':        ['fairway', 'wood'],
  '7-wood':        ['fairway', 'wood'],
  '9-wood':        ['fairway', 'wood'],
  'hybrid':        ['hybrid', 'rescue'],
  'utility':       ['utility', 'hybrid'],
  'utility-iron':  ['utility', 'iron'],
  'driving-iron':  ['driving iron', 'utility', 'iron'],
  'iron':          ['iron'],
  'wedge':         ['wedge'],
  'putter':        ['putter'],
};

// Tokens dropped from a BAG MODEL before matching. Kept deliberately tiny.
//
// An earlier version also dropped 'tour' and 'prototype' as generic filler.
// That is wrong in golf, where they are among the most identifying words a
// model has: it let "King Tour" match "KING IRONS", i.e. the wrong iron set.
// Anything that distinguishes one model from another stays significant.
const MODEL_STOPWORDS = new Set(['the', 'and', 'golf']);

// Words in a PRODUCT TITLE that should not count as unexplained noise. These
// are merchandising boilerplate, not model identity.
//
// Gender is deliberately NOT in here. It was, and against the real catalog it
// matched Gary Woodland's "OPTM MAX-K" driver to the WOMEN'S OPTM MAX-K —
// right model, wrong club. Gendered and handedness terms are identity for a
// golf club, so leaving them to score as noise makes the plain variant win.
const TITLE_NOISE_EXEMPT = new Set(['the', 'and', 'golf', 'new']);

// Titles carrying one of these are a DIFFERENT CLUB from the one a tour
// professional plays, so they are excluded outright rather than penalised.
//
// Penalising was not enough. Real catalogs are variant-level, and the men's SKU
// carries a long shaft spec ("OPTM MAX-K Driver | Right 9.0 / graphite regular
// / project x denali blue 60") while the women's is short. Because noise counts
// unexplained tokens, the SHORTER women's title scored better and won — title
// length is not match quality.
//
// Scoped to the current dataset: every tracked player is a men's tour
// professional. Adding LPGA players means gating this on player gender rather
// than excluding unconditionally.
const EXCLUDE_TERMS = new Set([
  'womens', 'women', 'ladies', 'junior', 'juniors', 'youth', 'boys', 'girls', 'kids',
]);

// A model whose significant tokens total fewer characters than this is not
// distinctive enough to match on. "SB" (2) is refused; "MB" (2) is refused.
const MIN_SIGNIFICANT_CHARS = 4;

const norm = s => String(s || '')
  .toLowerCase()
  .replace(/[‘’']/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const tokens = s => norm(s).split(' ').filter(Boolean);

/** Significant tokens of a bag model: stopwords dropped, order irrelevant. */
function modelTokens(model) {
  return tokens(model).filter(t => !MODEL_STOPWORDS.has(t));
}

function titleNamesType(title, clubType) {
  const kws = TYPE_KEYWORDS[clubType];
  if (!kws) return false;               // unknown type -> never match
  const n = ' ' + norm(title) + ' ';
  return kws.some(k => n.includes(' ' + norm(k) + ' ') || n.includes(norm(k)));
}

/**
 * Score one candidate. Returns null when any gate fails.
 * Lower score is better (it counts unexplained noise in the title).
 */
function scoreCandidate(item, product) {
  if (!titleNamesType(product.name, item.club_type)) return null;

  const titleTokens = tokens(product.name);
  for (const t of titleTokens) if (EXCLUDE_TERMS.has(t)) return null;   // wrong club, not a worse one

  const want = modelTokens(item.raw_model);
  if (!want.length) return null;
  if (want.join('').length < MIN_SIGNIFICANT_CHARS) return null;

  const have = new Set(tokens(product.name));
  for (const t of want) if (!have.has(t)) return null;      // full coverage

  // Noise = title tokens not accounted for by the model, its club type, or the
  // brand name. Fewer is a tighter match.
  const typeWords = new Set((TYPE_KEYWORDS[item.club_type] || []).flatMap(k => tokens(k)));
  const brandWords = new Set(tokens(item.raw_brand));
  let noise = 0;
  for (const t of have) {
    if (want.includes(t) || typeWords.has(t) || brandWords.has(t)) continue;
    if (TITLE_NOISE_EXEMPT.has(t)) continue;                // merchandising boilerplate
    if (/^\d{4}$/.test(t)) continue;                        // model year is expected
    noise++;
  }
  return noise;
}

/**
 * @param {Array} bagItems  [{club_type, raw_brand, raw_model, dormied_brand_slug}]
 * @param {Array} products  [{id, name, dormied_brand_slug, ...}]
 * @param {Object} overrides  { 'brand-slug|club_type|model': 'EXACT PRODUCT NAME' }
 * @returns {{matches: Array, unmatched: Array}}
 */
function matchBagToProducts(bagItems, products, overrides = {}) {
  const byBrand = new Map();
  for (const p of products) {
    if (!byBrand.has(p.dormied_brand_slug)) byBrand.set(p.dormied_brand_slug, []);
    byBrand.get(p.dormied_brand_slug).push(p);
  }

  const matches = [], unmatched = [];

  for (const item of bagItems) {
    const slug = item.dormied_brand_slug;
    const pool = byBrand.get(slug) || [];
    if (!pool.length) { unmatched.push({ item, reason: 'no catalog for brand' }); continue; }

    // An explicit override wins over scoring, and is the ONLY way a
    // low-specificity model reaches the carousel.
    const key = `${slug}|${item.club_type}|${norm(item.raw_model)}`;
    if (overrides[key]) {
      const want = norm(overrides[key]);
      const hit = pool.find(p => norm(p.name) === want);
      if (hit) { matches.push({ item, product: hit, via: 'override' }); continue; }
      unmatched.push({ item, reason: `override "${overrides[key]}" not in catalog` });
      continue;
    }

    let best = null, bestScore = Infinity;
    for (const p of pool) {
      const s = scoreCandidate(item, p);
      if (s === null) continue;
      if (s < bestScore) { best = p; bestScore = s; }
    }
    if (best) matches.push({ item, product: best, via: 'auto', noise: bestScore });
    else unmatched.push({ item, reason: 'no confident match' });
  }

  return { matches, unmatched };
}

module.exports = {
  matchBagToProducts,
  // exported for tests
  _internals: { norm, tokens, modelTokens, titleNamesType, scoreCandidate, MIN_SIGNIFICANT_CHARS, MODEL_STOPWORDS, TITLE_NOISE_EXEMPT, EXCLUDE_TERMS },
};
