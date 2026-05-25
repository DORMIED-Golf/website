#!/usr/bin/env node
/**
 * check-cache-tokens.js
 *
 * Verifies that the generate-article.js system prompts (Adam voice + base,
 * Travis voice + base) are above the Sonnet 4.6 prompt-caching floor of
 * 2,048 tokens, using the Anthropic count_tokens HTTP endpoint.
 *
 * Also checks generate-explanations.js and expand-descriptions.js system
 * prompts and confirms they are below the floor (expected no-ops).
 *
 * Run from the dormied_website directory:
 *   node scripts/check-cache-tokens.js
 *
 * Requires: ANTHROPIC_API_KEY in environment (shell or .env)
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY — run with the key in your shell environment.');
  process.exit(1);
}

const SONNET_CACHE_FLOOR = 2048;  // Sonnet 4.6 minimum tokens for caching
const OPUS_CACHE_FLOOR   = 4096;  // Opus 4.7 minimum tokens for caching

// ── Token count via raw HTTP (SDK 0.27.3 lacks countTokens) ──────────────────

async function countTokens(model, system) {
  const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method:  'POST',
    headers: {
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model,
      system,
      messages: [{ role: 'user', content: 'x' }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`count_tokens HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.input_tokens;  // includes the 'x' user message (~1 token)
}

// ── Extract template literal constants from a source file ─────────────────────

function extractTemplateConst(src, name) {
  const marker = 'const ' + name + ' = `';
  const start  = src.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '`')  break;
    i++;
  }
  return src.slice(start + marker.length, i);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const articleSrc = fs.readFileSync(
    path.join(__dirname, 'generate-article.js'), 'utf8'
  );
  const explanationsSrc = fs.readFileSync(
    path.join(__dirname, 'generate-explanations.js'), 'utf8'
  );
  const descriptionsSrc = fs.readFileSync(
    path.join(__dirname, 'expand-descriptions.js'), 'utf8'
  );

  // ── generate-article.js prompts ──────────────────────────────────────────

  const BASE  = extractTemplateConst(articleSrc, 'SYSTEM_PROMPT_BASE');
  const ADAM  = extractTemplateConst(articleSrc, 'ADAM_VOICE_BLOCK');
  const TRAV  = extractTemplateConst(articleSrc, 'TRAVIS_VOICE_BLOCK');

  if (!BASE || !ADAM || !TRAV) {
    console.error('Failed to extract prompt constants from generate-article.js');
    process.exit(1);
  }

  const adamFull   = [ADAM, BASE].join('\n\n');
  const travisFull = [TRAV, BASE].join('\n\n');

  // ── generate-explanations.js system prompt ───────────────────────────────
  // The system prompt is built as a string literal in generateExplanation().
  // Extract the `systemPrompt` variable assignment via regex.
  const explMatch = explanationsSrc.match(
    /const systemPrompt\s*=\s*(['"`])([\s\S]*?)\1\s*;/
  ) || explanationsSrc.match(
    /const systemPrompt\s*=[\s\S]{0,20}?'([^']+(?:\n[^']+)*)'/
  );
  // Simpler: extract the long string-concatenation block
  const explSrc = explanationsSrc;
  const explStart = explSrc.indexOf("'You are the Explanation Agent");
  const explEnd   = explSrc.indexOf("// Edit 2:", explStart);
  const explPrompt = explStart > -1 && explEnd > -1
    ? explSrc.slice(explStart, explEnd).replace(/'\s*\+\s*'/g, '').replace(/^'|'$/g, '').replace(/\\n/g, '\n').replace(/\\'/g, "'")
    : '(could not extract)';

  // ── expand-descriptions.js system prompt ────────────────────────────────
  const descStart = descriptionsSrc.indexOf('`You are a golf industry analyst');
  const descEnd   = descriptionsSrc.indexOf('`', descStart + 1);
  const descPrompt = descStart > -1 && descEnd > -1
    ? descriptionsSrc.slice(descStart + 1, descEnd)
    : '(could not extract)';

  // ── Count tokens ─────────────────────────────────────────────────────────

  console.log('\n╔═ DORMIED Prompt Cache Token Check');
  console.log(`║  Sonnet 4.6 cache floor: ${SONNET_CACHE_FLOOR} tokens`);
  console.log(`║  Opus 4.7   cache floor: ${OPUS_CACHE_FLOOR} tokens`);
  console.log(`╚${'═'.repeat(50)}\n`);

  const MODEL_SONNET = 'claude-sonnet-4-6';

  const checks = [
    {
      label:    'generate-article.js — Adam voice + base (Sonnet executor)',
      system:   adamFull,
      floor:    SONNET_CACHE_FLOOR,
      expectHit: true,
    },
    {
      label:    'generate-article.js — Travis voice + base (Sonnet executor)',
      system:   travisFull,
      floor:    SONNET_CACHE_FLOOR,
      expectHit: true,
    },
    {
      label:    'generate-article.js — Adam voice + base (Opus solo fallback)',
      system:   adamFull,
      floor:    OPUS_CACHE_FLOOR,
      expectHit: false,
      note:     'Opus solo (USE_ADVISOR=false) will NOT cache system prompt — below 4096 floor',
    },
    {
      label:    'generate-explanations.js — system prompt (~500 tokens)',
      system:   explPrompt,
      floor:    SONNET_CACHE_FLOOR,
      expectHit: false,
      note:     'Expected no-op — system prompt below 2048-token cache floor',
    },
    {
      label:    'expand-descriptions.js — system prompt (~300 tokens)',
      system:   descPrompt,
      floor:    SONNET_CACHE_FLOOR,
      expectHit: false,
      note:     'Expected no-op — system prompt below 2048-token cache floor',
    },
  ];

  for (const check of checks) {
    process.stdout.write(`  Checking: ${check.label} … `);
    try {
      const tokens  = await countTokens(MODEL_SONNET, check.system);
      const sysOnly = tokens - 1;  // subtract the dummy 'x' user message
      const above   = sysOnly >= check.floor;
      const match   = above === check.expectHit;
      const status  = match ? (above ? '✓ CACHES' : '✓ no-op (expected)') : (above ? '✓ CACHES (bonus)' : '✗ BELOW FLOOR — fix needed');

      console.log(`${sysOnly} tokens   ${status}`);
      console.log(`           floor: ${check.floor}   margin: ${sysOnly - check.floor > 0 ? '+' : ''}${sysOnly - check.floor}`);
      if (check.note) console.log(`           note: ${check.note}`);
    } catch (err) {
      console.log(`ERROR — ${err.message.slice(0, 100)}`);
    }
    console.log('');
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('Done. Re-run whenever system prompts are edited.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
