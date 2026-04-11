/**
 * DORMIED Originals RSS Feed
 * Serves RSS 2.0 XML for DORMIED original articles at /api/originals-feed
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

function escXml(str) {
  return String(str || '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

module.exports = async (req, res) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).send('Supabase not configured');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data, error } = await supabase
    .from('dormied_articles')
    .select('id, title, meta_description, image_url, slug, category, brand_slug, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(50);

  if (error) {
    return res.status(500).send('Feed unavailable');
  }

  const SITE = 'https://dormied.com';

  const items = (data || []).map(a => {
    const url     = `${SITE}/news/${a.slug}/`;
    const pubDate = new Date(a.published_at).toUTCString();
    const desc    = escXml(a.meta_description || '');
    const img     = a.image_url
      ? `<enclosure url="${escXml(a.image_url)}" type="image/jpeg" length="0"/>`
      : '';
    return `
  <item>
    <title>${escXml(a.title)}</title>
    <link>${escXml(url)}</link>
    <description>${desc}</description>
    <pubDate>${pubDate}</pubDate>
    <guid isPermaLink="true">${escXml(url)}</guid>
    <category>${escXml(a.category || 'Golf')}</category>
    ${img}
  </item>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>DORMIED Originals</title>
  <link>${SITE}</link>
  <description>Original golf brand intelligence from DORMIED. Press releases rewritten as editorial takes.</description>
  <language>en-us</language>
  <atom:link href="${SITE}/api/originals-feed" rel="self" type="application/rss+xml"/>
  <image>
    <url>${SITE}/images/dormied-icon.png</url>
    <title>DORMIED Originals</title>
    <link>${SITE}</link>
  </image>
  ${items}
</channel>
</rss>`;

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=600');
  res.send(xml);
};
