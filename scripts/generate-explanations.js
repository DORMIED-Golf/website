#!/usr/bin/env node
/**
 * DORMIED — Monthly Brand Explanation Generator
 *
 * Loops all brands, finds any with >15% MoM global search change,
 * generates a bullet-list explanation via Anthropic + web search,
 * and stores the result in Supabase.
 *
 * Usage:
 *   node scripts/generate-explanations.js           # defaults to last month
 *   node scripts/generate-explanations.js 2026-01   # specific month
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const Anthropic        = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

// ── Constants ────────────────────────────────────────────────────────────────

const MOVEMENT_THRESHOLD = 15; // minimum absolute % change to trigger

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const FALLBACK_TEXT =
  '• No identifiable catalyst this month. The move is real but the why is not visible yet.';

// ── Meta-commentary validator (Edit 3) ───────────────────────────────────────

// Validation patterns. If output starts with or contains any of these,
// it failed the no-meta-commentary rule.
const META_START_PATTERNS = [
  /^based on/i,
  /^according to/i,
  /^let me/i,
  /^i need to/i,
  /^i found/i,
  /^i cannot/i,
  /^i have not/i,
  /^i can see/i,
  /^i also see/i,
  /^despite/i,
  /^however,/i,
  /^after search/i,
  /^after review/i,
  /^my search/i,
  /^my research/i,
  /^the search results/i,
  /^the searches/i,
];

const META_BODY_PATTERNS = [
  /based on my search/i,
  /based on the search/i,
  /let me search/i,
  /let me try/i,
  /let me look/i,
  /i need to search/i,
  /my searches/i,
  /search results show/i,
  /search results suggest/i,
  /the searches/i,
  /searching for/i,
  /i cannot find/i,
  /i have not found/i,
  /i could not find/i,
  /no specific news/i,
  /no clear catalyst/i,
];

function hasMetaCommentary(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (META_START_PATTERNS.some(p => p.test(trimmed))) return true;
  if (META_BODY_PATTERNS.some(p => p.test(trimmed))) return true;
  return false;
}

// Task B: every non-empty line must start with "• "
function isBulletOnly(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(l => l.startsWith('• '));
}

// Normalize: rejoin trimmed bullet lines, collapsing blank lines
function normalizeBullets(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function yyyymmToLabel(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function prevMonthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function loadData() {
  const raw = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  return ctx.window.DORMIED_DATA;
}

function getMoMPct(brand, curLabel, prevLabel) {
  const g    = (brand.searchesByMarket && brand.searchesByMarket.global) || {};
  const cur  = g[curLabel]  || 0;
  const prev = g[prevLabel] || 0;
  if (prev === 0) return null;
  return (cur - prev) / prev * 100;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── DORMIED coverage fetcher ─────────────────────────────────────────────────

async function fetchRecentDormiedCoverage(supabase, brandId, monthYYYYMM) {
  const [year, month] = monthYYYYMM.split('-').map(Number);
  const monthEnd = new Date(year, month, 0); // last day of the target month
  const cutoff   = new Date(monthEnd);
  cutoff.setDate(cutoff.getDate() - 60);

  const { data, error } = await supabase
    .from('dormied_articles')
    .select('title, slug, published_at')
    .eq('brand_slug', brandId)
    .eq('status', 'published')
    .gte('published_at', cutoff.toISOString())
    .lte('published_at', monthEnd.toISOString())
    .order('published_at', { ascending: false })
    .limit(5);

  if (error) {
    console.warn(`  WARN  Failed to fetch DORMIED coverage for ${brandId}: ${error.message}`);
    return [];
  }

  return (data || []).map(a => ({
    title: a.title,
    url:   `https://dormied.com/news/${a.slug}/`,
    date:  a.published_at?.slice(0, 10) || '',
  }));
}

// ── Anthropic call ───────────────────────────────────────────────────────────

async function generateExplanation(anthropic, brand, pct, monthLabel, dormiedCoverage) {
  const sign = pct > 0 ? '+' : '';

  // Edit 1: Stricter system prompt with clearly labelled BANNED OUTPUT PATTERNS
  const systemPrompt =
    'You are the Explanation Agent for DORMIED, golf\'s brand desk. ' +
    'DORMIED is the monthly ranking and editorial home for golf brands. We track 175 brands across 10 global markets and publish independent rankings as the DORMIED Index. ' +
    'Every sport has a publication that covers the business and culture of its brands. Fashion has Lyst and Business of Fashion. Basketball has Boardroom. Golf has DORMIED. ' +
    'Your audience is gear-obsessed golf insiders who follow brand culture and equipment closely. ' +
    '\n\n' +
    'CRITICAL RULE ABOUT YOUR OUTPUT: ' +
    'You have access to a web search tool. Use it silently. The user will never see your search process, your reasoning, your hesitation, your hedging, or any commentary about what you did or did not find. ' +
    'Your output is the final published artifact. It appears on a brand\'s page on dormied.com. ' +
    'Treat the output the way a published columnist treats a column: only what makes the page. No drafts, no notes, no thinking-out-loud, no apology for what wasn\'t found. ' +
    '\n\n' +
    'Every text you produce is captured, including text written between searches. Do not narrate between tool calls. Do not summarize findings, weigh candidates, or draft bullets mid-search. Write nothing until you are done searching, then write only the final bullets. ' +
    '\n\n' +
    'BANNED OUTPUT PATTERNS (these will be rejected): ' +
    '- Any sentence that begins with "Based on", "According to", "Let me", "I need to", "I found", "I cannot", "I have not", "I can see", "I also see", "Despite", "However", "After searching", "After reviewing", "My search", "My research", "The search results". ' +
    '- Any sentence describing what you searched for, considered, or attempted. ' +
    '- Any sentence that says no catalyst was found and then continues with more text. The fallback rule below is the only acceptable way to indicate no catalyst was found. ' +
    '- Any sentence that summarizes what you will do next or what you just did. ' +
    '- Any opening preamble before the first bullet. ' +
    '- Any closing summary after the last bullet. ' +
    '- The phrase "search interest" (the percentage is shown elsewhere on the page; do not narrate the metric). ' +
    '\n\n' +
    'STYLE: ' +
    'Voice: dry, direct, opinionated, knowledgeable but casual. ' +
    'Never describe DORMIED as a ranking platform, data tool, or tracker. ' +
    'Never use the words "popularity" or "buzz". Use "attention" or "momentum" or just describe the thing. ' +
    'Never use em dashes. Use periods, commas, or restructure. ' +
    'Report what happened, not what you searched for.' +
    '\n\n' +
    'TEMPORAL SCOPE: Every explanation covers exactly one calendar month, stated in the user prompt. Every catalyst you cite must be an event that occurred within that month. This is a hard constraint, not a preference.' +
    '\n' +
    '- An event "occurred within the month" if the launch, win, announcement, signing, viral moment, or news broke during that calendar month. The date of the event matters, not the date you found the article.' +
    '\n' +
    '- Events from any prior month are off limits, even if they feel relevant, even if they are the most interesting thing you found, and even if search results surface them prominently. A product that launched in March cannot explain a May move.' +
    '\n' +
    '- One narrow exception: an event from the final 7 days of the immediately preceding month may be cited only if the bullet explicitly dates it and frames the move as carryover (e.g. "Late-April launch of X carried into May search interest"). Use this sparingly. If you are not certain of the date, do not use it.' +
    '\n' +
    '- Tour results count only for tournaments that concluded during the target month.' +
    '\n' +
    '- Before writing any bullet, confirm the underlying event has a verifiable date inside the target month. If you cannot date it, you cannot use it.' +
    '\n' +
    '- If every candidate catalyst you find falls outside the target month, that is a no-catalyst result. Use the exact no-catalyst line. Do not stretch an old event to fill the page.';

  // Edit 2: Tighter user prompt with numbered rules and explicit invalid examples
  const dormiedCoverageBlock = dormiedCoverage && dormiedCoverage.length > 0
    ? `\n\nRecent DORMIED coverage of ${brand.name}:\n` +
      dormiedCoverage.map(a => `- "${a.title}" (${a.date}) — ${a.url}`).join('\n') +
      `\n\nWhen a bullet relates to a moment DORMIED has covered, link the relevant phrase inline using markdown: [anchor text](url). Use natural anchor text, not "click here" or "read more." One internal link maximum per bullet. Skip the link if it does not fit naturally.`
    : '';

  const userPrompt =
    `${brand.name} (${brand.category}) moved ${sign}${pct.toFixed(1)}% on the DORMIED Index in ${monthLabel}.${dormiedCoverageBlock}\n\n` +
    `Search the web for the catalyst. Look at: tour activity, product launches, viral moments, player equipment changes, executive moves, marketing campaigns, recalls, partnerships, business news, or any other identifiable cause.\n\n` +
    `OUTPUT RULES:\n` +
    `1. Output is a markdown bullet list. Each bullet starts with "• ".\n` +
    `2. One catalyst per bullet. One bullet per catalyst.\n` +
    `3. 1 to 5 bullets total. Never pad. If there is one cause return one bullet.\n` +
    `4. 10 to 25 words per bullet. State the specific fact. Name the player, product, event, or publication.\n` +
    `5. Do not start any bullet with the brand name.\n` +
    `6. Do not include any text before the first bullet or after the last bullet.\n\n` +
    `IF YOU CANNOT IDENTIFY A SPECIFIC CATALYST FROM YOUR SEARCH:\n` +
    `Output exactly this single line and nothing else. No preamble. No explanation. No "I searched but..." commentary:\n` +
    `${FALLBACK_TEXT}\n\n` +
    `EXAMPLES OF VALID OUTPUTS:\n\n` +
    `Example A (catalyst found, multiple bullets):\n` +
    `• Cameron Smith switched to their Mezz.1 Max putter two weeks before the event, triggering coverage on GolfWRX and MyGolfSpy.\n` +
    `• The Qi35 iron launch generated more earned media than any TaylorMade iron release in three years.\n\n` +
    `Example B (catalyst found, single bullet):\n` +
    `• Hovland moved his bag to the brand mid-month and the news cycle did the rest.\n\n` +
    `Example C (no catalyst, fallback):\n` +
    `• No identifiable catalyst this month. The move is real but the why is not visible yet.\n\n` +
    `EXAMPLES OF INVALID OUTPUTS (these will be rejected):\n\n` +
    `Invalid 1 (preamble before bullets):\n` +
    `"Based on my search results, I found the following catalysts: • [bullet]"\n\n` +
    `Invalid 2 (research narration):\n` +
    `"Let me search more specifically for X. Based on my searches I can see that..."\n\n` +
    `Invalid 3 (apologetic non-finding before fallback):\n` +
    `"I searched extensively but could not find any specific catalysts that would explain the movement. • No identifiable catalyst..."\n\n` +
    `Invalid 4 (closing summary):\n` +
    `"• [bullet]\n\nIn summary, the catalyst appears to be the product launch."\n\n` +
    `Invalid 5 (out-of-month catalyst):\n` +
    `"• Launched the new Apex Ti line in February to strong reviews, fueling continued search interest."\n` +
    `Why invalid: the event occurred in February. An explanation for May cites May events only.\n\n` +
    `Output the bullet list directly. Nothing else.`;

  // System prompt as a cached array block — stable across all brands in a run,
  // so the second+ brand in a session reads from cache at 10% of base input cost.
  // System prompt is ~500 tokens — below the 2,048-token Sonnet 4.6 cache floor.
  // cache_creation and cache_read will be 0 on every call; that is expected, not
  // a bug. The cache_control marker is kept so future prompt growth auto-activates
  // caching without a code change.
  const cachedSystem = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];

  // Edit 3: Wrap API call with validator and one-retry pattern
  let response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1000,
    system:     cachedSystem,
    tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
    messages:   [{ role: 'user', content: userPrompt }],
  });

  // Log cache/token metrics. cache_creation and cache_read will be 0 because the
  // system prompt (~500 tokens) is below the 2,048-token Sonnet 4.6 cache floor.
  const u1 = response.usage || {};
  console.log(`        tokens — input: ${u1.input_tokens ?? 0}, cache_read: ${u1.cache_read_input_tokens ?? 0}, cache_creation: ${u1.cache_creation_input_tokens ?? 0}, output: ${u1.output_tokens ?? 0} [cache: no-op, system prompt below 2048-token floor]`);

  // Task A: take only the final text block — intermediate blocks are search narration
  const textBlocks1 = response.content.filter(block => block.type === 'text');
  let output = textBlocks1.length ? textBlocks1[textBlocks1.length - 1].text.trim() : '';

  // Task B: bullet-only check runs before (and in addition to) the existing meta-commentary check
  if (!isBulletOnly(output) || hasMetaCommentary(output)) {
    if (!isBulletOnly(output)) {
      console.log(`        Non-bullet output detected, retrying...`);
    } else {
      console.log(`        Meta-commentary detected, retrying...`);
    }
    const retryUserPrompt =
      `Your previous response contained banned meta-commentary (research narration, "Based on...", "Let me search...", "I cannot find...", or similar). ` +
      `Rewrite your response. Output only the bullet list or the fallback line. No preamble. No explanation of what you searched for. No apology for what was not found.`;

    // Retry uses the same cachedSystem — the second call gets a cache hit on the
    // system prompt since the content is byte-for-byte identical (same 5m TTL window).
    response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1000,
      system:     cachedSystem,
      tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
      messages:   [
        { role: 'user',      content: userPrompt },
        { role: 'assistant', content: output },
        { role: 'user',      content: retryUserPrompt },
      ],
    });

    const u2 = response.usage || {};
    console.log(`        retry tokens — input: ${u2.input_tokens ?? 0}, cache_read: ${u2.cache_read_input_tokens ?? 0}, output: ${u2.output_tokens ?? 0} [cache: no-op, system prompt below 2048-token floor]`);

    // Task A (retry): take only the final text block
    const textBlocks2 = response.content.filter(block => block.type === 'text');
    output = textBlocks2.length ? textBlocks2[textBlocks2.length - 1].text.trim() : '';

    if (!isBulletOnly(output) || hasMetaCommentary(output)) {
      console.warn(`        Retry still failed validation. Falling back to safe text.`);
      output = FALLBACK_TEXT;
    }
  }

  // Normalize: collapse blank lines, trim each bullet line
  output = normalizeBullets(output);

  return output;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error(
      'Missing required env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY'
    );
    process.exit(1);
  }

  // Determine target month
  let targetYYYYMM = process.argv[2];
  if (!targetYYYYMM) {
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    targetYYYYMM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // Optional --limit flag: node script.js 2026-04 --limit 10
  const limitArg = process.argv.indexOf('--limit');
  const limit    = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

  const curLabel  = yyyymmToLabel(targetYYYYMM);
  const prevLabel = prevMonthLabel(targetYYYYMM);

  console.log(`\n╔═ DORMIED Explanation Generator`);
  console.log(`║  Month:  ${curLabel} (${targetYYYYMM})`);
  console.log(`║  Prev:   ${prevLabel}`);
  console.log(`║  Threshold: >${MOVEMENT_THRESHOLD}% MoM`);
  if (limit !== Infinity) console.log(`║  Limit:  ${limit} generations`);
  console.log(`╚${'═'.repeat(40)}\n`);

  const data      = loadData();
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Edit 4: Sanity check — abort if data pipeline is broken (all brands ±100%)
  const sample = data.brands
    .map(b => getMoMPct(b, curLabel, prevLabel))
    .filter(v => v !== null);

  const allNeg100 = sample.length > 10 && sample.every(v => Math.abs(v + 100) < 0.01);
  const allPos100 = sample.length > 10 && sample.every(v => Math.abs(v - 100) < 0.01);

  if (allNeg100 || allPos100) {
    console.error('ABORT: every brand returned ±100% change. The upstream data is broken.');
    console.error('Investigate the MoM calculation in data.js or the source CSV before re-running.');
    process.exit(1);
  }

  let generated = 0, skipped = 0, errors = 0, retries = 0, genCount = 0;

  for (const brand of data.brands) {
    const pct = getMoMPct(brand, curLabel, prevLabel);

    if (pct === null || Math.abs(pct) <= MOVEMENT_THRESHOLD) {
      skipped++;
      continue;
    }

    // Check for existing row — never overwrite
    const { data: existing } = await supabase
      .from('brand_explanations')
      .select('id')
      .eq('brand_id', brand.id)
      .eq('month', targetYYYYMM)
      .maybeSingle();

    if (existing) {
      console.log(`  SKIP  ${brand.name} — already stored`);
      skipped++;
      continue;
    }

    if (genCount >= limit) break;
    genCount++;

    const sign = pct > 0 ? '+' : '';
    console.log(`  GEN   ${brand.name}  ${sign}${pct.toFixed(1)}%`);

    let dormiedCoverage = [];
    try {
      dormiedCoverage = await fetchRecentDormiedCoverage(supabase, brand.id, targetYYYYMM);
      if (dormiedCoverage.length > 0) {
        console.log(`        ${dormiedCoverage.length} DORMIED article(s) found for context`);
      }
    } catch (err) {
      console.warn(`  WARN  DORMIED coverage fetch failed for ${brand.name}: ${err.message}`);
    }

    try {
      const explanation = await generateExplanation(
        anthropic, brand, pct, curLabel, dormiedCoverage
      );

      // Track retries via log output (generateExplanation logs them inline)
      if (explanation === FALLBACK_TEXT) retries++;

      const { error } = await supabase.from('brand_explanations').insert({
        brand_id:          brand.id,
        brand_name:        brand.name,
        month:             targetYYYYMM,
        explanation,
        change_percentage: parseFloat(pct.toFixed(2)),
      });

      if (error) {
        console.error(`  ERROR saving ${brand.name}: ${error.message}`);
        errors++;
      } else {
        const preview = explanation.length > 80
          ? explanation.slice(0, 77) + '...'
          : explanation;
        console.log(`  SAVED ${brand.name} — "${preview}"`);
        generated++;
      }
    } catch (err) {
      console.error(`  ERROR generating ${brand.name}: ${err.message}`);
      errors++;
    }

    await sleep(2000);
  }

  console.log(`\n╔═ Done`);
  console.log(`║  Generated: ${generated}`);
  console.log(`║  Skipped:   ${skipped}`);
  console.log(`║  Errors:    ${errors}`);
  console.log(`╚${'═'.repeat(40)}\n`);
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}