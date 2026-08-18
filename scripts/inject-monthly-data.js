#!/usr/bin/env node
/**
 * inject-monthly-data.js
 *
 * Usage:
 *   node scripts/inject-monthly-data.js <csv-path> <new-month-label>
 *   e.g. node scripts/inject-monthly-data.js ~/Downloads/May\ 2026\ Update.csv "May 2026"
 *
 * Reads a CSV with columns:
 *   Brand, Global, United States, Japan, United Kingdom, Canada, China,
 *   Germany, Australia, France, Sweden, South Korea
 *
 * Updates js/data.js:
 *   - Adds newMonth data to each brand's searchesByMarket for all 11 markets
 *   - Updates meta: currentMonth, previousMonth, threeMonthsAgo, lastUpdated
 *
 * Does NOT regenerate any derived files — run the rebuild pipeline after this.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const csvPath  = process.argv[2];
const newMonth = process.argv[3]; // e.g. "May 2026"

if (!csvPath || !newMonth) {
  console.error('Usage: node scripts/inject-monthly-data.js <csv-path> "May 2026"');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CSV column → data.js market key
// ---------------------------------------------------------------------------
const COL_MARKET = {
  'Global':         'global',
  'United States':  'us',
  'Japan':          'jp',
  'United Kingdom': 'uk',
  'Canada':         'ca',
  'China':          'cn',
  'Germany':        'de',
  'Australia':      'au',
  'France':         'fr',
  'Sweden':         'se',
  'South Korea':    'kr',
};

// ---------------------------------------------------------------------------
// Parse CSV (simple: no quoted newlines in brand data)
// ---------------------------------------------------------------------------
function parseCSV(filePath) {
  const text    = fs.readFileSync(filePath, 'utf8');
  const lines   = text.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const rows    = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const row  = {};
    headers.forEach((h, j) => { row[h] = (cols[j] || '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthLabelToYM(label) {
  const [mon, yr] = label.trim().split(' ');
  const m = MONTHS.indexOf(mon);
  if (m === -1 || !yr) throw new Error(`Bad month label: "${label}"`);
  return { y: parseInt(yr, 10), m: m + 1 };
}

function shiftMonthLabel(label, delta) {
  const { y, m } = monthLabelToYM(label);
  const total = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${MONTHS[nm - 1]} ${ny}`;
}

// ---------------------------------------------------------------------------
// Load data.js
// ---------------------------------------------------------------------------
const SITE_ROOT = path.resolve(__dirname, '..');
const DATA_JS   = path.join(SITE_ROOT, 'js', 'data.js');

console.log('[inject] Loading js/data.js…');
const code = fs.readFileSync(DATA_JS, 'utf8');
const ctx  = { window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const D = ctx.window.DORMIED_DATA;

// Verify newMonth not already present
const existingSample = D.brands[0];
if (existingSample.searchesByMarket.global[newMonth] !== undefined) {
  console.error(`[inject] ERROR: "${newMonth}" already exists in data.js for brand "${existingSample.id}". Aborting.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse CSV and build lookup: lowercase-name → { market → value }
// ---------------------------------------------------------------------------
console.log(`[inject] Parsing CSV: ${csvPath}`);
const { headers, rows } = parseCSV(csvPath);

// Validate CSV headers
const marketCols = headers.filter(h => h !== 'Brand');
for (const col of marketCols) {
  if (!COL_MARKET[col]) {
    console.error(`[inject] Unknown CSV column: "${col}". Add it to COL_MARKET map.`);
    process.exit(1);
  }
}

const csvLookup = {}; // lowercase name → { marketKey → number }
rows.forEach(row => {
  const name = (row['Brand'] || '').trim().toLowerCase();
  if (!name) return;
  const marketData = {};
  marketCols.forEach(col => {
    const key = COL_MARKET[col];
    marketData[key] = parseInt(row[col] || '0', 10) || 0;
  });
  csvLookup[name] = marketData;
});

console.log(`[inject] CSV parsed: ${Object.keys(csvLookup).length} brands`);

// ---------------------------------------------------------------------------
// Inject new month into each brand
// ---------------------------------------------------------------------------
let updated = 0;
let skipped = 0;

for (const brand of D.brands) {
  const key = brand.name.trim().toLowerCase();
  const csvData = csvLookup[key];
  if (!csvData) {
    console.warn(`  WARN: no CSV data for brand "${brand.name}" (${brand.id}) — skipping`);
    skipped++;
    continue;
  }

  for (const market of Object.keys(brand.searchesByMarket)) {
    const val = csvData[market];
    if (val === undefined) {
      console.warn(`  WARN: no "${market}" column for brand "${brand.name}" — setting 0`);
      brand.searchesByMarket[market][newMonth] = 0;
    } else {
      brand.searchesByMarket[market][newMonth] = val;
    }
  }
  updated++;
}

console.log(`[inject] Updated ${updated} brands, skipped ${skipped}`);

// ---------------------------------------------------------------------------
// Update meta
// ---------------------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
D.meta.lastUpdated    = today;
D.meta.currentMonth   = newMonth;
D.meta.previousMonth  = shiftMonthLabel(newMonth, -1);
D.meta.threeMonthsAgo = shiftMonthLabel(newMonth, -3);

console.log(`[inject] Meta updated:`);
console.log(`  lastUpdated:    ${D.meta.lastUpdated}`);
console.log(`  currentMonth:   ${D.meta.currentMonth}`);
console.log(`  previousMonth:  ${D.meta.previousMonth}`);
console.log(`  threeMonthsAgo: ${D.meta.threeMonthsAgo}`);

// ---------------------------------------------------------------------------
// Write data.js
// ---------------------------------------------------------------------------
const header = `// DORMIED Index — Brand Data\n// Generated ${today} — Full dataset with all 10 markets (${
  Object.keys(D.brands[0].searchesByMarket.global).length
} months each)\n`;
const output = header + `window.DORMIED_DATA = ${JSON.stringify(D, null, 2)};`;

fs.writeFileSync(DATA_JS, output, 'utf8');
console.log(`[inject] Written js/data.js (${(fs.statSync(DATA_JS).size / 1024).toFixed(0)}KB)`);

// Quick sanity check
const check = D.brands.find(b => b.id === 'callaway');
if (check) {
  const g = check.searchesByMarket.global[newMonth];
  console.log(`[inject] Sanity: Callaway global ${newMonth} = ${g.toLocaleString()}`);
}
