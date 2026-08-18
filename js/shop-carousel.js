/**
 * DORMIED — "Shop [Brand]" affiliate carousel (brand pages only).
 *
 * The generator emits an EMPTY mount point; all product data arrives here from
 * /api/shop. No Supabase access from the browser, no keys, and tracking_url is
 * never exposed — every CTA points at /api/go/{id}.
 *
 * If the fetch is empty, errors, or times out, the entire section is removed
 * from the DOM. There is no empty state and no retry button.
 */
(function () {
  'use strict';

  var PAGE_SIZE      = 12;   // per fetch; /api/shop caps limit at 24
  var MAX_CARDS      = 60;   // hard cap on total loaded cards
  var PREFETCH_CARDS = 4;    // fetch more when within this many cards of the end
  var STALE_HOURS    = 48;   // suppress price when feed_updated_at is older than this
  var FETCH_TIMEOUT  = 8000;

  var section = document.getElementById('bp-shop-section');
  if (!section) return;

  var track = document.getElementById('bp-shop-track');
  var prev  = document.getElementById('bp-shop-prev');
  var next  = document.getElementById('bp-shop-next');
  var dots  = document.getElementById('bp-shop-dots');
  var slug  = section.getAttribute('data-brand-slug') || '';
  var brandName = section.getAttribute('data-brand-name') || '';
  // "Shop This Bag" supplies an explicit, ordered product list instead of a
  // brand to page through: the page already decided which products (the ones in
  // the player's bag), so there is nothing to paginate.
  var fixedIds = (section.getAttribute('data-product-ids') || '').trim();

  var loaded = [], offset = 0, total = null, fetching = false, exhausted = false;

  function removeSection() { if (section && section.parentNode) section.parentNode.removeChild(section); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(v, cur) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    var sym = cur === 'USD' ? '$' : '';
    return sym + (n % 1 === 0 ? n.toFixed(0) : n.toFixed(2));
  }

  // Prices are synced nightly; hide them rather than show a stale number. The
  // card still renders, just without the price row.
  function isStale(feedUpdatedAt) {
    if (!feedUpdatedAt) return true;
    var t = Date.parse(feedUpdatedAt);
    if (isNaN(t)) return true;
    return (Date.now() - t) > STALE_HOURS * 3600 * 1000;
  }

  function cardHtml(p) {
    // Amazon rows never carry a price: the Associates agreement only licenses
    // prices pulled through their API, so the card sends the reader to Amazon
    // to see it rather than showing a number we cannot legitimately display or
    // keep fresh. That also means the staleness guard below does not apply.
    var isAmazon = p.source === 'amazon';
    var stale = isStale(p.feed_updated_at);
    var showPrice = !isAmazon && !stale && p.current_price != null;
    var priceHtml = '';
    if (showPrice) {
      var onSale = p.original_price != null && Number(p.original_price) > Number(p.current_price);
      priceHtml =
        '<span class="bp-shop-price">' + esc(money(p.current_price, p.currency)) + '</span>' +
        (onSale ? '<span class="bp-shop-price-was">' + esc(money(p.original_price, p.currency)) + '</span>' : '') +
        (onSale && p.discount_percentage != null
          ? '<span class="bp-shop-badge">-' + esc(Math.round(Number(p.discount_percentage))) + '%</span>' : '');
    }
    var img = p.image_url
      ? '<img class="bp-shop-thumb" src="' + esc(p.image_url) + '" alt="" loading="lazy" width="300" height="300">'
      : '';
    // Amazon links go straight to the tagged amzn.to URL the API hands back,
    // not through /api/go/. Everything else keeps the redirect so the click is
    // logged and the network's tracking_url stays server-side.
    var href = isAmazon
      ? esc(p.go_url)
      : '/api/go/' + encodeURIComponent(p.id) + '?src=brand&amp;slug=' + encodeURIComponent(slug);
    // A suppressed price used to leave an empty .bp-shop-price-row holding 22px
    // of blank space under the name, next to a "BUY NOW" that showed no number.
    // That reads as broken rather than deliberate. Same treatment as Amazon:
    // drop the empty row and say plainly that the price lives on the merchant's
    // site. MacGregor hit this because their Impact feed's DateLastUpdated is
    // months old, so every one of their prices is correctly withheld.
    var cta = isAmazon ? 'Check price on Amazon'
            : showPrice ? 'BUY NOW'
            : (brandName ? 'Check price at ' + brandName : 'Check price');

    // rel="sponsored nofollow" is mandatory on every affiliate link.
    return '' +
      '<article class="bp-shop-card' + (isAmazon ? ' bp-shop-card--amazon' : '') + '">' +
        '<div class="bp-shop-thumb-wrap">' + img + '</div>' +
        '<div class="bp-shop-body">' +
          '<p class="bp-shop-name">' + esc(p.name) + '</p>' +
          (priceHtml ? '<div class="bp-shop-price-row">' + priceHtml + '</div>' : '') +
          '<a class="bp-shop-buy" href="' + href + '"' +
             ' rel="sponsored nofollow" target="_blank">' + esc(cta) + '</a>' +
        '</div>' +
      '</article>';
  }

  function cardsPerView() {
    var first = track.querySelector('.bp-shop-card');
    if (!first) return 4;
    var w = first.getBoundingClientRect().width + 12;
    return Math.max(1, Math.round(track.clientWidth / w));
  }

  function renderDots() {
    if (!dots) return;
    var per = cardsPerView();
    var pages = Math.max(1, Math.ceil(loaded.length / per));
    if (pages < 2) { dots.innerHTML = ''; return; }
    var active = Math.min(pages - 1, Math.round(track.scrollLeft / (track.clientWidth || 1)));
    var html = '';
    for (var i = 0; i < pages; i++) {
      html += '<button type="button" class="bp-shop-dot" role="tab" aria-selected="' +
              (i === active ? 'true' : 'false') + '" aria-label="Go to product page ' + (i + 1) +
              '" data-page="' + i + '"></button>';
    }
    dots.innerHTML = html;
  }

  function syncArrows() {
    if (!prev || !next) return;
    var atStart = track.scrollLeft <= 2;
    var atEnd   = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    prev.hidden = atStart;
    next.hidden = atEnd && exhausted;
  }

  function render() {
    track.innerHTML = loaded.map(cardHtml).join('');
    renderDots();
    syncArrows();
  }

  function fetchPage() {
    if (fetching || exhausted || loaded.length >= MAX_CARDS) return Promise.resolve();
    fetching = true;
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, FETCH_TIMEOUT);
    var url = fixedIds
      ? '/api/shop?ids=' + encodeURIComponent(fixedIds)
      : '/api/shop?brand=' + encodeURIComponent(slug) +
        '&limit=' + PAGE_SIZE + '&offset=' + offset;

    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        clearTimeout(timer);
        var items = (d && d.products) || [];
        total = (d && typeof d.count === 'number') ? d.count : total;
        // An empty FIRST page means the brand has a program but nothing sellable
        // yet (newly signed partner, catalog not flowing). Drop the section
        // rather than leave an empty shell with a heading and a disclosure.
        if (!items.length) {
          exhausted = true;
          if (!loaded.length) removeSection();
          return;
        }
        loaded = loaded.concat(items).slice(0, MAX_CARDS);
        offset += items.length;
        // A fixed id list arrives complete in one response; never ask for more.
        if (fixedIds || loaded.length >= MAX_CARDS || (total != null && offset >= total)) exhausted = true;
        render();
      })
      .catch(function (e) {
        clearTimeout(timer);
        exhausted = true;
        // First page failed -> no section at all.
        if (!loaded.length) { removeSection(); throw e; }
      })
      .then(function () { fetching = false; }, function () { fetching = false; });
  }

  function maybePrefetch() {
    if (exhausted || fetching) return;
    var first = track.querySelector('.bp-shop-card');
    if (!first) return;
    var cardW = first.getBoundingClientRect().width + 12;
    var lastVisible = (track.scrollLeft + track.clientWidth) / cardW;
    if (lastVisible >= loaded.length - PREFETCH_CARDS) fetchPage();
  }

  function scrollByPage(dir) {
    track.scrollBy({ left: dir * track.clientWidth, behavior: 'smooth' });
  }

  if (prev) prev.addEventListener('click', function () { scrollByPage(-1); });
  if (next) next.addEventListener('click', function () { scrollByPage(1); });
  if (dots) dots.addEventListener('click', function (e) {
    var b = e.target.closest('.bp-shop-dot');
    if (!b) return;
    track.scrollTo({ left: parseInt(b.getAttribute('data-page'), 10) * track.clientWidth, behavior: 'smooth' });
  });

  var ticking = false;
  track.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      syncArrows(); renderDots(); maybePrefetch(); ticking = false;
    });
  }, { passive: true });

  window.addEventListener('resize', function () { renderDots(); syncArrows(); });

  // Initial load. An empty first page removes the section entirely.
  fetchPage().then(function () {
    if (!loaded.length) removeSection();
  }).catch(function () { /* removeSection already ran */ });
})();
