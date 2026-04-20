'use strict';

/**
 * api/post-to-x.js — Cron-triggered serverless function
 *
 * Queries Supabase for published DORMIED articles that haven't been posted
 * to X yet and posts them. Called every 30 minutes by Vercel Cron.
 *
 * Protected by CRON_SECRET env var (set in Vercel project settings).
 * Articles must be at least 30 minutes old before posting (preview window).
 *
 * Images are uploaded directly via the X v1.1 media upload API so they
 * always appear inline on X — not relying on Twitter Card scraping.
 *
 * Note: x-client and validate-x-post logic is inlined here so Vercel's
 * file tracer can bundle this single file without needing ../lib/ resolution.
 */

const { createClient } = require('@supabase/supabase-js');
const { TwitterApi }   = require('twitter-api-v2');

const POST_DELAY_MS     = 5000;  // 5 s between posts if multiple are queued
const MIN_AGE_MINUTES   = 30;    // Wait this long after publish before posting
const MAX_POSTS_PER_CALL = 5;    // Never post more than this per cron invocation
const SITE_BASE_URL     = 'https://dormied.com';

// ---------------------------------------------------------------------------
// Inlined: lib/x-client.js
// ---------------------------------------------------------------------------

function getXClient() {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    throw new Error('[x-client] Missing one or more X API credentials in environment variables');
  }
  return new TwitterApi({
    appKey:       X_API_KEY,
    appSecret:    X_API_SECRET,
    accessToken:  X_ACCESS_TOKEN,
    accessSecret: X_ACCESS_TOKEN_SECRET,
  });
}

// ---------------------------------------------------------------------------
// Page-live check — verify the article HTML is deployed before tweeting
// ---------------------------------------------------------------------------

async function isArticleLive(slug) {
  const url = `${SITE_BASE_URL}/news/${slug}/`;
  try {
    const res = await fetch(url, {
      method:  'HEAD',
      signal:  AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'DORMIED-Bot/1.0' },
      redirect: 'follow',
    });
    if (res.ok) return true;
    console.warn(`[post-to-x] Page not live for "${slug}": HTTP ${res.status}`);
    return false;
  } catch (err) {
    console.warn(`[post-to-x] Page-live check failed for "${slug}": ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Image fetching — tries Vercel CDN first, then Supabase URL fallback
// ---------------------------------------------------------------------------

async function fetchImageBuffer(slug, imageUrl) {
  // 1. Try the locally-committed hero image served via Vercel CDN
  //    (committed to images/articles/ by the GitHub Actions pipeline)
  const exts = ['jpg', 'png', 'webp'];
  for (const ext of exts) {
    const cdnUrl = `https://dormied.com/images/articles/${slug}-hero.${ext}`;
    try {
      const res = await fetch(cdnUrl, {
        signal:  AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'DORMIED-Bot/1.0' },
      });
      if (res.ok) {
        const buffer   = Buffer.from(await res.arrayBuffer());
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        console.log(`[post-to-x] Image fetched from CDN: ${cdnUrl}`);
        return { buffer, mimeType };
      }
    } catch { /* try next extension */ }
  }

  // 2. Fallback: try image_url stored in Supabase (original source or Supabase storage)
  if (imageUrl) {
    try {
      const res = await fetch(imageUrl, {
        signal:  AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'DORMIED-Bot/1.0' },
      });
      if (res.ok) {
        const buffer   = Buffer.from(await res.arrayBuffer());
        const ct       = res.headers.get('content-type') || 'image/jpeg';
        const mimeType = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : 'image/jpeg';
        console.log(`[post-to-x] Image fetched from Supabase URL: ${imageUrl}`);
        return { buffer, mimeType };
      }
    } catch (err) {
      console.warn(`[post-to-x] Image fallback fetch failed: ${err.message}`);
    }
  }

  console.warn(`[post-to-x] No image available for slug: ${slug}`);
  return null;
}

// ---------------------------------------------------------------------------
// Tweet posting — with direct media upload when image is available
// ---------------------------------------------------------------------------

async function postTweet(text, imageBuffer, mimeType) {
  const client = getXClient();

  if (imageBuffer) {
    try {
      const mediaId    = await client.v1.uploadMedia(imageBuffer, { mimeType });
      const { data }   = await client.v2.tweet({ text, media: { media_ids: [mediaId] } });
      console.log(`[post-to-x] Posted with image (media_id: ${mediaId})`);
      return data; // { id: '...', text: '...' }
    } catch (imgErr) {
      // If image upload fails (e.g. size limit, format issue) fall back to text-only
      console.warn(`[post-to-x] Image upload failed — falling back to text-only: ${imgErr.message}`);
    }
  }

  const { data } = await client.v2.tweet(text);
  return data;
}

