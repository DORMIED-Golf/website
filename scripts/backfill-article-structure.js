#!/usr/bin/env node
/**
 * scripts/backfill-article-structure.js
 *
 * Adds section subheadings and a dedicated SEO title to already-published news
 * articles. New articles get both inline from generate-article.js; this is for
 * the back catalogue.
 *
 * WHY
 * Every stored article body is plain paragraphs. Of 629 articles, 576 run past
 * 400 words and only 3 had a subheading of any kind, so the page outline a
 * search engine reads was an h1 followed by sidebar furniture. And 602 of 626
 * <title> tags ran past the ~60 characters results display, because the tag was
 * the full editorial headline plus " | DORMIED".
 *
 * THE PROSE IS NOT TOUCHED. NOT ONE BYTE.
 * The model never returns article text. It returns paragraph NUMBERS and heading
 * strings, and this script splices "## Heading\n\n" in front of those paragraphs
 * at their exact offsets in the stored body. Before anything is written it
 * strips the inserted lines back out and requires the result to equal the
 * original body exactly; a mismatch aborts that article.
 *
 * GROUNDING
 * Same discipline as backfill-answer-blocks.js via scripts/lib/answer-block.js:
 * a heading or SEO title containing a number the article does not contain is
 * rejected. Headings and the SEO title are validated independently, so an
 * article can gain one while the other is refused.
 *
 * date_modified is bumped only when the BODY changes. Inserting subheadings is a
 * real change to the page's content; a new <title> alone is metadata and is not
 * a reason to tell crawlers the article was updated.
 *
 * Hand-authored PROTECTED_SLUGS are skipped: their committed HTML is the source
 * of truth and their stored body is not a faithful copy of it.
 *
 *   node scripts/backfill-article-structure.js --slug=a,b --dry-run
 *   node scripts/backfill-article-structure.js --limit=20
 *   node scripts/backfill-article-structure.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const ROOT = path.resolve(__dirname, '..');

(function loadDotenv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
})();

const { createClient } = require('@supabase/supabase-js');
const Anthropic        = require('@anthropic-ai/sdk');
const AB               = require('./lib/answer-block');

const MODEL = 'claude-opus-5';
const args  = process.argv.slice(2);
const DRY   = args.includes('--dry-run');
const SLUGS = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '')
                .split(',').map(s => s.trim()).filter(Boolean);
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '').replace('--limit=', ''), 10) || null;

const GENERIC_HEADING = /^(background|context|overview|introduction|analysis|summary|conclusion|final thoughts|the takeaway|takeaways?|the bottom line|bottom line|why it matters|what it means|what's next|whats next|looking ahead)$/i;
const HAS_HEADING     = /^#{2,3}\s+\S/m;
// A heading must not freeze a monthly-changing Index figure: the article's brand
// card re-renders with the CURRENT rank, so "Callaway Sits Fourth Among 169
// Brands" ended up directly beside a card reading #2.
const DATED_INDEX = /\bdormied index\b|\b(ranks?|ranked|ranking|sits|place[ds]?)\b[^.]*\b(\d+(st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b|\b\d+(st|nd|rd|th)\b[^.]*\b(index|rank|ranked|place|spot)\b|\bof \d{2,3}( brands)?\b|\bamong \d+ brands\b/i;

const stripEmDashes = s => String(s || '').replace(/\s*[—–]\s*/g, ', ');

/** PROTECTED_SLUGS is not exported by the generator, so read it from source. */
function protectedSlugs() {
  const src = fs.readFileSync(path.join(__dirname, 'generate-article.js'), 'utf8');
  const m = src.match(/const PROTECTED_SLUGS = new Set\(\[([\s\S]*?)\]\)/);
  return new Set(m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : []);
}

function brandNames() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8'), ctx);
  return new Map((ctx.window.DORMIED_DATA.brands || []).map(b => [b.id, b.name]));
}

/** Paragraph blocks with their exact start offsets in the stored body. */
function paragraphBlocks(body) {
  const out = [];
  for (const m of body.matchAll(/[^\n]+(?:\n(?!\n)[^\n]*)*/g)) {
    if (m[0].trim()) out.push({ start: m.index, text: m[0] });
  }
  return out;
}

