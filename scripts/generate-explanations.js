#!/usr/bin/env node
/**
 * DORMIED — Monthly Brand Explanation Generator
 *
 * Loops all 122 brands, finds any with >15% MoM global search change,
 * generates a 2-sentence AI explanation via Anthropic + web search,
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

  const systemPrompt =
    'You are the Explanation Agent for DORMIED, golf\'s brand desk. ' +
    'DORMIED is the monthly ranking and editorial home for golf brands. We track 169 brands across 10 global markets and publish independent rankings as the DORMIED Index. ' +
    'Every sport has a publication that covers the business and culture of its brands. Fashion has Lyst and Business of Fashion. Basketball has Boardroom. Golf has DORMIED. ' +
    'Your audience is gear-obsessed golf insiders who follow brand culture and equipment closely. ' +
    'Voice: dry, direct, opinionated, knowledgeable but casual. You report what happened, never what you searched for. ' +
    'Never explain your research process. Never open with or include phrases like "Based on my search results", "Based on my research", "Based on available information", "I found", "it appears", "it seems", "it is worth noting", "according to", or any similar meta-commentary. ' +
    'Never reference the search process at all. Go directly to the facts as if you already know them. ' +
    'Never describe DORMIED as a ranking platform, data tool, or tracker. ' +
    'Never use the words "popularity" or "buzz". Use "attention" or "momentum" or just describe the thing. ' +
    'Never use em dashes. Use periods, commas, or restructure. ' +
    'If you cannot find a specific fact do not speculate and do not explain why. Just report what you know.';

  const dormiedCoverageBlock = dormiedCoverage && dormiedCoverage.length > 0
    ? `\n\nRecent DORMIED coverage of ${brand.name}:\n` +
      dormiedCoverage.map(a => `- "${a.title}" (${a.date}) — ${a.url}`).join('\n') +
      `\n\nWhen a bullet relates to a moment DORMIED has covered, link the relevant phrase inline using markdown: [anchor text](url). Use natural anchor text, not "click here" or "read more." One internal link maximum per bullet. Skip the link if it does not fit naturally.`
    : '';

  const userPrompt =
    `${brand.name} saw a ${sign}${pct.toFixed(1)}% change in global search interest on the DORMIED Index in ${monthLabel}. ` +
    `Brand category: ${brand.category}.${dormiedCoverageBlock}\n\n` +
    `Search the web for news, tour activity, product launches, viral moments, player equipment changes, ` +
    `or media coverage involving ${brand.name} during or just before ${monthLabel} that explains this movement.\n\n` +
    `Output is a bullet list. One bullet per catalyst. One catalyst per bullet. ` +
    `Most moves have one to three real catalysts. Do not pad the list to look thorough. ` +
    `If there is one cause return one bullet. If there are three return three. Maximum five bullets.\n\n` +
    `Each bullet is one tight sentence stating a specific fact. Name the player, product, event, or publication where relevant. Do not be vague.\n\n` +
    `Rules that must be followed without exception:\n` +
    `• Start each bullet with •\n` +
    `• No intro text before the first bullet\n` +
    `• No outro text after the last bullet\n` +
    `• No preamble of any kind\n` +
    `• Do not start any bullet with the brand name\n` +
    `• Do not start any bullet with "Based", "According", "From", "My", "It appears", "It seems", "There was", "There has been", or any phrase that references your research process\n` +
    `• Start each bullet directly with the fact\n` +
    `• 10 to 25 words per bullet (excluding any markdown link syntax)\n\n` +
    `Tone examples:\n` +
    `Good: • Cameron Smith switched to their Mezz.1 Max putter two weeks before the event, triggering coverage on GolfWRX and MyGolfSpy.\n` +
    `Good: • The Qi35 iron launch generated more earned media than any TaylorMade iron release in three years.\n` +
    `Good: • Hovland moved his bag to the brand mid-month and search interest tracked the news cycle almost to the day.\n` +
    `Good (with internal link): • [Augusta capsule drop with Malbon](https://dormied.com/news/example-slug/) anchored the month.\n` +
    `Bad: • Based on my search results, it appears the brand had a strong month. (meta commentary, vague)\n` +
    `Bad: • TaylorMade saw increased interest following recent tour activity. (too vague, no specifics)\n` +
    `Bad: • A combination of factors contributed to growth. (vague, hedging, filler)\n\n` +
    `If no specific cause can be identified from available sources, output exactly this and nothing else:\n` +
    `${FALLBACK_TEXT}`;

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system:     systemPrompt,
    tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
    messages:   [{ role: 'user', content: userPrompt }],
  });

  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();
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

  const curLabel  = yyyymmToLabel(targetYYYYMM);
  const prevLabel = prevMonthLabel(targetYYYYMM);

  console.log(`\n╔═ DORMIED Explanation Generator`);
  console.log(`║  Month:  ${curLabel} (${targetYYYYMM})`);
  console.log(`║  Prev:   ${prevLabel}`);
  console.log(`║  Threshold: >${MOVEMENT_THRESHOLD}% MoM`);
  console.log(`╚${'═'.repeat(40)}\n`);

  const data      = loadData();
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let generated = 0, skipped = 0, errors = 0;

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
        // Truncate explanation for logging
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

main().catch(err => { console.error(err); process.exit(1); });
