/* ─────────────────────────────────────────────────────────────────────────
   api/matchup-result.js  —  DORMIED Daily Match-Up Result Writer
   Generates a Claude write-up for the match result, writes the full match
   record to Supabase matchup_archive (once per day), and returns the text.
   Supabase operations are fully isolated — Claude runs regardless of DB state.
   ───────────────────────────────────────────────────────────────────────── */

const Anthropic        = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ── Validation ────────────────────────────────────────────────────────────────

const DISALLOWED_STARTS = ['Based', 'According', 'From', 'My', 'It appears', 'It seems', 'There was', 'There has'];

function startsWithDisallowed(text, nameA, nameB) {
  if (!text) return true;
  const t = text.trim();
  if (DISALLOWED_STARTS.some(p => t.startsWith(p))) return true;
  if (t.toLowerCase().startsWith(nameA.toLowerCase())) return true;
  if (t.toLowerCase().startsWith(nameB.toLowerCase())) return true;
  return false;
}

// ── Claude caller ─────────────────────────────────────────────────────────────

async function callClaude(client, systemPrompt, userPrompt) {
  const resp = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 150,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  });
  return (resp.content[0]?.text || '').trim();
}

const SYSTEM_PROMPT =
  'You are a dry, sharp golf analyst writing match result copy for DORMIED. ' +
  'One to two sentences maximum. Direct. No filler. No em dashes. No meta commentary. ' +
  'Never start with either brand name. State the result and what the data says about it.';

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Cache-Control', 'no-store');

  const {
    brand_a_id, brand_a_name, brand_a_logo,
    brand_b_id, brand_b_name, brand_b_logo,
    brand_a_di,   brand_b_di,
    brand_a_mom,  brand_b_mom,
    brand_a_3m,   brand_b_3m,
    brand_a_12m,  brand_b_12m,
    result_score, result_winner,
    category,     date,
    pts_a, pts_b,
  } = req.body || {};

  if (!brand_a_name || !brand_b_name) {
    return res.status(400).json({ error: 'Missing brand names' });
  }

  const today    = date || new Date().toISOString().slice(0, 10);
  const supabase = getSupabase();

  // ── 1. Check archive — fully isolated, never crashes the flow ─────────────
  if (supabase) {
    try {
      const { data: existing, error: selectErr } = await supabase
        .from('matchup_archive')
        .select('result_writeup')
        .eq('date', today)
        .maybeSingle();

      if (selectErr) {
        console.warn('[matchup-result] Archive select error:', selectErr.message, selectErr.code);
      } else if (existing && existing.result_writeup) {
        console.log('[matchup-result] Cache hit for', today);
        return res.json({ writeup: existing.result_writeup, cached: true });
      }
    } catch (sbErr) {
      // Table may not exist yet — log and continue to generate with Claude
      console.warn('[matchup-result] Archive check threw:', sbErr.message);
    }
  }

  // ── 2. Build prompt ────────────────────────────────────────────────────────
  const fmtPct = v =>
    v != null ? (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(1) + '%' : '—';

  const decidingStats = [];
  if (brand_a_di != null && brand_b_di != null) {
    if (Number(brand_a_di) > Number(brand_b_di)) decidingStats.push(`DI Score (${brand_a_name})`);
    else if (Number(brand_b_di) > Number(brand_a_di)) decidingStats.push(`DI Score (${brand_b_name})`);
  }
  if (brand_a_mom != null && brand_b_mom != null) {
    if (Number(brand_a_mom) > Number(brand_b_mom)) decidingStats.push(`M/M Change (${brand_a_name})`);
    else if (Number(brand_b_mom) > Number(brand_a_mom)) decidingStats.push(`M/M Change (${brand_b_name})`);
  }
  if (brand_a_3m != null && brand_b_3m != null) {
    if (Number(brand_a_3m) > Number(brand_b_3m)) decidingStats.push(`3M Trend (${brand_a_name})`);
    else if (Number(brand_b_3m) > Number(brand_a_3m)) decidingStats.push(`3M Trend (${brand_b_name})`);
  }
  if (brand_a_12m != null && brand_b_12m != null) {
    if (Number(brand_a_12m) > Number(brand_b_12m)) decidingStats.push(`12M Trend (${brand_a_name})`);
    else if (Number(brand_b_12m) > Number(brand_a_12m)) decidingStats.push(`12M Trend (${brand_b_name})`);
  }

  const scoreA = pts_a != null ? pts_a : 0;
  const scoreB = pts_b != null ? pts_b : 0;

  const userPrompt =
    `Write a one to two sentence summary of this match-up result. ` +
    `${brand_a_name} scored ${scoreA} points. ${brand_b_name} scored ${scoreB} points. ` +
    `The deciding stats were ${decidingStats.length ? decidingStats.join(', ') : 'all stats tied'}. ` +
    `DI Scores: ${brand_a_di} vs ${brand_b_di}. ` +
    `M/M change: ${fmtPct(brand_a_mom)} vs ${fmtPct(brand_b_mom)}. ` +
    `3M trend: ${fmtPct(brand_a_3m)} vs ${fmtPct(brand_b_3m)}. ` +
    `12M trend: ${fmtPct(brand_a_12m)} vs ${fmtPct(brand_b_12m)}. ` +
    `Do not start with either brand name. State what the data shows. One to two sentences only.`;

  // ── 3. Call Claude — always runs ───────────────────────────────────────────
  let writeup = '';
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    writeup = await callClaude(client, SYSTEM_PROMPT, userPrompt);

    if (startsWithDisallowed(writeup, brand_a_name, brand_b_name)) {
      console.warn('[matchup-result] First response disallowed. Retrying.');
      const retryPrompt =
        userPrompt +
        '\n\nYour previous response began with a disallowed phrase. Rewrite it. ' +
        'Do not start with either brand name or any of the following: ' +
        DISALLOWED_STARTS.join(', ') + '.';
      writeup = await callClaude(client, SYSTEM_PROMPT, retryPrompt);
    }

    console.log('[matchup-result] Generated writeup for', today, ':', writeup.slice(0, 60));
  } catch (claudeErr) {
    console.error('[matchup-result] Claude call failed:', claudeErr.message);
    // Return empty rather than crashing — result panel shows score only
    return res.json({ writeup: '' });
  }

  // ── 4. Write to matchup_archive — fully isolated, never blocks response ────
  if (supabase && writeup) {
    (async () => {
      try {
        const { error } = await supabase.from('matchup_archive').insert({
          date:           today,
          brand_a_id:     brand_a_id   || null,
          brand_a_name:   brand_a_name,
          brand_a_logo:   brand_a_logo || null,
          brand_b_id:     brand_b_id   || null,
          brand_b_name:   brand_b_name,
          brand_b_logo:   brand_b_logo || null,
          brand_a_di:     brand_a_di   != null ? Number(brand_a_di)  : null,
          brand_b_di:     brand_b_di   != null ? Number(brand_b_di)  : null,
          brand_a_mom:    brand_a_mom  != null ? Number(brand_a_mom) : null,
          brand_b_mom:    brand_b_mom  != null ? Number(brand_b_mom) : null,
          brand_a_3m:     brand_a_3m   != null ? Number(brand_a_3m)  : null,
          brand_b_3m:     brand_b_3m   != null ? Number(brand_b_3m)  : null,
          brand_a_12m:    brand_a_12m  != null ? Number(brand_a_12m) : null,
          brand_b_12m:    brand_b_12m  != null ? Number(brand_b_12m) : null,
          result_score:   result_score  || null,
          result_winner:  result_winner || null,
          result_writeup: writeup,
          category:       category      || null,
        });

        if (error) {
          if (error.code === '23505') {
            console.log('[matchup-result] Race: record already inserted for', today);
          } else {
            console.warn('[matchup-result] Archive insert failed:', error.message, error.code);
          }
        } else {
          console.log('[matchup-result] Archived match-up for', today);
        }
      } catch (insertErr) {
        console.warn('[matchup-result] Archive insert threw:', insertErr.message);
      }
    })();
  }

  return res.json({ writeup });
};
