#!/usr/bin/env node
/**
 * scripts/backfill-player-headshots.js
 *
 * Fills witb_players.pga_tour_id + headshot_url for the WITB player pages.
 *
 * WHERE THE IMAGES COME FROM
 * PGA Tour publishes players_sitemap.xml (listed in their own robots.txt, which
 * carries no blanket bot block). Each entry is /player/<id>/<slug>, and that same
 * <id> is the filename in their Cloudinary headshot library. So one sanctioned
 * fetch of the sitemap gives every id we need, and the image URL is derived
 * rather than scraped.
 *
 * NOT VIA DATAGOLF. The headshots surface on DataGolf player profiles, but
 * DataGolf hotlinks them from PGA Tour's Cloudinary — it is a middleman, and its
 * dg_id is a different number entirely (Rory: 28237 on Tour, 10091 on DataGolf).
 * Going to the sitemap removes a hop and a second site's rate limits.
 *
 * WE REHOST, WE DO NOT HOTLINK
 * Each image is copied into Supabase storage and served from there. Rendering
 * from the origin would stamp our referrer on ~200 player pageviews and make
 * every headshot on the site break together if a path ever moved.
 *
 * NO LOCAL COPIES. Unlike article heroes, these never touch images/ — 205 files
 * at ~140KB would add ~29MB to every deployment, and deployment storage is the
 * constraint that took the site down once already.
 *
 *   node scripts/backfill-player-headshots.js            # fill what is missing
 *   node scripts/backfill-player-headshots.js --force    # re-fetch everyone
 *   node scripts/backfill-player-headshots.js --dry-run  # report, write nothing
 *   node scripts/backfill-player-headshots.js --only=rory-mcilroy,jon-rahm
 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

(function loadDotenv() {
  const fs = require('fs');
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
})();

const { createClient } = require('@supabase/supabase-js');

const SITEMAP   = 'https://www.pgatour.com/players_sitemap.xml';
const BUCKET    = 'dormied-articles';
const PREFIX    = 'players';
const UA        = 'DORMIED-Bot/1.0 (+https://dormied.com)';

/** Cloudinary transform DataGolf's profile pages use: face-centred 280x350 @2x. */
const CLOUDINARY = id =>
  'https://pga-tour-res.cloudinary.com/image/upload/'
  + 'c_fill,d_headshots_default.png,dpr_2.0,f_auto,g_face:center,h_350,q_auto,w_280/'
  + `headshots_${id}.png`;

/**
 * Slugs the Tour spells differently to us. Each was confirmed by hand against
 * their sitemap; this is not fuzzy matching, and it must not become fuzzy
 * matching — a wrong id here silently puts another golfer's face on a page.
 */
const SLUG_ALIASES = {
  'matthew-fitzpatrick':    'matt-fitzpatrick',
  'cameron-davis':          'cam-davis',
  'sebastian-j-munoz':      'sebastian-munoz',
  'guillermo-mito-pereira': 'mito-pereira',
  'siwoo-kim':              'si-woo-kim',
  'nicolai-hojgaard':       'nicolai-hjgaard',   // the Tour drops the o-slash
  'rasmus-hojgaard':        'rasmus-hjgaard',
  'max-steinlechner':       'maximilian-steinlechner',
};

/**
 * Players the sitemap simply does not contain, checked by hand so nobody spends
 * an afternoon rediscovering it. Two groups:
 *   - not PGA Tour members: Nelly Korda, Charley Hull, Asterisk Talley (LPGA);
 *     Charlie Woods, Luke Potter, Will Cannon, Joe Weiler (amateurs)
 *   - genuinely absent despite being Tour members: J.J. Spaun, J.T. Poston,
 *     C.T. Pan, Kyoung-Hoon Lee. The sitemap is a flat 2,737-player list, not a
 *     complete roster, and these four are not in it under any spelling.
 * Their ids could be found by hand, but they are NOT guessed here: an id that
 * looks plausible and is wrong puts another golfer's face on the page.
 */

const args    = process.argv.slice(2);
const FORCE   = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const ONLY    = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '')
                  .split(',').map(s => s.trim()).filter(Boolean);

