#!/usr/bin/env node
/**
 * scripts/backfill-article-meta.js
 *
 * Repairs articles that shipped with no metadata.
 *
 * generate-article.js validated only parsed.body, so an Opus response that came
 * back with a title and a body but no meta_description, seo_keywords or x_post
 * passed every gate and shipped a page with an empty <meta name="description">,
 * an empty og:description, no keywords, and an X post that degraded to the bare
 * headline. generate-article.js now has a metadata completeness gate, so this
 * backfill is for the articles that shipped before it existed.
 *
 * Fields are regenerated from the article's OWN published body, so the
 * description describes the piece that actually ran. Same grounding rule as
 * backfill-article-faq.js: any number in the description must appear in the
 * body, otherwise the article is skipped rather than given an invented figure.
 *
 * Also recovers answer_block and faq when the same response dropped them.
 * Does NOT touch title, body or date_modified.
 *
 * Scope: by default only articles with an EMPTY meta_description. Pass --all to
 * also fill lone seo_keywords / x_post_text gaps on older rows.
 *
 * Usage:
 *   node scripts/backfill-article-meta.js --dry-run
 *   node scripts/backfill-article-meta.js --slug=some-slug
 *   node scripts/backfill-article-meta.js
 *   node scripts/backfill-article-meta.js --all
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL   = 'claude-opus-5';
const DRY     = process.argv.includes('--dry-run');
const slugArg  = (process.argv.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '') || null;
const slugList = slugArg ? slugArg.split(',').map(x => x.trim()).filter(Boolean) : null;

const NUM_RE  = /\d[\d,]*(?:\.\d+)?/g;
const normNum = n => n.replace(/,/g, '');

/** Every number in the text must also appear in the body. */
function grounded(text, body) {
  const bodyNums = new Set((body.match(NUM_RE) || []).map(normNum));
  for (const raw of (String(text || '').match(NUM_RE) || [])) {
    if (!bodyNums.has(normNum(raw))) return { ok: false, bad: raw };
  }
  return { ok: true };
}

