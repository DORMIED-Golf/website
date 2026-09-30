'use strict';
const { isPreOwned } = require('../../lib/affiliate-retailers');
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
  // Balls and grips were absent while every sellable catalogue was clubs and
  // apparel, which meant a bag's ball and grip rows could never match anything.
  // The hand-curated Amazon rows are mostly exactly those two types, so without
  // these a player carrying a Pro V1x got no match despite us selling it.
  // "Ball cap" and similar are not a risk here: scoreCandidate demands full
  // model-token coverage, so a cap can never satisfy "Pro V1x Left Dash".
  'ball':          ['ball', 'balls'],
  'grip':          ['grip', 'grips'],
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

// Head variants. Each names a DIFFERENT club from the base model: a Qi10 MAX is
// not a Qi10, an Apex Pro is not an Apex, a Qi4D Tour is not a Qi4D. When one
// appears in the title but not in the bag model, the product is refused rather
// than scored, because Adam Scott's Qi10 5-wood matched a "Qi10 MAX 3 Wood".
const VARIANT_TERMS = new Set([
  'max', 'ls', 'lst', 'hl', 'os', 'sft', 'sf', 'plus', 'lite', 'light', 'xd',
  'tour', 'pro', 'draw', 'fast', 'hd', 'mini', 'ti', 'tr', 'k', 'x', 'lx',
  // Callaway line names: a Paradym is not a Paradym Super, Ai Smoke or Triple Diamond.
  'super', 'ai', 'smoke', 'triple', 'diamond', 'td',
  // An Opus is not an Opus SP or an Opus Platinum.
  'sp', 'platinum',
  // Putter lines: an Ai-One is not an Ai-One Milled, a 2-Ball is not a Stroke Lab.
  'milled', 'stroke',
  // Iron families: an X Forged is not an X Forged CB, a P7 set is not its MB.
  'cb', 'mb', 'mc',
]);

