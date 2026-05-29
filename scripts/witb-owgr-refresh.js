#!/usr/bin/env node
/**
 * scripts/witb-owgr-refresh.js
 *
 * Re-runnable weekly OWGR rank refresh for all players in witb_players.
 *
 * Data source: apiweb.owgr.com/api/owgr/rankings/getRankings
 *   - Undocumented internal API used by owgr.com (Next.js app)
 *   - Returns full ranking list in one call (~9500 entries, JSON)
 *   - Includes player.fullName, player.firstName, player.lastName, rank
 *   - Updates weekly on Monday
 *
 * Matching strategy: confident exact match only.
 *   - Normalise both sides: NFD accent strip, lowercase, "Last, First" -> "First Last"
 *   - A player is matched iff the normalised key is identical.
 *   - Unmatched players are left unchanged and reported; never guessed.
 *
 * Usage:
 *   node scripts/witb-owgr-refresh.js
 *
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

// Undocumented OWGR REST API discovered from owgr.com Next.js bundle.
// Returns { rankingsList: [...], totalNumberOfPages: 1, totalNumberOfRankings: N }
// All entries in a single response (no pagination needed).
const OWGR_API_URL = 'https://apiweb.owgr.com/api/owgr/rankings/getRankings';

const USER_AGENT   = 'DORMIED-WITB-Bot/1.0 (+https://dormied.com)';

// ── Utilities ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function warn(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.warn(`[${ts}] WARN: ${msg}`);
}

// ── Curated name aliases ──────────────────────────────────────────────────────

/**
 * Maps our DB player name (normalised) -> OWGR fullName (normalised).
 * Add entries here only when the match is 100% confident but the names
 * differ by romanisation, abbreviation, or punctuation convention.
 *
 * Do NOT add aliases based on similarity alone — verify on owgr.com first.
 */
const DB_TO_OWGR_ALIAS = {
  // DB name            -> OWGR name
  'siwoo kim':          'si woo kim',     // OWGR uses space: "Si Woo Kim"
};

// ── Name Normalisation ────────────────────────────────────────────────────────

/**
 * Produce a canonical key for name matching:
 *   - Decompose Unicode + strip combining diacritical marks (accents)
 *   - Lowercase + trim
 *   - "Last, First" -> "first last"
 *   - Collapse internal whitespace
 *
 * Examples:
 *   "Scottie Scheffler"     -> "scottie scheffler"
 *   "Jon Rahm"              -> "jon rahm"
 *   "Viktor Hovland"        -> "viktor hovland"
 *   "Byeong Hun An"         -> "byeong hun an"
 *   "Sepp Straka"           -> "sepp straka"
 *   "Rory McIlroy"          -> "rory mcilroy"
 *   "Thorbjorn Olesen"      -> "thorbjorn olesen"  (o/O with stroke -> o)
 *   "Scheffler, Scottie"    -> "scottie scheffler"
 */
function normaliseName(raw) {
  if (!raw) return '';
  // NFD decompose then strip combining marks (U+0300..U+036F)
  let s = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.toLowerCase().trim();
  // "Last, First" -> "first last"
  if (s.includes(',')) {
    const parts = s.split(',');
    s = `${parts[1].trim()} ${parts[0].trim()}`;
  }
  s = s.replace(/\s+/g, ' ');
  return s;
}

// ── OWGR Fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch all OWGR rankings from the internal apiweb.owgr.com API.
 * Returns array of { rank: number, name: string }.
 */
