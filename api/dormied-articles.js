/**
 * DORMIED Originals API
 *
 * Returns published DORMIED original articles from Supabase.
 * Supports ?brand=slug to filter by primary brand.
 * Normalises shape to match /api/feed articles for easy frontend merging.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const brandFilter = req.query.brand || null;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 10000);

  let query = supabase
    .from('dormied_articles')
    .select('id, brand_slug, title, meta_description, image_url, source_url, source_name, slug, category, published_at, author')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);

  if (brandFilter) {
    query = query.eq('brand_slug', brandFilter);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[dormied-articles] Supabase error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  // Derive author from category when not explicitly set.
  // Kept in step with scripts/lib/article-authors.js. Not a require(): this is
  // a Vercel serverless function and scripts/ is not part of its bundle, so the
  // rule is duplicated here on purpose. Women's routing is absent because it
  // keys off the brand's sub-categories, which this row does not carry.
  function authorFromCategory(category) {
    const cat = (category || '').toLowerCase();
    if (/bags? & accessories|\bbags?\b|accessor/.test(cat)) return 'James K.';
    if (/apparel|footwear|shoe/.test(cat))                  return 'Adam R.';
    return 'Travis R.';
  }

  // Normalise to article shape used by the frontend
  const articles = (data || []).map(a => ({
    id:          a.id,
    title:       a.title,
    url:         `/news/${a.slug}/`,
    // Prefer explicit author from DB; fall back to category derivation
    author:      a.author || authorFromCategory(a.category),
    sourceName:  'DORMIED',
    sourceId:    'dormied',
    pubDate:     a.published_at,
    description: a.meta_description || '',
    imageUrl:    a.image_url || null,
    brandIds:    [a.brand_slug],
    isDormied:   true,
    category:    a.category || '',
    slug:        a.slug,
    sourceUrl:   a.source_url || null,
  }));

  res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=300');
  res.json({ articles, updatedAt: new Date().toISOString() });
};