// ---------------------------------------------------------------------------
// Inlined: lib/validate-x-post.js
// ---------------------------------------------------------------------------

const DISALLOWED_PHRASES = [
  'check out',
  'read more',
  'new article',
  'we wrote about',
  'link in bio',
  'my search',
  'search results',
  'the index shows',
  'the data suggests',
  'according to the dormied index',
  'exciting',
  'thrilled',
  'proud to announce',
];

function assembleFinalPost(copy, slug) {
  return `${copy}\n\ndormied.com/news/${slug}`;
}

function fitCopy(copy, slug) {
  const suffix  = `\n\ndormied.com/news/${slug}`;
  const maxCopy = 280 - suffix.length;
  if (copy.length <= maxCopy) return copy;
  const truncated = copy.slice(0, maxCopy).replace(/\s\S*$/, '');
  console.warn(`[validate-x-post] Truncated copy from ${copy.length} → ${truncated.length} chars`);
  return truncated;
}

function validateXPost(postText, article) {
  const { slug, brand_slug, x_posted_at } = article;

  // 1. Duplicate check (defensive — query already filters by x_posted_at IS NULL)
  if (x_posted_at) {
    return { valid: false, reason: `Already posted at ${x_posted_at}` };
  }

  // 2. Non-empty
  const copy = (postText || '').trim();
  if (!copy) {
    return { valid: false, reason: 'Post text is empty' };
  }

  // 3. Disallowed phrase check (case-insensitive)
  const lower = copy.toLowerCase();
  for (const phrase of DISALLOWED_PHRASES) {
    if (lower.includes(phrase)) {
      return { valid: false, reason: `Contains disallowed phrase: "${phrase}"` };
    }
  }

  // 4. First-word check — reject if first word matches brand name
  if (brand_slug) {
    const brandWords  = brand_slug.replace(/-/g, ' ').toLowerCase().split(' ');
    const firstWord   = lower.split(/\W+/)[0];
    const brandJoined = brand_slug.replace(/-/g, '').toLowerCase();
    if (brandWords.includes(firstWord) || firstWord === brandJoined) {
      return { valid: false, reason: `Post starts with brand name ("${firstWord}")` };
    }
  }

  // 5. Length — fit within 280 chars
  const fittedCopy = fitCopy(copy, slug);
  const finalPost  = assembleFinalPost(fittedCopy, slug);

  if (finalPost.length > 280) {
    return { valid: false, reason: `Post too long after truncation (${finalPost.length} chars)` };
  }

  return { valid: true, text: finalPost };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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
  // Cap at MAX_POSTS_PER_CALL so we never dump an entire backlog in one cron run
  const { data: articles, error: queryErr } = await supabase
    .from('dormied_articles')
    .select('id, slug, title, brand_slug, x_post_text, x_posted_at, image_url')
    .eq('status', 'published')
    .is('x_posted_at', null)
    .lte('published_at', cutoff)
    .order('published_at', { ascending: true })
    .limit(MAX_POSTS_PER_CALL);

  if (queryErr) {
    console.error('[post-to-x] Supabase query error:', queryErr.message);
    return res.status(500).json({ error: 'Database error' });
  }

  if (!articles || articles.length === 0) {
    console.log('[post-to-x] No eligible articles to post');
    return res.status(200).json({ posted: 0, skipped: 0, errors: 0, message: 'Nothing to post' });
  }

  console.log(`[post-to-x] ${articles.length} article(s) eligible (max ${MAX_POSTS_PER_CALL}/run)`);
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

    // Safety check: confirm the article HTML page is actually live before tweeting.
    // If the GitHub Actions push failed the HTML won't be deployed yet — skip for now
    // and the next cron run will retry once the page is live.
    const live = await isArticleLive(article.slug);
    if (!live) {
      console.warn(`[post-to-x] Skipped "${article.title}": page not yet live at /news/${article.slug}/`);
      results.skipped++;
      continue;
    }

    // Fetch image for direct upload (guarantees it appears on X, not just Twitter Card)
    const imgResult = await fetchImageBuffer(article.slug, article.image_url);

    // Post to X
    try {
      const tweet = await postTweet(
        validation.text,
        imgResult?.buffer  || null,
        imgResult?.mimeType || null,
      );
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
