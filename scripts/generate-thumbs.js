#!/usr/bin/env node
/**
 * scripts/generate-thumbs.js
 *
 * Builds the static thumbnails that replaced /_vercel/image (see lib/thumbs.js).
 *
 * Sources, in the order a page needs them:
 *   - article heroes and player headshots, from Supabase, for the rows the
 *     feeds and WITB pages actually bake
 *   - brand logos, from the repo
 *
 * Idempotent: an existing thumbnail is left alone, so re-running costs one stat
 * per file. Run it before a bake; the generators also call ensureThumbs for
 * anything they reference, so this is a warm-up, not a prerequisite.
 *
 * Usage:
 *   node scripts/generate-thumbs.js            # articles + players + logos
 *   node scripts/generate-thumbs.js --articles=200
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { ensureThumbs, WIDTHS } = require('./lib/thumbs');

const ROOT = path.resolve(__dirname, '..');
const ARTICLE_LIMIT = parseInt((process.argv.find(a => a.startsWith('--articles=')) || '').split('=')[1], 10) || 0;

// Feed cards top out around 300 CSS px, the homepage lead card around 750.
const ARTICLE_WIDTHS = [80, 160, 400, 600, 800, 1200];
// 200 and 400 serve the player-page portrait and the Freshest Bag avatar.
const PLAYER_WIDTHS  = [40, 80, 160, 200, 400];
// 200 is the homepage Most Viewed card (a 100px logo at DPR 2). Every width a
// client script asks for must be listed here, or that card falls back.
const LOGO_WIDTHS    = [40, 80, 160, 200];

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('[thumbs] Missing SUPABASE env vars'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function run(label, sources, widths) {
  let made = 0, had = 0, failed = 0;
  for (const src of sources) {
    if (!src) continue;
    const before = widths.filter(w => require('./lib/thumbs').thumbExists(src, w)).length;
    const got    = await ensureThumbs(src, widths);
    if (!got.length) { failed++; continue; }
    made += got.length - before;
    had  += before;
    if ((made + had) % 500 === 0) process.stdout.write('.');
  }
  console.log(`\n[thumbs] ${label}: ${made} written, ${had} already present, ${failed} source(s) unavailable`);
  return failed;
}

(async () => {
  console.log('[thumbs] building static thumbnails');

  let q = sb.from('dormied_articles').select('image_url').eq('status', 'published')
    .not('image_url', 'is', null).order('published_at', { ascending: false });
  if (ARTICLE_LIMIT) q = q.limit(ARTICLE_LIMIT);
  const { data: articles, error: aErr } = await q;
  if (aErr) throw new Error(`articles: ${aErr.message}`);
  await run(`articles (${articles.length})`, articles.map(a => a.image_url), ARTICLE_WIDTHS);

  const { data: players, error: pErr } = await sb.from('witb_players')
    .select('headshot_url').not('headshot_url', 'is', null);
  if (pErr) throw new Error(`players: ${pErr.message}`);
  await run(`players (${players.length})`, players.map(p => p.headshot_url), PLAYER_WIDTHS);

  const logoDir = path.join(ROOT, 'images', 'logos');
  const logos = fs.existsSync(logoDir)
    ? fs.readdirSync(logoDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).map(f => `/images/logos/${f}`)
    : [];
  await run(`logos (${logos.length})`, logos, LOGO_WIDTHS);

  console.log(`[thumbs] done. Widths: articles ${ARTICLE_WIDTHS.join('/')}, players ${PLAYER_WIDTHS.join('/')}, logos ${LOGO_WIDTHS.join('/')} (of ${WIDTHS.join('/')} supported)`);
})().catch(e => { console.error('[thumbs] FAILED:', e.message); process.exit(1); });
