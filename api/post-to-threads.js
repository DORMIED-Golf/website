'use strict';

/**
 * api/post-to-threads.js — Cron-triggered serverless function
 *
 * Queries Supabase for published DORMIED articles that haven't been posted
 * to Threads yet and posts them. Called every 30 minutes by Vercel Cron.
 *
 * Protected by CRON_SECRET env var (set in Vercel project settings).
 * Articles must be at least 30 minutes old before posting (preview window).
 *
 * Threads API flow (two-step):
 *   1. Create a media container:  POST /USER_ID/threads
 *   2. Publish the container:     POST /USER_ID/threads_publish
 *
 * Required env vars:
 *   THREADS_USER_ID       — numeric Threads user ID
 *   THREADS_ACCESS_TOKEN  — long-lived user access token (threads_basic +
 *                           threads_content_publish scopes)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET
 */

const { createClient } = require('@supabase/supabase-js');

const THREADS_API_BASE  = 'https://graph.threads.net/v1.0';
const POST_DELAY_MS     = 5000;   // 5 s between posts if multiple are queued
const MIN_AGE_MINUTES   = 30;     // Wait this long after publish before posting
const MAX_POSTS_PER_CALL = 5;     // Never post more than this per cron invocation
const SITE_BASE_URL     = 'https://dormied.com';

// ---------------------------------------------------------------------------
// Threads API helpers
// ---------------------------------------------------------------------------

function getThreadsCreds() {
  const { THREADS_USER_ID, THREADS_ACCESS_TOKEN } = process.env;
  if (!THREADS_USER_ID || !THREADS_ACCESS_TOKEN) {
    throw new Error('[post-to-threads] Missing THREADS_USER_ID or THREADS_ACCESS_TOKEN');
  }
  return { userId: THREADS_USER_ID, token: THREADS_ACCESS_TOKEN };
}

/**
 * Step 1 — Create a text-only Threads media container.
 * Returns the container ID.
 */
async function createContainer(text) {
  const { userId, token } = getThreadsCreds();
  const url = `${THREADS_API_BASE}/${userId}/threads`;

  const params = new URLSearchParams({
    media_type:   'TEXT',
    text,
    access_token: token,
  });

  const res = await fetch(`${url}?${params}`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
  });

  const body = await res.json();
  if (!res.ok || !body.id) {
    const msg = body?.error?.message || JSON.stringify(body);
    throw Object.assign(new Error(`Threads container creation failed: ${msg}`), {
      code: res.status,
      threadsError: body?.error,
    });
  }

  return body.id; // container ID
}

/**
 * Step 2 — Publish the container. Returns the live Threads post ID.
 */
async function publishContainer(containerId) {
  const { userId, token } = getThreadsCreds();
  const url = `${THREADS_API_BASE}/${userId}/threads_publish`;

  const params = new URLSearchParams({
    creation_id:  containerId,
    access_token: token,
  });

  const res = await fetch(`${url}?${params}`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
  });

  const body = await res.json();
  if (!res.ok || !body.id) {
    const msg = body?.error?.message || JSON.stringify(body);
    throw Object.assign(new Error(`Threads publish failed: ${msg}`), {
      code: res.status,
      threadsError: body?.error,
    });
  }

  return body.id; // live post ID
}

/**
 * Full post: create container → wait 1 s → publish.
 * Returns the live Threads post ID.
 */
async function postToThreads(text) {
  const containerId = await createContainer(text);
  // Meta recommends a brief pause between container creation and publish
  await new Promise(r => setTimeout(r, 1000));
  return publishContainer(containerId);
}

// ---------------------------------------------------------------------------
// Page-live check — same safety gate as post-to-x.js
// ---------------------------------------------------------------------------

