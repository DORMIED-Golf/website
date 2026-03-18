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
  'No single catalyst is obvious from available coverage this month. ' +
  'The movement may reflect broader seasonal trends or organic brand momentum.';

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

// ── Anthropic call ───────────────────────────────────────────────────────────

async function generateExplanation(anthropic, brand, pct, monthLabel) {
  const sign = pct > 0 ? '+' : '';

  const systemPrompt =
    'You are a golf industry analyst writing for DORMIED, a golf brand intelligence platform. ' +
    'Your tone is knowledgeable, direct, and dry. You write for gear-obsessed golf enthusiasts ' +
    'who follow brand culture closely and use insider terminology. ' +
    'Never explain your search process. Never say "Based on my search results", "Based on my research", ' +
    '"I found", "it appears", "it seems", or any similar meta-commentary. ' +
    'Go directly to the facts. Write in tight, production-ready prose.';

  const userPrompt =
    `${brand.name} saw a ${sign}${pct.toFixed(1)}% change in global search interest on the DORMIED Index in ${monthLabel}. ` +
    `Brand category: ${brand.category}.\n\n` +
    `Search the web for news, tour activity, product launches, viral moments, player equipment changes, ` +
    `or media coverage involving ${brand.name} during or just before ${monthLabel} that explains this movement.\n\n` +
    `Output exactly 2–3 bullet points starting with the • character. ` +
    `Each bullet is one sentence. No intro text. No outro text. No preamble. Start directly with •.\n` +
    `Each bullet must state a specific fact — name the player, product, or event. ` +
    `Do not start any bullet with the brand name. Do not use "it appears" or "it seems".\n\n` +
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

    try {
      const explanation = await generateExplanation(
        anthropic, brand, pct, curLabel
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
