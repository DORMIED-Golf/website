'use strict';
/**
 * scripts/lib/scorecard-issue.js
 *
 * Two derivations that every Scorecard surface needs and that had drifted into
 * three inconsistent copies: which image represents an issue, and what to call
 * it in a link.
 *
 * THUMBNAIL. Issues used to carry a three-image `strip` and no hero, so the hub
 * card, the archive rows and the homepage module each reached straight for
 * `images.strip[0].src`. August 2026 shipped with a single tagged hero and an
 * empty strip, and all three surfaces silently rendered a grey placeholder --
 * no error, just a missing image on the newest issue, which is the one every
 * link points at. Prefer the hero, fall back to the strip, so an issue laid out
 * either way still has a face.
 *
 * HEADLINE. `title` is the full SEO string, "Shinnecock Paid Out in Strange
 * Currency | The Scorecard | July 2026". Cross-links were printing `monthLabel`
 * instead, so "More from The Scorecard" was three cards reading "June 2026",
 * "May 2026", "April 2026": nothing to click for. Strip the suffix to recover
 * the headline. Issues before June 2026 have no headline at all (their title is
 * literally "The Scorecard | May 2026"), so fall back to the month rather than
 * emitting an empty string.
 */

/** The image that represents an issue, or null if it has none. */
function issueThumb(issue) {
  const imgs = (issue && issue.images) || {};
  const hero = imgs.hero;
  // hero is an object on newer issues, a bare path on older ones.
  const heroSrc = hero && (typeof hero === 'string' ? hero : hero.src);
  if (heroSrc) return heroSrc;
  const strip = imgs.strip || [];
  if (strip.length && strip[0] && strip[0].src) return strip[0].src;
  return null;
}

/**
 * Intrinsic width/height of issueThumb() as a ready-to-inline attribute
 * string, or '' when the issue does not record them. With the attributes the
 * browser reserves the right box from the aspect ratio before the bytes
 * arrive; without them a tall hero drops in on load and shoves the rest of the
 * page down.
 */
function issueThumbSizeAttrs(issue) {
  const imgs = (issue && issue.images) || {};
  const hero = imgs.hero;
  const src = hero && typeof hero !== 'string' ? hero : null;
  if (src && src.w && src.h) return ` width="${src.w}" height="${src.h}"`;
  const strip = imgs.strip || [];
  const s0 = strip[0];
  if (s0 && s0.w && s0.h) return ` width="${s0.w}" height="${s0.h}"`;
  return '';
}

/** Alt text for issueThumb(), never undefined. */
function issueThumbAlt(issue) {
  const imgs = (issue && issue.images) || {};
  const hero = imgs.hero;
  if (hero && typeof hero !== 'string' && hero.alt) return hero.alt;
  const strip = imgs.strip || [];
  if (strip.length && strip[0] && strip[0].label) return strip[0].label;
  return '';
}

/** The headline half of `title`, falling back to the subtitle's opening line. */
function issueHeadline(issue) {
  if (!issue) return '';
  const title = issue.title || '';
  const head = title.split('|')[0].trim();
  if (head && head.toLowerCase() !== 'the scorecard') return head;
  // Issues before June 2026 have no headline: their title is literally "The
  // Scorecard | May 2026". Cards already print the month in the eyebrow, so
  // falling back to monthLabel prints it twice and still gives no reason to
  // click. The subtitle's first sentence is the hook those issues do have.
  const sub = (issue.subtitle || '').trim();
  if (sub) {
    const firstSentence = (sub.match(/^.*?[.!?](?=\s|$)/) || [sub])[0].trim();
    return firstSentence.length > 95
      ? firstSentence.slice(0, 92).replace(/\s+\S*$/, '') + '…'
      : firstSentence;
  }
  return issue.monthLabel || title;
}

module.exports = { issueThumb, issueThumbAlt, issueThumbSizeAttrs, issueHeadline };
