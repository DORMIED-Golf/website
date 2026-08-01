const Anthropic        = require('@anthropic-ai/sdk');
const Parser           = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Convert "Feb 2026" → "2026-02" for consistent DB storage
function monthToYYYYMM(label) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [mon, year] = label.split(' ');
  const m = MONTHS.indexOf(mon) + 1;
  return `${year}-${String(m).padStart(2, '0')}`;
}

// ── RSS feeds to scan for brand mentions ─────────────────────────────────────

const FEEDS = [
  { id: 'mygolfspy',    name: 'MyGolfSpy',        url: 'https://feeds.feedburner.com/Mygolfspy' },
  { id: 'golfwrx',      name: 'GolfWRX',           url: 'https://www.golfwrx.com/feed' },
  { id: 'golfdigest',   name: 'Golf Digest',       url: 'https://www.golfdigest.com/rss/rss.xml' },
  { id: 'golfcom',      name: 'Golf.com',          url: 'https://golf.com/feed' },
  { id: 'golfweek',     name: 'Golfweek',          url: 'https://golfweek.usatoday.com/feed' },
  { id: 'pluggedin',    name: 'Plugged In Golf',   url: 'https://www.pluggedingolf.com/feed' },
  { id: 'hackerspar',   name: "Hacker's Paradise", url: 'https://www.thehackersparadise.com/feed' },
  { id: 'golfmonthly',  name: 'Golf Monthly',      url: 'https://www.golfmonthly.com/feed' },
];

// ── Validation ────────────────────────────────────────────────────────────────

// Must not appear at the start of the response
const DISALLOWED_STARTS = [
  'Based on',
  'According to',
  'From my',
  'From the',
  'Looking at',
  'After reviewing',
  'Having reviewed',
  'The search results',
  'The news',
  'The data shows',
  'It appears',
  'It seems',
];

// Must not appear anywhere in the body
const DISALLOWED_BODY = [
  'my search',
  'search results',
  'from my research',
  'the articles suggest',
  'the coverage indicates',
  'from what I found',
  'my research shows',
  'the data shows',
  'available information',
  'ranking platform',
  'data tool',
  'tracker',
];

function startsWithDisallowed(text, brandName) {
  if (!text) return true;
  const trimmed = text.trim();
  const lower   = trimmed.toLowerCase();
  if (DISALLOWED_STARTS.some(p => lower.startsWith(p.toLowerCase()))) return true;
  if (lower.startsWith(brandName.toLowerCase())) return true;
  return false;
}

function containsDisallowedPhrase(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return DISALLOWED_BODY.some(p => lower.includes(p.toLowerCase()));
}

function isInvalid(text, brandName) {
  return startsWithDisallowed(text, brandName) || containsDisallowedPhrase(text);
}

// ── News fetcher ──────────────────────────────────────────────────────────────

async function fetchRecentArticles(brandName) {
  const parser     = new Parser({ timeout: 3000, maxRedirects: 3 });
  const brandLower = brandName.toLowerCase();
  const cutoff     = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const results = await Promise.allSettled(
    FEEDS.map(f => parser.parseURL(f.url).then(feed => ({ name: f.name, items: feed.items || [] })))
  );

  const articles = [];
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const { name, items } = r.value;
    items.forEach(item => {
      const title   = (item.title || '').toLowerCase();
      const snippet = (item.contentSnippet || '').toLowerCase();
      if (!title.includes(brandLower) && !snippet.includes(brandLower)) return;
      if (item.isoDate && new Date(item.isoDate) < cutoff) return;
      articles.push(`[${name}] ${item.title}: ${(item.contentSnippet || '').slice(0, 200)}`);
    });
  });

  return articles.slice(0, 8);
}

// ── Prompt builder ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are The Read Agent for DORMIED, golf's brand desk.

DORMIED is the monthly ranking and editorial home for golf brands. We track 215 brands across 10 global markets and publish independent rankings as the DORMIED Index. Every sport has a publication that covers the business and culture of its brands. Fashion has Lyst and Business of Fashion. Basketball has Boardroom. Golf has DORMIED.

The Read is the editorial take on every brand's page. Where the standings show position and the explanation section covers the latest move, The Read steps back: how the brand is doing, what the trend says, what to watch.

Audience: gear-obsessed golf enthusiasts who follow brand culture closely and take their equipment seriously, sometimes too seriously.

Voice: direct, dry, confident. You have a point of view. You do not sit on the fence. You can land a dry one-liner when the data earns it but you never force it. If a brand is coasting, say so with a raised eyebrow. If a brand is having a moment, give them their due without gushing. If nothing interesting is happening, say that plainly. Wit comes from the observation, not from trying to be funny.

Never describe DORMIED as a ranking platform, data tool, or tracker. The phrase is "golf's brand desk."
Never use the words "popularity" or "buzz". Use "attention" or "momentum" or just describe the thing.
No filler language. No em dashes. No bullet points. Write in tight prose.
Never start with the brand name.
Never open with any phrase that references your research process, search results, available information, or analysis.
Never use phrases like "based on", "according to", "it appears", "it seems", "from what I found", "my research shows", or any similar construction.
Start directly with the observation. Write as if you already know this information and are stating it plainly.`;

function buildUserPrompt(params, newsContext, retry = false) {
  const { name, rank, di, vsMonth, mom, yoy, bestRank, bestMonth, category, topMarket } = params;

  const base = `Write a 300 to 500 word editorial analysis of the current state of ${name}. This is "The Read" on the brand's DORMIED page. It is substantive editorial that gives the reader something worth reading, not a summary.