async function extractMeta(anthropic, title, body, brandName) {
  const prompt = `You are given the FULL text of a published DORMIED golf article. Produce its missing metadata using ONLY information explicitly stated in the article below.

STRICT RULES:
- Do NOT introduce any fact, number, date, name or claim that is not in the text.
- No em dashes anywhere.
- meta_description: 120 to 155 characters, includes the brand name, describes what THIS article says.
- seo_keywords: 5 keywords a reader would actually search for this piece.
- x_post: under 220 characters, dry and factual in DORMIED's voice, no hashtags, no link (one is appended automatically).
- answer_block: 40 to 60 words, a single paragraph answering what this article establishes, in the article's dry voice.
- faq: 3 to 5 question/answer pairs a reader would search, each answer 1 to 3 sentences, fully supported by the text.

Return valid JSON only, exactly:
{"meta_description":"...","seo_keywords":["...","...","...","...","..."],"x_post":"...","answer_block":"...","faq":[{"q":"...","a":"..."}]}

BRAND: ${brandName}
TITLE: ${title}

ARTICLE:
${body}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    // 2500, not 1000: adding faq to the payload pushed responses past a 1000
    // token ceiling and JSON.parse failed on the truncated string. That is the
    // same truncation class as the bug this script exists to repair.
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = res.content.map(c => c.text || '').join('').trim();
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE env vars');
  if (!ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  const sb        = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  let query = sb.from('dormied_articles')
    .select('slug,title,body,brand_slug,meta_description,seo_keywords,x_post_text,answer_block,faq')
    .eq('status', 'published');
  if (slugList) query = query.in('slug', slugList);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Default scope is the actual defect: an EMPTY meta description, which is
  // what reaches the page as <meta name="description" content="">. A missing
  // seo_keywords or x_post_text on its own is a much older, cosmetic gap (24
  // articles, all already posted) and is left alone unless --all is passed, so
  // a routine run cannot quietly rewrite two dozen unrelated rows.
  const noMeta = r => !r.meta_description || !String(r.meta_description).trim();
  const anyGap = r => noMeta(r)
    || !Array.isArray(r.seo_keywords) || !r.seo_keywords.length
    || !r.x_post_text || !String(r.x_post_text).trim()
    || !r.answer_block || !String(r.answer_block).trim()
    || !Array.isArray(r.faq) || !r.faq.length;
  const wantAll = process.argv.includes('--all');
  const targets = (data || []).filter(wantAll || slugList ? anyGap : noMeta);

  console.log(`[meta-backfill] ${targets.length} article(s) missing metadata${DRY ? ' (DRY RUN)' : ''}`);
  const done = [], skipped = [];

  for (const r of targets) {
    process.stdout.write(`  ${r.slug.slice(0, 52).padEnd(54)}`);
    try {
      if (!r.body || r.body.length < 200) { console.log('SKIP (no usable body)'); skipped.push([r.slug, 'no body']); continue; }
      const m = await extractMeta(anthropic, r.title, r.body, r.brand_slug || 'DORMIED');

      const md = String(m.meta_description || '').trim();
      const xp = String(m.x_post || '').trim();
      const kw = Array.isArray(m.seo_keywords) ? m.seo_keywords.filter(Boolean) : [];
      if (!md || !xp || !kw.length) { console.log('SKIP (incomplete response)'); skipped.push([r.slug, 'incomplete']); continue; }
      if ((md + xp).includes('—'))  { console.log('SKIP (em dash)');        skipped.push([r.slug, 'em dash']); continue; }

      const g1 = grounded(md, r.body), g2 = grounded(xp, r.body);
      if (!g1.ok || !g2.ok) {
        const bad = (g1.ok ? g2 : g1).bad;
        console.log(`SKIP (ungrounded number "${bad}")`); skipped.push([r.slug, `ungrounded ${bad}`]); continue;
      }

      // Only fill what is actually missing; never overwrite existing metadata.
      const patch = {};
      if (!r.meta_description || !String(r.meta_description).trim())      patch.meta_description = md;
      if (!Array.isArray(r.seo_keywords) || !r.seo_keywords.length)        patch.seo_keywords     = kw.slice(0, 5);
      if (!r.x_post_text || !String(r.x_post_text).trim())                 patch.x_post_text      = xp;

      // The same truncated response that dropped the description also dropped
      // the answer block and FAQ, so recover them here rather than in a third
      // pass. Both are held to the grounding rule and simply omitted if they
      // fail it: a page with no answer block beats one with an invented number.
      const ab = String(m.answer_block || '').trim();
      if ((!r.answer_block || !String(r.answer_block).trim()) && ab && !ab.includes('—') && grounded(ab, r.body).ok) {
        patch.answer_block = ab;
      }
      const faq = Array.isArray(m.faq)
        ? m.faq.filter(x => x && x.q && x.a).map(x => ({ q: String(x.q).trim(), a: String(x.a).trim() }))
        : [];
      if ((!Array.isArray(r.faq) || !r.faq.length) && faq.length >= 3
          && !faq.some(x => (x.q + x.a).includes('—'))
          && faq.every(x => grounded(x.a, r.body).ok)) {
        patch.faq = faq.slice(0, 5);
      }

      if (!DRY) {
        const { error: uerr } = await sb.from('dormied_articles').update(patch).eq('slug', r.slug);
        if (uerr) { console.log('DB ERROR: ' + uerr.message); skipped.push([r.slug, 'db error']); continue; }
      }
      console.log(`OK (${Object.keys(patch).join(', ')})`);
      done.push(r.slug);
    } catch (e) {
      console.log('ERROR: ' + e.message);
      skipped.push([r.slug, e.message]);
    }
  }

  console.log(`\n[meta-backfill] backfilled ${done.length}, skipped ${skipped.length}`);
  if (skipped.length) { console.log('  Skipped:'); skipped.forEach(([s, why]) => console.log(`    ${s} — ${why}`)); }
  if (done.length && !DRY) {
    console.log('\n  Re-bake the affected pages so the new metadata reaches the HTML:');
    console.log(`    node scripts/generate-article.js --regenerate-all --only=${done.join(',')}`);
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => { console.error('[meta-backfill] Fatal:', err.message); process.exit(1); });
}
