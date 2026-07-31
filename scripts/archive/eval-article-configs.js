#!/usr/bin/env node
/**
 * eval-article-configs.js — Part D eval gate
 *
 * Compares three article generation configs across three representative press
 * releases BEFORE switching the live pipeline to the advisor config.
 *
 * Configs tested:
 *   (a) opus-solo       — Opus 4.7 executor, no advisor
 *   (b) sonnet+advisor  — Sonnet 4.6 executor + Opus 4.7 advisor (max_uses: 3)
 *   (c) sonnet-solo     — Sonnet 4.6 executor, no advisor (baseline)
 *
 * Usage:
 *   node scripts/eval-article-configs.js
 *   node scripts/eval-article-configs.js --topic 0   # single topic (0,1,2)
 *   node scripts/eval-article-configs.js --config b  # single config (a,b,c)
 *
 * Output: eval-results/ directory (JSON + printed comparison)
 *
 * Required env: ANTHROPIC_API_KEY
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// ── Load production prompts from generate-article.js at runtime ───────────────
// This ensures the eval always uses the live prompt text, not a stale copy.

const genArticleSrc = fs.readFileSync(
  path.join(__dirname, 'generate-article.js'), 'utf8'
);

function extractTemplateConst(src, name) {
  // Matches: const NAME = `...`;  handles escaped characters inside.
  const marker = 'const ' + name + ' = `';
  const start  = src.indexOf(marker);
  if (start === -1) throw new Error(`Could not find: ${name}`);
  let i = start + marker.length;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }   // skip escaped char
    if (src[i] === '`')  break;                   // closing backtick
    i++;
  }
  return src.slice(start + marker.length, i);
}

const SYSTEM_PROMPT_BASE = extractTemplateConst(genArticleSrc, 'SYSTEM_PROMPT_BASE');
const ADAM_VOICE_BLOCK   = extractTemplateConst(genArticleSrc, 'ADAM_VOICE_BLOCK');
const TRAVIS_VOICE_BLOCK = extractTemplateConst(genArticleSrc, 'TRAVIS_VOICE_BLOCK');

function getSystemPrompt(author) {
  const voiceBlock = author === 'Adam' ? ADAM_VOICE_BLOCK : TRAVIS_VOICE_BLOCK;
  return [voiceBlock, SYSTEM_PROMPT_BASE].join('\n\n');
}

// Verify extraction succeeded
if (!SYSTEM_PROMPT_BASE || !ADAM_VOICE_BLOCK || !TRAVIS_VOICE_BLOCK) {
  console.error('[eval] Failed to extract prompt constants from generate-article.js');
  process.exit(1);
}
console.log(`[eval] Loaded prompts — base: ${SYSTEM_PROMPT_BASE.length} chars, Adam voice: ${ADAM_VOICE_BLOCK.length} chars, Travis voice: ${TRAVIS_VOICE_BLOCK.length} chars`);

// ── Pricing ($/1M tokens as of May 2026) ─────────────────────────────────────

const PRICING = {
  'claude-opus-4-7':   { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
};

function calcCost(model, usage) {
  const p = PRICING[model];
  if (!p || !usage) return 0;
  return (
    ((usage.input_tokens              ?? 0) * p.input      / 1e6) +
    ((usage.output_tokens             ?? 0) * p.output     / 1e6) +
    ((usage.cache_read_input_tokens   ?? 0) * p.cacheRead  / 1e6) +
    ((usage.cache_creation_input_tokens ?? 0) * p.cacheWrite / 1e6)
  );
}

// ── Configs ───────────────────────────────────────────────────────────────────

const EVAL_CONFIGS = [
  { id: 'a-opus-solo',      label: 'Opus 4.7 solo (no advisor)',             executor: 'claude-opus-4-7',   advisor: null },
  { id: 'b-sonnet+advisor', label: 'Sonnet 4.6 executor + Opus 4.7 advisor', executor: 'claude-sonnet-4-6', advisor: 'claude-opus-4-7' },
  { id: 'c-sonnet-solo',    label: 'Sonnet 4.6 solo (baseline)',              executor: 'claude-sonnet-4-6', advisor: null },
];

// ── Test cases ────────────────────────────────────────────────────────────────
// Three representative topics covering the two author voices and content types.

const TEST_CASES = [
  {
    id:     'equipment-travis',
    author: 'Travis',
    brandInfo: {
      brand:        { name: 'KBS Golf Shafts', category: 'Equipment', subCategories: ['Shafts'] },
      rank:         42,
      di:           24.1,
      momStr:       '+18%',
      currentMonth: 'Apr 2026',
    },
    pressRelease:
`KBS GOLF SHAFTS INTRODUCES TOUR 90 — LOW-LAUNCH STEEL IRON SHAFT FOR FASTER SWING SPEEDS

Vista, Calif. – KBS Golf Shafts today announced the Tour 90, a new addition to the KBS Tour family designed for faster swing-speed players seeking a penetrating ball flight. The Tour 90 features KBS's proprietary step-less design and a new low-bend point construction that produces a lower launch angle and reduced spin compared to the existing KBS Tour 80.

The shaft is available in three weight profiles — 90, 95, and 100 grams — in Stiff and X-Stiff flex options. Retail price is $34.95 per shaft in standard lengths. The Tour 90 will be available at certified KBS fitting facilities and premium independent retailers beginning April 15.

"We've heard from both our tour staff and retail customers that they wanted a Tour option with more control in the lower trajectory range," said Kim Braly, founder of KBS Golf Shafts. "The Tour 90 delivers that without sacrificing the consistency KBS is known for."

KBS currently has shafts in play across all four major tours and counts 14 tour winners among its staff players this season. The KBS Tour remains one of the most-played steel iron shafts on tour globally. The company, founded in 2004, operates its R&D and manufacturing quality control from its Vista, California facility.`,
  },

  {
    id:     'apparel-adam',
    author: 'Adam',
    brandInfo: {
      brand:        { name: 'Malbon Golf', category: 'Apparel', subCategories: ['Apparel'] },
      rank:         67,
      di:           15.3,
      momStr:       '+31%',
      currentMonth: 'Apr 2026',
    },
    pressRelease:
`MALBON GOLF AND NEW BALANCE ANNOUNCE LIMITED FOOTWEAR COLLABORATION

Los Angeles, Calif. — Malbon Golf and New Balance today unveiled a limited-edition footwear collaboration, the Bogey Club pack, featuring three colorways of the New Balance 997 silhouette adapted for golf use. The shoes incorporate a replaceable cleat system and waterproof leather upper while retaining the 997's heritage look.

The collection launches April 22 in a simultaneous drop at select New Balance retail locations and on malbon.com. Each colorway is limited to 500 pairs globally, priced at $195. A matching polo and bucket hat complete the Bogey Club pack, available exclusively on malbon.com.

"The 997 was the shoe that made sense from day one," said Stephen Malbon, co-founder of Malbon Golf. "It's a golf shoe that works off the course too. That's the whole Malbon thesis."

Malbon Golf, founded in 2017, operates a flagship location in Los Angeles and runs the Bogey Club membership concept. The brand has previously collaborated with Titleist, FootJoy, and Polo Ralph Lauren. This is its first footwear-primary collaboration with a performance athletic brand.`,
  },

  {
    id:     'tech-travis',
    author: 'Travis',
    brandInfo: {
      brand:        { name: 'Arccos Golf', category: 'Technology', subCategories: ['Technology'] },
      rank:         88,
      di:           11.2,
      momStr:       '+22%',
      currentMonth: 'Apr 2026',
    },
    pressRelease:
`ARCCOS GOLF RAISES $30 MILLION SERIES C, ANNOUNCES CALLAWAY FITTING INTEGRATION

Seattle, Wash. — Arccos Golf, maker of the AI-powered golf performance tracking system, announced today a $30 million Series C funding round led by Callaway Golf. The investment includes a new commercial partnership integrating Arccos's Strokes Gained analytics into Callaway's fitting process at its 500-plus fitting center network.

Under the terms of the deal, Arccos will power the performance data layer of Callaway's AI fitting recommendation engine, which guides club fittings at authorized Callaway locations. Arccos's database of over 12 billion tracked shots will provide the statistical foundation for equipment recommendations.

Arccos CEO Sal Syed said the capital will be used to accelerate product development and expand the platform's international presence in the UK, Japan, and Australia. The Series C brings total Arccos funding to $60 million.

Arccos currently tracks shots for more than 250,000 active users. The company's smart sensors attach to club grips and communicate with a companion app to record shot data automatically without player input. The system calculates handicap-certified statistics for every round.`,
  },
];

// ── Generation ────────────────────────────────────────────────────────────────

async function generate(anthropic, testCase, config) {
  const { brand, rank, di, momStr, currentMonth } = testCase.brandInfo;

  const userMsg =
`Brand: ${brand.name}
Current DORMIED global rank: #${rank} of 175
DI score: ${di}/100
Month-over-month: ${momStr}
Month: ${currentMonth}
Category: ${brand.category}

Press release:
${testCase.pressRelease}`;

  const cachedSystem = [{
    type:          'text',
    text:          getSystemPrompt(testCase.author),
    cache_control: { type: 'ephemeral' },
  }];

  const t0 = Date.now();
  let res;

  if (config.advisor) {
    res = await anthropic.beta.messages.create({
      model:      config.executor,
      max_tokens: 3000,
      betas:      ['advisor-tool-2026-03-01'],
      tools:      [{
        type:     'advisor_20260301',
        name:     'advisor',
        model:    config.advisor,
        max_uses: 3,
      }],
      system:   cachedSystem,
      messages: [{ role: 'user', content: userMsg }],
    });
  } else {
    res = await anthropic.messages.create({
      model:      config.executor,
      max_tokens: 3000,
      system:     cachedSystem,
      messages:   [{ role: 'user', content: userMsg }],
    });
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Extract last text block (advisor blocks may appear mid-content)
  const textBlocks = (res.content || []).filter(b => b.type === 'text' && b.text?.trim());
  const rawText    = (textBlocks[textBlocks.length - 1]?.text || '').trim();

  // Parse JSON response
  let parsed = null;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch { /* leave null — caught in report */ }

  // Cost accounting
  const u            = res.usage || {};
  const executorCost = calcCost(config.executor, u);
  const advisorIter  = (u.iterations || []).find(i => i.type === 'advisor_message');
  const advisorCost  = advisorIter ? calcCost(config.advisor, advisorIter) : 0;

  return {
    config:       config.id,
    configLabel:  config.label,
    topic:        testCase.id,
    author:       testCase.author,
    elapsed,
    title:        parsed?.title        || '[JSON parse failed]',
    body:         parsed?.body         || '',
    xPost:        parsed?.x_post       || '',
    meta:         parsed?.meta_description || '',
    valid:        parsed !== null,
    rawText,
    usage:        u,
    advisorTokens: advisorIter || null,
    executorCost,
    advisorCost,
    totalCost:    executorCost + advisorCost,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Let the SDK auto-read ANTHROPIC_API_KEY from the environment.
  // (The first failed API call will surface a missing-key error.)
  const anthropic = new Anthropic();

  // Optional filters
  const topicArg  = process.argv.find(a => a.startsWith('--topic='))?.split('=')[1];
  const configArg = process.argv.find(a => a.startsWith('--config='))?.split('=')[1];

  const topics  = topicArg  ? [TEST_CASES[parseInt(topicArg)]]  : TEST_CASES;
  const configs = configArg ? EVAL_CONFIGS.filter(c => c.id.startsWith(configArg)) : EVAL_CONFIGS;

  const outDir = path.join(__dirname, '..', 'eval-results');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('\n╔═ DORMIED Article Config Eval — Part D');
  console.log(`║  Configs: ${configs.map(c => c.label).join(' | ')}`);
  console.log(`║  Topics:  ${topics.map(t => t.id).join(', ')}`);
  console.log(`╚${'═'.repeat(55)}\n`);

  const allResults = [];

  for (const testCase of topics) {
    console.log(`\n▶ Topic: ${testCase.id}  (${testCase.author} voice)`);
    for (const config of configs) {
      process.stdout.write(`  [${config.id}] … `);
      try {
        const result = await generate(anthropic, testCase, config);
        allResults.push(result);

        const costStr  = `$${result.totalCost.toFixed(4)}`;
        const advStr   = result.advisorTokens
          ? ` | adv ${result.advisorTokens.input_tokens}in/${result.advisorTokens.output_tokens}out ($${result.advisorCost.toFixed(4)})`
          : '';
        console.log(`${result.elapsed}s  ${costStr}${advStr}`);
        console.log(`           "${result.title}"`);
      } catch (err) {
        console.log(`ERROR — ${err.message}`);
        allResults.push({ config: config.id, configLabel: config.label, topic: testCase.id, error: err.message });
      }

      await new Promise(r => setTimeout(r, 3000)); // rate-limit buffer
    }
  }

  // ── Save JSON ──────────────────────────────────────────────────────────────

  const stamp      = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
  const jsonPath   = path.join(outDir, `eval-${stamp}.json`);
  const reportPath = path.join(outDir, `eval-${stamp}.txt`);
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));

  // ── Build text report ──────────────────────────────────────────────────────

  const lines = [];
  const hr    = '═'.repeat(70);
  lines.push(hr);
  lines.push('DORMIED Article Config Eval — Part D Results');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(hr);

  for (const testCase of topics) {
    const topicResults = allResults.filter(r => r.topic === testCase.id && !r.error);
    lines.push('');
    lines.push(`── Topic: ${testCase.id}  (${testCase.author} voice) ─────────────────────────`);

    for (const r of topicResults) {
      lines.push('');
      lines.push(`  Config:   ${r.config} — ${r.configLabel}`);
      lines.push(`  Cost:     $${r.totalCost.toFixed(4)} total  (exec: $${r.executorCost.toFixed(4)}, adv: $${r.advisorCost.toFixed(4)})`);
      lines.push(`  Tokens:   input ${r.usage.input_tokens ?? 0}, cache_read ${r.usage.cache_read_input_tokens ?? 0}, cache_creation ${r.usage.cache_creation_input_tokens ?? 0}, output ${r.usage.output_tokens ?? 0}`);
      if (r.advisorTokens) {
        lines.push(`  Advisor:  input ${r.advisorTokens.input_tokens}, output ${r.advisorTokens.output_tokens}`);
      }
      lines.push(`  Time:     ${r.elapsed}s`);
      lines.push(`  Valid JSON: ${r.valid}`);
      lines.push(`  Title:    ${r.title}`);
      lines.push(`  X Post:   ${r.xPost}`);
      lines.push(`  Body (first 400 chars):`);
      (r.body || '').slice(0, 400).split('\n').forEach(l => lines.push(`    ${l}`));
    }

    // Errors
    allResults.filter(r => r.topic === testCase.id && r.error).forEach(r => {
      lines.push('');
      lines.push(`  [${r.config}] ERROR: ${r.error}`);
    });
  }

  // Cost summary table
  lines.push('');
  lines.push(hr);
  lines.push('Cost Summary (average per article across topics)');
  lines.push(hr);
  for (const cfg of configs) {
    const cfgResults = allResults.filter(r => r.config === cfg.id && !r.error);
    if (cfgResults.length === 0) continue;
    const avgTotal    = cfgResults.reduce((s, r) => s + r.totalCost,    0) / cfgResults.length;
    const avgExec     = cfgResults.reduce((s, r) => s + r.executorCost, 0) / cfgResults.length;
    const avgAdv      = cfgResults.reduce((s, r) => s + r.advisorCost,  0) / cfgResults.length;
    const avgOut      = cfgResults.reduce((s, r) => s + (r.usage.output_tokens ?? 0), 0) / cfgResults.length;
    lines.push(`  ${cfg.id.padEnd(20)} avg $${avgTotal.toFixed(4)}/article  (exec $${avgExec.toFixed(4)} + adv $${avgAdv.toFixed(4)})  avg output tokens: ${Math.round(avgOut)}`);
  }

  lines.push('');
  lines.push(hr);
  lines.push('DECISION RULE');
  lines.push(hr);
  lines.push('Adopt b-sonnet+advisor for the live pipeline ONLY if its voice/quality');
  lines.push('matches a-opus-solo closely enough to be indistinguishable in DORMIED');
  lines.push("voice. If advisor config loses the voice, set USE_ADVISOR = false and");
  lines.push("EXECUTOR_MODEL = 'claude-opus-4-7' in generate-article.js.");
  lines.push('');
  lines.push('Key checks:');
  lines.push('  - No em dashes (—) anywhere');
  lines.push('  - Lede: direct, editorial, not press-office language');
  lines.push("  - Voice calibration: dry, specific, no 'exciting news' phrases");
  lines.push('  - Insider fluency: correct references, plausible industry analysis');
  lines.push('  - X post: does NOT start with brand name; works as standalone take');
  lines.push('');
  lines.push(`Full JSON: ${jsonPath}`);

  const reportText = lines.join('\n');
  fs.writeFileSync(reportPath, reportText);

  // Print to console
  console.log('\n\n' + reportText);
  console.log(`\n✓ Report saved: ${reportPath}`);
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => { console.error('[eval] Fatal:', err); process.exit(1); });
}