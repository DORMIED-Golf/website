#!/usr/bin/env node
'use strict';
/**
 * scripts/backfill-answer-blocks.js
 *
 * Adds the answer block, and an FAQ where one is missing, to already-published
 * articles. New articles get both inline from generate-article.js; this is for
 * the back catalogue.
 *
 * Targets the pages Search Console shows ranking without converting: 65 queries
 * in the top 10 with zero clicks, and question-shaped queries worst of all at
 * 0.94% CTR. Those pages rank, so the answer is being taken before the click.
 *
 * GROUNDING
 * Same discipline as backfill-article-faq.js, via scripts/lib/answer-block.js:
 * every number in generated text must appear in the article body, and fewer
 * than three groundable FAQ pairs means no FAQ rather than padded filler. The
 * answer block and the FAQ are gated independently, so an article can gain a
 * block while its FAQ is correctly refused.
 *
 * date_modified is bumped ONLY on articles that actually gain something. Adding
 * an answer block is a real body change and the bump is correct; touching the
 * date on an untreated page would be a lie to the crawler.
 *
 *   node scripts/backfill-answer-blocks.js --questions        question-shaped only
 *   node scripts/backfill-answer-blocks.js --slug=a,b,c       explicit slugs
 *   node scripts/backfill-answer-blocks.js --questions --dry-run
 *   node scripts/backfill-answer-blocks.js --questions --limit=5
 */

const path = require('path');
const fs   = require('fs');
const { createClient } = require('@supabase/supabase-js');
const Anthropic        = require('@anthropic-ai/sdk');
const AB               = require('./lib/answer-block');

const ROOT = path.resolve(__dirname, '..');
(function loadDotenv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
})();

const MODEL = 'claude-opus-4-7';
const DRY   = process.argv.includes('--dry-run');

const stripEmDashes = s => String(s || '').replace(/\s*—\s*/g, ', ');

async function extract(anthropic, title, body, needFaq) {
  const faqSpec = needFaq ? `
2. "faq": 3 to 6 {"q","a"} pairs.
   - Questions must be SPECIFIC TO THIS ARTICLE: the price, the mechanism, the person, the comparison, the consequence. Not "What is [brand]?" unless the article genuinely answers it.
   - Every answer fully supported by the article text. No fact, number, date, name or claim that is not in it. No invented sources.
   - 1 to 3 sentences each, plain prose, self-contained.
   - If the article does not support at least 3 distinct groundable pairs, return an EMPTY array. Do not pad.` : `
2. "faq": return an empty array. This article already has one.`;

  const prompt = `You are given the FULL text of a published DORMIED golf article. Using ONLY information explicitly stated in it, produce two things.

1. "answer_block": one paragraph of 40 to 60 words that answers the story directly, for a reader or a model that will read only this.
   - Lead with the direct answer, then the two or three supporting specifics: price, date, name, number. Front-load the entities.
   - No hedging, no throat-clearing, no "this article". It is a summary, not a teaser. Give the answer away.
   - Dry, direct, plain prose. One paragraph, no bullets.
   - Every number must appear in the article text. Count the words: 40 to 60.
${faqSpec}

No em dashes anywhere. No marketing language.

Return ONLY valid JSON, no markdown fences:
{"answer_block": "...", "faq": [{"q": "...", "a": "..."}]}

ARTICLE TITLE: ${title}

ARTICLE BODY:
${body}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const json = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(json);
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const slugArg = (process.argv.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  const limArg  = (process.argv.find(a => a.startsWith('--limit=')) || '').replace('--limit=', '');
  const limit   = limArg ? parseInt(limArg, 10) : null;

  let q = sb.from('dormied_articles')
    .select('slug,title,body,faq,answer_block,category')
    .eq('status', 'published')
    .neq('category', 'Feature')
    .is('answer_block', null);

  if (slugArg) q = q.in('slug', slugArg.split(',').map(s => s.trim()).filter(Boolean));

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let rows = data || [];
  if (process.argv.includes('--questions')) {
    rows = rows.filter(r =>
      /^(who|what|where|why|when|which|how|is|are|does|do|did|can)\b/i.test(r.title) ||
      r.title.trim().endsWith('?') ||
      /^(who|what|where|why|when|which|how|is|are|does|do|did|can)\b/i.test(r.slug.replace(/-/g, ' ')));
  }
  if (limit) rows = rows.slice(0, limit);

  console.log(`[backfill] ${rows.length} article(s) to treat${DRY ? ' (DRY RUN)' : ''}`);

  const treated = [], skipped = [];
  for (const r of rows) {
    process.stdout.write(`  ${r.slug.slice(0, 62).padEnd(64)}`);
    if (!r.body || r.body.length < 200) { console.log('SKIP (no body)'); skipped.push([r.slug, 'no body']); continue; }

    const needFaq = !(Array.isArray(r.faq) && r.faq.length >= AB.MIN_FAQ_PAIRS);
    let out;
    try { out = await extract(anthropic, r.title, r.body, needFaq); }
    catch (e) { console.log('SKIP (' + e.message.slice(0, 40) + ')'); skipped.push([r.slug, 'model error']); continue; }

    // Answer block gate
    let block = typeof out.answer_block === 'string' ? stripEmDashes(out.answer_block.trim()) : '';
    const badNums = block ? AB.ungroundedNumbers(block, r.body) : ['(empty)'];
    if (badNums.length) { block = null; }

    // FAQ gate, independent of the block
    let faq = AB.cleanFaq(out.faq).map(x => ({ q: stripEmDashes(x.q), a: stripEmDashes(x.a) }));
    let faqNote = '';
    if (!needFaq)                       { faq = null; faqNote = 'faq kept'; }
    else if (!faq.length)               { faq = null; faqNote = 'faq none offered'; }
    else if (faq.length < AB.MIN_FAQ_PAIRS) { faqNote = `faq refused (${faq.length} pair)`; faq = null; }
    else {
      const g = AB.answersGrounded(faq, r.body);
      if (!g.ok) { faqNote = `faq refused (ungrounded ${g.bad})`; faq = null; }
      else       { faqNote = `faq ${faq.length} pairs`; }
    }

    if (!block && !faq) {
      console.log(`SKIP (block ungrounded ${badNums[0]}; ${faqNote})`);
      skipped.push([r.slug, `block ungrounded ${badNums[0]}`]);
      continue;
    }

    const patch = { date_modified: new Date().toISOString() };
    if (block) patch.answer_block = block;
    if (faq)   patch.faq = faq;

    if (!DRY) {
      const { error: upErr } = await sb.from('dormied_articles').update(patch).eq('slug', r.slug);
      if (upErr) { console.log('SKIP (db ' + upErr.message.slice(0, 30) + ')'); skipped.push([r.slug, 'db error']); continue; }
    }
    console.log(`OK  ${block ? AB.wordCount(block) + 'w block' : 'no block'} | ${faqNote}`);
    treated.push([r.slug, block ? AB.wordCount(block) : 0, faq ? faq.length : 0]);
  }

  console.log(`\n[backfill] treated ${treated.length}, skipped ${skipped.length}`);
  if (skipped.length) {
    console.log('[backfill] skipped for insufficient grounding:');
    skipped.forEach(([s, why]) => console.log(`   ${s}  ${why}`));
  }
  console.log('\n[backfill] re-bake the treated pages:');
  console.log('  node scripts/generate-article.js --regenerate-all');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('[backfill] Fatal:', e.message); process.exit(1); });
}
