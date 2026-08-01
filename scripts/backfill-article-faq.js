#!/usr/bin/env node
/**
 * scripts/backfill-article-faq.js
 *
 * Question-style news articles answer in prose but carry no on-page FAQ block,
 * so they cannot legitimately hold FAQPage schema. This backfills a REAL FAQ:
 * for each target article it asks Opus to extract question/answer pairs GROUNDED
 * STRICTLY in the article's own body (no invented facts), validates the answers
 * are supported by the text, and stores them in dormied_articles.faq. The
 * article generator then renders a visible FAQ block + matching FAQPage JSON-LD.
 *
 * If a body does not contain enough distinct, answerable questions, the article
 * is SKIPPED and reported rather than padded with filler.
 *
 * Usage:
 *   node scripts/backfill-article-faq.js --slug=who-owns-malbon-golf   # one (test)
 *   node scripts/backfill-article-faq.js --dry-run                     # extract, don't write
 *   node scripts/backfill-article-faq.js                               # all question articles missing faq
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL   = 'claude-opus-5';
const DRY     = process.argv.includes('--dry-run');
const slugArg = (process.argv.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '') || null;

const QUESTION_RE = /^(who-owns|who-is|who-makes|what-is|what-makes|where-is|where-are|is-|does-|how-|why-)/i;
// Already have valid hand-authored FAQ schema — never touch.
const SKIP_SLUGS = new Set(['what-is-random-golf-club', 'who-is-arnie-mcnair']);

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Grounding guard: every number in an answer must also appear in the body. Cheap
// but catches the most common fabrication (invented figures). The regex matches
// integers (with thousands commas) and true decimals only, so a trailing sentence
// period is NOT swallowed into the number ("founded in 1963." -> "1963").
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const normNum = n => n.replace(/,/g, '');
function answersGrounded(faq, body) {
  const bodyNums = new Set((body.match(NUM_RE) || []).map(normNum));
  for (const { a } of faq) {
    for (const raw of (a.match(NUM_RE) || [])) {
      if (!bodyNums.has(normNum(raw))) return { ok: false, bad: raw };
    }
  }
  return { ok: true };
}

async function extractFaq(anthropic, title, body) {
  const prompt = `You are given the FULL text of a published DORMIED golf article. Produce FAQ question/answer pairs for a FAQPage, using ONLY information explicitly stated in the article below.

STRICT RULES:
- Every answer must be directly and fully supported by the article text. Do NOT add any fact, number, date, name, or claim that is not present in the text.
- Questions must be natural things a reader would search and that the article actually answers (who / what / where / when / why / how / is).
- 3 to 6 pairs. Each answer 1 to 3 sentences, self-contained, factual, in the article's dry voice.
- No em dashes anywhere. No marketing language. No hedging.
- If the article does NOT contain at least 3 distinct, clearly answerable questions grounded in its own text, return an empty array. Do not pad with filler or restate the same fact twice.

Return ONLY valid JSON, no markdown fences:
{"faq": [{"q": "...", "a": "..."}, ...]}

ARTICLE TITLE: ${title}

ARTICLE BODY:
${body}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const jsonStr = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(jsonStr);
  return Array.isArray(parsed.faq) ? parsed.faq : [];
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let query = sb.from('dormied_articles').select('slug,title,body,faq').eq('status', 'published');
  if (slugArg) query = query.eq('slug', slugArg);
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const targets = (rows || []).filter(r =>
    QUESTION_RE.test(r.slug) && !SKIP_SLUGS.has(r.slug) && (slugArg || !r.faq));

  console.log(`[faq-backfill] ${targets.length} target article(s)${DRY ? ' (DRY RUN)' : ''}`);
  const done = [], skipped = [];

  for (const r of targets) {
    process.stdout.write(`  ${r.slug} ... `);
    try {
      const faq = await extractFaq(anthropic, r.title, r.body || '');
      if (faq.length < 3) { console.log(`SKIP (only ${faq.length} grounded Q&A)`); skipped.push([r.slug, `${faq.length} Q&A`]); continue; }
      const g = answersGrounded(faq, r.body || '');
      if (!g.ok) { console.log(`SKIP (ungrounded number "${g.bad}")`); skipped.push([r.slug, `ungrounded ${g.bad}`]); continue; }
      if (faq.some(x => (x.q + x.a).includes('—'))) { console.log('SKIP (em dash)'); skipped.push([r.slug, 'em dash']); continue; }
      if (!DRY) {
        const { error: uerr } = await sb.from('dormied_articles').update({ faq }).eq('slug', r.slug);
        if (uerr) { console.log('DB ERROR: ' + uerr.message); skipped.push([r.slug, 'db error']); continue; }
      }
      console.log(`OK (${faq.length} Q&A)`);
      done.push([r.slug, faq.length]);
    } catch (e) {
      console.log('ERROR: ' + e.message);
      skipped.push([r.slug, e.message.slice(0, 40)]);
    }
    await new Promise(res => setTimeout(res, 800));
  }

  console.log(`\n[faq-backfill] backfilled ${done.length}, skipped ${skipped.length}`);
  if (skipped.length) { console.log('  Skipped:'); skipped.forEach(([s, why]) => console.log(`    ${s} — ${why}`)); }
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(e => { console.error('[faq-backfill] Fatal:', e.message); process.exit(1); });
}