'use strict';

/**
 * api/post-to-x.js — Cron-triggered serverless function
 *
 * Queries Supabase for published DORMIED articles that haven't been posted
 * to X yet and posts them. Called every 30 minutes by Vercel Cron.
 *
 * Protected by CRON_SECRET env var (set in Vercel project settings).
 * Articles must be at least 30 minutes old before posting (preview window).
 */

const { createClient } = require('@supabase/supabase-js');
const { postTweet }     = require('../lib/x-client');
const { validateXPost } = require('../lib/validate-x-post');

const POST_DELAY_MS      = 5000;  // 5 s between posts if multiple are queued
const MIN_AGE_MINUTES    = 30;    // Wait this long after publish before posting

module.exports = async (req, res) => {
  // Only allow GET (Vercel Cron) and POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron / caller secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      console.warn('[post-to-x] Unauthorized request — bad or missing CRON_SECRET');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  let supabase;
  try {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    );
  } catch (err) {
    console.error('[post-to-x] Failed to init Supabase client:', err.message);
    return res.status(500).json({ error: 'Database init failed' });
  }

  // Cutoff: articles published more than MIN_AGE_MINUTES ago
  const cutoff = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000).toISOString();

  // Fetch eligible articles: published, not yet posted, old enough
  const { data: articles, error: queryErr } = await supabase
    .from('dormied_articles')
    .select('id, slug, title, brand_slug, x_post_text, x_post_id')
    .eq('status', 'published')
    .is('x_post_id', null)
    .lte('published_at', cutoff)
    .order('published_at', { ascending: true });

  if (queryErr) {
    console.error('[post-to-x] Supabase query error:', queryErr.message);
    return res.status(500).json({ error: 'Database error' });
  }

  if (!articles || articles.length === 0) {
    console.log('[post-to-x] No eligible articles to post');
    return res.status(200).json({ posted: 0, skipped: 0, errors: 0, message: 'Nothing to post' });
  }

  console.log(`[post-to-x] ${articles.length} article(s) eligible`);
  const results = { posted: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];

    // Use generated x_post_text or fall back to article title
    const copySource    = (article.x_post_text || '').trim() || article.title;
    const usingFallback = !(article.x_post_text || '').trim();

    if (usingFallback) {
      console.log(`[post-to-x] No x_post_text for "${article.title}" — using title as fallback`);
    }

    // Validate
    const validation = validateXPost(copySource, article);
    if (!validation.valid) {
      console.warn(`[post-to-x] Skipped "${article.title}": ${validation.reason}`);
      results.skipped++;
      continue;
    }

    // Post to X
    try {
      const tweet = await postTweet(validation.text);
      console.log(`[post-to-x] ✓ Posted: "${article.title}" → X post ID ${tweet.id}`);

      // Record the result in Supabase
      const { error: updateErr } = await supabase
        .from('dormied_articles')
        .update({
          x_post_id:   tweet.id,
          x_posted_at: new Date().toISOString(),
        })
        .eq('id', article.id);

      if (updateErr) {
        console.error(`[post-to-x] Failed to update row for ${article.id}:`, updateErr.message);
      }

      results.posted++;

    } catch (err) {
      // twitter-api-v2 exposes HTTP status on err.code
      const status = err.code || err.statusCode || 0;

      if (status === 429 || err.rateLimitError) {
        console.warn('[post-to-x] Rate limited by X API. Will retry on next cron run.');
        break; // Stop this run; next cron will retry remaining articles

      } else if (status === 403) {
        console.error('[post-to-x] CRITICAL: X API auth/permissions error — check X_API_KEY, X_ACCESS_TOKEN, and Read+Write permissions.');
        console.error('[post-to-x] Post text was:', validation.text);
        results.errors++;
        break; // Do not retry auth failures

      } else if (status === 400) {
        console.error(`[post-to-x] Bad request for article ${article.id}. Post text: "${validation.text}"`);
        results.errors++;
        // Continue to next article

      } else {
        console.error(`[post-to-x] Error posting article ${article.id} (HTTP ${status}):`, err.message);
        results.errors++;
        // Continue to next article
      }
    }

    // Delay between posts to avoid rate issues when multiple are queued
    if (i < articles.length - 1) {
      await new Promise(r => setTimeout(r, POST_DELAY_MS));
    }
  }

  console.log(`[post-to-x] Done — posted: ${results.posted}, skipped: ${results.skipped}, errors: ${results.errors}`);
  return res.status(200).json(results);
};
