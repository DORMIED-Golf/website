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

/** Returns true for URLs that should be skipped (logos, icons, emojis, thumbnails). */
function looksLikeLogo(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Explicit logo/icon/favicon signals in path or filename
  if (/\/(logo|favicon|icon|brand-mark|wordmark|badge)[^/]*\.(png|svg|jpg|jpeg|webp)/i.test(lower)) return true;
  if (lower.endsWith('.svg')) return true;
  // WordPress emoji images (s.w.org or any path containing /emoji/)
  if (lower.includes('s.w.org') || lower.includes('/emoji/')) return true;
  // WordPress thumbnail-size suffixes: -150x150.jpg, -300x200.png, etc.
  // Real hero images don't have these suffixes — they're added by WP for resized variants.
  if (/\-\d{2,4}x\d{2,4}\.(png|jpg|jpeg|webp)$/i.test(lower)) return true;
  return false;
}

function extractFirstImage(html) {
  if (!html) return null;
  // Attributes to check in order (covers eager, lazy-loaded, and WordPress lazy variants)
  const attrs = ['src', 'data-src', 'data-lazy-src', 'data-original'];
  // Collect all candidate URLs first so we can rank them.
  const candidates = [];
  for (const attr of attrs) {
    // Double quotes
    const re1 = new RegExp('<img[^>]+' + attr + '="(https?:[^"]+)"', 'gi');
    let m;
    while ((m = re1.exec(html)) !== null) candidates.push(m[1]);
    // Single quotes
    const re2 = new RegExp("<img[^>]+" + attr + "='(https?:[^']+)'", 'gi');
    while ((m = re2.exec(html)) !== null) candidates.push(m[1]);
  }
  // Filter out emojis, thumbnails, and logos before ranking.
  const filtered = candidates.filter(u => !looksLikeLogo(u));
  // Prefer images that are clearly editorial (thegolfwire.com wp-content uploads).
  // Fall back to any non-logo image.
  const editorial = filtered.find(u => /thegolfwire\.com\/wp-content\/uploads\//i.test(u));
  return editorial || filtered[0] || null;
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

    // Extract image: cascade through three sources in priority order.
    //
    // 1. For Golf Wire native articles (sourceUrl on thegolfwire.com): always
    //    fetch og:image directly from the page — it's the authoritative featured
    //    image. The RSS content:encoded is unreliable: it includes WordPress emoji
    //    <img> tags and legacy thumbnail-size variants before the real hero image.
    // 2. Inline <img> in content:encoded (for non-GW source articles)
    // 3. og:image from sourceUrl as a last resort (brand sites, press releases)
    let imageUrl = null;

    const isGolfWireSource = sourceUrl.includes('thegolfwire.com');

    if (isGolfWireSource) {
      // Always prefer og:image scraped from the Golf Wire page itself
      console.log(`[scrape] Fetching og:image from Golf Wire page for "${item.title}"…`);
      imageUrl = await fetchOgImage(sourceUrl);
      if (imageUrl && looksLikeLogo(imageUrl)) {
        console.log(`[scrape] GW og:image looks like a logo, discarding.`);
        imageUrl = null;
      }
    }

    // For non-GW sources (or if GW og:image fetch failed): try inline content image
    if (!imageUrl) {
      imageUrl = extractFirstImage(rawContent);
    }

    // Last resort: try the source URL itself (press release / brand site)
    if (!imageUrl && !isGolfWireSource && sourceUrl) {
      console.log(`[scrape] Trying og:image from source URL for "${item.title}"…`);
      imageUrl = await fetchOgImage(sourceUrl);
      if (imageUrl && looksLikeLogo(imageUrl)) {
        console.log(`[scrape] Source og:image looks like a logo, discarding.`);
        imageUrl = null;
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

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
// Explicit exit(0) for the same reason as scrape-pressrooms.js: rss-parser 3.13
// leaves a ref'd TLSSocket behind, so the process will not exit on its own. Even
// on a fully successful run that cost ~60s per invocation waiting for the socket
// to idle out; on a failed feed it hangs indefinitely.
if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => {
    console.error('[scrape] Fatal error:', err.message);
    process.exit(1);
  });
}