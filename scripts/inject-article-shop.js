#!/usr/bin/env node
/**
 * scripts/inject-article-shop.js
 *
 * Adds the "Shop [Brand]" carousel to already-published news articles whose
 * primary brand has become sellable since the page was generated (Global
 * Golf's feed, Sep 2026, took sellable brands from 15 to ~90).
 *
 * generate-article.js emits the section at build time only, and a full
 * `--regenerate-all` re-render is not faithful to what shipped (it refreshes
 * brand-card figures and publish times), so this inserts exactly what the
 * generator would have: the shared mount from lib/shop-section.js directly
 * after the primary brand card, and the carousel script after da-article.
 * Features are skipped (they opt in per feature via inlineCommerce), as are
 * pages that already carry a carousel. Idempotent.
 *
 *   node scripts/inject-article-shop.js --dry-run
 *   node scripts/inject-article-shop.js
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true, quiet: true });

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { fetchSellableBrandSlugs } = require('./lib/sellable-brands');
const { articleShopSectionHtml }  = require('./lib/shop-section');
const { js: jsVersion } = require('./lib/asset-version.js');

const ROOT = path.resolve(__dirname, '..');
const DRY  = process.argv.includes('--dry-run');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const unesc = s => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Index just past the </div> that closes the <div> opening at `start`. */
function endOfDiv(html, start) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const sellable = await fetchSellableBrandSlugs(sb);
  const featureSrc = fs.readFileSync(path.join(__dirname, 'generate-feature.js'), 'utf8');
  const features = new Set([...featureSrc.matchAll(/^ {4}slug: '([a-z0-9-]+)',/gm)].map(m => m[1]));
  const script = `<script defer src="/js/shop-carousel.min.js?v=${jsVersion('shop-carousel.min.js')}"></script>`;

  const stats = { scanned: 0, already: 0, feature: 0, noCard: 0, notSellable: 0, noAnchor: 0, injected: 0 };
  const byBrand = {};
  const newsDir = path.join(ROOT, 'news');
  for (const slug of fs.readdirSync(newsDir)) {
    if (slug === 'page') continue;
    const f = path.join(newsDir, slug, 'index.html');
    if (!fs.existsSync(f)) continue;
    stats.scanned++;
    if (features.has(slug)) { stats.feature++; continue; }
    let html = fs.readFileSync(f, 'utf8');
    if (html.includes('id="bp-shop-section"')) {
      // Prune: a mount whose brand is no longer sellable (e.g. its retailer
      // stock is all pre-owned) would render an empty "Shop X" heading and
      // disclosure until the script removed it. Exactly the inserted block.
      const mount = html.match(/\n\s*<!-- ── Shop [^\n]*\(affiliate\) ── -->\n\s*<section class="bp-shop-section" id="bp-shop-section" data-brand-slug="([^"]+)"[\s\S]*?<\/section>\n/);
      if (mount && !sellable.has(mount[1])) {
        html = html.replace(mount[0], '\n').replace(/\n\s*<script defer src="\/js\/shop-carousel\.min\.js\?v=[^"]*"><\/script>/, '');
        if (!DRY) fs.writeFileSync(f, html);
        stats.pruned = (stats.pruned || 0) + 1;
        byBrand['-' + mount[1]] = (byBrand['-' + mount[1]] || 0) + 1;
        continue;
      }
      stats.already++; continue;
    }

    const cardStart = html.indexOf('<div class="da-brand-card">');
    if (cardStart === -1) { stats.noCard++; continue; }
    const cardEnd = endOfDiv(html, cardStart);
    const card = html.slice(cardStart, cardEnd);
    const brandSlug = (card.match(/href="\/brands\/([^/"]+)\/" class="da-brand-card-cta"/) || [])[1];
    const brandName = (card.match(/class="da-brand-card-name">([^<]+)</) || [])[1];
    if (!brandSlug || !brandName || cardEnd === -1) { stats.noCard++; continue; }
    if (!sellable.has(brandSlug)) { stats.notSellable++; continue; }

    const daScript = html.match(/<script src="\/js\/da-article\.min\.js\?v=[^"]*"><\/script>/);
    if (!daScript) { stats.noAnchor++; continue; }

    html = html.slice(0, cardEnd) + articleShopSectionHtml(brandSlug, unesc(brandName), esc) + html.slice(cardEnd);
    html = html.replace(daScript[0], `${daScript[0]}\n  ${script}`);
    if (!DRY) fs.writeFileSync(f, html);
    stats.injected++;
    byBrand[brandSlug] = (byBrand[brandSlug] || 0) + 1;
  }
  console.log(`[inject-shop]${DRY ? ' (dry-run)' : ''}`, JSON.stringify(stats));
  console.log('[inject-shop] by brand:', Object.entries(byBrand).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(', '));
})().catch(e => { console.error('[inject-shop] Fatal:', e.message); process.exit(1); });
