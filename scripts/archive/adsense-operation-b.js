#!/usr/bin/env node
/**
 * AdSense Remediation — Operation B: Expand 17 thin standalone articles + 2 keep articles
 *
 * For each article: call Opus to generate a 200-400 word analytical section,
 * append to body, verify 600+ words, update DB, then regenerate HTML.
 *
 * Travis voice, no em dashes, don't repeat existing content.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const fs             = require('fs');
const path           = require('path');
const { execSync }   = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const Anthropic      = require('@anthropic-ai/sdk');

const SITE_ROOT  = path.resolve(__dirname, '..');
const MODEL      = 'claude-opus-4-5';
const MIN_WORDS  = 600;
const TARGET_NEW = 350; // target words per expansion section

const SLUGS = [
  'bettinardis-copper-wedges-are-a-250-bet-on-patina-obsessed-g-2026-04-17',
  'cleveland-golf-is-now-paying-you-to-play-through-a-rewards-a-2026-04-15',
  'five-iron-golf-is-building-a-pipeline-from-simulator-bays-to-2026-04-13',
  'foresight-sports-locks-down-another-tour-deal-while-its-cons-2026-04-19',
  'full-swings-disappearing-act-from-tigers-garage-to-marriotts-2026-04-13',
  'gts-fairways-hit-tour-bags-as-titleists-metalwood-dominance-2026-04-13',
  'jj-spauns-texas-open-win-gives-puma-something-it-desperately-2026-04-05',
  'mini-drivers-are-no-longer-a-niche-callaway-just-made-that-o-2026-04-16',
  'odyssey-just-made-zero-torque-putters-look-normal-that-chang-2026-04-16',
  'rory-mcilroy-puts-500k-behind-youth-golf-access-but-the-real-2026-04-08',
  'the-550-fairway-wood-is-here-and-callaway-isnt-apologizing-2026-04-16',
  'the-hybrid-is-dying-on-the-pga-tour-heres-why-that-doesnt-ma-2026-04-17',
  'vice-golf-partners-with-uneekor-for-major-season-giveaway-pu-2026-04-08',
  'wilson-goes-big-in-times-square-but-can-billboards-fix-a-bra-2026-04-09',
  'mygolfspy-just-called-the-adipower-26-the-best-value-in-golf-2026-04-17',
  'the-standard-srixon-zxi-just-beat-every-driver-in-mygolfspys-2026-04-17',
  'tour-edge-just-beat-the-big-four-in-driver-testing-time-to-s-2026-04-17',
  // Under-600 keep articles from Operation A
  'superstroke-rides-mcilroys-back-to-back-masters-win-into-rel-2026-04-13',
  'original-penguin-bets-its-golf-future-on-nostalgia-that-migh-2026-04-14',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sanitize(text) {
  // Replace em dashes with commas (site rule)
  return text.replace(/—/g, ',').replace(/—/g, ',');
}

async function callOpusExpansion(anthropic, existingBody, title, brandName, category, sectionLabel) {
  const neededWords = Math.max(200, MIN_WORDS - wordCount(existingBody) + 50);
  const targetWords = Math.min(400, Math.max(neededWords, TARGET_NEW));

  const prompt = `You are writing for DORMIED, a golf brand intelligence platform. Your voice is direct, dry, opinionated, and informed. You write like a beat columnist, not a press office.

EXISTING ARTICLE (do not repeat what is already written):
Title: ${title}
Brand: ${brandName}
Category: ${category}

Body:
${existingBody}

---

Write ONE new analytical section to add to this article. The section should:
1. Start with a short section heading (3-6 words, no colon, no period)
2. Follow with ${targetWords} words of original analysis that does NOT repeat the existing content
3. Either: (a) analyse what this means for the brand's competitive position, (b) compare to a key rival, (c) place the move in broader industry context, or (d) assess what the DORMIED data suggests about the brand's trajectory
4. End with a forward-looking observation about where this brand goes next
5. NEVER use em dashes (—) or double hyphens. Use commas, colons, or periods instead.
6. No exclamation points. No excited language. No "exciting" or "thrilled to".
7. Write in active voice. Be specific. No filler.

Return ONLY the section heading and body text — no preamble, no quotes around the output, no explanation. Start directly with the heading.`;

  const response = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0]?.text || '';
  return sanitize(raw.trim());
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const sb        = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Fetch all articles
  const { data: articles, error: fetchErr } = await sb
    .from('dormied_articles')
    .select('slug, title, body, brand_slug, category, status')
    .in('slug', SLUGS);

  if (fetchErr) { console.error('[B] Fetch error:', fetchErr.message); process.exit(1); }

  // Extract brand names from data.js
  const dormiedDataRaw = fs.readFileSync(path.join(SITE_ROOT, 'js/data.js'), 'utf8');
  const brandNames = {};
  for (const m of dormiedDataRaw.matchAll(/"id":\s*"([^"]+)"[^}]+"name":\s*"([^"]+)"/g)) {
    brandNames[m[1]] = m[2];
  }

  const results = [];

  for (const art of articles) {
    const brandName = brandNames[art.brand_slug] || art.brand_slug;
    const initialWc = wordCount(art.body);

    console.log(`\n[B] ${art.slug}: ${initialWc} words (need ${MIN_WORDS}+)`);

    let body = art.body;
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    while (wordCount(body) < MIN_WORDS && attempts < MAX_ATTEMPTS) {
      attempts++;
      console.log(`[B]   Attempt ${attempts}: calling Opus... (current: ${wordCount(body)} words)`);

      const newSection = await callOpusExpansion(anthropic, body, art.title, brandName, art.category, `Expansion ${attempts}`);

      if (!newSection || newSection.length < 50) {
        console.warn(`[B]   Opus returned empty/short response — skipping attempt`);
        continue;
      }

      const sectionWc = wordCount(newSection);
      console.log(`[B]   Opus generated ${sectionWc} words`);
      body = body + '\n\n' + newSection;
    }

    const finalWc = wordCount(body);
    const met600  = finalWc >= MIN_WORDS;
    console.log(`[B] ${art.slug}: final ${finalWc} words ${met600 ? '✓' : '✗ STILL UNDER 600'}`);

    if (body !== art.body) {
      // Update DB
      const updatePayload = { body, status: 'published' };
      const { error: updateErr } = await sb
        .from('dormied_articles')
        .update(updatePayload)
        .eq('slug', art.slug);

      if (updateErr) {
        console.error(`[B] DB update failed for ${art.slug}:`, updateErr.message);
      } else {
        console.log(`[B] DB updated: ${art.slug}`);
      }
    }

    results.push({ slug: art.slug, initialWc, finalWc, met600 });
  }

  // ── Regenerate HTML for all expanded articles ──────────────────────────────
  console.log('\n[B] Running --regenerate-all to rebuild HTML...');
  execSync('node scripts/generate-article.js --regenerate-all', {
    cwd:   SITE_ROOT,
    stdio: 'inherit',
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n[B] ── SUMMARY ─────────────────────────────────────────────');
  results.forEach(r => {
    const flag = r.met600 ? '✓' : '✗';
    console.log(`  ${flag} ${r.slug}: ${r.initialWc} → ${r.finalWc} words`);
  });
  const failed = results.filter(r => !r.met600);
  if (failed.length === 0) {
    console.log('\n[B] All articles now exceed 600 words.');
  } else {
    console.log(`\n[B] ${failed.length} articles still under 600:`);
    failed.forEach(r => console.log(`  - ${r.slug}: ${r.finalWc} words`));
  }

  console.log('\n[B] Operation B complete.');
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => {
    console.error('[B] Fatal:', err.message);
    process.exit(1);
  });
}