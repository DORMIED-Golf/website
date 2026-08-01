#!/usr/bin/env node
/**
 * scripts/import-new-brands.js
 *
 * One-off: import the "40 New Brands" workbook into js/data.js, taking the
 * Index from 215 brands to 215.
 *
 * js/data.js is the source of truth. Everything downstream derives from it:
 *   js/data.js
 *     -> generate-brand-data.js   -> js/brand-data/{slug}.js
 *     -> backfill-brand-scores.js -> dormied_brand_scores
 *     -> refresh-brand-summary.js -> dormied_monthly_brand_summary
 *
 * So this script only writes js/data.js; the rest is run afterwards.
 *
 * Field policy, per the brief: publish what the sheet has. A cell that is
 * genuinely empty becomes null; a cell that has a value but carries a VERIFY
 * note in the workbook is published as-is.
 *
 * Usage:
 *   node scripts/import-new-brands.js --dry-run
 *   node scripts/import-new-brands.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DRY   = process.argv.includes('--dry-run');
const ROOT  = path.resolve(__dirname, '..');
const DATA  = path.join(ROOT, 'js', 'data.js');
const XLSX  = process.env.NEW_BRANDS_XLSX ||
              '/Users/travisr/Downloads/40 New Brands.xlsx';

// Workbook sheet -> the market key used in searchesByMarket.
const SHEET_TO_MARKET = {
  'Global': 'global',
  'United States': 'us',
  'Canada': 'ca',
  'UK': 'uk',
  'Japan': 'jp',
  'South Korea': 'kr',
  'China': 'cn',
  'Australia': 'au',
  'Germany': 'de',
  'France': 'fr',
  'Sweden': 'se',
};

// Parent-company corrections that span this batch and the existing 175.
// Adding one side of a relationship without the other creates a factual
// inconsistency, so they are applied together.
const PARENT_FIXES = {
  // Uneekor acquired Evnroll in 2023. Evnroll is an existing brand; Uneekor
  // arrives in this batch, so the existing row has to move too.
  'evnroll': 'Uneekor',

  // Never Compromise joins Cleveland, Srixon and XXIO under the same owner, but
  // the three existing rows say "Dunlop Sports" while the sheet says "Sumitomo
  // Rubber Industries". One owner should not read as two companies, so all four
  // are normalised to the fuller form that names both the group and the
  // operating unit golfers recognise.
  'cleveland-golf': 'Sumitomo Rubber Industries (Dunlop Sports)',
  'srixon':         'Sumitomo Rubber Industries (Dunlop Sports)',
  'xxio':           'Sumitomo Rubber Industries (Dunlop Sports)',
};

// Incoming values overridden so a new brand matches how its siblings already
// read. Keyed by slug.
const INCOMING_PARENT_OVERRIDES = {
  'never-compromise': 'Sumitomo Rubber Industries (Dunlop Sports)',
};

const slugify = n => String(n).toLowerCase().replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const clean = v => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Read the workbook via python/openpyxl — no new npm dependency. */
function readWorkbook() {
  const py = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(${JSON.stringify(XLSX)}, data_only=True)
out = {'brands': [], 'markets': {}}
ws = wb['Brands']; hdr = [c.value for c in ws[1]]
for r in ws.iter_rows(min_row=2, values_only=True):
    if not r[0]: continue
    out['brands'].append(dict(zip(hdr, [None if c is None else (c if isinstance(c,(int,float)) else str(c)) for c in r])))
for name in wb.sheetnames:
    if name == 'Brands': continue
    s = wb[name]; h = [c.value for c in s[1]]
    months = [str(x).replace('Searches: ','') for x in h[1:]]
    rows = {}
    for r in s.iter_rows(min_row=2, values_only=True):
        if not r[0]: continue
        rows[str(r[0]).strip()] = {m: (0 if v is None else int(v)) for m, v in zip(months, r[1:])}
    out['markets'][name] = rows
json.dump(out, sys.stdout)
`;
  return JSON.parse(execFileSync('python3', ['-c', py], { maxBuffer: 64 * 1024 * 1024 }));
}

function main() {
  if (!fs.existsSync(XLSX)) { console.error(`[import] Workbook not found: ${XLSX}`); process.exit(1); }

  const wb = readWorkbook();
  console.log(`[import] workbook: ${wb.brands.length} brands, ${Object.keys(wb.markets).length} market sheets`);

  const raw = fs.readFileSync(DATA, 'utf8');
  const open = raw.indexOf('{');
  const close = raw.lastIndexOf('}');
  const prefix = raw.slice(0, open);
  const suffix = raw.slice(close + 1);
  const data = JSON.parse(raw.slice(open, close + 1));

  const existing = new Set(data.brands.map(b => b.id));
  console.log(`[import] js/data.js currently holds ${data.brands.length} brands (meta.totalBrands=${data.meta.totalBrands})`);

  // Month axis must match what the existing brands carry, or the charts and
  // rank maths silently compare different windows.
  const refMonths = Object.keys(data.brands[0].searchesByMarket.global);
  const sheetMonths = Object.keys(wb.markets['Global'][Object.keys(wb.markets['Global'])[0]]);
  const missing = refMonths.filter(m => !sheetMonths.includes(m));
  const extra   = sheetMonths.filter(m => !refMonths.includes(m));
  if (missing.length || extra.length) {
    console.error(`[import] MONTH AXIS MISMATCH — refusing to import.`);
    if (missing.length) console.error(`   in data.js but not the sheet: ${missing.join(', ')}`);
    if (extra.length)   console.error(`   in the sheet but not data.js: ${extra.join(', ')}`);
    process.exit(1);
  }
  console.log(`[import] month axis matches (${refMonths.length} months, ${refMonths[0]} .. ${refMonths[refMonths.length-1]})`);

  const added = [];
  const skipped = [];

  for (const row of wb.brands) {
    const name = String(row['Brand']).trim();
    const id = slugify(name);
    if (existing.has(id)) { skipped.push(`${name} (${id}) already present`); continue; }

    const cats = String(row['Category'] || '').split(';').map(s => s.trim()).filter(Boolean);
    const subs = String(row['Sub Category'] || '').split(';').map(s => s.trim()).filter(Boolean);

    const searchesByMarket = {};
    for (const [sheet, market] of Object.entries(SHEET_TO_MARKET)) {
      const rows = wb.markets[sheet];
      if (!rows) { console.error(`[import] missing sheet ${sheet}`); process.exit(1); }
      const series = rows[name];
      if (!series) { console.error(`[import] ${name} missing from sheet ${sheet}`); process.exit(1); }
      // Re-key in the reference month order so every brand's series lines up.
      searchesByMarket[market] = Object.fromEntries(refMonths.map(m => [m, series[m] ?? 0]));
    }

    const foundedRaw = row['Founded'];
    const founded = foundedRaw === null || foundedRaw === undefined || foundedRaw === ''
      ? null : parseInt(String(foundedRaw), 10);

    added.push({
      id,
      name,
      logo: `/images/logos/${id}.jpg`,
      website: clean(row['URL']),
      headquarters: clean(row['Headquarters']),
      founded: Number.isFinite(founded) ? founded : null,
      parentCompany: INCOMING_PARENT_OVERRIDES[id] || clean(row['Parent Company']),
      category: cats[0] || null,
      allCategories: cats,
      subCategories: subs,
      description: clean(row['Description']),
      searchesByMarket,
    });
  }

  console.log(`[import] ${added.length} to add, ${skipped.length} skipped`);
  for (const s of skipped) console.log(`   skip: ${s}`);

  // Cross-batch parent-company corrections on EXISTING rows.
  const fixed = [];
  for (const b of data.brands) {
    if (PARENT_FIXES[b.id] && b.parentCompany !== PARENT_FIXES[b.id]) {
      fixed.push(`${b.id}: "${b.parentCompany}" -> "${PARENT_FIXES[b.id]}"`);
      if (!DRY) b.parentCompany = PARENT_FIXES[b.id];
    }
  }
  for (const f of fixed) console.log(`[import] parent fix: ${f}`);

  const total = data.brands.length + added.length;
  console.log(`[import] totalBrands ${data.meta.totalBrands} -> ${total}`);

  if (DRY) {
    console.log('\n[import] DRY RUN — nothing written. Sample of what would be added:');
    for (const b of added.slice(0, 3)) {
      const g = b.searchesByMarket.global;
      console.log(`   ${b.id}: ${b.category} | ${b.parentCompany} | founded ${b.founded} | Jun 2026 global ${g['Jun 2026']}`);
    }
    return;
  }

  data.brands.push(...added);
  data.brands.sort((a, b) => a.id.localeCompare(b.id));
  data.meta.totalBrands = total;

  fs.writeFileSync(DATA, prefix + JSON.stringify(data, null, 2) + suffix);
  console.log(`[import] wrote js/data.js — ${data.brands.length} brands`);
  console.log('\n[import] now run, in order:');
  console.log('  node scripts/generate-brand-data.js');
  console.log('  node scripts/backfill-brand-scores.js');
  console.log('  node scripts/refresh-brand-summary.js');
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main();
}