const norm = s => String(s || '')
  .toLowerCase()
  .replace(/[‘’']/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const tokens = s => norm(s).split(' ').filter(Boolean);

/**
 * The identity part of a product title, i.e. everything before the variant
 * spec. Retail titles are "MODEL Driver | Right 9.0 / graphite stiff / shaft",
 * where only the head names the club and the tail is loft/flex/shaft.
 *
 * Scoring the whole title made longer, more-specified SKUs look like worse
 * matches, which is how "OPTM MAX-K" picked the Women's driver and how plain
 * "DS-ADAPT X" lost to "DS-ADAPT X Volition Driver - Limited Edition". It also
 * let "AEROJET Weights Blue / aerojet fairway hybrid / 8g" — a weight kit —
 * satisfy the 3-wood type gate on the word "fairway" in its spec tail.
 *
 * Split only on SPACED separators: "KING CB/MB Irons" must not lose "/MB".
 */
function titleHead(name) {
  const head = String(name || '').split(/\s\|\s|\s\/\s/)[0].trim();
  // Global Golf titles use spaced hyphens for the spec tail: "Scotty Cameron
  // Phantom 5.5 Putter Golf Club -  Steel Shaft". Left in, "Shaft" tripped the
  // accessory gate and rejected the putter itself. Cut at the first " - " only
  // when what precedes it already names a club, so a title that LEADS with a
  // tag ("Limited Edition - Realtree Driver") keeps its full head.
  const dash = head.split(/\s+-\s+/);
  if (dash.length > 1 && CLUB_WORD_RE.test(dash[0])) return dash[0].trim();
  return head;
}
const CLUB_WORD_RE = /\b(driver|wood|hybrid|rescue|irons?|wedge|putter|balls?|grips?)\b/i;

// Accessories routinely carry a club word ("KING Tour Iron Headcover") and are
// never the club itself.
const ACCESSORY_TERMS = new Set([
  'weights', 'weight', 'headcover', 'headcovers', 'cover', 'covers',
  'grip', 'grips', 'shaft', 'shafts', 'wrench', 'tool', 'towel', 'bag',
  'glove', 'gloves', 'hat', 'cap', 'tee', 'tees', 'marker', 'sticker',
  // "... Wood Club Heads": a bare head is not the club a player carries.
  'head', 'heads',
]);

/** Significant tokens of a bag model: stopwords dropped, order irrelevant. */
function modelTokens(model) {
  return tokens(model).filter(t => !MODEL_STOPWORDS.has(t));
}

function titleNamesType(title, clubType) {
  const kws = TYPE_KEYWORDS[clubType];
  if (!kws) return false;               // unknown type -> never match
  const n = ' ' + norm(titleHead(title)) + ' ';
  return kws.some(k => n.includes(' ' + norm(k) + ' ') || n.includes(norm(k)));
}

/**
 * Score one candidate. Returns null when any gate fails.
 * Lower score is better (it counts unexplained noise in the title).
 */
function scoreCandidate(item, product) {
  if (!titleNamesType(product.name, item.club_type)) return null;

  const head = titleHead(product.name);
  const titleTokens = tokens(head);
  for (const t of titleTokens) if (EXCLUDE_TERMS.has(t)) return null;    // wrong club, not a worse one
  for (const t of titleTokens) if (ACCESSORY_TERMS.has(t)) return null;  // an accessory, not the club

  const want = modelTokens(item.raw_model);
  if (!want.length) return null;
  if (want.join('').length < MIN_SIGNIFICANT_CHARS) return null;

  const have = new Set(titleTokens);
  for (const t of want) if (!have.has(t)) return null;      // full coverage
  // Words inside a slash pair ("KING CB/MB Irons") are alternatives, not a
  // variant of the other side, so they are exempt here.
  const slashWords = new Set(((head.match(/\S+\/\S+/g) || []).join(' ').toLowerCase().split(/[\/\s]+/)));
  for (const t of have) if (VARIANT_TERMS.has(t) && !want.includes(t) && !slashWords.has(t)) return null;  // a different head

  // The model must appear as one run in the title, not as scattered tokens:
  // "Pro S-3" was satisfied by "Pro S-4 3-PW Iron Set" once hyphens split it.
  const compact = s => norm(s).replace(/ /g, '');
  // "KING CB/MB Irons" is a combo set answering both "King CB" and "King MB",
  // so each side of a slash pair is tried as the title.
  const heads = [head];
  const pair = head.match(/(\S+)\/(\S+)/);
  if (pair) heads.push(head.replace(pair[0], pair[1]), head.replace(pair[0], pair[2]));
  if (!heads.some(h => compact(h).includes(compact(want.join(' '))))) return null;
  // A "+" is part of the model: LS+ is not LS, SP+ is not SP.
  if (/\+/.test(item.raw_model) !== /\+/.test(head)) return null;
  // Iron variants are often one letter (PING Blueprint S vs Blueprint T). For
  // irons only, since wedges carry grind letters ("S Grind") legitimately.
  if (item.club_type === 'iron') {
    for (const t of have) if (/^[a-z]$/.test(t) && !want.includes(t)) return null;
  }
  // A fairway wood listing that says hybrid or driver is another club.
  if (/wood$/.test(item.club_type) && /\b(hybrid|rescue|driver)\b/i.test(head)) return null;
  // An unexplained letters+digits code is another model: a bag "Apex" is not an
  // "Apex Ai200". Allowed: generation tags (T100 "4G"), hybrid/wood numbers
  // ("3H", "3HL") and codes the brand or model already account for.
  const brandToks = new Set(tokens(item.raw_brand));
  for (const t of have) {
    if (want.includes(t) || brandToks.has(t)) continue;
    if (!/[a-z]/.test(t) || !/\d/.test(t)) continue;
    if (/^\d{1,2}(g|h|hl|w|hw)$/.test(t)) continue;
    return null;
  }

  // Club NUMBER must agree when the title states one. "3 Wood" is not a 5-wood.
  // Also catches suffixed numbers: "Qi10 3HL Wood" is a 3-wood (high launch).
  // Cobra states the club number in the variant tail instead: "OPTM X Fairway
  // Right / 7 / graphite stiff", "DS-ADAPT X Fairway Right / 3hf / ...".
  const tailNum = (String(product.name || '').match(/\b(?:right|left)\s*\/\s*(\d)(?:hf|hl)?\s*\//i) || [])[1];
  const woodNum = (head.match(/\b(\d{1,2})(?:hl|hw|w)?\s*-?\s*wood\b/i) || [])[1] ||
                  (/wood$/.test(item.club_type) ? tailNum : undefined);
  const bagWood = (String(item.club_type).match(/^(\d{1,2})-wood$/) || [])[1];
  if (woodNum && bagWood && woodNum !== bagWood) return null;

  // A single-iron listing ("T250 4-Iron", "T100 9-Iron") is one club. It can
  // only answer a bag entry that is that exact single iron; it never stands in
  // for a set, and never for a different number.
  // Putter head numbers are different heads: "Spider Tour" is not "Spider Tour
  // #3". A "#N" in the title must be in the bag model.
  if (item.club_type === 'putter') {
    const heads = (head.match(/#\s*\d+/g) || []).map(h => h.replace(/\D/g, ''));
    const modelNums = new Set((String(item.raw_model).match(/\d+/g) || []));
    if (heads.some(h => !modelNums.has(h))) return null;
  }

  // Wedges: the listed loft must be one the player carries (within 1°), and
  // a stated grind letter must be that loft's grind. An S259 50° and 56°
  // S-grind setup is not answered by a 60° T-grind lob wedge.
  if (item.club_type === 'wedge') {
    const pl = (String(product.name || '').match(/\b(\d{2}(?:\.\d)?)\s*°/) || [])[1];
    const pg = (head.match(/\b([a-z]{1,4})\s*-?\s*grind\b/i) || [])[1];
    // A single-wedge listing ("... Lob Wedge", "... T Grind") without a loft
    // cannot be checked against the bag, so it is refused.
    const singleWedge = /\b(lob|sand|gap|pitching|approach)\s+wedge\b|\bgrind\b/i.test(head);
    if (singleWedge && !pl) return null;
    // Bag entries: "60-L", "58K*", "60-A+", "50-12F", "56-14F@55", "60 T-6",
    // "46 S-12", "60 LOW-6", "60-08". Loft = leading two digits; grind = the
    // first letter group after it, if any.
    const bag = String(item.loft_or_number || '').split(',').map(s => {
      const m = s.trim().match(/^(\d{2})(.*)$/);
      if (!m) return null;
      const g = (m[2].match(/[a-z]+/i) || [])[0];
      return { loft: parseFloat(m[1]), grind: g && !/^degrees?$/i.test(g) ? g.toUpperCase() : null };
    }).filter(Boolean);
    if (pl) {
      if (!bag.length) return null;
      const hit = bag.find(b => Math.abs(b.loft - parseFloat(pl)) <= 1);
      if (!hit) return null;
      if (pg && hit.grind && hit.grind !== pg.toUpperCase()) return null;
      // Cobra names the grind in the tail: "KING Wedge | Drop | Right 60°".
      // Whole segment, so "| Wide Low |" reads as W, not as nothing.
      const named = (String(product.name || '').match(/wedge\s*\|\s*([a-z][a-z ]*?)\s*\|/i) || [])[1];
      if (named && hit.grind && hit.grind.length === 1 && hit.grind !== named[0].toUpperCase()) return null;
    }
  }

  // For fairway woods and hybrids the loft IS the club: a 15° Qi4D 3-wood is a
  // different head from the 16.5° "3HL", a 21° hybrid is not the 19° "3H".
  // When both lofts are stated they must agree within 1°. Drivers are exempt:
  // their loft is an adjustable setting on one head.
  if (/wood$|^hybrid$|^utility$|^utility-iron$|^mini-driver$/.test(item.club_type)) {
    const pl = (String(product.name || '').match(/(\d{1,2}(?:\.\d)?)\s*°/) || [])[1];
    const bl = (String(item.loft_or_number || '').match(/^(\d{1,2}(?:\.\d)?)\s*degrees/i) || [])[1];
    if (pl && bl && Math.abs(parseFloat(pl) - parseFloat(bl)) > 1) return null;
  }

  // Iron sets: the irons the player carries must overlap the set's range. Bag
  // formats: "4", "4-PW", "4, 5", "5-UW", "UW". "T250 3" is not in a 4-PW set,
  // "P770 4-5" is not in a 6-PW set, and a lone UW is not in a 6-PW set.
  const IRON_NUM = { pw: 10, uw: 11, gw: 11, aw: 11, sw: 12, lw: 13 };
  const ironNum = s => IRON_NUM[String(s).toLowerCase()] || parseInt(s, 10);
  const bagIrons = (() => {
    const out = [];
    for (const part of String(item.loft_or_number || '').split(',')) {
      const t = part.trim().toLowerCase();
      const r = t.match(/^(\d{1,2}|pw|uw|gw|aw)\s*-\s*(\d{1,2}|pw|uw|gw|aw)$/);
      if (r) { for (let n = ironNum(r[1]); n <= ironNum(r[2]); n++) out.push(n); continue; }
      const one = t.match(/^(\d{1,2}|pw|uw|gw|aw)$/);
      if (one) out.push(ironNum(one[1]));
    }
    return out;
  })();
  const range = head.match(/\b(\d{1,2})\s*-\s*(\d{1,2}|pw|gw|aw|sw)\b/i);
  if (item.club_type === 'iron' && range && bagIrons.length) {
    const lo = ironNum(range[1]), hi = ironNum(range[2]);
    if (!bagIrons.some(n => n >= lo && n <= hi)) return null;
  }

  // Hybrid numbers imply a loft. "3H" is ~19-20°; a 23° club is not a 3H, and
  // a 2-iron is not a "4H". Checked when the title gives no loft of its own.
  const hNum = (head.match(/\b(\d)h\b/i) || [])[1] || (item.club_type === 'hybrid' ? tailNum : undefined);
  if (hNum) {
    const H_LOFT = { 1: [14, 16.5], 2: [16, 18.5], 3: [18.5, 20.5], 4: [20.5, 23], 5: [23, 26], 6: [26, 29], 7: [29, 32] };
    const bl = (String(item.loft_or_number || '').match(/^(\d{1,2}(?:\.\d)?)\s*(?:,|degrees)/i) || [])[1];
    const bn = (String(item.loft_or_number || '').trim().match(/^(\d)$/) || [])[1];
    const rng = H_LOFT[hNum];
    if (bl && rng && (parseFloat(bl) < rng[0] || parseFloat(bl) > rng[1])) return null;
    if (bn && bn !== hNum) return null;
  }

  // A utility or driving iron is one club: never answered by an iron set.
  // ("KING TEC Utility Irons" is sold per club despite the plural, so only a
  // stated set or range counts.)
  if (/^(utility-iron|driving-iron)$/.test(item.club_type) && /\biron set\b|\b\d{1,2}\s*-\s*(pw|\d{1,2})\b/i.test(head)) return null;

  const single = head.match(/\b(\d{1,2}|pw|gw|aw|sw|lw)\s*-?\s*iron\b(?!s)/i);
  if (single && !/\birons\b|\biron set\b/i.test(head)) {
    const bagNum = String(item.loft_or_number || '').trim().toLowerCase();
    if (bagNum !== single[1].toLowerCase()) return null;
  }

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
  // Handedness lives in the variant tail, so left- and right-handed SKUs share a
  // head and tie. We do not store player handedness, so break the tie toward
  // right-handed — the overwhelming default on tour, and a far better guess
  // than whichever row the catalog happened to return first. A left-handed
  // player therefore needs an explicit override.
  // Retailer stock made this a real risk: when a used LEFT-handed club is the
  // only one listed, a penalty still lets it win (Ludvig Aberg's 3-wood). We do
  // not store handedness, so a left-handed product is refused outright; a
  // left-handed player's bag needs an explicit override.
  // "Left Dash" is a Pro V1x, not a handedness, so match the handedness words
  // themselves, and only for clubs.
  // Cobra writes a bare "Left" in the variant tail ("Driver | Left 9.0"), so
  // any "left" counts for a club.
  if (!/^(ball|grip)$/.test(item.club_type) && /\bleft\b|\blh\b/i.test(String(product.name || ''))) return null;

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
      // Equal match: new beats pre-owned (a retailer may list both).
      if (s < bestScore || (s === bestScore && best && isPreOwned(best.condition) && !isPreOwned(p.condition))) { best = p; bestScore = s; }
    }
    if (best) {
      // A combo set ("KING CB/MB Irons") legitimately answers two bag items.
      // Record the match but never show the same product twice in one carousel.
      const already = matches.find(m => m.product.id === best.id);
      if (already) { unmatched.push({ item, reason: `same product as "${already.item.raw_model}"` }); continue; }
      matches.push({ item, product: best, via: 'auto', noise: bestScore });
    }
    else unmatched.push({ item, reason: 'no confident match' });
  }

  return { matches, unmatched };
}

module.exports = {
  matchBagToProducts,
  // exported for tests
  _internals: { norm, tokens, modelTokens, titleNamesType, scoreCandidate, MIN_SIGNIFICANT_CHARS, MODEL_STOPWORDS, TITLE_NOISE_EXEMPT, EXCLUDE_TERMS, ACCESSORY_TERMS, titleHead },
};