Data context:
* Current global rank: ${rank} out of 215
* DI Score: ${di}
* Month over month change: ${vsMonth}
* 3 month trend: ${mom}
* Year over year change: ${yoy}
* Best rank ever: ${bestRank} in ${bestMonth}
* Brand category: ${category}
* Strongest market: ${topMarket}
${newsContext}

Open with the sharpest observation you have about this brand right now. Then develop the context: what explains their current position and recent trajectory. Analyse the trend: what the data says about where they are headed. Close with a forward-looking observation about what to watch.

Three to five paragraphs. No headers. No bullet points. Plain prose.

Take a position. "Holding steady" is fine. "Quietly losing ground" is sharper than "experiencing decline." Never hedge for the sake of safety.

Geography is often the most interesting angle. If a brand dominates one market and is invisible in another, that is the story. Category context is the second most interesting angle. Don't write a paragraph that's just a number-by-number recap of the data above. Synthesize.

A dry observation is welcome when it earns it, but never reach for a joke when a straight read is sharper. No preamble. No meta commentary. Write as if you already know this brand cold.`;

  if (retry) {
    return base + '\n\nYour previous response contained a disallowed phrase either at the start or in the body. Rewrite it starting directly with the editorial observation. Do not reference your research, search results, available information, or analysis process anywhere in the response. No preamble. No meta commentary.';
  }

  return base;
}

// ── Claude caller ─────────────────────────────────────────────────────────────

async function callClaude(client, userPrompt) {
  const response = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 1000,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  });
  return (response.content[0]?.text || '').trim();
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Cache-Control', 'no-store');

  try {

  const { name, rank, di, vsMonth, mom, yoy, bestRank, bestMonth, category, topMarket } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing required field: name' });

  // Derive brand_id from name (matches data.js id convention)
  const brandId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const monthYM = monthToYYYYMM(bestMonth || ''); // use currentMonth passed as bestMonth context
  // Use the month from the request — frontend passes currentMonth as part of the data
  // We'll derive it from the data: rank/di are current-month values
  // Store by brand_id + a stable month key derived from the request
  // The frontend caches by currentMonth already; we use the same key here
  const supabase = getSupabase();

  // ── 1. Check Supabase cache ───────────────────────────────────────────────
  if (supabase) {
    // We need the current month — frontend doesn't send it explicitly, so we
    // store takes keyed by brand_id only within a month. We'll add currentMonth
    // to the request body. For now derive from today's data cycle.
    // The frontend sends `bestMonth` as the all-time best — we need currentMonth.
    // Add it as an optional param; fall back to current calendar month.
    const cm = req.body.currentMonth
      ? monthToYYYYMM(req.body.currentMonth)
      : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const { data: cached } = await supabase
      .from('brand_takes')
      .select('take')
      .eq('brand_id', brandId)
      .eq('month', cm)
      .maybeSingle();

    if (cached?.take) {
      console.log(`[take] Cache hit for "${name}" (${cm})`);
      return res.json({ take: cached.take });
    }

    // ── 2. Generate with Claude ─────────────────────────────────────────────
    let articles = [];
    try {
      articles = await fetchRecentArticles(name);
    } catch (e) {
      console.warn(`[take] RSS fetch failed for "${name}":`, e.message);
    }

    const newsContext = articles.length > 0
      ? `\nRecent news articles mentioning ${name} (last 60 days):\n${articles.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
      : `\nNo recent articles mentioning ${name} were found in golf media feeds.`;

    const params = { name, rank, di, vsMonth, mom, yoy, bestRank, bestMonth, category, topMarket };
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let take = await callClaude(client, buildUserPrompt(params, newsContext, false));

    if (isInvalid(take, name)) {
      console.warn(`[take] First response for "${name}" contained disallowed phrase. Retrying.`);
      take = await callClaude(client, buildUserPrompt(params, newsContext, true));
      if (isInvalid(take, name)) {
        console.warn(`[take] Second response for "${name}" also contained disallowed phrase. Returning anyway.`);
      }
    }

    // ── 3. Store in Supabase ────────────────────────────────────────────────
    const { error } = await supabase.from('brand_takes').insert({
      brand_id:   brandId,
      brand_name: name,
      month:      cm,
      take,
    });

    if (error) {
      console.warn(`[take] Supabase insert failed for "${name}":`, error.message);
    } else {
      console.log(`[take] Stored take for "${name}" (${cm})`);
    }

    return res.json({ take });
  }

  // ── Supabase not configured — generate without caching ───────────────────
  console.warn('[take] Supabase not configured — generating without DB cache.');

  let articles = [];
  try {
    articles = await fetchRecentArticles(name);
  } catch (e) {
    console.warn(`[take] RSS fetch failed for "${name}":`, e.message);
  }

  const newsContext = articles.length > 0
    ? `\nRecent news articles mentioning ${name} (last 60 days):\n${articles.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
    : `\nNo recent articles mentioning ${name} were found in golf media feeds.`;

  const params = { name, rank, di, vsMonth, mom, yoy, bestRank, bestMonth, category, topMarket };
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let take = await callClaude(client, buildUserPrompt(params, newsContext, false));

  if (isInvalid(take, name)) {
    console.warn(`[take] First response for "${name}" contained disallowed phrase. Retrying.`);
    take = await callClaude(client, buildUserPrompt(params, newsContext, true));
    if (isInvalid(take, name)) {
      console.warn(`[take] Second response for "${name}" also contained disallowed phrase. Returning anyway.`);
    }
  }

  res.json({ take });

  } catch (err) {
    console.error('[take] Unhandled error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
};