function sb() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY required');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

/** slug -> tour id, from the Tour's own sitemap. */
async function fetchTourIds() {
  const res = await fetch(SITEMAP, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`players_sitemap.xml returned ${res.status}`);
  const xml = await res.text();

  const map = new Map();
  const re = /https:\/\/www\.pgatour\.com\/player\/(\d+)\/([a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    // First occurrence wins: the plain /player/ path precedes the
    // /korn-ferry-tour/player/ duplicates for the same golfer.
    if (!map.has(m[2])) map.set(m[2], m[1]);
  }
  if (map.size < 1000) {
    throw new Error(`sitemap yielded only ${map.size} players — refusing to run on a partial fetch`);
  }
  return map;
}

async function copyToStorage(supabase, tourId, slug) {
  const res = await fetch(CLOUDINARY(tourId), {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return { error: `origin returned ${res.status}` };

  const buffer = Buffer.from(await res.arrayBuffer());
  // The transform falls back to headshots_default.png for players with no photo.
  // That default is small; anything under 8KB is almost certainly it, and storing
  // it would put an identical grey silhouette on a dozen pages as if it were real.
  if (buffer.length < 8000) return { error: `looks like the default placeholder (${buffer.length}b)` };

  const contentType = res.headers.get('content-type') || 'image/png';
  const ext  = contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') ? 'jpg' : 'png';
  const key  = `${PREFIX}/${slug}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, buffer, { contentType, upsert: true, cacheControl: '2592000' });
  if (error) return { error: `upload failed: ${error.message}` };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return { url: data && data.publicUrl, bytes: buffer.length };
}

async function main() {
  const supabase = sb();

  console.log('[headshots] fetching PGA Tour players_sitemap.xml …');
  const tourIds = await fetchTourIds();
  console.log(`[headshots] ${tourIds.size} player slugs in the sitemap`);

  let q = supabase.from('witb_players').select('slug, name, pga_tour_id, headshot_url');
  if (ONLY.length) q = q.in('slug', ONLY);
  const { data: players, error } = await q.order('slug');
  if (error) throw new Error(`witb_players read failed: ${error.message}`);
  console.log(`[headshots] ${players.length} player(s) to consider\n`);

  const stats = { done: 0, skipped: 0, noId: [], failed: [] };

  for (const p of players) {
    if (!FORCE && p.headshot_url) { stats.skipped++; continue; }

    const lookup = SLUG_ALIASES[p.slug] || p.slug;
    const tourId = tourIds.get(lookup);
    if (!tourId) { stats.noId.push(p.slug); continue; }

    if (DRY_RUN) {
      console.log(`  would fetch ${p.slug.padEnd(26)} tour id ${tourId}`);
      stats.done++;
      continue;
    }

    const r = await copyToStorage(supabase, tourId, p.slug);
    if (r.error) { stats.failed.push(`${p.slug} (${r.error})`); continue; }

    const { error: upErr } = await supabase.from('witb_players').update({
      pga_tour_id: tourId,
      headshot_url: r.url,
      headshot_updated_at: new Date().toISOString(),
    }).eq('slug', p.slug);
    if (upErr) { stats.failed.push(`${p.slug} (db: ${upErr.message})`); continue; }

    stats.done++;
    console.log(`  ✔ ${p.slug.padEnd(26)} id ${String(tourId).padEnd(6)} ${(r.bytes / 1024).toFixed(0)}KB`);
    await new Promise(r2 => setTimeout(r2, 150));   // be a polite guest
  }

  console.log(`\n[headshots] stored ${stats.done}, already had ${stats.skipped}`);
  if (stats.noId.length) {
    console.log(`[headshots] no PGA Tour profile (${stats.noId.length}) — LPGA players and amateurs`);
    console.log('            ' + stats.noId.join(', '));
  }
  if (stats.failed.length) {
    console.log(`[headshots] failed (${stats.failed.length}):`);
    stats.failed.forEach(f => console.log('            ' + f));
  }
}

main().catch(e => { console.error('[headshots] FATAL:', e.message); process.exit(1); });
