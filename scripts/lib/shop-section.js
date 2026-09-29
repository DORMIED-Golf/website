'use strict';
/**
 * scripts/lib/shop-section.js
 *
 * The "Shop [Brand]" carousel mount for a news article, shared by
 * generate-article.js (new pages) and inject-article-shop.js (adding it to
 * pages already published when a brand becomes sellable, e.g. when Global
 * Golf's feed put ~80 more brands in stock). One copy, so the two cannot drift.
 *
 * The mount is EMPTY: no product data, price or tracking_url is baked into the
 * page. js/shop-carousel.js fills it from /api/shop at runtime and removes the
 * whole section if the brand returns no products.
 */

const { pinnedProductAttr } = require('./brand-pinned-products');

function articleShopSectionHtml(brandSlug, brandName, esc) {
  return `
            <!-- ── Shop ${esc(brandName)} (affiliate) ── -->
            <section class="bp-shop-section" id="bp-shop-section" data-brand-slug="${esc(brandSlug)}" data-brand-name="${esc(brandName)}"${pinnedProductAttr(brandSlug, esc)}>
              <p class="bp-chart-heading">Shop ${esc(brandName)}</p>
              <div class="bp-shop-viewport">
                <button type="button" class="bp-shop-arrow bp-shop-arrow--prev" id="bp-shop-prev" aria-label="Scroll to previous products" hidden>&#8249;</button>
                <div class="bp-shop-track" id="bp-shop-track" role="region" aria-label="Shop ${esc(brandName)} products" tabindex="0"></div>
                <button type="button" class="bp-shop-arrow bp-shop-arrow--next" id="bp-shop-next" aria-label="Scroll to next products" hidden>&#8250;</button>
              </div>
              <div class="bp-shop-dots" id="bp-shop-dots" role="tablist" aria-label="Product pages"></div>
              <p class="bp-shop-disclosure">Some links on this page are affiliate links. DORMIED may earn a commission on purchases made through them. This does not influence the DORMIED Index or our editorial coverage.</p>
            </section>
`;
}

module.exports = { articleShopSectionHtml };
