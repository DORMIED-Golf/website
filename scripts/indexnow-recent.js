#!/usr/bin/env node
/**
 * scripts/indexnow-recent.js
 *
 * One-time seed: submits articles published or updated within the last 7 days.
 *
 * Per IndexNow guidance, do NOT bulk-submit the historical catalog.
 * This script is intentionally narrow — only recent changes.
 *
 * Usage:
 *   node scripts/indexnow-recent.js              # 7-day window (default)
 *   node scripts/indexnow-recent.js --days=3     # custom window
 *
 * Reads from Supabase; mutates nothing.
 * Requires .env with SUPABASE_URL, SUPABASE_SERVICE_KEY, INDEXNOW_KEY.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');
const { submitUrls }   = require('../lib/indexnow');

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  // Parse --days flag
  const daysArg = process.argv.find(a => a.startsWith('--days='));
  const days    = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;
  if (isNaN(days) || days < 1) throw new Error('--days must be a positive integer');

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  console.log(`[indexnow-recent] Querying articles published or updated since ${since} (${days} days)`);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: articles, error } = await sb
    .from('dormied_articles')
    .select('slug, published_at, updated_at')
    .eq('status', 'published')
    .or(`published_at.gte.${since},updated_at.gte.${since}`)
    .order('published_at', { ascending: false });

  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  if (!articles || articles.length === 0) {
    console.log('[indexnow-recent] No articles found in window — nothing to submit');
    return;
  }

  const urls = articles.map(a => `https://dormied.com/news/${a.slug}/`);
  console.log(`[indexnow-recent] Submitting ${urls.length} URL(s):`);
  urls.forEach(u => console.log(`  ${u}`));

  await submitUrls(urls);
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => {
    console.error('[indexnow-recent] Fatal:', err.message);
    process.exit(1);
  });
}