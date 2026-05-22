#!/usr/bin/env node
/**
 * AdSense Remediation — Operation A: Merge 5 Clusters + 1 standalone redirect
 *
 * For each cluster:
 *   1. Merge removed articles' bodies into the keep article (new sections)
 *   2. Set removed articles to status='suppressed' in DB
 *   3. Delete HTML files for removed articles
 *   4. Add 301 redirects to vercel.json
 *   5. Re-publish TravisMathew keep article (was suppressed), update title
 *
 * Then: run generate-article.js --regenerate-all to rebuild HTML for keep articles.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs             = require('fs');
const path           = require('path');
const { execSync }   = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const SITE_ROOT = path.resolve(__dirname, '..');

// ── Cluster definitions ───────────────────────────────────────────────────────

const CLUSTERS = [
  {
    name: 'PXG',
    keep: 'pxg-finally-admits-it-needs-big-box-retail-to-survive-2026-04-14',
    remove: [
      { slug: 'pxg-blinks-first-the-dtc-purist-heads-to-big-box-retail-2026-04-14',  sectionTitle: 'When the DTC Purist Blinks' },
      { slug: 'pxg-turns-masters-week-into-a-retail-footfall-play-2026-04-06',         sectionTitle: 'Masters Week as a Retail Test' },
      { slug: 'pxgs-fitting-pitch-feels-like-2018-all-over-again-2026-04-16',          sectionTitle: 'The Fitting Pitch Problem' },
    ],
  },
  {
    name: 'SuperStroke',
    keep: 'superstroke-rides-mcilroys-back-to-back-masters-win-into-rel-2026-04-13',
    remove: [
      { slug: 'rory-mcilroys-back-to-back-masters-wins-put-superstroke-back-2026-04-13', sectionTitle: "McIlroy's Back-to-Back and What It Means" },
      { slug: 'superstrokes-patriotic-putter-grip-is-the-right-kind-of-limi-2026-04-15', sectionTitle: 'The Limited-Edition Strategy' },
    ],
  },
  {
    name: 'Sun Mountain',
    keep: 'why-sun-mountain-is-doubling-down-on-womens-bags-while-compe-2026-04-14',
    remove: [
      { slug: 'sun-mountains-camo-play-is-smarter-than-it-looks-2026-04-06',            sectionTitle: 'The Camo Strategy' },
      { slug: 'sun-mountains-clubglider-wins-back-to-back-mygolfspy-travel-2026-04-15', sectionTitle: 'Travel Bag Validation' },
    ],
  },
  {
    name: 'TravisMathew',
    keep: 'reggie-bushs-third-travismathew-drop-signals-the-brands-long-2026-04-17',
    keepTitle: "TravisMathew's Lifestyle Play: Inside the Brand's 2026 Expansion Beyond Golf",
    keepRepublish: true, // was suppressed; re-publish as the merged anchor
    remove: [
      { slug: 'travismathew-and-peloton-team-up-to-chase-the-athleisure-cro-2026-04-17', sectionTitle: 'The Peloton Partnership' },
      { slug: 'travismathew-goes-full-hypebeast-with-1759-pair-guinness-dr-2026-04-17',  sectionTitle: 'The Hypebeast Move' },
      { slug: 'travismathew-is-betting-big-on-country-music-and-it-might-a-2026-04-17',  sectionTitle: 'Country Music as Brand Strategy' },
    ],
  },
  {
    name: 'Original Penguin',
    keep: 'original-penguin-bets-its-golf-future-on-nostalgia-that-migh-2026-04-14',
    remove: [
      { slug: 'original-penguin-is-betting-its-womens-line-on-the-picklebal-2026-04-15', sectionTitle: "The Women's and Pickleball Bet" },
    ],
  },
];

// Standalone redirect (not part of a content merge, just a URL consolidation)
const STANDALONE_REDIRECTS = [
  {
    source: 'nippon-shaft-bets-on-black-chrome-to-match-the-murdered-out-2026-04-10',
    dest:   'gts-fairways-hit-tour-bags-as-titleists-metalwood-dominance-2026-04-13',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Fetch all relevant article bodies up front
  const allSlugs = [
    ...CLUSTERS.flatMap(c => [c.keep, ...c.remove.map(r => r.slug)]),
    ...STANDALONE_REDIRECTS.map(r => r.source),
  ];

  const { data: articles, error: fetchErr } = await sb
    .from('dormied_articles')
    .select('slug, title, body, status, brand_slug, secondary_brand_slugs, published_at, image_url, source_url, source_name, meta_description, seo_keywords, category, author')
    .in('slug', allSlugs);

  if (fetchErr) { console.error('[A] Fetch error:', fetchErr.message); process.exit(1); }

  const bySlug = {};
  articles.forEach(a => { bySlug[a.slug] = a; });

  // ── Read + update vercel.json ──────────────────────────────────────────────
  const vercelPath = path.join(SITE_ROOT, 'vercel.json');
  const vercel     = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  if (!Array.isArray(vercel.redirects)) vercel.redirects = [];

  // Helper: add both /news/SLUG and /news/SLUG/ redirects
  function addRedirect(removedSlug, keepSlug) {
    const src  = `/news/${removedSlug}`;
    const dest = `/news/${keepSlug}`;
    // Avoid duplicates
    const exists = vercel.redirects.some(r => r.source === src);
    if (!exists) {
      vercel.redirects.push({ source: src,  destination: dest,  permanent: true });
      vercel.redirects.push({ source: src + '/', destination: dest + '/', permanent: true });
      console.log(`[A] Redirect: ${src} → ${dest}`);
    } else {
      console.log(`[A] Redirect already exists: ${src}`);
    }
  }

  // ── Process clusters ───────────────────────────────────────────────────────
  for (const cluster of CLUSTERS) {
    console.log(`\n[A] Processing cluster: ${cluster.name}`);

    const keepArt = bySlug[cluster.keep];
    if (!keepArt) { console.error(`[A] KEEP article not found: ${cluster.keep}`); continue; }

    // Build merged body: start with keep's body, then append each removed article's body
    let mergedBody = keepArt.body;

    for (const { slug, sectionTitle } of cluster.remove) {
      const removeArt = bySlug[slug];
      if (!removeArt) { console.warn(`[A] Remove article not found: ${slug}`); continue; }

      // Append section
      mergedBody += `\n\n${sectionTitle}\n\n${removeArt.body}`;
    }

    const mergedWc = wordCount(mergedBody);
    console.log(`[A] ${cluster.name} merged body: ${mergedWc} words`);

    // Update KEEP article in DB
    const keepUpdate = {
      body:   mergedBody,
      status: 'published',
    };
    if (cluster.keepTitle) keepUpdate.title = cluster.keepTitle;

    const { error: keepErr } = await sb
      .from('dormied_articles')
      .update(keepUpdate)
      .eq('slug', cluster.keep);
    if (keepErr) { console.error(`[A] Failed to update KEEP ${cluster.keep}:`, keepErr.message); }
    else { console.log(`[A] Updated KEEP: ${cluster.keep} (${mergedWc} words)`); }

    // Process each REMOVE article
    for (const { slug } of cluster.remove) {
      const removeArt = bySlug[slug];
      if (!removeArt) continue;

      // 1. Soft-delete in DB (set suppressed)
      const { error: suppErr } = await sb
        .from('dormied_articles')
        .update({ status: 'suppressed' })
        .eq('slug', slug);
      if (suppErr) { console.warn(`[A] Suppress failed for ${slug}:`, suppErr.message); }
      else { console.log(`[A] Suppressed: ${slug}`); }

      // 2. Delete HTML file
      const htmlPath = path.join(SITE_ROOT, 'news', slug, 'index.html');
      if (fs.existsSync(htmlPath)) {
        fs.rmSync(htmlPath);
        // Try to remove directory if empty (rmSync on the index.html only; dir needs separate handling)
        try { fs.rmdirSync(path.join(SITE_ROOT, 'news', slug)); } catch {}
        console.log(`[A] Deleted HTML: news/${slug}/index.html`);
      } else {
        console.log(`[A] HTML already absent: news/${slug}/index.html`);
      }

      // 3. Add redirect
      addRedirect(slug, cluster.keep);
    }
  }

  // ── Process standalone redirects ───────────────────────────────────────────
  console.log('\n[A] Processing standalone redirects...');
  for (const { source, dest } of STANDALONE_REDIRECTS) {
    // Suppress source in DB
    const { error: suppErr } = await sb
      .from('dormied_articles')
      .update({ status: 'suppressed' })
      .eq('slug', source);
    if (suppErr) { console.warn(`[A] Suppress failed for ${source}:`, suppErr.message); }
    else { console.log(`[A] Suppressed standalone: ${source}`); }

    // Delete HTML file
    const htmlPath = path.join(SITE_ROOT, 'news', source, 'index.html');
    if (fs.existsSync(htmlPath)) {
      fs.rmSync(htmlPath);
      try { fs.rmdirSync(path.join(SITE_ROOT, 'news', source)); } catch {}
      console.log(`[A] Deleted HTML: news/${source}/index.html`);
    }

    // Add redirect
    addRedirect(source, dest);
  }

  // ── Write updated vercel.json ──────────────────────────────────────────────
  fs.writeFileSync(vercelPath, JSON.stringify(vercel, null, 2) + '\n', 'utf8');
  console.log('\n[A] Updated vercel.json with redirects.');

  // ── Regenerate HTML for KEEP articles ─────────────────────────────────────
  console.log('\n[A] Running --regenerate-all to rebuild KEEP article HTML...');
  execSync('node scripts/generate-article.js --regenerate-all', {
    cwd:   SITE_ROOT,
    stdio: 'inherit',
  });

  console.log('\n[A] Operation A complete.');
}

main().catch(err => {
  console.error('[A] Fatal:', err.message);
  process.exit(1);
});
