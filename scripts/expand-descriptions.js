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

// ── Write updated descriptions back to data.js via Python (safe for any content) ──
function saveDescriptions(descMap) {
  const { execFileSync } = require('child_process');

  // Build a JSON payload: {id: newDesc, ...}
  const payload = JSON.stringify(descMap);

  // Use Python to do safe JS-string-aware replacements
  const pyScript = `
import sys, json, re

data_js = sys.argv[1]
desc_map = json.loads(sys.argv[2])

with open(data_js, 'r', encoding='utf-8') as f:
    content = f.read()

def parse_js_string_end(s, start):
    """Walk past the content of a JS string starting at 'start' (after opening quote).
    Returns the index of the closing (unescaped) quote."""
    i = start
    while i < len(s):
        c = s[i]
        if c == '\\\\' and i + 1 < len(s):
            i += 2
        elif c == '"':
            return i
        else:
            i += 1
    return len(s)

fixed = 0
for brand_id, new_desc in desc_map.items():
    # Find the brand's id field
    id_marker = 'id: "' + brand_id + '"'
    brand_pos = content.find(id_marker)
    if brand_pos == -1:
        print(f"  WARN: brand not found: {brand_id}", file=sys.stderr)
        continue

    # Find description: " after this brand
    desc_marker = 'description: "'
    desc_pos = content.find(desc_marker, brand_pos)
    if desc_pos == -1:
        print(f"  WARN: description not found for: {brand_id}", file=sys.stderr)
        continue

    desc_value_start = desc_pos + len(desc_marker)
    closing_q = parse_js_string_end(content, desc_value_start)

    # Escape the new description for JS string literal
    escaped = (new_desc
        .replace('\\\\', '\\\\\\\\')
        .replace('"', '\\\\"')
        .replace('\\n', '\\\\n'))

    # Replace: keep everything up to and including 'description: "',
    # insert new desc, then closing " and whatever follows (should be ,)
    content = content[:desc_value_start] + escaped + content[closing_q:]
    fixed += 1

print(f"  Saved {fixed}/{len(desc_map)} descriptions", file=sys.stderr)

with open(data_js, 'w', encoding='utf-8') as f:
    f.write(content)
`;

  try {
    execFileSync('python3', ['-c', pyScript, DATA_JS, payload], {
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    const stderr = err.stderr || '';
    stderr.split('\n').filter(Boolean).forEach(l => process.stderr.write(l + '\n'));
    throw new Error('saveDescriptions python3 failed: ' + err.message);
  }
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

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    console.log(`\n[Batch ${bi + 1}/${batches.length}] Processing: ${batch.map(b => b.name).join(', ')}`);

    let attempts = 0;
    while (attempts < 3) {
      try {
        const results = await callClaude(batch);
        // Only save THIS batch's descriptions (not accumulated)
        const batchDescMap = {};
        for (const r of results) {
          if (r.id && r.description) {
            batchDescMap[r.id] = r.description;
            state.completed.push(r.id);
            console.log(`  ✓ ${r.id} — ${r.description.split(' ').length} words`);
          }
        }

        // Save progress after each successful batch
        saveState(state);
        saveDescriptions(batchDescMap);
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