function buildPrompt(title, brandName, blocks, words) {
  const want = words >= 400 ? '2 to 4' : '0 to 2';
  const numbered = blocks.map((b, i) => `[${i + 1}] ${b.text}`).join('\n\n');
  return `You are adding section subheadings and a search title to an article that is ALREADY PUBLISHED on DORMIED, a golf brand and business publication. You must not change, rewrite, summarise or quote the article. You only choose where headings go and what they say.

HEADLINE: ${title}
BRAND: ${brandName || '(none)'}
LENGTH: ${words} words in ${blocks.length} paragraphs

ARTICLE (paragraphs are numbered):
${numbered}

Return JSON only, no markdown fences, exactly:
{"headings":[{"before":N,"text":"..."}],"seo_title":"..."}

HEADINGS: ${want} of them.
- "before" is the number of the paragraph the heading sits directly above. Never 1: the lead paragraph always comes first, and the first heading may sit directly after it (before 2). Between one heading and the next, leave at least 2 paragraphs, so every section has substance.
- Each heading says specifically what its section establishes, the way a reader scanning or a search engine reading the outline would want: "Why Tour Players Are Dropping the 3-Wood", "A $375 Iron Priced Against Mizuno". 3 to 9 words, title case.
- Never a generic label: not "Background", "Context", "Overview", "Analysis", "Why It Matters", "What It Means", "The Bottom Line", "What's Next", "Looking Ahead", "Conclusion", "Final Thoughts", "The Takeaway".
- Only claims the article makes. No number that does not appear in the article. No em dashes. No clickbait, no questions the article does not answer.
- Never put a DORMIED Index rank, position, score or brand count in a heading ("Ranked 47th", "Sits Fourth Among 169 Brands", "93rd of 175"). Those figures change every month, and the page shows the brand's CURRENT rank right beside the article, so a heading repeating an old one contradicts it on the same screen.
- If the article is too short or too single-threaded to divide honestly, return an empty array.

SEO_TITLE: what search results show above the link.
- 60 characters or fewer, counted. Contains the brand name${brandName ? ` ("${brandName}")` : ''}. Says plainly what the article is about, so a searcher knows before clicking.
- Not the headline, and not a truncated headline. No "| DORMIED". No em dashes. No number that is not in the article.`;
}

