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
 *
 * IMAGE GATE
 * An article also has to have a usable hero image. Two shipped with a brand
 * logo where the photo should be, 72x72 and 123x53, which the feed then
 * upscaled about 4.5x into a 328x185 thumbnail. They did not look like thin
 * content, they looked broken.
 *
 * Held articles are NOT lost and nothing is deleted: the row stays
 * status='draft', so it is absent from the feed, the sitemap and IndexNow
 * (every generator filters on status='published'). Attach a real image and the
 * next pipeline run publishes it normally.
 *
 * The floors are deliberately low. They are asking "is this a photograph or is
 * it an icon", not "is this sharp everywhere". Measured against the 610
 * published articles, 400px holds the bottom 9% and every logo-sized case;
 * requiring 660 (the width the trio thumbnail actually needs at 2x) would hold
 * 28% of a normal month, which is a different decision and the user's to make.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { submitUrls } = require('../lib/indexnow');

const fs            = require('fs');
const path          = require('path');
const { spawnSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const SITE_ROOT = path.resolve(__dirname, '..');

/* Minimum usable hero. Overridable so the bar can be raised without a deploy,
   but never silently disabled: a non-numeric or negative value is ignored. */
function envFloor(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}
const MIN_IMAGE_WIDTH  = envFloor('PUBLISH_MIN_IMAGE_WIDTH', 400);
const MIN_IMAGE_HEIGHT = envFloor('PUBLISH_MIN_IMAGE_HEIGHT', 200);

/**
 * Why this article may not go live, or null if it may.
 *
 * Unmeasured counts as unusable. Dimensions are recorded at ingest, so a null
 * means the image could not be read, and an image that cannot be read is not
 * one to put in a 328px box sight unseen. Only 1 of 610 published articles is
 * unmeasured, so this holds almost nothing in practice, and a hold is
 * reversible where a bad publish is already in someone's feed.
 */
function imageBlocker(article) {
  if (!article.image_url) return 'no image';
  const w = article.image_width;
  const h = article.image_height;
  if (w == null || h == null) return 'image dimensions unknown';
  if (w < MIN_IMAGE_WIDTH || h < MIN_IMAGE_HEIGHT) {
    return `image ${w}x${h} is below the ${MIN_IMAGE_WIDTH}x${MIN_IMAGE_HEIGHT} floor`;
  }
  return null;
}

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
    .select('id, slug, title, image_url, image_width, image_height')
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
  const heldForImage  = [];

  for (const article of drafts) {
    // Image first: it is the cheapest check and the one that keeps a visibly
    // broken card out of the feed.
    const blocker = imageBlocker(article);
    if (blocker) {
      console.warn(`[publish] HOLDING "${article.title}" — ${blocker}. Stays draft; attach a real image and it publishes on the next run.`);
      heldForImage.push(`${article.slug} (${blocker})`);
      skipped++;
      continue;
    }

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

  if (heldForImage.length) {
    console.warn(`[publish] ${heldForImage.length} article(s) held for image quality:`);
    for (const h of heldForImage) console.warn(`[publish]   - ${h}`);
    // Loud, because "every draft was held" means the measuring step broke, not
    // that a whole batch happened to have bad art. Not fatal: the articles that
    // did pass are already live and still need their IndexNow ping.
    if (published === 0 && heldForImage.length === drafts.length) {
      console.warn('[publish] !! EVERY draft was held on the image gate. Check that image dimensions are being recorded at ingest.');
    }
  }

  // Notify IndexNow for every freshly published article URL
  if (publishedUrls.length > 0) {
    await submitUrls(publishedUrls);
  }
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => {
    console.error('[publish] Fatal error:', err.message);
    process.exit(1);
  });
}