'use strict';
/**
 * scripts/lib/answer-block.js
 *
 * The answer block is a short, dense, extractable summary rendered at the top of
 * a page, directly after the byline and before the body. It exists because
 * ranking is no longer the same thing as being read: Search Console shows 65
 * queries in the top 10 with zero clicks, and the question-shaped queries
 * convert worst of all (16 queries, 1,271 impressions, 12 clicks, 0.94%). The
 * answer is being taken before the click, so the block is written to be the
 * thing that gets taken, with the brand attached.
 *
 * Three labels, chosen deterministically. They are not interchangeable:
 * a brand-move story has no question to answer, so a forced "Quick Answer"
 * would read as filler. "What Happened" is honest and still parses as a
 * question-answer pair to an extraction model.
 *
 * Shared by generate-article.js, generate-feature.js, generate-witb-player-page.js
 * and generate-brand-page.js so the label rule cannot drift between them, the way
 * the author routing did before scripts/lib/article-authors.js existed.
 */

const LABEL_KEY_TAKEAWAYS = 'Key Takeaways';
const LABEL_QUICK_ANSWER  = 'Quick Answer';
const LABEL_WHAT_HAPPENED = 'What Happened';

// Interrogative openers. A title starting with one of these, or ending in a
// question mark, is question-intent and gets "Quick Answer".
const QUESTION_OPENERS = /^(who|what|where|why|when|which|how|is|are|does|do|did|can)\b/i;

/**
 * Deterministic label for an article.
 *
 * @param {object} opts
 * @param {string} opts.title    Article headline
 * @param {string} opts.slug     Article slug
 * @param {string} opts.category Article category ('Feature' is special)
 * @returns {string} one of the three labels
 */
function answerLabel({ title = '', slug = '', category = '' } = {}) {
  if (String(category).toLowerCase() === 'feature') return LABEL_KEY_TAKEAWAYS;
  const t = String(title).trim();
  if (t.endsWith('?'))            return LABEL_QUICK_ANSWER;
  if (QUESTION_OPENERS.test(t))   return LABEL_QUICK_ANSWER;
  if (QUESTION_OPENERS.test(String(slug).replace(/-/g, ' '))) return LABEL_QUICK_ANSWER;
  return LABEL_WHAT_HAPPENED;
}

/** Word count used by the 40-60 target. Counts bullet text too. */
function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

const MIN_WORDS = 40;
const MAX_WORDS = 60;

/**
 * Is the block within the target length? Returned as a soft check: callers warn
 * and ship rather than dropping a block, on the same reasoning as the headline
 * gate. A 38-word answer still beats no answer.
 */
function lengthOk(text) {
  const n = wordCount(text);
  return n >= MIN_WORDS && n <= MAX_WORDS;
}

// ── Grounding ────────────────────────────────────────────────────────────────
// Lifted from scripts/backfill-article-faq.js so the inline generation in
// generate-article.js and the backfill script cannot enforce different rules.
//
// Every number in generated text must also appear in the body. Cheap, but it
// catches the most common fabrication by far, which is an invented figure. The
// regex matches integers (with thousands commas) and true decimals only, so a
// trailing sentence period is not swallowed into the number: "founded in 1963."
// yields "1963", not "1963.".
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const normNum = n => n.replace(/,/g, '');

/** Numbers in `text` that do not appear in `body`. Empty array means grounded. */
function ungroundedNumbers(text, body) {
  const bodyNums = new Set((String(body || '').match(NUM_RE) || []).map(normNum));
  const bad = [];
  for (const raw of (String(text || '').match(NUM_RE) || [])) {
    if (!bodyNums.has(normNum(raw))) bad.push(raw);
  }
  return bad;
}

/** Grounding check across an faq array. Mirrors backfill-article-faq.js. */
function answersGrounded(faq, body) {
  for (const { a } of (faq || [])) {
    const bad = ungroundedNumbers(a, body);
    if (bad.length) return { ok: false, bad: bad[0] };
  }
  return { ok: true };
}

/**
 * Keep only faq pairs that are usable, then enforce the floor.
 * Below three groundable pairs we emit nothing: the renderer already treats an
 * empty faq as "no FAQ section", and padded filler is worse than absence both
 * for the reader and for the extraction model.
 */
const MIN_FAQ_PAIRS = 3;
const MAX_FAQ_PAIRS = 6;

function cleanFaq(faq) {
  const out = (Array.isArray(faq) ? faq : [])
    .filter(x => x && typeof x.q === 'string' && typeof x.a === 'string')
    .map(x => ({ q: x.q.trim(), a: x.a.trim() }))
    .filter(x => x.q && x.a);
  return out.slice(0, MAX_FAQ_PAIRS);
}

module.exports = {
  LABEL_KEY_TAKEAWAYS, LABEL_QUICK_ANSWER, LABEL_WHAT_HAPPENED,
  answerLabel, wordCount, lengthOk, MIN_WORDS, MAX_WORDS,
  ungroundedNumbers, answersGrounded, cleanFaq, MIN_FAQ_PAIRS, MAX_FAQ_PAIRS,
};