function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function validateHeadings(raw, blocks, body, words) {
  if (!Array.isArray(raw)) return { ok: false, why: 'no headings array' };
  if (!raw.length) return { ok: true, list: [] };
  const max = words >= 400 ? 4 : 2;
  if (raw.length > max) return { ok: false, why: `${raw.length} headings (max ${max})` };
  if (words >= 400 && raw.length < 2) return { ok: false, why: `${raw.length} heading for ${words} words` };
  const list = [];
  // The lead paragraph may stand alone above the first heading; that is the
  // normal shape of an article. Only the gap BETWEEN headings needs 2 paragraphs.
  let prev = null;
  for (const h of raw) {
    const before = Number(h && h.before);
    const text   = stripEmDashes(h && h.text).replace(/[.:;,]+$/, '').trim();
    if (!Number.isInteger(before) || before < 2 || before > blocks.length) return { ok: false, why: `bad position ${h && h.before}` };
    if (prev !== null && before - prev < 2) return { ok: false, why: `heading at ${before} leaves a section under 2 paragraphs` };
    if (text.length < 3 || text.length > 70) return { ok: false, why: `heading length ${text.length}: "${text}"` };
    if (text.split(/\s+/).length > 10)       return { ok: false, why: `heading over 10 words: "${text}"` };
    if (GENERIC_HEADING.test(text))          return { ok: false, why: `generic heading "${text}"` };
    if (DATED_INDEX.test(text))              return { ok: false, why: `heading freezes an Index figure: "${text}"` };
    if (/^#/.test(text) || /\n/.test(text))  return { ok: false, why: 'malformed heading' };
    const bad = AB.ungroundedNumbers(text, body);
    if (bad.length) return { ok: false, why: `heading "${text}" has ungrounded number ${bad[0]}` };
    list.push({ before, text });
    prev = before;
  }
  return { ok: true, list };
}

function validateSeoTitle(raw, brandName, body, title) {
  const t = stripEmDashes(raw).replace(/\s*\|\s*DORMIED\s*$/i, '').trim();
  if (!t) return { ok: false, why: 'empty' };
  if (t.length > 60) return { ok: false, why: `${t.length} chars` };
  if (brandName && !t.toLowerCase().includes(brandName.toLowerCase())) return { ok: false, why: `missing brand "${brandName}"` };
  const bad = AB.ungroundedNumbers(t, `${body} ${title}`);
  if (bad.length) return { ok: false, why: `ungrounded number ${bad[0]}` };
  return { ok: true, value: t };
}

/** Splice headings in at exact offsets, then prove the prose is untouched. */
function insertHeadings(body, blocks, list) {
  let out = body;
  for (const { before, text } of [...list].sort((a, b) => b.before - a.before)) {
    const at = blocks[before - 1].start;
    out = out.slice(0, at) + `## ${text}\n\n` + out.slice(at);
  }
  const stripped = out.replace(/^## [^\n]*\n\n/gm, '');
  if (stripped !== body) throw new Error('prose changed during insertion');
  return out;
}

async function callModel(anthropic, prompt) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 4000 * attempt));
    }
  }
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
    throw new Error('SUPABASE_URL, SUPABASE_SERVICE_KEY and ANTHROPIC_API_KEY are required');
  }
  const sb        = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const PROTECTED = protectedSlugs();
  const names     = brandNames();

  let rows = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('dormied_articles')
      .select('slug, title, body, brand_slug, category, seo_title')
      .eq('status', 'published')
      .neq('category', 'Feature')
      .order('published_at', { ascending: false })
      .range(from, from + 999);
    if (SLUGS.length) q = q.in('slug', SLUGS);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows = rows.concat(data || []);
    if (!data || data.length < 1000) break;
  }

  rows = rows.filter(r => !PROTECTED.has(r.slug)
    && r.body && r.body.length >= 200
    && (!HAS_HEADING.test(r.body) || !r.seo_title));
  if (LIMIT) rows = rows.slice(0, LIMIT);

  console.log(`[structure] ${rows.length} article(s) to treat${DRY ? ' (DRY RUN)' : ''}\n`);

  const changed = [], skipped = [];
  for (const r of rows) {
    const brandName = r.brand_slug ? (names.get(r.brand_slug) || null) : null;
    const blocks    = paragraphBlocks(r.body);
    const words     = AB.wordCount(r.body);
    const needHead  = !HAS_HEADING.test(r.body);
    process.stdout.write(`  ${r.slug.slice(0, 58).padEnd(58)} `);

    let parsed, rawText = '';
    try {
      rawText = await callModel(anthropic, buildPrompt(r.title, brandName, blocks, words));
      parsed  = parseJson(rawText);
      if (!parsed) {           // one retry: a malformed response is usually transient
        rawText = await callModel(anthropic, buildPrompt(r.title, brandName, blocks, words)
          + '\n\nReturn ONLY the JSON object. Escape any double quote inside a string value.');
        parsed = parseJson(rawText);
      }
    }
    catch (e) { console.log(`SKIP (model: ${e.message.slice(0, 40)})`); skipped.push([r.slug, 'model error']); continue; }
    if (!parsed) {
      console.log('SKIP (unparseable response after retry)');
      console.log(`      raw: ${JSON.stringify(String(rawText).slice(0, 300))}`);
      skipped.push([r.slug, 'unparseable']); continue;
    }

    const patch = {};
    const notes = [];

    if (needHead) {
      const h = validateHeadings(parsed.headings, blocks, r.body, words);
      if (!h.ok) notes.push(`headings refused: ${h.why}`);
      else if (h.list.length) {
        try {
          patch.body = insertHeadings(r.body, blocks, h.list);
          patch.date_modified = new Date().toISOString();
          notes.push(`${h.list.length} headings: ${h.list.map(x => `[${x.before}] ${x.text}`).join(' | ')}`);
        } catch (e) { notes.push(`headings aborted: ${e.message}`); }
      } else notes.push('no headings (too short to divide)');
    }

    if (!r.seo_title) {
      const t = validateSeoTitle(parsed.seo_title, brandName, r.body, r.title);
      if (t.ok) { patch.seo_title = t.value; notes.push(`seo_title (${t.value.length}): ${t.value}`); }
      else notes.push(`seo_title refused: ${t.why}`);
    }

    if (!Object.keys(patch).length) {
      console.log('SKIP');
      notes.forEach(n => console.log(`      ${n}`));
      skipped.push([r.slug, notes.join('; ')]);
      continue;
    }
    if (!DRY) {
      const { error } = await sb.from('dormied_articles').update(patch).eq('slug', r.slug);
      if (error) { console.log(`SKIP (db: ${error.message.slice(0, 40)})`); skipped.push([r.slug, 'db error']); continue; }
    }
    console.log(DRY ? 'WOULD WRITE' : 'OK');
    notes.forEach(n => console.log(`      ${n}`));
    changed.push(r.slug);
  }

  console.log(`\n[structure] ${DRY ? 'would change' : 'changed'} ${changed.length}, skipped ${skipped.length}`);
  if (changed.length && !DRY) {
    console.log('\n[structure] re-bake the changed pages:');
    console.log(`  node scripts/generate-article.js --regenerate-all --only=${changed.join(',')}`);
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('[structure] FATAL:', e.message); process.exit(1); });
}
