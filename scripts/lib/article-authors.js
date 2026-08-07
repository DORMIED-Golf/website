'use strict';
/**
 * scripts/lib/article-authors.js
 *
 * One definition of the DORMIED byline desks and the rules that route an
 * article to one.
 *
 * This logic used to exist in five places (generate-article.js, feed-bake.js,
 * generate-index-pages.js, js/feed.js and its minified twin), and they drifted:
 * renaming the desks in the article generator left every baked feed card on the
 * site still rendering the old first-name-only byline, because the card
 * templates derive an author of their own whenever the row has none. The
 * Top Stories module is the clearest case — it reads article_clicks, which has
 * no author column at all, so it always derives.
 *
 * Browser code (js/feed.js) cannot require() this, so it carries a copy that is
 * marked to be kept in sync. Everything running under Node imports from here.
 */

// Byline names. The initial is part of the name everywhere it renders: page
// byline, <meta name="author">, article:author, and the JSON-LD Person.
const AUTHOR_ADAM     = 'Adam R.';
const AUTHOR_TRAVIS   = 'Travis R.';
const AUTHOR_VICTORIA = 'Victoria H.';
const AUTHOR_JAMES    = 'James K.';

/** The desk used when nothing else can be determined. */
const AUTHOR_DEFAULT = AUTHOR_TRAVIS;

const ALL_AUTHORS = [AUTHOR_ADAM, AUTHOR_TRAVIS, AUTHOR_VICTORIA, AUTHOR_JAMES];

/**
 * Route by category text alone, for callers that have no full brand record.
 * Cannot detect the women's desk: that lives in the brand's sub-categories,
 * not in any category string, so use authorForBrand() wherever the brand is
 * available.
 *
 * @param {string} category Brand category, or the wire feed's own label
 */
function authorFromCategory(category) {
  const cat = String(category || '').toLowerCase();
  if (/bags? & accessories|\bbags?\b|accessor/.test(cat)) return AUTHOR_JAMES;
  if (/apparel|footwear|shoe/.test(cat))                  return AUTHOR_ADAM;
  return AUTHOR_TRAVIS;
}

/**
 * Route from a brand record in data.js.
 *
 * Precedence is deliberate: a brand carrying the Women's sub-category goes to
 * Victoria ahead of every other test, so a women's bag label is hers rather
 * than James's. No brand currently holds both (checked across all 215), so the
 * ordering exists to keep future data unambiguous rather than to settle a live
 * conflict.
 *
 * The wire feed's category is consulted only when the brand carries none of its
 * own, which preserves the behaviour for brands missing from data.js.
 *
 * @param {object} brand            Brand record from data.js (may be undefined)
 * @param {string} fallbackCategory Wire-feed category, used only as a fallback
 */
function authorForBrand(brand, fallbackCategory) {
  const subs = (brand && brand.subCategories) || [];
  if (subs.some(s => /women/i.test(s))) return AUTHOR_VICTORIA;

  const cats = (brand && (brand.allCategories || (brand.category ? [brand.category] : []))) || [];
  // allCategories can hold a semicolon-joined string ("Apparel & Footwear;
  // Bags & Accessories") for the 9 multi-category brands, so match on the
  // joined text rather than on exact array membership.
  const catText = (cats.length ? cats : [fallbackCategory]).filter(Boolean).join(' ');
  return authorFromCategory(catText);
}

module.exports = {
  AUTHOR_ADAM, AUTHOR_TRAVIS, AUTHOR_VICTORIA, AUTHOR_JAMES,
  AUTHOR_DEFAULT, ALL_AUTHORS,
  authorFromCategory, authorForBrand,
};