async function fetchOwgrRankings() {
  log(`Fetching OWGR rankings from ${OWGR_API_URL} ...`);

  const res = await fetch(OWGR_API_URL, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept':     'application/json',
      'Referer':    'https://www.owgr.com/',
      'Origin':     'https://www.owgr.com',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`OWGR API returned HTTP ${res.status}`);
  }

  const json = await res.json();
  const list = json.rankingsList;

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`OWGR API response missing rankingsList (keys: ${Object.keys(json).join(', ')})`);
  }

  log(`OWGR returned ${list.length} ranked players (total in ranking: ${json.totalNumberOfRankings ?? '?'})`);

  return list.map(entry => {
    const c = entry.player?.country;
    // Standard nations have code2 (ISO 3166-1 alpha-2).
    // GB home nations (England, Scotland, Wales, Northern Ireland) have empty code2
    // but a distinct code3 (ENG, SCO, WAL, NIR). Map those to country_code=GB + nation.
    let country_code = c?.code2 || null;
    let nation       = null;
    if (!country_code && c?.code3) {
      const HOME_NATIONS = { NIR: true, ENG: true, SCO: true, WAL: true };
      if (HOME_NATIONS[c.code3]) {
        country_code = 'GB';
        nation       = c.code3;
      }
    }
    return {
      rank:         entry.rank,
      name:         entry.player?.fullName || `${entry.player?.firstName} ${entry.player?.lastName}`.trim(),
      country_code,
      nation,
    };
  }).filter(r => r.rank > 0 && r.name.length > 1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── 1. Fetch OWGR rankings ─────────────────────────────────────────────────

  const owgrRankings = await fetchOwgrRankings();

  if (owgrRankings.length === 0) {
    console.error('No OWGR rankings received — aborting to avoid clearing existing ranks.');
    process.exit(1);
  }

  // Build normalised lookup: normName -> { rank, rawName, country_code, nation }
  const owgrByNorm = new Map();
  for (const row of owgrRankings) {
    const key = normaliseName(row.name);
    if (key) owgrByNorm.set(key, {
      rank:         row.rank,
      rawName:      row.name,
      country_code: row.country_code,
      nation:       row.nation,
    });
  }

  // ── 2. Load all players from DB ────────────────────────────────────────────

  const { data: players, error: pErr } = await supabase
    .from('witb_players')
    .select('id, name, slug, owgr_rank, country_code, nation')
    .order('name');

  if (pErr) throw new Error(`Could not load witb_players: ${pErr.message}`);
  log(`Loaded ${players.length} players from DB`);

  // ── 3. Match and update ────────────────────────────────────────────────────

  const matched   = [];
  const unmatched = [];
  const now       = new Date().toISOString();

  for (const player of players) {
    const key     = normaliseName(player.name);
    // Apply curated alias if defined, otherwise use the normalised key directly
    const lookupKey = DB_TO_OWGR_ALIAS[key] || key;
    const hit       = owgrByNorm.get(lookupKey);

    if (hit) {
      matched.push({ player, hit });
    } else {
      unmatched.push(player);
    }
  }

  log(`Matched: ${matched.length}  |  Unmatched: ${unmatched.length}`);

  let updatedCount = 0;
  let errorCount   = 0;

  for (const { player, hit } of matched) {
    const { error: updErr } = await supabase
      .from('witb_players')
      .update({
        owgr_rank:            hit.rank,
        owgr_rank_updated_at: now,
        country_code:         hit.country_code,
        nation:               hit.nation,
      })
      .eq('id', player.id);

    if (updErr) {
      warn(`Update failed for ${player.name}: ${updErr.message}`);
      errorCount++;
    } else {
      const delta = (player.owgr_rank !== null && player.owgr_rank !== hit.rank)
        ? ` (was #${player.owgr_rank})`
        : '';
      const flagNote = hit.nation
        ? ` [GB/${hit.nation}]`
        : (hit.country_code ? ` [${hit.country_code}]` : '');
      log(`  Updated: ${player.name} -> #${hit.rank}${delta}${flagNote}`);
      updatedCount++;
    }
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('OWGR REFRESH COMPLETE');
  console.log('='.repeat(60));
  console.log(`  OWGR rows fetched:     ${owgrRankings.length}`);
  console.log(`  DB players:            ${players.length}`);
  console.log(`  Matched and updated:   ${updatedCount}`);
  console.log(`  Update errors:         ${errorCount}`);
  console.log(`  Unmatched (unchanged): ${unmatched.length}`);

  // Country/nation coverage
  const gbPlayers = matched.filter(({ hit }) => hit.country_code === 'GB');
  const homeNationCounts = {};
  gbPlayers.forEach(({ hit }) => {
    homeNationCounts[hit.nation || '?'] = (homeNationCounts[hit.nation || '?'] || 0) + 1;
  });
  if (gbPlayers.length > 0) {
    console.log('\nGB home nation breakdown:');
    Object.entries(homeNationCounts).sort().forEach(([n, c]) => {
      console.log(`  ${n}: ${c} player${c !== 1 ? 's' : ''}`);
    });
  }

  const noCountry = matched.filter(({ hit }) => !hit.country_code);
  if (noCountry.length > 0) {
    console.log(`\nWARN: ${noCountry.length} matched players have no country_code in OWGR data:`);
    noCountry.forEach(({ player }) => console.log(`  ${player.name}`));
  }

  if (unmatched.length > 0) {
    console.log('\nPlayers NOT matched to OWGR (owgr_rank left unchanged):');
    for (const p of unmatched) {
      const key = normaliseName(p.name);
      console.log(`  ${p.name.padEnd(32)} [norm: "${key}", slug: ${p.slug}]`);
    }
    console.log('');
    console.log('To fix: verify the exact name on owgr.com and confirm the normalised');
    console.log('form matches. Do NOT guess -- leave owgr_rank null/unchanged if unsure.');
  }

  // Verification counts
  const { count: haveOwgr } = await supabase
    .from('witb_players')
    .select('*', { count: 'exact', head: true })
    .not('owgr_rank', 'is', null);

  const { count: freshToday } = await supabase
    .from('witb_players')
    .select('*', { count: 'exact', head: true })
    .gte('owgr_rank_updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  console.log('\nVerification:');
  console.log(`  Players with owgr_rank set:    ${haveOwgr ?? '?'}`);
  console.log(`  Players refreshed in last 24h: ${freshToday ?? '?'}`);
  console.log('='.repeat(60) + '\n');

  if (errorCount > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('[witb-owgr-refresh] Fatal:', err.message);
  process.exit(1);
});
