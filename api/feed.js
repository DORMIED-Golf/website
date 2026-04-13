const Parser = require('rss-parser');
const brands = require('./_brands.json');

const FEEDS = [
  { id: 'mygolfspy',    name: 'MyGolfSpy',            url: 'https://feeds.feedburner.com/Mygolfspy' },
  { id: 'golfwrx',      name: 'GolfWRX',              url: 'https://www.golfwrx.com/feed?posts_per_rss=500' },
  { id: 'golfcom',      name: 'Golf.com',              url: 'https://golf.com/feed?posts_per_rss=500' },
  { id: 'pluggedin',    name: 'Plugged In Golf',       url: 'https://www.pluggedingolf.com/feed?posts_per_rss=500' },
  { id: 'bunkered',     name: 'Bunkered',              url: 'https://www.bunkered.co.uk/feed?posts_per_rss=500' },
  { id: 'gbm',          name: 'Golf Business Monitor', url: 'https://www.golfbusinessmonitor.com/feed?posts_per_rss=500' },
  { id: 'ncg',          name: 'National Club Golfer',  url: 'https://www.nationalclubgolfer.com/feed?posts_per_rss=500' },
  { id: 'hackerspar',   name: "Hacker's Paradise",     url: 'https://www.thehackersparadise.com/feed?posts_per_rss=500' },
];

// Pre-compile word-boundary regexes for each brand name + aliases.
// Prevents false positives (e.g. "PING" inside "groupings") while
// allowing common alternate spellings (e.g. "LAB Golf" for "L.A.B. Golf").
function makeRe(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&').replace(/\s+/g, '\\s+');
  const start   = /^\w/.test(term) ? '\\b' : '';
  const end     = /\w$/.test(term) ? '\\b' : '';
  return new RegExp(start + escaped + end, 'i');
}

const brandPatterns = brands.map(b => {
  // matchTerms overrides name+aliases for brands whose canonical name
  // is a common English word or phrase (e.g. "Municipal", "Vessel", "Sub 70")
  const terms = b.matchTerms || [b.name].concat(b.aliases || []);
  return { id: b.id, res: terms.map(makeRe) };
});

function tagArticle(title, snippet) {
  const text = (title + ' ' + (snippet || '')).toLowerCase();
  return brandPatterns
    .filter(p => p.res.some(re => re.test(text)))
    .map(p => p.id);
}

function extractImage(item) {
  // 1. media:content or media:thumbnail (standard media RSS)
  const mediaUrl = (item['media:content'] && item['media:content'].$ && item['media:content'].$.url)
                || (item['media:thumbnail'] && item['media:thumbnail'].$ && item['media:thumbnail'].$.url);
  if (mediaUrl) return mediaUrl;

  // 2. enclosure (podcasts / some WordPress feeds)
  if (item.enclosure && item.enclosure.url && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(item.enclosure.url)) {
    return item.enclosure.url;
  }

  // 3. First <img src="..."> inside content:encoded HTML (GolfWRX, Plugged In, NCG, Hacker's Paradise etc.)
  const html = item['content:encoded'] || item.content || '';
  if (html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && m[1] && !/data:image/i.test(m[1])) return m[1];
  }

  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const parser = new Parser({
      timeout: 6000,
      maxRedirects: 3,
      customFields: {
        item: [
          ['media:content',   'media:content',   { keepArray: false }],
          ['media:thumbnail', 'media:thumbnail', { keepArray: false }],
          ['content:encoded', 'content:encoded', { keepArray: false }],
        ]
      }
    });

    const results = await Promise.allSettled(
      FEEDS.map(f =>
        parser.parseURL(f.url).then(feed => ({ feed: f, items: feed.items || [] }))
      )
    );

    const articles = [];
    let loaded = 0, failed = 0;

    results.forEach(r => {
      if (r.status === 'rejected') { failed++; return; }
      loaded++;
      const { feed, items } = r.value;
      items.forEach(item => {
        const title   = (item.title || '').trim();
        const snippet = (item.contentSnippet || '').slice(0, 500);
        articles.push({
          id:          Buffer.from(item.link || item.guid || title).toString('base64').slice(0, 16),
          title,
          url:         item.link || item.guid || '',
          sourceName:  feed.name,
          sourceId:    feed.id,
          pubDate:     item.isoDate || item.pubDate || null,
          description: snippet.slice(0, 300),
          imageUrl:    extractImage(item),
          brandIds:    tagArticle(title, snippet),
        });
      });
    });

    // Deduplicate by URL, sort newest first, apply optional ?since= filter
    const since = req.query.since ? new Date(req.query.since) : null;
    const seen = new Set();
    const deduped = articles
      .filter(a => {
        if (!a.url || seen.has(a.url)) return false;
        seen.add(a.url);
        if (since && a.pubDate && new Date(a.pubDate) < since) return false;
        return true;
      })
      .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

    res.json({
      articles:    deduped,
      lastUpdated: new Date().toISOString(),
      feedsLoaded: loaded,
      feedsFailed: failed,
    });

  } catch (err) {
    console.error('[feed] Unhandled error:', err);
    res.status(500).json({
      error:       'Feed temporarily unavailable',
      articles:    [],
      lastUpdated: new Date().toISOString(),
      feedsLoaded: 0,
      feedsFailed: FEEDS.length,
    });
  }
};
