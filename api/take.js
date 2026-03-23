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

const DISALLOWED_STARTS = ['Based', 'According', 'From', 'My', 'It appears', 'It seems'];

function startsWithDisallowed(text, brandName) {
  if (!text) return true;
  const trimmed = text.trim();
  if (DISALLOWED_STARTS.some(phrase => trimmed.startsWith(phrase))) return true;
  if (trimmed.toLowerCase().startsWith(brandName.toLowerCase())) return true;
  return false;
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

const SYSTEM_PROMPT = `You are a sharp, opinionated golf industry analyst writing for DORMIED, a golf brand intelligence platform. Your audience is gear-obsessed golf enthusiasts who follow brand culture closely and take their equipment seriously, sometimes too seriously. Your tone is direct, dry, and confident. You have a point of view. You do not sit on the fence. You are not afraid to be witty or land a dry one liner when the data earns it, but you never force it. If a brand is coasting you might say so with a raised eyebrow. If a brand is having a moment you give them their due without gushing. If nothing interesting is happening you say that plainly and move on. Wit comes from the observation, not from trying to be funny. No filler language. No em dashes. No bullet points. Write in tight prose. Never start with the brand name. Never open with any phrase that references your research process, search results, available information, or analysis. Never use phrases like based on, according to, it appears, it seems, from what I found, my research shows, or any similar construction. Start directly with the observation. Write as if you already know this information and are stating it plainly.`;

function buildUserPrompt(params, newsContext, retry = false) {
  const { name, rank, di, vsMonth, mom, yoy, bestRank, bestMonth, category, topMarket } = params;

  const base = `Write a 1 to 3 sentence editorial take on the current state of ${name} based on the following data and any recent news you can find about the brand.

Data context:
* Current global rank: ${rank} out of 144
* DI Score: ${di}
* Month over month change: ${vsMonth}
* 3 month trend: ${mom}
* Year over year change: ${yoy}
* Best rank ever: ${bestRank} in ${bestMonth}
* Brand category: ${category}
* Strongest market: ${topMarket}
${newsContext}

Write your response as a direct editorial statement. Start with the most interesting or telling observation about this brand right now. Be specific where the data or news supports it. Be opinionated. If a brand is clearly on a sustained decline say so. If a brand is quietly building momentum say so. If a brand is stubbornly holding the same position month after month say that too. A dry one liner is welcome when the situation genuinely calls for it, but do not reach for a joke when a straight observation is sharper. One to three sentences maximum. No preamble. No meta commentary. Just the take.

A few examples of the tone you are going for:
Good: Still the most searched putter brand in golf. Scotty Cameron does not need to do much to stay relevant, which is either a tribute to the brand or an indictment of how little the putter market moves.
Good: Jumped 174% in February and the data is not subtle about why. One viral putting clip and a wave of GolfWRX threads later, the waitlist is longer than ever.
Good: Holding steady at 43rd for the third consecutive month. Not falling, not rising, just existing. There are worse places to be.
Good: The apparel side is clearly carrying this brand right now. The equipment numbers have not kept pace with the hoodie.
Bad: Wow, what a month for this brand! (forced enthusiasm)
Bad: Interesting to note that search interest has declined. (filler)
Bad: Based on recent data and news coverage... (disallowed)`;

  if (retry) {
    return base + '\n\nYour previous response began with a disallowed phrase. Rewrite it starting directly with the editorial observation. No preamble. No meta commentary.';
  }

  return base;
}

// ── Claude caller ─────────────────────────────────────────────────────────────

async function callClaude(client, userPrompt) {
  const response = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 300,
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

    if (startsWithDisallowed(take, name)) {
      console.warn(`[take] First response for "${name}" started with disallowed phrase. Retrying.`);
      take = await callClaude(client, buildUserPrompt(params, newsContext, true));
      if (startsWithDisallowed(take, name)) {
        console.warn(`[take] Second response for "${name}" also started with disallowed phrase. Returning anyway.`);
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

  if (startsWithDisallowed(take, name)) {
    console.warn(`[take] First response for "${name}" started with disallowed phrase. Retrying.`);
    take = await callClaude(client, buildUserPrompt(params, newsContext, true));
    if (startsWithDisallowed(take, name)) {
      console.warn(`[take] Second response for "${name}" also started with disallowed phrase. Returning anyway.`);
    }
  }

  res.json({ take });

  } catch (err) {
    console.error('[take] Unhandled error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
};
