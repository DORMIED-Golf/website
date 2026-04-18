#!/usr/bin/env node
/**
 * DORMIED Content Pipeline — Step 1b: Press Room Scraper
 *
 * Fetches articles from brand press rooms (RSS/Atom feeds + HTML sources)
 * and stores them in the golf_wire_raw table alongside Golf Wire content.
 *
 * Sources:
 *   RSS/Atom: Titleist, Good Good Golf, Holderness & Bourne, Miura, Mizuno,
 *             Takomo, PXG, Adidas Golf, LA Golf (PRNewswire), Cobra, Malbon,
 *             SWAG Golf, Greyson Clothiers, Bettinardi, Sun Mountain
 *   HTML:     Callaway Golf, Ping, First Call Golf
 *
 * Usage:
 *   node scripts/scrape-pressrooms.js
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const Parser           = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_AGE_MS        = 14 * 24 * 60 * 60 * 1000; // 14 days
const FETCH_TIMEOUT_MS  = 12000;
const DELAY_MS          = 500; // polite delay between requests

// ── Sources ───────────────────────────────────────────────────────────────────

const RSS_SOURCES = [
  {
    id:   'titleist',
    name: 'Titleist',
    url:  'https://mediacenter.titleist.com/en-US/press_releases.atom',
    type: 'atom',
  },
  {
    id:   'good-good-golf',
    name: 'Good Good Golf',
    url:  'https://goodgoodgolf.com/blogs/press-releases.atom',
    type: 'atom',
  },
  {
    id:   'holderness-bourne',
    name: 'Holderness & Bourne',
    url:  'https://holdernessandbourne.com/blogs/press.atom',
    type: 'atom',
  },
  {
    id:   'miura',
    name: 'Miura Golf',
    url:  'https://miuragolf.com/blogs/in-the-news.atom',
    type: 'atom',
  },
  {
    id:   'mizuno',
    name: 'Mizuno Golf',
    url:  'https://mizunogolf.com/us/blog/category/news/feed/',
    type: 'rss',
  },
  {
    id:   'takomo',
    name: 'Takomo Golf',
    url:  'https://takomogolf.com/blogs/news.atom',
    type: 'atom',
  },
  {
    id:   'pxg',
    name: 'PXG',
    url:  'https://www.pxg.com/blogs/the-range.atom',
    type: 'atom',
  },
  {
    id:   'adidas-golf',
    name: 'Adidas Golf',
    url:  'https://news.adidas.com/RSS/sports/golf',
    type: 'rss',
  },
  {
    id:   'la-golf',
    name: 'LA Golf',
    url:  'https://www.prnewswire.com/rss/news-releases-list.rss?box=la-golf',
    type: 'rss',
  },
  {
    id:   'cobra',
    name: 'COBRA Golf',
    url:  'https://www.cobragolf.com/blogs/news.atom',
    type: 'atom',
    // Cobra's atom entries have no body — fetch each article for content
    fetchBodyFromUrl: true,
  },
  {
    id:   'malbon',
    name: 'Malbon Golf',
    url:  'https://malbon.com/blogs/news.atom',
    type: 'atom',
  },
  {
    id:   'swag-golf',
    name: 'SWAG Golf',
    url:  'https://swag.golf/blogs/news.atom',
    type: 'atom',
  },
  {
    id:   'greyson',
    name: 'Greyson Clothiers',
    url:  'https://greysonclothiers.com/blogs/news.atom',
    type: 'atom',
  },
  {
    id:   'bettinardi',
    name: 'Bettinardi Golf',
    url:  'https://bettinardi.com/blogs/news.atom',
    type: 'atom',
  },
  {
    id:   'sun-mountain',
    name: 'Sun Mountain',
    url:  'https://www.sunmountain.com/blogs/blog.atom',
    type: 'atom',
  },
  {
    id:   'golf-one-media',
    name: 'Golf One Media',
    url:  'https://golfonemedia.com/feed/',
    type: 'rss',
  },
  {
    id:   'mygolfspy',
    name: 'MyGolfSpy',
    url:  'https://feeds.feedburner.com/Mygolfspy',
    type: 'rss',
  },
];
// Note: Breezy Golf excluded per request (blog is gift guides, not press releases)
// Skipped (broken): TaylorMade (redirect loop), Scotty Cameron/FootJoy/Golf Pride/Wilson (403)
// MyGolfSpy: direct feed 403, use FeedBurner mirror instead

// HTML sources: scrape a listing page for article links, then visit each
const HTML_SOURCES = [
  {
    id:           'callaway',
    name:         'Callaway Golf',
    listingUrl:   'https://www.callawaygolf.com/press',
    baseUrl:      'https://www.callawaygolf.com',
    // Links like /press/callaway-golf-announces-quantum-mini-driver...
    linkPattern:  /\/press\/[a-z0-9-]{10,}/i,
    extractor:    'generic',
  },
  {
    id:           'ping',
    name:         'Ping',
    listingUrl:   'https://ping.com/en-us/discover-ping/news',
    baseUrl:      'https://ping.com',
    // Links like /en-us/discover-ping/news/i540-irons-deliver-speed...
    linkPattern:  /\/en-us\/discover-ping\/news\/[a-z0-9-]{5,}/i,
    extractor:    'generic',
  },
  {
    id:           'first-call-golf',
    name:         'First Call Golf',
    listingUrl:   'https://www.firstcallgolf.com/industry-news',
    baseUrl:      'https://www.firstcallgolf.com',
    // Find links matching /industry-news/release/YYYY-MM-DD/slug
    linkPattern:  /\/industry-news\/release\/\d{4}-\d{2}-\d{2}\//i,
    extractor:    'firstcall',
  },
];

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function stripHtml(html) {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
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
  let m = html.match(/<img[^>]+src="(https?:[^"]+)"/i);
  if (m) return m[1];
  m = html.match(/<img[^>]+src='(https?:[^']+)'/i);
  if (m) return m[1];
  return null;
}

async function fetchPage(url, { timeout = FETCH_TIMEOUT_MS } = {}) {
  try {
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(timeout),
      headers: {
        'User-Agent': 'DORMIED-Bot/1.0 (dormied.com)',
        'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchOgMeta(url) {
  const html = await fetchPage(url);
  if (!html) return {};

  const ogImage = (
    (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
     html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i) || [])[1]
  ) || null;

  const ogDesc = (
    (html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
     html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i) ||
     html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
     html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i) || [])[1]
  ) || null;

  return { ogImage, ogDesc };
}

function inferCategory(title, content) {
  const text = (title + ' ' + content).toLowerCase();
  if (/apparel|clothing|shirt|polo|jacket|shoe|footwear|glove|hat|cap|vest|wear/.test(text))
    return 'Apparel';
  if (/driver|iron|wedge|putter|wood|hybrid|club|shaft|grip|ball|equipment/.test(text))
    return 'Equipment';
  if (/rangefinder|gps|launch monitor|simulator|training|tech|app|technology/.test(text))
    return 'Tech';
  if (/bag|cart|trolley|caddie|accessory|accessories/.test(text))
    return 'Accessories';
  return 'Business';
}

async function insertRecord(supabase, record, sourceName) {
  const { error } = await supabase.from('golf_wire_raw').insert(record);
  if (error) {
    if (error.code === '23505') return 'duplicate';
    console.warn(`[pressrooms:${sourceName}] Insert failed for "${record.title}":`, error.message);
    return 'error';
  }
  return 'ok';
}

// ── RSS/Atom Scraper ──────────────────────────────────────────────────────────

async function scrapeRssSource(supabase, source, parser) {
  console.log(`\n[pressrooms] Fetching ${source.name} (${source.type.toUpperCase()})…`);

  let feed;
  try {
    feed = await parser.parseURL(source.url);
  } catch (err) {
    console.warn(`[pressrooms:${source.id}] Failed to fetch feed:`, err.message);
    return;
  }

  console.log(`[pressrooms:${source.id}] ${feed.items.length} items found`);

  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  let ingested = 0;
  let skipped  = 0;

  for (const item of feed.items) {
    const pubDate = item.isoDate ? new Date(item.isoDate) : null;
    if (pubDate && pubDate < cutoff) { skipped++; continue; }

    const sourceUrl = (item.link || '').trim();
    if (!sourceUrl) { skipped++; continue; }

    // Get body text from feed
    const rawContent = item['content:encoded'] || item.content || item.contentSnippet || item.summary || '';
    let bodyText = stripHtml(rawContent);

    // If body is missing (e.g. Cobra) or too short, fetch from article URL
    if ((!bodyText || bodyText.length < 80) && sourceUrl) {
      const { ogDesc, ogImage: fetchedImage } = await fetchOgMeta(sourceUrl);
      if (ogDesc) bodyText = ogDesc;
      if (!bodyText || bodyText.length < 30) { skipped++; await delay(DELAY_MS); continue; }
    }

    // Extract image
    let imageUrl = extractFirstImage(rawContent);
    if (!imageUrl) {
      // Try media:content or enclosure from parsed feed
      imageUrl = item['media:content']?.$ ?.url || item.enclosure?.url || null;
    }
    if (!imageUrl && sourceUrl) {
      const { ogImage } = await fetchOgMeta(sourceUrl);
      imageUrl = ogImage;
      await delay(DELAY_MS);
    }

    const title    = (item.title || '').trim();
    const category = inferCategory(title, bodyText);

    const result = await insertRecord(supabase, {
      source_url:   sourceUrl,
      title,
      body:         bodyText,
      image_url:    imageUrl || null,
      category,
      published_at: pubDate ? pubDate.toISOString() : new Date().toISOString(),
      processed:    false,
    }, source.id);

    if (result === 'ok') {
      console.log(`[pressrooms:${source.id}] ✓ "${title}"`);
      ingested++;
    } else if (result === 'duplicate') {
      skipped++;
    }

    await delay(DELAY_MS);
  }

  console.log(`[pressrooms:${source.id}] Done — ingested: ${ingested}, skipped/dup: ${skipped}`);
}

// ── HTML Scraper — Generic ────────────────────────────────────────────────────
// Works for any site that renders full HTML with og: meta tags.
// Falls back to heuristic body extraction when og:description is sparse.

async function extractGenericArticle(url) {
  const html = await fetchPage(url);
  if (!html) return null;

  // Title: og:title → <h1>
  let title = (
    (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
     html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i) || [])[1] || ''
  );
  if (!title) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) title = stripHtml(h1[1]);
  }
  // Strip common site-name suffixes like " | Callaway Golf"
  title = title.replace(/\s*[|\-–—].*$/, '').trim();
  if (!title) return null;

  // Date: og:article:published_time → datetime attr → URL date → today
  let pubDate = null;
  const dateMeta = (
    html.match(/<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="article:published_time"/i) ||
    html.match(/<time[^>]+datetime="([^"]+)"/i)
  );
  if (dateMeta) {
    const parsed = new Date(dateMeta[1]);
    if (!isNaN(parsed)) pubDate = parsed.toISOString();
  }
  if (!pubDate) {
    // Try to find YYYY-MM-DD in the URL
    const urlDate = url.match(/\/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
    if (urlDate) {
      const parsed = new Date(`${urlDate[1]}-${urlDate[2]}-${urlDate[3]}`);
      if (!isNaN(parsed)) pubDate = parsed.toISOString();
    }
  }

  // Body: og:description first, then try common content wrappers
  const ogDesc = (
    (html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
     html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i) ||
     html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
     html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i) || [])[1] || ''
  );

  let bodyText = ogDesc;

  // Try common article body selectors
  const bodyPatterns = [
    /<article[^>]*>([\s\S]{300,}?)<\/article>/i,
    /class="[^"]*(?:press-release|article-body|entry-content|post-content|page-content|release-content|content-body|main-content|rte|rich-text)[^"]*"[^>]*>([\s\S]{300,}?)<\/(?:div|section|article)>/i,
    /<main[^>]*>([\s\S]{300,}?)<\/main>/i,
  ];
  for (const pat of bodyPatterns) {
    const m = html.match(pat);
    if (m) {
      const extracted = stripHtml(m[1]);
      if (extracted.length > bodyText.length) {
        bodyText = extracted.slice(0, 3000);
        break;
      }
    }
  }

  if (!bodyText || bodyText.length < 50) return null;

  // Image: og:image
  const ogImage = (
    (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
     html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i) || [])[1] || null
  );

  return { title, body: bodyText, imageUrl: ogImage, pubDate };
}

// ── HTML Scraper — First Call Golf ───────────────────────────────────────────

async function extractFirstCallArticle(url) {
  const html = await fetchPage(url);
  if (!html) return null;

  // Title
  let title = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
               html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1] || '';
  title = stripHtml(title).replace(/\s*[-|].*First Call.*/i, '').trim();
  if (!title) return null;

  // Date from URL: /industry-news/release/YYYY-MM-DD/
  let pubDate = null;
  const urlDate = url.match(/\/(\d{4}-\d{2}-\d{2})\//);
  if (urlDate) pubDate = new Date(urlDate[1]).toISOString();

  // Body
  const ogDesc = (html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
                  html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i) || [])[1] || '';

  // Try article body — First Call wraps in .press-release, .entry-content, etc.
  let bodyText = ogDesc;
  const patterns = [
    /class="[^"]*(?:press-release|article-body|entry-content|release-content|content-body)[^"]*"[^>]*>([\s\S]{300,}?)<\/(?:div|section|article)>/i,
    /<article[^>]*>([\s\S]{300,}?)<\/article>/i,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) {
      const extracted = stripHtml(m[1]);
      if (extracted.length > bodyText.length) { bodyText = extracted.slice(0, 3000); break; }
    }
  }
  if (!bodyText || bodyText.length < 50) return null;

  const ogImage = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
                   html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i) || [])[1] || null;

  return { title, body: bodyText, imageUrl: ogImage, pubDate };
}

