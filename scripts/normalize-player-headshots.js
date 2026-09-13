#!/usr/bin/env node
/**
 * scripts/normalize-player-headshots.js
 *
 * Brings every witb_players headshot to the same 4:5 portrait aspect ratio.
 *
 * WHY THIS EXISTS
 * 194 of the 205 headshots came from PGA Tour's Cloudinary at 560x700 (4:5).
 * The other 11 were supplied by hand and run 747x498, 400x440, 623x623 and
 * 280x280. Every surface that renders a headshot crops it with CSS
 * `object-fit: cover; object-position: 50% 12%` -- a rule tuned for 4:5. Feed a
 * 1.5 landscape source through it and the crop lands somewhere else entirely,
 * so eleven players looked wrong next to everyone else. It is most obvious at
 * the 88px Freshest Bag size, where the difference is a face versus a forehead.
 *
 * WHAT IT DOES
 * Crops horizontally, centred, to exactly 4:5. Nothing else.
 *
 * Every one of the 11 is WIDER than 4:5, never taller, so the fix only ever
 * removes width. That matters: cropping height on a headshot is how you
 * decapitate someone, and this script cannot do that even if a future outlier
 * is shaped differently -- a source taller than 4:5 is skipped and reported
 * rather than guessed at, because the safe crop for it depends on where the
 * face sits and that is a judgement call, not arithmetic.
 *
 * NO UPSCALING. The crop output keeps the source's pixels (a 280x280 becomes
 * 224x280, not a blurry 560x700). These render at 28-88px; ratio consistency is
 * the thing that was broken, resolution was already sufficient.
 *
 * CACHE BUSTING. Storage objects are uploaded with a 30-day cacheControl, and
 * re-uploading the same key does not evict the CDN copy or Vercel's optimizer
 * cache. So headshot_url gains a ?v=N suffix, which both layers treat as a new
 * object. Without it the corrected image would not be visible for a month.
 *
 *   node scripts/normalize-player-headshots.js --dry-run   # report, write nothing
 *   node scripts/normalize-player-headshots.js             # fix what is off-ratio
 *   node scripts/normalize-player-headshots.js --only=c-t-pan,nelly-korda
 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require('dotenv').config({ path: path.join(ROOT, '.env') });

const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'dormied-articles';
const PREFIX = 'players';

/** 4:5 portrait, matching the 194-file Cloudinary majority. */
const TARGET_W = 4;
const TARGET_H = 5;
const TARGET_RATIO = TARGET_W / TARGET_H;      // 0.8
/** A pixel of rounding either way is not a defect worth a re-upload. */
const RATIO_TOLERANCE = 0.005;

const args    = process.argv.slice(2);
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

/** Strip any existing ?v= so re-runs bump the version rather than stacking it. */
function splitVersion(url) {
  const i = String(url || '').indexOf('?');
  if (i < 0) return { base: url, version: 0 };
  const base  = url.slice(0, i);
  const m     = url.slice(i).match(/[?&]v=(\d+)/);
  return { base, version: m ? Number(m[1]) : 0 };
}

async function main() {
  const supabase = sb();

  let q = supabase.from('witb_players')
    .select('slug, name, headshot_url')
    .not('headshot_url', 'is', null);
  if (ONLY.length) q = q.in('slug', ONLY);
  const { data: players, error } = await q.order('slug');
  if (error) throw new Error(`witb_players read failed: ${error.message}`);

  console.log(`[normalize] ${players.length} player(s) with a headshot\n`);

  const stats = { ok: 0, fixed: 0, skippedTall: [], failed: [] };

  for (const p of players) {
    const { base, version } = splitVersion(p.headshot_url);

    let buf, meta;
    try {
      const res = await fetch(p.headshot_url);
      if (!res.ok) { stats.failed.push(`${p.slug} (fetch ${res.status})`); continue; }
      buf  = Buffer.from(await res.arrayBuffer());
      meta = await sharp(buf).metadata();
    } catch (e) {
      stats.failed.push(`${p.slug} (${e.message})`);
      continue;
    }

    const ratio = meta.width / meta.height;
    if (Math.abs(ratio - TARGET_RATIO) <= RATIO_TOLERANCE) { stats.ok++; continue; }

    // Taller than 4:5 would mean cropping height, which risks the top of the
    // head. Report it and move on rather than choose an anchor blindly.
    if (ratio < TARGET_RATIO) {
      stats.skippedTall.push(`${p.slug} (${meta.width}x${meta.height}, ratio ${ratio.toFixed(3)})`);
      continue;
    }

    // Full height, centred width. No resize: the source pixels are kept.
    const cropH = meta.height;
    const cropW = Math.round(cropH * TARGET_RATIO);
    const left  = Math.round((meta.width - cropW) / 2);

    console.log(`  ${p.slug.padEnd(24)} ${String(meta.width + 'x' + meta.height).padEnd(9)}`
      + ` ratio ${ratio.toFixed(3)}  ->  ${cropW}x${cropH}  (crop ${meta.width - cropW}px of width)`);

    if (DRY_RUN) { stats.fixed++; continue; }

    let out;
    try {
      out = await sharp(buf).extract({ left, top: 0, width: cropW, height: cropH }).png().toBuffer();
    } catch (e) {
      stats.failed.push(`${p.slug} (crop: ${e.message})`);
      continue;
    }

    const key = `${PREFIX}/${p.slug}.png`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(key, out, { contentType: 'image/png', upsert: true, cacheControl: '2592000' });
    if (upErr) { stats.failed.push(`${p.slug} (upload: ${upErr.message})`); continue; }

    const nextUrl = `${base}?v=${version + 1}`;
    const { error: dbErr } = await supabase.from('witb_players').update({
      headshot_url: nextUrl,
      headshot_updated_at: new Date().toISOString(),
    }).eq('slug', p.slug);
    if (dbErr) { stats.failed.push(`${p.slug} (db: ${dbErr.message})`); continue; }

    stats.fixed++;
  }

  console.log(`\n[normalize] already 4:5: ${stats.ok}   ${DRY_RUN ? 'would fix' : 'fixed'}: ${stats.fixed}`);
  if (stats.skippedTall.length) {
    console.log(`[normalize] taller than 4:5, NOT cropped (needs a human to pick the anchor):`);
    stats.skippedTall.forEach(s => console.log('            ' + s));
  }
  if (stats.failed.length) {
    console.log(`[normalize] failed (${stats.failed.length}):`);
    stats.failed.forEach(f => console.log('            ' + f));
  }
}

if (require.main === module) {
  main().catch(e => { console.error('[normalize] FATAL:', e.message); process.exit(1); });
}
