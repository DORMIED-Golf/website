const Parser = require('rss-parser');
const brands = require('./_brands.json');

const FEEDS = [
  { id: 'mygolfspy',    name: 'MyGolfSpy',            url: 'https://feeds.feedburner.com/Mygolfspy' },
  { id: 'golfwrx',      name: 'GolfWRX',              url: 'https://www.golfwrx.com/feed' },
  { id: 'golfdigest',   name: 'Golf Digest',           url: 'https://www.golfdigest.com/rss/rss.xml' },
  { id: 'golfcom',      name: 'Golf.com',              url: 'https://golf.com/feed' },
  { id: 'golfmonthly',  name: 'Golf Monthly',          url: 'https://www.golfmonthly.com/feed' },
  { id: 'todaysgolfer', name: "Today's Golfer",        url: 'https://www.todays-golfer.com/feed' },
  { id: 'pluggedin',    name: 'Plugged In Golf',       url: 'https://www.pluggedingolf.com/feed' },
  { id: 'golfweek',     name: 'Golfweek',              url: 'https://golfweek.usatoday.com/feed' },
  { id: 'bunkered',     name: 'Bunkered',              url: 'https://www.bunkered.co.uk/feed' },
  { id: 'gbm',          name: 'Golf Business Monitor', url: 'https://www.golfbusinessmonitor.com/feed' },
  { id: 'ncg',          name: 'National Club Golfer',  url: 'https://www.nationalclubgolfer.com/feed' },
  { id: 'hackerspar',   name: "Hacker's Paradise",     url: 'https://www.thehackersparadise.com/feed' },
  { id: 'skratch',      name: 'Skratch Golf',          url: 'https://www.skratch.golf/feed' },
  { id: 'hypebeast',    name: 'Hypebeast',             url: 'https://hypebeast.com/feed' },
];

function tagArticle(title, snippet) {
  const text = (title + ' ' + (snippet || '')).toLowerCase();
  return brands
    .filter(b => text.includes(b.name.toLowerCase()))
    .map(b => b.id);
}

function extractImage(item) {
  return (item['media:content'] && item['media:content'].$ && item['media:content'].$.url)
      || (item['media:thumbnail'] && item['media:thumbnail'].$ && item['media:thumbnail'].$.url)
      || (item.enclosure && item.enclosure.url)
      || null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const parser = new Parser({
    timeout: 6000,
    maxRedirects: 3,
    customFields: {
      item: [
        ['media:content',   'media:content',   { keepArray: false }],
        ['media:thumbnail', 'media:thumbnail', { keepArray: false }]
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
    items.slice(0, 100).forEach(item => {
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
};
