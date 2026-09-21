#!/usr/bin/env node
/**
 * scripts/sync-article-robots.js
 *
 * Keeps each article page's robots meta in step with its publish status.
 *
 * WHY THIS EXISTS
 * The pipeline commits an article's HTML before publish-articles.js promotes
 * its row, and an article held on the image gate keeps that committed page
 * while the row stays draft. generate-sitemap.js correctly refuses to list a
 * draft -- but the page is still deployed, still returns 200, and still says
 * "index, follow". So a held draft was crawlable while being deliberately kept
 * out of the sitemap: the one combination nobody wants, because Google can
 * reach it through the feed and index a story we judged not ready.
 *
 * Two were live in exactly that state when this was written:
 *   ben-hogan-golf-900-000-copies    image 395x287 (5px under the width floor)
 *   taylormade-1-21-mph-gap-becomes  image 338x107
 *
 * WHAT IT DOES
 * Reads status from dormied_articles and rewrites the robots meta to match:
 *   draft     -> noindex, follow   (crawl the links, do not index the page)
 *   published -> index, follow     (plus the existing preview directives)
 * "follow" either way: a held draft's internal links should still pass through
 * to the brand and WITB pages it references.
 *
 * It is idempotent and safe to run on every build. It never changes anything
 * but the robots meta, and it never invents a status: a page whose slug has no
 * row is left exactly as it is and reported, because that is a different bug
 * (an orphaned page) and guessing would hide it.
 *
 * ORDERING: run it AFTER publish-articles.js, so articles promoted in this run
 * get their "index" back in the same commit that makes them live. Running it
 * before would leave a just-published article noindexed until the next build.
 *
 *   node scripts/sync-article-robots.js --dry-run   # report, write nothing
 *   node scripts/sync-article-robots.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require('dotenv').config({ path: path.join(ROOT, '.env'), override: true, quiet: true });

const { createClient } = require('@supabase/supabase-js');

const DRY = process.argv.includes('--dry-run');

/** The preview directives every article carries, published or not. */
const PREVIEW = 'max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const ROBOTS  = {
  published: `index, follow, ${PREVIEW}`,
  draft:     `noindex, follow, ${PREVIEW}`,
};

function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('[robots] SUPABASE_URL / SUPABASE_SERVICE_KEY missing');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  return (async () => {
    // Page through the table; a .select() without a range caps at 1000 rows and
    // would silently treat everything past that as "no row".
    const statusBySlug = new Map();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('dormied_articles')
        .select('slug, status')
        .range(from, from + 999);
      if (error) {
        console.error('[robots] Failed to read dormied_articles:', error.message);
        process.exit(1);
      }
      for (const r of data) statusBySlug.set(r.slug, r.status);
      if (data.length < 1000) break;
    }

    const newsDir = path.join(ROOT, 'news');
    const slugs = fs.readdirSync(newsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'page')
      .map(d => d.name)
      .filter(s => fs.existsSync(path.join(newsDir, s, 'index.html')));

    let changed = 0, already = 0;
    const orphans = [], changes = [];

    for (const slug of slugs) {
      const status = statusBySlug.get(slug);
      if (!status) { orphans.push(slug); continue; }

      const want = ROBOTS[status === 'published' ? 'published' : 'draft'];
      const file = path.join(newsDir, slug, 'index.html');
      const html = fs.readFileSync(file, 'utf8');

      const m = html.match(/<meta\s+name="robots"\s+content="([^"]*)"\s*\/?>/i);
      if (!m) { orphans.push(`${slug} (no robots meta)`); continue; }
      if (m[1] === want) { already++; continue; }

      changes.push(`${slug}: "${m[1].split(',')[0]}" -> "${want.split(',')[0]}"  [${status}]`);
      if (!DRY) {
        fs.writeFileSync(file, html.replace(m[0], `<meta name="robots" content="${want}">`), 'utf8');
      }
      changed++;
    }

    console.log(`[robots] ${slugs.length} article page(s); ${already} already correct, ${changed} ${DRY ? 'would be' : ''} rewritten.`);
    for (const c of changes) console.log(`[robots]   ${c}`);
    if (orphans.length) {
      console.warn(`[robots] ${orphans.length} page(s) with no database row or no robots meta — left untouched:`);
      for (const o of orphans.slice(0, 20)) console.warn(`[robots]   - ${o}`);
    }
  })();
}

main();
