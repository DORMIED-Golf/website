/* ─────────────────────────────────────────────────────────────────────────
   scorecard-article.js  —  DORMIED Scorecard Article Page
   Depends on: scorecard-data.js, data.js (for brand slug map + auto-linking)
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function slugFromPath() {
    var parts = window.location.pathname.replace(/\/$/, '').split('/');
    return parts[parts.length - 1] || '';
  }

  /* ── Build brand name→slug map from DORMIED_DATA ─────────────────────── */
  function buildBrandMap() {
    var map = {};
    var data = window.DORMIED_DATA;
    if (!data || !data.brands) return map;
    data.brands.forEach(function (b) {
      if (b.name && b.id) map[b.name] = b.id;
    });
    return map;
  }

  /* ── Auto-link brand names in rendered HTML ──────────────────────────── */
  function autolinkBrands(html, brandMentions, brandMap) {
    if (!brandMentions || !brandMentions.length) return html;

    // Build reverse map: id → name, only for mentioned brands
    var toLink = [];
    brandMentions.forEach(function (id) {
      // find name from brandMap
      var name = null;
      Object.keys(brandMap).forEach(function (n) {
        if (brandMap[n] === id) name = n;
      });
      if (name) toLink.push({ id: id, name: name });
    });

    // Sort by name length desc (longest first) to avoid partial matches
    toLink.sort(function (a, b) { return b.name.length - a.name.length; });

    toLink.forEach(function (brand) {
      // Word-boundary regex, avoid re-linking already-linked text
      var escaped = brand.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('(?<![\\w/"])(' + escaped + ')(?![\\w"])', 'g');
      html = html.replace(re, function (match) {
        return '<a href="/brands/' + brand.id + '/" class="sc-brand-link">' + match + '</a>';
      });
    });

    return html;
  }

  /* ── Render image strip or hero image ────────────────────────────────── */
  function buildImageHtml(issue) {
    if (!issue.images) return '';
    var strip = issue.images.strip || [];
    var hero  = issue.images.hero;

    if (strip.length > 0) {
      var items = strip.map(function (img) {
        return '<div class="sc-strip-item">' +
          '<img class="sc-strip-img" src="' + escHtml(img.src) + '" alt="' + escHtml(img.label || '') + '" loading="lazy">' +
          (img.label ? '<span class="sc-strip-label">' + escHtml(img.label) + '</span>' : '') +
        '</div>';
      }).join('');
      return '<div class="sc-image-strip sc-image-strip--article">' + items + '</div>';
    }

    if (hero) {
      return '<img class="sc-article-hero-img" src="' + escHtml(hero) + '" alt="" loading="lazy">';
    }

    return '';
  }

  /* ── Render table of contents ────────────────────────────────────────── */
  function buildToc(issue) {
    if (!issue.toc || !issue.toc.length) return '';
    var items = issue.toc.map(function (item) {
      return '<li><a href="#' + escHtml(item.id) + '" class="sc-toc-link">' + escHtml(item.label) + '</a></li>';
    }).join('');
    return '<nav class="sc-toc" aria-label="Article sections"><ul class="sc-toc-list">' + items + '</ul></nav>';
  }

  /* ── Render index snapshot table ─────────────────────────────────────── */
  function buildIndexTable(snapshot) {
    if (!snapshot || !snapshot.length) return '';
    var rows = snapshot.map(function (row) {
      var momClass = row.mom > 0 ? 'sc-table-up' : row.mom < 0 ? 'sc-table-down' : 'sc-table-flat';
      var momStr   = row.mom > 0 ? '+' + row.mom.toFixed(1) + '%' : row.mom < 0 ? row.mom.toFixed(1) + '%' : '—';
      return '<tr>' +
        '<td class="sc-table-rank">' + escHtml(String(row.rank)) + '</td>' +
        '<td class="sc-table-name"><a href="/brands/' + escHtml(row.id) + '/" class="sc-brand-link">' + escHtml(row.name) + '</a></td>' +
        '<td class="sc-table-di">' + escHtml(String(row.di.toFixed(1))) + '</td>' +
        '<td class="sc-table-mom ' + momClass + '">' + escHtml(momStr) + '</td>' +
        '<td class="sc-table-cat">' + escHtml(row.category) + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="sc-table-wrap">' +
      '<table class="sc-table" aria-label="Index snapshot">' +
        '<thead><tr>' +
          '<th>#</th><th>Brand</th><th>DI</th><th>M/M</th><th>Category</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  /* ── Render article sections ─────────────────────────────────────────── */
  function buildSections(issue, brandMap) {
    if (!issue.sections) return '';
    return issue.sections.map(function (section) {
      var body = autolinkBrands(section.body || '', issue.brandMentions || [], brandMap);
      var headingHtml = section.heading
        ? '<h2 id="' + escHtml(section.id) + '" class="sc-section-heading">' +
            '<a href="#' + escHtml(section.id) + '" class="sc-section-anchor" aria-label="Link to section">#</a>' +
            escHtml(section.heading) +
          '</h2>'
        : '';

      // Inject index table after "AT THE TOP" section
      var tableHtml = '';
      if (section.id === 'at-the-top' && issue.indexSnapshot && issue.indexSnapshot.length) {
        tableHtml = buildIndexTable(issue.indexSnapshot);
      }

      return '<section class="sc-section" id="' + (section.heading ? '' : escHtml(section.id)) + '">' +
        headingHtml +
        body +
        tableHtml +
      '</section>';
    }).join('');
  }

  /* ── Render prev/next nav ────────────────────────────────────────────── */
  function buildPrevNext(issues, currentIdx) {
    var prev = currentIdx < issues.length - 1 ? issues[currentIdx + 1] : null;
    var next = currentIdx > 0                  ? issues[currentIdx - 1] : null;

    var prevHtml = prev
      ? '<a href="/scorecard/' + escHtml(prev.slug) + '/" class="sc-prevnext-link sc-prevnext-prev">' +
          '<span class="sc-prevnext-dir">← Previous</span>' +
          '<span class="sc-prevnext-title">' + escHtml(prev.title) + '</span>' +
        '</a>'
      : '<span class="sc-prevnext-link sc-prevnext-empty"></span>';

    var nextHtml = next
      ? '<a href="/scorecard/' + escHtml(next.slug) + '/" class="sc-prevnext-link sc-prevnext-next">' +
          '<span class="sc-prevnext-dir">Next →</span>' +
          '<span class="sc-prevnext-title">' + escHtml(next.title) + '</span>' +
        '</a>'
      : '<span class="sc-prevnext-link sc-prevnext-empty"></span>';

    return '<nav class="sc-prevnext" aria-label="Issue navigation">' + prevHtml + nextHtml + '</nav>';
  }

  /* ── Set page SEO meta ───────────────────────────────────────────────── */
  function setMeta(issue) {
    var title = 'The Scorecard | ' + issue.monthLabel + ' — Golf Brand Trends & Rankings | DORMIED';
    var desc  = issue.subtitle;

    document.title = title;

    var canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.href = 'https://dormied.com/scorecard/' + issue.slug + '/';

    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.content = desc;

    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.content = title;

    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.content = desc;

    var ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.content = 'https://dormied.com/scorecard/' + issue.slug + '/';

    var twTitle = document.querySelector('meta[name="twitter:title"]');
    if (twTitle) twTitle.content = title;

    var twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) twDesc.content = desc;

    // Dynamic OG / Twitter image — use first strip image or hero if available
    var articleImg = 'https://dormied.com/images/og-image.jpg';
    if (issue.images) {
      var strip = issue.images.strip || [];
      if (strip.length > 0 && strip[0].src) {
        articleImg = 'https://dormied.com' + strip[0].src;
      } else if (issue.images.hero) {
        articleImg = 'https://dormied.com' + issue.images.hero;
      }
    }
    var ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg) ogImg.content = articleImg;
    var twImg = document.querySelector('meta[name="twitter:image"]');
    if (twImg) twImg.content = articleImg;

    // Structured data
    var ldJson = document.getElementById('sc-ld-json');
    if (ldJson) {
      ldJson.textContent = JSON.stringify({
        "@context":       "https://schema.org",
        "@type":          "Article",
        "headline":       issue.title,
        "description":    issue.subtitle,
        "datePublished":  issue.dateISO,
        "image":          articleImg,
        "author": [
          { "@type": "Person", "name": "Travis", "url": "https://dormied.com/about/" },
          { "@type": "Person", "name": "Adam",   "url": "https://dormied.com/about/" }
        ],
        "publisher":      { "@type": "Organization", "name": "DORMIED", "url": "https://dormied.com", "logo": { "@type": "ImageObject", "url": "https://dormied.com/images/dormied-logo-colour.png" } },
        "url":            "https://dormied.com/scorecard/" + issue.slug + "/",
        "breadcrumb": {
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home",       "item": "https://dormied.com/" },
            { "@type": "ListItem", "position": 2, "name": "Scorecard",  "item": "https://dormied.com/scorecard/" },
            { "@type": "ListItem", "position": 3, "name": issue.title,  "item": "https://dormied.com/scorecard/" + issue.slug + "/" }
          ]
        }
      });
    }
  }

  /* ── Main ────────────────────────────────────────────────────────────── */
  function init() {
    var scData = window.DORMIED_SCORECARD_DATA;
    if (!scData || !scData.issues) return;

    var slug = slugFromPath();
    var idx  = scData.issues.findIndex(function (i) { return i.slug === slug; });
    if (idx === -1) {
      // Unknown slug — redirect to archive
      window.location.replace('/scorecard/');
      return;
    }

    var issue    = scData.issues[idx];
    var brandMap = buildBrandMap();

    setMeta(issue);

    // Populate header
    var labelEl = document.getElementById('sc-article-label');
    if (labelEl) labelEl.textContent = 'THE SCORECARD';

    var titleEl = document.getElementById('sc-article-title');
    if (titleEl) titleEl.textContent = issue.title;

    var subEl = document.getElementById('sc-article-subtitle');
    if (subEl) subEl.textContent = issue.subtitle;

    var bylineEl = document.getElementById('sc-article-byline');
    if (bylineEl) bylineEl.textContent = 'Adam & Travis  ·  ' + issue.date;

    // Populate image
    var imgEl = document.getElementById('sc-article-image');
    if (imgEl) imgEl.innerHTML = buildImageHtml(issue);

    // Populate TOC
    var tocEl = document.getElementById('sc-article-toc');
    if (tocEl) tocEl.innerHTML = buildToc(issue);

    // Populate body
    var bodyEl = document.getElementById('sc-article-body');
    if (bodyEl) bodyEl.innerHTML = buildSections(issue, brandMap);

    // Populate prev/next
    var pnEl = document.getElementById('sc-article-prevnext');
    if (pnEl) pnEl.innerHTML = buildPrevNext(scData.issues, idx);

    // Error state
    document.getElementById('sc-article-loading') && (document.getElementById('sc-article-loading').hidden = true);
    document.getElementById('sc-article-wrap') && (document.getElementById('sc-article-wrap').hidden = false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
