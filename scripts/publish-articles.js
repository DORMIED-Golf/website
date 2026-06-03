#!/usr/bin/env node
/**
 * scripts/publish-articles.js
 *
 * Promotes dormied_articles rows from status='draft' to status='published',
 * but ONLY for articles whose HTML file is confirmed committed in git.
 *
 * Called by the GitHub Actions pipeline immediately after a successful
 * `git push` — this guarantees no article appears in the feed or can
 * be tweeted before its page is live on Vercel.
 *
 * Safe to run locally; it will only promote articles whose index.html
 * appears in `git ls-files` (i.e. committed to the repo).
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { submitUrls } = require('../lib/indexnow');

const fs            = require('fs');
const path          = require('path');
const { spawnSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const SITE_ROOT = path.resolve(__dirname, '..');

/* Returns true if filePath is tracked in the current git HEAD */
function isCommittedToGit(filePath) {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', filePath], {
    cwd:   SITE_ROOT,
    stdio: 'pipe',
  });
  return result.status === 0;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('[publish] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const { data: drafts, error } = await supabase
    .from('dormied_articles')
    .select('id, slug, title')
    .eq('status', 'draft');

  if (error) {
    console.error('[publish] Failed to fetch draft articles:', error.message);
    process.exit(1);
  }

  if (!drafts || drafts.length === 0) {
    console.log('[publish] No draft articles — nothing to publish.');
    return;
  }

  console.log(`[publish] ${drafts.length} draft article(s) found.`);

  let published       = 0;
  let skipped         = 0;
  const publishedUrls = [];

  for (const article of drafts) {
    const relPath = path.join('news', article.slug, 'index.html');
    const absPath = path.join(SITE_ROOT, relPath);

    // Must exist on disk
    if (!fs.existsSync(absPath)) {
      console.warn(`[publish] Skipping "${article.title}" — HTML not on disk`);
      skipped++;
      continue;
    }

    // Must be committed to git (not just written to disk during this run)
    if (!isCommittedToGit(relPath)) {
      console.warn(`[publish] Skipping "${article.title}" — HTML not committed to git`);
      skipped++;
      continue;
    }

    const { error: updateErr } = await supabase
      .from('dormied_articles')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', article.id);

    if (updateErr) {
      console.error(`[publish] Failed to publish "${article.title}":`, updateErr.message);
      skipped++;
    } else {
      console.log(`[publish] ✓ Published: "${article.title}"`);
      publishedUrls.push(`https://dormied.com/news/${article.slug}/`);
      published++;
    }
  }

  console.log(`[publish] Done — published: ${published}, skipped: ${skipped}`);

  // Notify IndexNow for every freshly published article URL
  if (publishedUrls.length > 0) {
    await submitUrls(publishedUrls);
  }
}

main().catch(err => {
  console.error('[publish] Fatal error:', err.message);
  process.exit(1);
});
