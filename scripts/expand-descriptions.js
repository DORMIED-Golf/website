#!/usr/bin/env node
/**
 * expand-descriptions.js
 * Expands short brand descriptions in js/data.js to 200-400 words using Claude.
 * Processes brands in batches of 12 with 30-second delays between batches.
 *
 * Usage: node scripts/expand-descriptions.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const _env = require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// dotenv v17 doesn't auto-assign to process.env — do it manually
if (_env.parsed) Object.assign(process.env, _env.parsed);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

const DATA_JS   = path.join(__dirname, '..', 'js', 'data.js');
const STATE_FILE = path.join(__dirname, '..', '.expand-descriptions-state.json');
const BATCH_SIZE = 12;
const BATCH_DELAY_MS = 30_000; // 30 seconds between batches

// ── Load data.js and extract brands array ──────────────────────────────────────
function loadBrands() {
  const content = fs.readFileSync(DATA_JS, 'utf8');
  // Use Function constructor to safely evaluate window.DORMIED_DATA
  const fn = new Function('window', content + '; return window.DORMIED_DATA;');
  const data = fn({ DORMIED_DATA: null });
  return data;
}

// ── Write updated descriptions back to data.js ────────────────────────────────
function saveDescriptions(descMap) {
  let content = fs.readFileSync(DATA_JS, 'utf8');

  for (const [id, newDesc] of Object.entries(descMap)) {
    // Match:  description: "...",
    // We'll do a targeted replacement by looking for the brand id context
    // Strategy: find the brand block via its id, then replace the description field
    // This is safe because brand ids are unique slugs
    const escaped = newDesc.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

    // Pattern: look for   id: "brand-id",  ...  description: "OLD",
    // We'll use a simple line-by-line replacement approach
    // Find the description line that appears after the brand id
    const idPattern = new RegExp(
      '(id:\\s*"' + escapeRegex(id) + '"[\\s\\S]*?description:\\s*")([^"]*(?:\\\\"[^"]*)*?)(")',
      'g'
    );
    const before = content;
    content = content.replace(idPattern, (match, pre, _old, post) => {
      return pre + escaped + post;
    });
    if (content === before) {
      console.warn(`  ⚠️  Could not replace description for brand: ${id}`);
    }
  }

  fs.writeFileSync(DATA_JS, content, 'utf8');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Claude API call ────────────────────────────────────────────────────────────
async function callClaude(brands) {
  const prompt = brands.map(b => {
    const meta = [
      b.headquarters ? `Headquarters: ${b.headquarters}` : null,
      b.founded ? `Founded: ${b.founded}` : null,
      b.parentCompany && b.parentCompany !== 'Independent' ? `Parent: ${b.parentCompany}` : null,
      b.subCategories?.length ? `Sub-category: ${b.subCategories.join(', ')}` : null,
    ].filter(Boolean).join(' | ');

    return `BRAND: ${b.name}
CATEGORY: ${b.category}
${meta}
CURRENT SHORT DESCRIPTION: ${b.description}`;
  }).join('\n\n---\n\n');

  const systemPrompt = `You are a golf industry analyst and writer for DORMIED, an independent golf brand intelligence publication. Your job is to write authoritative, editorial brand descriptions for the DORMIED Brand Index.

For each brand provided, write a 200-400 word description that covers:
1. What the brand makes and what it's known for in golf
2. Its founding story, history, or origin (if notable)
3. Key products, innovations, or signature items
4. Its market positioning, reputation among golfers, and target audience
5. Any notable industry context: tour presence, collaborations, recent moves, or controversies

Tone: editorial and confident, like Bloomberg or Business of Fashion covering golf. Avoid marketing speak. Be specific — name actual products, real partnerships, or documented facts when possible.

Format your response as a JSON array, where each element is an object with "id" (the brand ID as I'll provide) and "description" (the expanded text). Output ONLY the JSON array, no other text.`;

  const userMsg = `Expand descriptions for these ${brands.length} brands. Use their original short descriptions as a starting point but expand significantly to 200-400 words each.\n\n${prompt}\n\nBrand IDs (in order): ${brands.map(b => b.id).join(', ')}\n\nReturn a JSON array: [{"id":"...","description":"..."}, ...]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  // Parse JSON — handle potential markdown code fences
  let jsonText = text;
  const fence = text.match(/```(?:json)?\n?([\s\S]*?)```/);
  if (fence) jsonText = fence[1];

  const parsed = JSON.parse(jsonText);
  return parsed; // [{id, description}, ...]
}

// ── State management for resumability ─────────────────────────────────────────
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return { completed: [] };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const dormiedData = loadBrands();
  const allBrands   = dormiedData.brands;
  const state       = loadState();

  const pending = allBrands.filter(b => !state.completed.includes(b.id));
  console.log(`Total brands: ${allBrands.length}`);
  console.log(`Already completed: ${state.completed.length}`);
  console.log(`Pending: ${pending.length}`);

  if (pending.length === 0) {
    console.log('All brands already processed!');
    fs.unlinkSync(STATE_FILE);
    return;
  }

  // Process in batches
  const batches = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    batches.push(pending.slice(i, i + BATCH_SIZE));
  }

  console.log(`Processing ${batches.length} batches of up to ${BATCH_SIZE} brands each\n`);

  const descMap = {};

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    console.log(`\n[Batch ${bi + 1}/${batches.length}] Processing: ${batch.map(b => b.name).join(', ')}`);

    let attempts = 0;
    while (attempts < 3) {
      try {
        const results = await callClaude(batch);
        for (const r of results) {
          if (r.id && r.description) {
            descMap[r.id] = r.description;
            state.completed.push(r.id);
            console.log(`  ✓ ${r.id} — ${r.description.split(' ').length} words`);
          }
        }

        // Save progress after each successful batch
        saveState(state);
        saveDescriptions(descMap);
        console.log(`  ✅ Batch ${bi + 1} saved to data.js`);
        break;

      } catch (err) {
        attempts++;
        console.error(`  ❌ Batch ${bi + 1} attempt ${attempts} failed: ${err.message}`);
        if (attempts < 3) {
          console.log(`  ↻ Retrying in 15 seconds…`);
          await sleep(15_000);
        }
      }
    }

    // Delay between batches (except after the last one)
    if (bi < batches.length - 1) {
      console.log(`\n⏳ Waiting ${BATCH_DELAY_MS / 1000}s before next batch…`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log('\n✅ All batches complete!');
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
