#!/usr/bin/env node
/**
 * DORMIED Content Pipeline — Step 1: Golf Wire Scraper
 *
 * Fetches new press releases from The Golf Wire RSS feed and stores
 * them in the golf_wire_raw Supabase table. Skips duplicates (UNIQUE
 * constraint on source_url). Only ingests articles from the last 14 days.
 *
 * Usage:
 *   node scripts/scrape-golfwire.js
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const Parser           = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

const FEED_URL    = 'https://www.thegolfwire.com/feed/';
const MAX_AGE_MS  = 14 * 24 * 60 * 60 * 1000; // 14 days

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirstImage(html) {
  if (!html) return null;
  // Try src with double quotes
  let m = html.match(/<img[^>]+src="(https?:[^"]+)"/i);
  if (m) return m[1];
  // Try src with single quotes
  m = html.match(/<img[^>]+src='(https?:[^']+)'/i);
  if (m) return m[1];
  return null;
}

async function fetchOgImage(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'DORMIED-Bot/1.0' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // og:image content may come before or after property attribute
    let m = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    if (!m) m = html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function inferCategory(title, content) {
  const text = (title + ' ' + content).toLowerCase();
  if (/apparel|clothing|shirt|polo|jacket|shoe|footwear|glove|hat|cap|vest/.test(text))
    return 'Apparel';
  if (/driver|iron|wedge|putter|wood|hybrid|club|shaft|grip|ball/.test(text))
    return 'Equipment';
  if (/rangefinder|gps|launch monitor|simulator|training|tech|app/.test(text))
    return 'Tech';
  if (/bag|cart|trolley|caddie|accessory|accessories/.test(text))
    return 'Accessories';
  return 'Business';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = getSupabase();
  const parser   = new Parser({
    customFields: { item: ['content:encoded'] },
    timeout: 10000,
  });

  console.log('[scrape] Fetching Golf Wire RSS feed…');
  let feed;
  try {
    feed = await parser.parseURL(FEED_URL);
  } catch (err) {
    console.error('[scrape] Failed to fetch RSS feed:', err.message);
    process.exit(1);
  }

  console.log(`[scrape] Found ${feed.items.length} items in feed`);

  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  let ingested = 0;
  let skipped  = 0;

  for (const item of feed.items) {
    const pubDate = item.isoDate ? new Date(item.isoDate) : null;

    // Skip articles older than 14 days
    if (pubDate && pubDate < cutoff) {
      skipped++;
      continue;
    }

    const sourceUrl = (item.link || '').trim();
    if (!sourceUrl) { skipped++; continue; }

    // Skip PR Newswire articles — they are almost never golf-specific and
    // frequently match golf brand names by coincidence (wrong Odyssey, wrong
    // Ping, wrong MacGregor, etc.), causing off-topic articles to be generated.
    if (sourceUrl.includes('prnewswire.com')) {
      skipped++;
      continue;
    }

    const rawContent = item['content:encoded'] || item.content || item.contentSnippet || '';
    const bodyText   = stripHtml(rawContent);

    if (!bodyText || bodyText.length < 50) { skipped++; continue; }

    // Extract image: try content HTML first.
    // If item.guid is a Golf Wire page URL (different from sourceUrl), try its og:image.
    // We do NOT fall back to og:image from sourceUrl (the brand press release) because
    // brand sites typically serve their logo as og:image, not the article's actual photo.
    let imageUrl = extractFirstImage(rawContent);
    if (!imageUrl) {
      const guidUrl = (item.guid || '').trim();
      if (guidUrl && guidUrl !== sourceUrl && guidUrl.includes('thegolfwire.com')) {
        console.log(`[scrape] Trying og:image from Golf Wire page for "${item.title}"…`);
        imageUrl = await fetchOgImage(guidUrl);
      }
    }
    if (!imageUrl) {
      console.log(`[scrape] No image found for "${item.title}" — will use default fallback`);
    }

    const category = inferCategory(item.title || '', bodyText);

    const record = {
      source_url:   sourceUrl,
      title:        (item.title || '').trim(),
      body:         bodyText,
      image_url:    imageUrl || null,
      category,
      published_at: pubDate ? pubDate.toISOString() : new Date().toISOString(),
      processed:    false,
    };

    const { error } = await supabase
      .from('golf_wire_raw')
      .insert(record);

    if (error) {
      if (error.code === '23505') {
        // Duplicate — already ingested
        skipped++;
      } else {
        console.warn(`[scrape] Insert failed for "${item.title}":`, error.message);
        skipped++;
      }
    } else {
      console.log(`[scrape] ✓ Ingested: "${item.title}"`);
      ingested++;
    }

    // Brief delay to be polite to Golf Wire's server
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[scrape] Done. Ingested: ${ingested}, Skipped/duplicate: ${skipped}`);
}

main().catch(err => {
  console.error('[scrape] Fatal error:', err.message);
  process.exit(1);
});
