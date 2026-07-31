#!/usr/bin/env node
/**
 * DORMIED Content Pipeline — Step 2: Brand Matcher
 *
 * Reads unprocessed golf_wire_raw articles and matches them against
 * the DORMIED brand list (with aliases). Stores matches in golf_wire_matched
 * and marks raw articles as processed.
 *
 * Matching rules:
 * - Checks title + first 200 words of body
 * - Sorts brands by name length (longest first) to prevent partial matches
 * - Skips articles with zero brand matches
 * - Primary brand = first match found in title, or most-mentioned in body
 *
 * Usage:
 *   node scripts/match-brands.js
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const path             = require('path');
const fs               = require('fs');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

// Words that look like brand names but should not trigger a match on their own
const EXCLUSION_LIST = [
  'cobra',       // too generic without "Cobra Golf" context — keep if title mentions it
  'ping',        // same
  'wilson',      // same
  'full swing',  // common generic phrase in golf instruction; only match if in title
];

// Brands with autoMatch:false in _brands.json are excluded from pipeline matching
// entirely — "municipal" matches far too many generic golf articles


// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ── Brand list ────────────────────────────────────────────────────────────────

function loadBrands() {
  const brandsPath = path.join(__dirname, '../api/_brands.json');
  const raw = fs.readFileSync(brandsPath, 'utf8');
  const brands = JSON.parse(raw);

  // Build a flat list of { slug, terms[] } sorted longest-term first
  // Brands with autoMatch:false are excluded from automatic pipeline matching
  return brands
  .filter(b => b.autoMatch !== false)
  .map(b => {
    const terms = [b.name, ...(b.aliases || []), ...(b.matchTerms || [])];
    return { slug: b.id, name: b.name, terms };
  }).sort((a, b) => {
    // Sort by longest primary name first to avoid partial matches
    return b.name.length - a.name.length;
  });
}

// ── Matching ──────────────────────────────────────────────────────────────────

function buildSearchText(title, body) {
  const first200Words = body.split(/\s+/).slice(0, 200).join(' ');
  return title + ' ' + first200Words;
}

function matchBrands(searchText, brands, title) {
  const textLower = searchText.toLowerCase();
  const titleLower = title.toLowerCase();
  const matched   = [];

  for (const brand of brands) {
    for (const term of brand.terms) {
      if (!term || term.length < 3) continue;

      const termLower = term.toLowerCase();

      // Word-boundary match (handle both word chars and punctuation)
      const escaped = termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');

      if (re.test(textLower)) {
        // Apply exclusion list: skip if term is in exclusion list AND not in the actual title
        if (EXCLUSION_LIST.includes(termLower) && !re.test(titleLower)) {
          continue;
        }

        matched.push(brand.slug);
        break; // Only need one term match per brand
      }
    }
  }

  return [...new Set(matched)]; // deduplicate
}

function pickPrimaryBrand(title, allSlugs, brands) {
  if (allSlugs.length === 0) return null;
  if (allSlugs.length === 1) return allSlugs[0];

  const titleLower = title.toLowerCase();

  // Prefer the brand whose name appears in the title
  for (const slug of allSlugs) {
    const brand = brands.find(b => b.slug === slug);
    if (!brand) continue;
    for (const term of brand.terms) {
      if (titleLower.includes(term.toLowerCase())) return slug;
    }
  }

  // Fall back to first matched (longest name wins due to sort order)
  return allSlugs[0];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = getSupabase();
  const brands   = loadBrands();

  console.log(`[match] Loaded ${brands.length} brands`);

  // Fetch unprocessed raw articles
  const { data: articles, error: fetchErr } = await supabase
    .from('golf_wire_raw')
    .select('id, title, body')
    .eq('processed', false)
    .order('published_at', { ascending: false });

  if (fetchErr) {
    console.error('[match] Failed to fetch unprocessed articles:', fetchErr.message);
    process.exit(1);
  }

  console.log(`[match] ${articles.length} unprocessed articles to evaluate`);

  let matched = 0;
  let noMatch = 0;

  for (const article of articles) {
    const searchText   = buildSearchText(article.title, article.body);
    const allSlugs     = matchBrands(searchText, brands, article.title);
    const primarySlug  = pickPrimaryBrand(article.title, allSlugs, brands);

    if (!primarySlug) {
      console.log(`[match] No brand match: "${article.title}"`);
      noMatch++;
    } else {
      console.log(`[match] ✓ "${article.title}" → ${primarySlug} (all: ${allSlugs.join(', ')})`);

      const { error: insertErr } = await supabase
        .from('golf_wire_matched')
        .insert({
          raw_article_id:     article.id,
          primary_brand_slug: primarySlug,
          all_brand_slugs:    allSlugs,
        });

      if (insertErr && insertErr.code !== '23505') {
        console.warn(`[match] Insert failed for "${article.title}":`, insertErr.message);
      } else {
        matched++;
      }
    }

    // Mark as processed regardless of match result
    await supabase
      .from('golf_wire_raw')
      .update({ processed: true })
      .eq('id', article.id);
  }

  console.log(`[match] Done. Matched: ${matched}, No brand match: ${noMatch}`);
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => {
    console.error('[match] Fatal error:', err.message);
    process.exit(1);
  });
}