async function isArticleLive(slug) {
  const url = `${SITE_BASE_URL}/news/${slug}/`;
  try {
    const res = await fetch(url, {
      method:   'HEAD',
      signal:   AbortSignal.timeout(8000),
      headers:  { 'User-Agent': 'DORMIED-Bot/1.0' },
      redirect: 'follow',
    });
    if (res.ok) return true;
    console.warn(`[post-to-threads] Page not live for "${slug}": HTTP ${res.status}`);
    return false;
  } catch (err) {
    console.warn(`[post-to-threads] Page-live check failed for "${slug}": ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Validate & fit copy for Threads
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

// Threads limit: 500 characters total (URL is actual length, not shortened)
const THREADS_MAX_CHARS = 500;

function buildThreadsUrl(slug) {
  return `${SITE_BASE_URL}/news/${slug}/`;
}

function fitCopy(copy, slug) {
  const url      = buildThreadsUrl(slug);
  // "\n\n" (2 chars) + actual URL length
  const overhead = 2 + url.length;
  const maxCopy  = THREADS_MAX_CHARS - overhead;
  if (copy.length <= maxCopy) return copy;
  const truncated = copy.slice(0, maxCopy).replace(/\s\S*$/, '');
  console.warn(`[post-to-threads] Truncated copy ${copy.length} → ${truncated.length} chars`);
  return truncated;
}

function assemblePost(copy, slug) {
  return `${copy}\n\n${buildThreadsUrl(slug)}`;
}

function validatePost(postText, article) {
  const { slug, brand_slug, threads_posted_at } = article;

  if (threads_posted_at) {
    return { valid: false, reason: `Already posted at ${threads_posted_at}` };
  }

  const copy = (postText || '').trim();
  if (!copy) return { valid: false, reason: 'Post text is empty' };

  const lower = copy.toLowerCase();
  for (const phrase of DISALLOWED_PHRASES) {
    if (lower.includes(phrase)) {
      return { valid: false, reason: `Contains disallowed phrase: "${phrase}"` };
    }
  }

  if (brand_slug) {
    const brandWords  = brand_slug.replace(/-/g, ' ').toLowerCase().split(' ');
    const firstWord   = lower.split(/\W+/)[0];
    const brandJoined = brand_slug.replace(/-/g, '').toLowerCase();
    if (brandWords.includes(firstWord) || firstWord === brandJoined) {
      return { valid: false, reason: `Post starts with brand name ("${firstWord}")` };
    }
  }

  const fittedCopy  = fitCopy(copy, slug);
  const finalPost   = assemblePost(fittedCopy, slug);
  if (finalPost.length > THREADS_MAX_CHARS) {
    return { valid: false, reason: `Post too long after truncation (${finalPost.length} chars)` };
  }

  return { valid: true, text: finalPost };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      console.warn('[post-to-threads] Unauthorized — bad or missing CRON_SECRET');
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
    console.error('[post-to-threads] Failed to init Supabase:', err.message);
    return res.status(500).json({ error: 'Database init failed' });
  }

  const cutoff = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000).toISOString();

  const { data: articles, error: queryErr } = await supabase
    .from('dormied_articles')
    .select('id, slug, title, brand_slug, x_post_text, threads_posted_at')
    .eq('status', 'published')
    .is('threads_posted_at', null)
    .lte('published_at', cutoff)
    .order('published_at', { ascending: true })
    .limit(MAX_POSTS_PER_CALL);

  if (queryErr) {
    console.error('[post-to-threads] Supabase query error:', queryErr.message);
    return res.status(500).json({ error: 'Database error' });
  }

  if (!articles || articles.length === 0) {
    console.log('[post-to-threads] No eligible articles to post');
    return res.status(200).json({ posted: 0, skipped: 0, errors: 0, message: 'Nothing to post' });
  }

  console.log(`[post-to-threads] ${articles.length} article(s) eligible (max ${MAX_POSTS_PER_CALL}/run)`);
  const results = { posted: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];

    // Reuse x_post_text — same editorial voice, different platform
    const copySource    = (article.x_post_text || '').trim() || article.title;
    const usingFallback = !(article.x_post_text || '').trim();
    if (usingFallback) {
      console.log(`[post-to-threads] No x_post_text for "${article.title}" — using title as fallback`);
    }

    const validation = validatePost(copySource, article);
    if (!validation.valid) {
      console.warn(`[post-to-threads] Skipped "${article.title}": ${validation.reason}`);
      results.skipped++;
      continue;
    }

    const live = await isArticleLive(article.slug);
    if (!live) {
      console.warn(`[post-to-threads] Skipped "${article.title}": page not yet live`);
      results.skipped++;
      continue;
    }

    try {
      const postId = await postToThreads(validation.text);
      console.log(`[post-to-threads] ✓ Posted: "${article.title}" → Threads post ID ${postId}`);

      const { error: updateErr } = await supabase
        .from('dormied_articles')
        .update({
          threads_post_id:   postId,
          threads_posted_at: new Date().toISOString(),
        })
        .eq('id', article.id);

      if (updateErr) {
        console.error(`[post-to-threads] Failed to update row for ${article.id}:`, updateErr.message);
      }

      results.posted++;

    } catch (err) {
      const status       = err.code || 0;
      const threadsCode  = err.threadsError?.code;

      if (status === 429 || threadsCode === 32 /* rate limit */) {
        console.warn('[post-to-threads] Rate limited by Threads API. Will retry next cron run.');
        break;
      } else if (status === 401 || status === 403 || threadsCode === 190 /* invalid token */) {
        console.error('[post-to-threads] CRITICAL: Threads auth error — check THREADS_ACCESS_TOKEN. Token may have expired (60-day TTL).');
        results.errors++;
        break;
      } else {
        console.error(`[post-to-threads] Error posting "${article.title}" (HTTP ${status}):`, err.message);
        results.errors++;
      }
    }

    if (i < articles.length - 1) {
      await new Promise(r => setTimeout(r, POST_DELAY_MS));
    }
  }

  console.log(`[post-to-threads] Done — posted: ${results.posted}, skipped: ${results.skipped}, errors: ${results.errors}`);
  return res.status(200).json(results);
};
