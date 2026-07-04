'use strict';

/**
 * DORMIED — Article Click Recorder
 *
 * POST /api/click
 * Body: { url, title, source_name, image_url, brand_ids, pub_date }
 *
 * Increments click_count for the article in Supabase.
 * Used to power the Top Stories section (most clicked in past 7 days).
 */

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, title, source_name, image_url, brand_ids, pub_date } = req.body || {};
  if (!url || !title) return res.status(400).json({ error: 'url and title required' });

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'DB not configured' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Resolve pub_date from the source of truth. For a DORMIED article URL
    // (/news/{slug}/) always use the live dormied_articles.published_at and ignore
    // the client-supplied value, so a published_at correction self-heals on the next
    // click and a stale page can never re-stamp an old date. Fall back to the client
    // value ONLY when the URL has no matching article row (external/wire links).
    let resolvedPubDate = pub_date || null;
    const slugMatch = url.match(/^\/news\/([^/]+)\/?$/);
    if (slugMatch) {
      const { data: article } = await supabase
        .from('dormied_articles')
        .select('published_at')
        .eq('slug', slugMatch[1])
        .maybeSingle();
      if (article && article.published_at) resolvedPubDate = article.published_at;
    }

    const { data: existing } = await supabase
      .from('article_clicks')
      .select('click_count')
      .eq('url', url)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('article_clicks')
        .update({
          click_count:  existing.click_count + 1,
          last_clicked: new Date().toISOString(),
          // Refresh metadata in case it changed
          title, source_name, image_url,
          brand_ids:    brand_ids  || [],
          pub_date:     resolvedPubDate,
        })
        .eq('url', url);
    } else {
      await supabase.from('article_clicks').insert({
        url, title, source_name, image_url,
        brand_ids:    brand_ids || [],
        pub_date:     resolvedPubDate,
        click_count:  1,
        last_clicked: new Date().toISOString(),
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[click] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
