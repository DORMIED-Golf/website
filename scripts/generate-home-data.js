#!/usr/bin/env node
/**
 * generate-home-data.js
 * Generates /js/data-home.js — a slim dataset for the homepage only.
 *
 * Includes only what home.js, feed.js need:
 *   - meta (full)
 *   - Brand: id, name, logo, category, founded, headquarters
 *   - searchesByMarket.global: 7 months (cm, cm-1…cm-5, cm-12)
 *   - searchesByMarket.[other markets]: 2 months (cm, cm-1)
 *
 * Result: ~60-80KB vs 1.5MB (data.js)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SITE_ROOT = path.resolve(__dirname, '..');
const DATA_JS   = path.join(SITE_ROOT, 'js', 'data.js');
const OUT_FILE  = path.join(SITE_ROOT, 'js', 'data-home.js');

// ── Load full data ─────────────────────────────────────────────────────────────
const code = fs.readFileSync(DATA_JS, 'utf8');
const ctx  = { window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const D = ctx.window.DORMIED_DATA;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function shiftMonth(label, delta) {
  const parts = label.split(' ');
  const total = parseInt(parts[1]) * 12 + MONTHS.indexOf(parts[0]) + delta;
  return MONTHS[((total % 12) + 12) % 12] + ' ' + Math.floor(total / 12);
}

const cm  = D.meta.currentMonth;
const pm  = D.meta.previousMonth; // = cm-1

// Months needed for global (home.js rankings + h2h trend + feed.js)
const globalMonths = [
  shiftMonth(cm, -12),
  shiftMonth(cm, -5),
  shiftMonth(cm, -4),
  shiftMonth(cm, -3),
  shiftMonth(cm, -2),
  shiftMonth(cm, -1),
  cm,
];

// All market keys
const marketKeys = D.meta.markets.map(m => m.key);

// ── Build slim brands ─────────────────────────────────────────────────────────
const slimBrands = D.brands.map(b => {
  const sbm = {};
  for (const mkt of marketKeys) {
    const g = (b.searchesByMarket && b.searchesByMarket[mkt]) || {};
    if (mkt === 'global') {
      const slim = {};
      for (const mo of globalMonths) {
        if (g[mo] !== undefined) slim[mo] = g[mo];
      }
      sbm.global = slim;
    } else {
      // Other markets: only cm and cm-1 (for market pulse)
      const slim = {};
      if (g[cm]  !== undefined) slim[cm]  = g[cm];
      if (g[pm]  !== undefined) slim[pm]  = g[pm];
      if (Object.keys(slim).length) sbm[mkt] = slim;
    }
  }

  return {
    id:           b.id,
    name:         b.name,
    logo:         b.logo         || null,
    category:     b.category     || null,
    founded:      b.founded      || null,
    headquarters: b.headquarters || null,
    searchesByMarket: sbm,
  };
});

// ── Write output ──────────────────────────────────────────────────────────────
const payload = { meta: D.meta, brands: slimBrands };
const js = `// data-home.js — Homepage-only slim dataset. Auto-generated.\nwindow.DORMIED_DATA=${JSON.stringify(payload)};`;
fs.writeFileSync(OUT_FILE, js);

const origKB  = (fs.statSync(DATA_JS).size  / 1024).toFixed(0);
const slimKB  = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
const savings = (100 - (slimKB / origKB) * 100).toFixed(0);

console.log(`[home-data] data.js: ${origKB}KB  →  data-home.js: ${slimKB}KB  (${savings}% smaller)`);
console.log(`[home-data] Written: ${OUT_FILE}`);
