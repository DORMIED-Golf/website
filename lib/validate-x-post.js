'use strict';

/**
 * Validation module for X (Twitter) post copy.
 * Returns { valid: true, text: finalPost } or { valid: false, reason: string }.
 */

const DISALLOWED_PHRASES = [
  'check out',
  'read more',
  'new article',
  'we wrote about',
  'link in bio',
  'my search',
  'search results',
  'the index shows',
  'the data suggests',
  'according to the dormied index',
  'exciting',
  'thrilled',
  'proud to announce',
];

/**
 * Assemble the final post: copy + blank line + URL.
 * @param {string} copy
 * @param {string} slug
 * @returns {string}
 */
function assembleFinalPost(copy, slug) {
  return `${copy}\n\ndormied.com/news/${slug}`;
}

/**
 * Truncate copy at the last full word so the assembled post fits within 280 chars.
 * @param {string} copy
 * @param {string} slug
 * @returns {string}
 */
function fitCopy(copy, slug) {
  const suffix    = `\n\ndormied.com/news/${slug}`;
  const maxCopy   = 280 - suffix.length;
  if (copy.length <= maxCopy) return copy;
  const truncated = copy.slice(0, maxCopy).replace(/\s\S*$/, '');
  console.warn(`[validate-x-post] Truncated copy from ${copy.length} → ${truncated.length} chars`);
  return truncated;
}

/**
 * Validate X post copy against all rules.
 *
 * @param {string} postText  - The raw post copy (without URL)
 * @param {Object} article   - { slug, brand_slug, x_post_id }
 * @returns {{ valid: true, text: string } | { valid: false, reason: string }}
 */
function validateXPost(postText, article) {
  const { slug, brand_slug, x_post_id } = article;

  // 1. Duplicate check
  if (x_post_id) {
    return { valid: false, reason: `Already posted (X post ID: ${x_post_id})` };
  }

  // 2. Non-empty
  const copy = (postText || '').trim();
  if (!copy) {
    return { valid: false, reason: 'Post text is empty' };
  }

  // 3. Disallowed phrase check (case-insensitive)
  const lower = copy.toLowerCase();
  for (const phrase of DISALLOWED_PHRASES) {
    if (lower.includes(phrase)) {
      return { valid: false, reason: `Contains disallowed phrase: "${phrase}"` };
    }
  }

  // 4. First-word check — reject if first word matches brand name
  if (brand_slug) {
    const brandWords  = brand_slug.replace(/-/g, ' ').toLowerCase().split(' ');
    const firstWord   = lower.split(/\W+/)[0];
    const brandJoined = brand_slug.replace(/-/g, '').toLowerCase();
    if (brandWords.includes(firstWord) || firstWord === brandJoined) {
      return { valid: false, reason: `Post starts with brand name ("${firstWord}")` };
    }
  }

  // 5. Length — fit within 280 chars
  const fittedCopy = fitCopy(copy, slug);
  const finalPost  = assembleFinalPost(fittedCopy, slug);

  if (finalPost.length > 280) {
    return { valid: false, reason: `Post too long after truncation (${finalPost.length} chars)` };
  }

  return { valid: true, text: finalPost };
}

module.exports = { validateXPost, assembleFinalPost };
