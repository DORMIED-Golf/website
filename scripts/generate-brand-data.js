#!/usr/bin/env node
/**
 * generate-brand-data.js
 * Generates /js/brand-data/{slug}.js — one per brand.
 * Each file exposes window.DORMIED_DATA with:
 *   - meta (currentMonth, previousMonth)
 *   - Full brand object for this brand (all months, all fields)
 *   - Slim {id, searchesByMarket:{global:{cm,pm}}} for ALL other brands (for rank calc)
 *
 * Article pages load this instead of the full 1.5MB data.js.
 * Typical output: ~15–25KB per file vs 1.5MB.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SITE_ROOT   = path.resolve(__dirname, '..');
const DATA_JS     = path.join(SITE_ROOT, 'js', 'data.js');
const OUT_DIR     = path.join(SITE_ROOT, 'js', 'brand-data');

// ── Load full data ─────────────────────────────────────────────────────────────
const code = fs.readFileSync(DATA_JS, 'utf8');
const ctx  = { window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const D    = ctx.window.DORMIED_DATA;

const cm = D.meta.currentMonth;
const pm = D.meta.previousMonth;

// ── Prepare slim records for all brands (for rank calculation) ─────────────────
// {id, name, searchesByMarket: {global: {[cm]: v, [pm]: v}}}
const slimBrands = D.brands.map(b => {
  const g = (b.searchesByMarket && b.searchesByMarket.global) || {};
  return { id: b.id, searchesByMarket: { global: { [cm]: g[cm] || 0, [pm]: g[pm] || 0 } } };
});

// ── Output dir ─────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });

let count = 0;

for (const brand of D.brands) {
  // Replace the slim record for this brand with its full object
  const brands = slimBrands.map(s => (s.id === brand.id ? brand : s));

  const payload = {
    meta:   D.meta,
    brands,
  };

  const js = `window.DORMIED_DATA=${JSON.stringify(payload)};`;
  const outPath = path.join(OUT_DIR, `${brand.id}.js`);
  fs.writeFileSync(outPath, js);
  count++;
}

console.log(`[brand-data] Generated ${count} per-brand files → js/brand-data/`);

// Print size stats for a sample
const samples = ['titleist', 'callaway', 'pxg', 'taylormade'];
for (const id of samples) {
  const f = path.join(OUT_DIR, `${id}.js`);
  if (fs.existsSync(f)) {
    const kb = (fs.statSync(f).size / 1024).toFixed(1);
    console.log(`  ${id}.js  → ${kb}KB`);
  }
}