// ── HTML Source Dispatcher ────────────────────────────────────────────────────

async function scrapeHtmlSource(supabase, source) {
  console.log(`\n[pressrooms] Fetching ${source.name} (HTML)…`);

  const html = await fetchPage(source.listingUrl);
  if (!html) {
    console.warn(`[pressrooms:${source.id}] Failed to fetch listing page`);
    return;
  }

  // Extract unique article links matching the pattern
  const linkSet = new Set();
  const re      = new RegExp(`href="(${source.linkPattern.source})"`, 'gi');
  let   match;
  while ((match = re.exec(html)) !== null) {
    let href = match[1];
    if (!href.startsWith('http')) href = source.baseUrl + href;
    linkSet.add(href);
  }

  const links = [...linkSet].slice(0, 20); // cap at 20 per run
  console.log(`[pressrooms:${source.id}] Found ${links.length} article links`);

  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  let ingested = 0;
  let skipped  = 0;

  for (const articleUrl of links) {
    await delay(DELAY_MS);

    let extracted;
    if (source.extractor === 'firstcall') {
      extracted = await extractFirstCallArticle(articleUrl);
    } else if (source.extractor === 'generic') {
      extracted = await extractGenericArticle(articleUrl);
    }

    if (!extracted || !extracted.title || !extracted.body) { skipped++; continue; }

    const { title, body, imageUrl, pubDate } = extracted;

    // Age filter
    if (pubDate && new Date(pubDate) < cutoff) { skipped++; continue; }

    const category = inferCategory(title, body);
    const result   = await insertRecord(supabase, {
      source_url:   articleUrl,
      title,
      body,
      image_url:    imageUrl || null,
      category,
      published_at: pubDate || new Date().toISOString(),
      processed:    false,
    }, source.id);

    if (result === 'ok') {
      console.log(`[pressrooms:${source.id}] ✓ "${title}"`);
      ingested++;
    } else if (result === 'duplicate') {
      skipped++;
    }
  }

  console.log(`[pressrooms:${source.id}] Done — ingested: ${ingested}, skipped/dup: ${skipped}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = getSupabase();

  const parser = new Parser({
    customFields: {
      item: ['content:encoded', 'summary', ['media:content', 'media:content', { keepArray: false }]],
    },
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': 'DORMIED-Bot/1.0 (dormied.com)' },
  });

  // RSS/Atom sources
  for (const source of RSS_SOURCES) {
    try {
      await scrapeRssSource(supabase, source, parser);
    } catch (err) {
      console.error(`[pressrooms:${source.id}] Fatal error:`, err.message);
    }
    await delay(DELAY_MS * 2);
  }

  // HTML sources
  for (const source of HTML_SOURCES) {
    try {
      await scrapeHtmlSource(supabase, source);
    } catch (err) {
      console.error(`[pressrooms:${source.id}] Fatal error:`, err.message);
    }
    await delay(DELAY_MS * 2);
  }

  console.log('\n[pressrooms] All sources complete.');
}

main().catch(err => {
  console.error('[pressrooms] Fatal error:', err.message);
  process.exit(1);
});
