'use strict';

/**
 * DORMIED — Affiliate Click Redirect
 *
 * GET /api/go/{id}[?src=brand|article|witb&slug=...]
 *
 * Logs the click, then 302s to the product's Impact tracking URL.
 *
 * NOTE ON FILE PATH: the spec called this "api/go.js". On Vercel a flat
 * api/go.js only serves /api/go — serving /api/go/{id} needs either this
 * native dynamic-route filename or a vercel.json rewrite. This filename is
 * the zero-config option and leaves vercel.json untouched.
 *
 * Rules enforced here:
 *   - tracking_url is read LIVE from Supabase on every request, never cached
 *     or baked (mirrors api/click.js self-healing behaviour).
 *   - We NEVER build or rewrite the affiliate link. Impact's `Url` already
 *     carries our account identifiers; appending to it breaks attribution.
 *   - mobile_tracking_url is used only when the UA is mobile AND the value is
 *     truthy. It is an empty string across the current feed, so a null check
 *     alone would redirect people to nowhere.
 *   - Click logging must NEVER block or fail the redirect.
 *
 * Uses SUPABASE_SERVICE_KEY: these tables are RLS deny-all, so an anon key
 * would find no product and bounce every visitor to the fallback.
 */

const { createClient } = require('@supabase/supabase-js');

// Impact click URLs conventionally accept subId params, but this is UNVERIFIED
// against Impact's own docs. Leave false until manually confirmed; when false
// the tracking URL is passed through completely untouched.
const APPEND_SUBID = false;

const MOBILE_RE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

module.exports = async (req, res) => {
  const q  = req.query || {};
  const id = parseInt(q.id, 10);

  const bounce = dest => { res.writeHead(302, { Location: dest, 'Cache-Control': 'no-store' }); return res.end(); };

  if (!Number.isFinite(id)) return bounce('/');

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[go] DB not configured');
    return bounce('/');
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Live read every request — never cached.
    const { data: product, error } = await supabase
      .from('affiliate_products')
      .select('id, dormied_brand_slug, tracking_url, mobile_tracking_url, is_active')
      .eq('id', id)
      .maybeSingle();

    if (error) { console.error('[go] lookup error:', error.message); return bounce('/'); }

    // Missing or deactivated -> brand page if resolvable, else home.
    if (!product || product.is_active !== true || !product.tracking_url) {
      return bounce(product && product.dormied_brand_slug ? `/brands/${product.dormied_brand_slug}/` : '/');
    }

    const ua       = req.headers['user-agent'] || '';
    const isMobile = MOBILE_RE.test(ua);
    // Truthy check, not a null check: mobile_tracking_url is '' across this feed.
    const target   = (isMobile && product.mobile_tracking_url) ? product.mobile_tracking_url : product.tracking_url;

    let destination = target;
    if (APPEND_SUBID) {
      // Only reachable once the parameter name has been manually verified.
      const srcType = typeof q.src === 'string' && q.src ? q.src : null;
      const srcSlug = typeof q.slug === 'string' && q.slug ? q.slug : null;
      const subId1  = [srcType, srcSlug].filter(Boolean).join(':');
      if (subId1) {
        const u = new URL(destination);
        u.searchParams.set('subId1', subId1);
        destination = u.toString();
      }
    }

    // Log the click — must never block or fail the redirect.
    try {
      const { error: clickErr } = await supabase.from('affiliate_clicks').insert({
        product_id:         product.id,
        dormied_brand_slug: product.dormied_brand_slug,
        source_page_type:   (typeof q.src === 'string' && q.src) ? q.src : null,
        source_slug:        (typeof q.slug === 'string' && q.slug) ? q.slug : null,
        referrer:           req.headers.referer || req.headers.referrer || null,
        user_agent:         ua || null,
      });
      if (clickErr) console.error('[go] click log failed (redirecting anyway):', clickErr.message);
    } catch (e) {
      console.error('[go] click log threw (redirecting anyway):', e.message);
    }

    return bounce(destination);
  } catch (err) {
    console.error('[go] Error:', err.message);
    return bounce('/');
  }
};
