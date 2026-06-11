#!/usr/bin/env node
/**
 * cleanup-may-explanations.js
 *
 * One-time fix for 6 May 2026 brand_explanations rows that contain
 * search narration leaked by the text-block extraction bug.
 *
 * RULE: keep only the LAST CONTIGUOUS BLOCK of bullet lines.
 * SCOPE: month = '2026-05', rows with any non-bullet non-empty line.
 * SAFETY: UPDATE only. No deletes. No API calls. No other months touched.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Returns true if every non-empty line starts with "• "
function isBulletOnly(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(l => l.startsWith('• '));
}

// Keep only the last contiguous block of bullet lines.
// Walks from the end; blank lines and non-bullet lines both terminate the block,
// so blank-line-separated bullet sets are treated as distinct blocks.
function lastBulletBlock(text) {
  const lines = text.split('\n').map(l => l.trim());
  const block = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('• ')) {
      block.unshift(lines[i]);
    } else {
      break;  // blank line or non-bullet stops the walk
    }
  }
  return block.join('\n');
}

async function main() {
  // Step 1: SELECT all May 2026 rows
  const { data: rows, error: fetchErr } = await sb
    .from('brand_explanations')
    .select('id, brand_name, explanation')
    .eq('month', '2026-05')
    .order('brand_name');

  if (fetchErr) { console.error('Fetch error:', fetchErr.message); process.exit(1); }

  console.log(`\nFound ${rows.length} May 2026 rows total.\n`);

  // Step 2: Identify affected rows (any non-bullet non-empty line)
  const affected = rows.filter(r => !isBulletOnly(r.explanation));
  const clean    = rows.filter(r =>  isBulletOnly(r.explanation));

  console.log(`Clean rows (no action needed): ${clean.length}`);
  console.log(`Affected rows (will be updated): ${affected.length}\n`);

  if (affected.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  // Step 3: Print before/after for review, compute new values
  const updates = [];
  const skipped = [];

  for (const row of affected) {
    const newText = lastBulletBlock(row.explanation);
    if (!newText) {
      console.log(`SKIP (zero bullets found): ${row.brand_name}`);
      skipped.push(row.brand_name);
      continue;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Brand: ${row.brand_name}  (id: ${row.id})`);
    console.log(`\n-- BEFORE --\n${row.explanation}`);
    console.log(`\n-- AFTER --\n${newText}`);

    updates.push({ id: row.id, brand_name: row.brand_name, newText });
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped (zero bullet lines): ${skipped.join(', ')}`);
  }

  if (updates.length === 0) {
    console.log('\nNo valid updates to apply.');
    return;
  }

  // Step 4: Apply UPDATEs
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Applying ${updates.length} UPDATE(s)...\n`);

  let successCount = 0;
  for (const u of updates) {
    const { error } = await sb
      .from('brand_explanations')
      .update({ explanation: u.newText })
      .eq('id', u.id);

    if (error) {
      console.error(`  ERROR updating ${u.brand_name}: ${error.message}`);
    } else {
      console.log(`  UPDATED ${u.brand_name}`);
      successCount++;
    }
  }

  // Step 5: Verify — re-fetch all May rows and confirm all are bullet-only
  console.log(`\nVerifying all May 2026 rows...\n`);

  const { data: verify, error: verifyErr } = await sb
    .from('brand_explanations')
    .select('id, brand_name, explanation')
    .eq('month', '2026-05')
    .order('brand_name');

  if (verifyErr) { console.error('Verify fetch error:', verifyErr.message); return; }

  let failures = 0;
  for (const r of verify) {
    if (!isBulletOnly(r.explanation)) {
      console.log(`  STILL DIRTY: ${r.brand_name}`);
      console.log(`  >> ${r.explanation.slice(0, 120)}`);
      failures++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total May rows:     ${verify.length}`);
  console.log(`Updated:            ${successCount}`);
  console.log(`Skipped (no bullets): ${skipped.length}`);
  console.log(`Still dirty:        ${failures}`);
  if (failures === 0) {
    console.log(`\nAll May 2026 rows are now bullet-only.`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
