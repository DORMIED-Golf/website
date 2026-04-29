'use strict';
/**
 * update-lcp-preload.js
 *
 * Fetches the most recently published article from Supabase and updates
 * the <link rel="preload"> hero image hint in index.html.
 *
 * Run this after publishing any new article so the LCP image starts
 * downloading before JavaScript executes, dramatically reducing LCP time.
 *
 * Usage:  node scripts/update-lcp-preload.js
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const ROOT       = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');

const SB_URL  = 'https://cimmmmnapdthqvtifpzr.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpbW1tbW5hcGR0aHF2dGlmcHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NzE3NTksImV4cCI6MjA4OTM0Nzc1OX0.yejRXgvODw3bMr3oA9IiNA-MIZsHHkxmDZouJmEgDfI';

function fetchJson(url, headers, cb) {
  const u = new URL(url);
  const req = https.request({
    hostname: u.hostname,
    path: u.pathname + u.search,
    headers,
  }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try { cb(null, JSON.parse(data)); }
      catch (e) { cb(e); }
    });
  });
  req.on('error', cb);
  req.end();
}

const apiUrl = SB_URL +
  '/rest/v1/dormied_articles' +
  '?select=title,image_url,slug,published_at' +
  '&status=eq.published' +
  '&order=published_at.desc' +
  '&limit=1';

fetchJson(apiUrl, { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON }, (err, articles) => {
  if (err) { console.error('[ERROR] Fetch failed:', err.message); process.exit(1); }
  if (!articles || !articles.length || !articles[0].image_url) {
    console.error('[ERROR] No published articles with image_url found.');
    process.exit(1);
  }

  const { title, image_url, published_at } = articles[0];
  console.log(`  Hero: "${title}"`);
  console.log(`  Published: ${published_at}`);
  console.log(`  Image: ${image_url}`);

  let html = fs.readFileSync(INDEX_HTML, 'utf8');

  // Replace the href on the existing LCP preload link
  const preloadRe = /(<link rel="preload" as="image" fetchpriority="high"\s+href=")[^"]*(")/;
  if (!preloadRe.test(html)) {
    console.error('[ERROR] Could not find LCP preload <link> in index.html.');
    console.error('  Expected a tag like: <link rel="preload" as="image" fetchpriority="high" href="...">');
    process.exit(1);
  }

  const newHtml = html.replace(preloadRe, `$1${image_url}$2`);
  if (newHtml === html) {
    console.log('  [SKIP] index.html already has this image URL — no change needed.');
    process.exit(0);
  }

  fs.writeFileSync(INDEX_HTML, newHtml, 'utf8');
  console.log('  [OK] index.html updated with new LCP preload URL.');
  console.log('\n  Remember to commit index.html and redeploy!');
});
