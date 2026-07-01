#!/usr/bin/env node
/**
 * scripts/inject-4-seo-articles.js
 *
 * Publishes 4 pre-written SEO articles directly to dormied_articles (status='published')
 * and generates the static HTML files. No Opus calls — content is pre-written.
 *
 * Run: node scripts/inject-4-seo-articles.js
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const fs               = require('fs');
const path             = require('path');
const vm               = require('vm');
const { createClient } = require('@supabase/supabase-js');
let   sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

const SITE_ROOT = path.resolve(__dirname, '..');
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ═══════════════════════════════════════════════════════════════════════════════
// ARTICLES
// ═══════════════════════════════════════════════════════════════════════════════

const ARTICLES = [
  {
    slug:            'who-owns-odyssey-golf',
    brandSlug:       'odyssey-golf',
    secondarySlugs:  ['callaway', 'toulon-golf'],
    title:           'Who Owns Odyssey Golf?',
    author:          'Travis',
    category:        'Putters',
    sourceUrl:       'https://www.golfdigest.com/story/heres-what-happened-with-eight-equipment-company-acquistions',
    sourceName:      'Golf Digest',
    imageUrl:        'https://images.contentstack.io/v3/assets/bltf7bc8e0c7e024392/blt9a5b653369ea1862/696fe8bd7602634abad3043f/2026-AI-DUAL_Lifestyle_3.jpg?auto=webp&width=2048&quality=75',
    metaDescription: 'Callaway has owned Odyssey Golf since 1997. The $130M acquisition reshaped the putter category and still drives roughly 40% of US putter sales today.',
    seoKeywords:     ['Odyssey Golf owner', 'who owns Odyssey Golf', 'Callaway Odyssey acquisition', 'Odyssey Golf history', 'Toulon Design'],
    xPostText:       'Callaway has owned Odyssey since 1997. The $130M deal still pays back every quarter. Inside what 28 years of category ownership actually built.',
    body: `Odyssey Golf has been owned by Callaway Golf Company since August 1997. The acquisition cost $130 million in cash, paid to U.S. Industries, the conglomerate that owned Odyssey Sports at the time. Odyssey has operated as a wholly-owned subsidiary of Callaway ever since, and the original deal still ranks as one of the most consequential transactions in modern golf equipment history.

The numbers tell the story. At the time of acquisition, Odyssey was a fast-growing putter brand built around its dual-insert face technology. Callaway was the dominant force in metalwoods through the Big Bertha franchise but had no real presence on the putting green. Then-CEO Donald Dye told the market that the goal was simple: own the green by the end of 1997. Eight years later, Callaway's Odyssey division alone generated $86 million in putter sales. Today the brand sells roughly four of every ten putters bought in the United States.

What makes the deal interesting in hindsight is what Callaway didn't do. After the acquisition, the company kept the Odyssey name, kept its design team, and kept its standalone identity in retail. The 2-Ball, launched in 2001, remains one of the highest-volume putter models ever produced. The White Hot insert, introduced in 2000, became the category-defining face technology of its era. Callaway provided the back-end infrastructure and the manufacturing scale. Odyssey kept the brand voice and the product DNA. It is a textbook example of how to acquire without destroying.

The Toulon Connection

In 2016, Callaway folded another acquisition into the Odyssey portfolio. Toulon Design, a boutique milled putter brand founded by Sean Toulon, was brought under Odyssey's umbrella. Sean Toulon became general manager of Odyssey Golf and a senior vice president at Callaway. The move expanded Odyssey's reach into the premium milled segment without diluting the mainline insert business that drives the brand's volume.

The result is a portfolio that competes at three price tiers under one ownership structure: high-volume insert putters under the Odyssey brand, premium milled putters under Toulon, and the broader Callaway umbrella covering everything else in the bag. That kind of category coverage is rare. Scotty Cameron competes in the premium milled segment under Titleist ownership. Ping has stayed disciplined as an independent operator. Odyssey is the only putter brand that sits inside a full-line OEM and still owns the category.

What This Means for the Putter Market

Ownership matters in putters more than people realize. Putter brands rely on consistency of feel, manufacturing tolerance, and shelf presence at custom-fit retailers. A boutique brand can build a tour following on one of those three but rarely all three. Callaway's ownership gave Odyssey decades of manufacturing investment that smaller competitors could not match. That is why the 2-Ball is still on every starter set recommendation list and the latest L.A.B. Golf or Bettinardi challenger usually wins the editorial coverage while Odyssey wins the retail sale.

Context: How This Compares

Callaway's purchase of Odyssey in 1997 cost roughly four times the company's then-current annual revenue. That premium price has paid back many times over. Odyssey's putter sales have been a meaningful contributor to Callaway's revenue every year since the acquisition closed. Compare that to other major OEM acquisitions in the same era. The Top-Flite acquisition out of Spalding's bankruptcy delivered scale but not category leadership. The Ben Hogan acquisition delivered brand history but not commercial traction. Odyssey is the rare deal where the price tag at the time looked expensive and the math has only gotten better since.

If you are asking who owns Odyssey because you are wondering whether the brand is independent or backed by deeper resources: it is the second one, and that is a feature, not a bug. The brand has spent 28 years inside Callaway and remains the category leader.`,
  },
  {
    slug:            'where-is-takomo-golf-from',
    brandSlug:       'takomo-golf',
    secondarySlugs:  [],
    title:           'Where Is Takomo Golf From?',
    author:          'Travis',
    category:        'Clubs',
    sourceUrl:       'https://www.si.com/golf/news/price-point-makes-takomo-golf-a-player',
    sourceName:      'Sports Illustrated',
    imageUrl:        'https://golfergeeks.b-cdn.net/wp-content/uploads/2026/03/Takomo-201T-MKII-irons-full-set.jpg',
    metaDescription: 'Takomo Golf is headquartered in Turku, Finland. Founded 2020 by Sebastian Haapahovi, the direct-to-consumer brand designs in Finland and manufactures in Asia.',
    seoKeywords:     ['where is Takomo Golf from', 'Takomo Golf Finland', 'Takomo Golf headquarters', 'Takomo Golf origin', 'Takomo Golf DTC irons'],
    xPostText:       'Takomo Golf is from Turku, Finland. Founded 2020. Designed in Finland, manufactured in Asia, shipped from Hong Kong. The combination is what makes the DTC pricing work.',
    body: `Takomo Golf is headquartered in Turku, Finland. The brand was founded in 2020 by Sebastian Haapahovi, a former IT executive who turned to club design after experiencing sticker shock at premium equipment pricing. Takomo's design, research, prototyping, and quality control all happen at its Finnish headquarters at Ajurinkatu 2 in Turku. Manufacturing is contracted to factories in Southeast Asia, and shipping originates from a warehouse in Hong Kong.

The split between Finnish design and Asian manufacturing is the foundational structural choice of the business. Takomo operates as a direct-to-consumer brand, which means the company never sells through traditional golf retail. Iron sets ship directly from the Hong Kong warehouse to the customer. Cutting out middlemen is what lets Takomo price a forged S20C steel iron set at $589 against equivalent OEM sets that retail in the $1,400 to $1,800 range.

Finland matters here as more than a corporate address. The country has roughly 150 golf courses and a small but committed golfing community. More importantly, Finland has a deep manufacturing heritage rooted in design precision. Takomo positions itself within that Nordic design tradition, which the brand markets as Scandinavian mindset: quality and durability over volume, function over decoration. The aesthetic shows up in the product, from the clean topline geometry of the 201 series to the muted color palette and the typography on the brand's website.

How the Manufacturing Split Actually Works

The Finnish team controls the design specifications, steel selection, forging tolerances, and CNC milling standards. The Iron 201, the brand's flagship, is precision-forged from S20C carbon steel, the same grade used by most premium forged irons from Japanese manufacturers. The Iron 101 is a cast game-improvement model targeted at higher-handicap players. The Skyforger wedge line uses S20C forging with milled grooves. All three lines are designed in Turku, manufactured in Southeast Asia under Finnish quality control oversight, and shipped from Hong Kong.

This is not the same model as a brand that buys off-the-shelf castings and adds a logo. Takomo controls the design and the specifications. The Asian factory makes the heads to those specifications, the same way many Japanese forged irons are made in Taiwan or China for cost reasons. The difference between Takomo and a true OEM is mostly the scale of marketing budget and tour presence, not the underlying engineering rigor.

The DORMIED Take

Takomo's geographic story is more interesting than most direct-to-consumer brands because the Finnish identity actually carries through to the product. Most DTC challengers in equipment, from Sub 70 to New Level, operate from American bases with no particular geographic identity beyond the founder's hometown. Takomo built its brand on Finland because the country gives the brand a story to tell and a design tradition to claim. That story matters more in apparel and more in luxury goods than in clubs, but it still moves the needle for buyers who want their gear to have a point of view.

The business model has held up. Takomo got an early boost from positive YouTube reviews by Tour Experience Golf in 2021 and sold out repeatedly through 2022. The brand has since expanded to include drivers, fairway woods, hybrids, and bag accessories. The pricing remains aggressive relative to category incumbents like Mizuno and Srixon, which is the bet at the center of the brand.

So when you see Takomo on a YouTube fitter's bag list and wonder where the brand actually comes from: Turku, Finland. Founded 2020. Design and quality control Finnish. Manufacturing Southeast Asian. Shipping global. That combination is what lets the price point work.`,
  },
  {
    slug:            'where-is-avoda-golf-based',
    brandSlug:       'avoda-golf',
    secondarySlugs:  ['krank-golf'],
    title:           'Where Is Avoda Golf Based?',
    author:          'Travis',
    category:        'Clubs',
    sourceUrl:       'https://www.golfmonthly.com/features/what-is-avoda-golf-check-out-bryson-dechambeaus-new-iron-brand',
    sourceName:      'Golf Monthly',
    imageUrl:        'https://avodagolf.com/cdn/shop/articles/SameLengthOrComboLength_c91e8f97-ddc8-4a6c-8303-9b9b77b5a417.png?v=1757426701&width=1000',
    metaDescription: 'Avoda Golf is based in Pittsburgh, founded 2023 by Tom Bailey. The hand-built iron brand jumped to prominence when Bryson DeChambeau won the 2024 US Open playing them.',
    seoKeywords:     ['where is Avoda Golf based', 'Avoda Golf Pittsburgh', 'Avoda Golf Tom Bailey', 'Bryson DeChambeau irons', 'same length irons'],
    xPostText:       'Avoda Golf is based in Pittsburgh. Founded 2023 by Tom Bailey. Bryson DeChambeau won the 2024 US Open playing their irons within a year of the company existing. The geography matters more than people think.',
    body: `Avoda Golf is based in Pittsburgh, Pennsylvania. The brand was founded in 2023 by Tom Bailey, a former European Tour coach who built the company around hand-built, made-to-order iron sets. Avoda's defining technical idea is combo-length and same-length iron construction, which reduces or eliminates the length variation between irons in a set. The pitch is consistency: same setup, same swing plane, same ball-striking dynamics across the bag.

Pittsburgh is not a coincidence. Bailey built the operation there to keep the supply chain close, the build process visible, and the customer fitting experience controllable. Avoda's irons are not cast at scale and shipped through retail. Each set is built individually to a player's anatomy, swing data, and preference inputs gathered through the brand's Precision Fit system. The model is closer to a boutique club-maker than a traditional equipment manufacturer, and the geography reflects that. A small, hands-on operation in Pittsburgh is easier to scale carefully than a multi-continental supply chain optimized for volume.

The Bryson Effect

Avoda went from unknown to widely-searched in a single Masters week. Bryson DeChambeau put Avoda prototype irons in the bag at the 2024 Masters, with the clubs only receiving USGA approval the week of the tournament. DeChambeau led the first round at Augusta playing them. He did not win the Masters that year, but he won the U.S. Open at Pinehurst weeks later, still playing Avoda irons. A small Pittsburgh club-maker with under a year of operating history had become the iron brand of a major champion.

That kind of validation is what most boutique brands spend a decade chasing. DeChambeau was not a paid endorser at the time. He had been instrumental in the prototype design, drawn to Avoda's same-length theory because it aligned with his own long-standing belief that same-length irons could improve consistency. Same-length is not new in golf. DeChambeau had previously won majors with Cobra irons built to a single length. What Avoda did was design from scratch around the concept, with a curved face geometry intended to counteract the gear effect inherent in single-length sets.

What Pittsburgh Means for the Business

The geography limits Avoda's scale in the short term, and that is the point. Hand-built irons cannot scale the same way cast game-improvement irons from Callaway or TaylorMade scale. A Pittsburgh-based operation building each set to order will always have a lead-time bottleneck. Avoda's growth pace depends on how many fitters and coaches Bailey can certify through the Precision Fit program and how much production capacity the local build operation can add without sacrificing quality.

The bet Bailey is making is that golfers who can wait for hand-built irons are exactly the golfers who will pay for them. It is the opposite trade from a brand like Takomo, which prices aggressively to a global mass market by trading custom fitting for volume. Avoda is selling craftsmanship and personalization at a premium and using Krank Golf's playbook as a model: tour validation first, then expand carefully.

The DORMIED Take

Pittsburgh is a useful location for what Avoda actually does. It is a manufacturing city with a deep machinist tradition, accessible to the Midwest and East Coast golf markets, and far enough from the OEM cluster in Southern California to maintain its outsider identity. The brand has the rare combination of a clear technical theory, a major-winning player who genuinely believed in the product, and a build process that scales slowly enough to protect quality. Whether that combination becomes a sustainable business or a one-tournament-cycle moment will depend on the next 18 months.

For now: Pittsburgh, Pennsylvania. Founded 2023. Tom Bailey. Hand-built. Same-length and combo-length irons. The story is real, and the address is unusual enough to be worth knowing.`,
  },
  {
    slug:            'is-gfore-owned-by-peter-millar',
    brandSlug:       'g-fore',
    secondarySlugs:  ['peter-millar'],
    title:           'Is G/Fore Owned by Peter Millar?',
    author:          'Adam',
    category:        'Trendy/Lifestyle',
    sourceUrl:       'https://www.golfdigest.com/story/peter-millar-purchases-mossimo-giannullis-gfore-brand',
    sourceName:      'Golf Digest',
    imageUrl:        'https://www.gfore.com/on/demandware.static/-/Sites-GF-US-Library/default/dwc5bb42a1/other/stores/scottsdale/gfore-store-scottsdale-az.jpg',
    metaDescription: 'Yes. Peter Millar acquired G/Fore in January 2018. Both brands now sit inside Richemont, the Swiss luxury group that also owns Cartier and Montblanc.',
    seoKeywords:     ['is G/Fore owned by Peter Millar', 'G/Fore owner', 'G/Fore Richemont', 'G/Fore acquisition 2018', 'Mossimo Giannulli golf brand'],
    xPostText:       'Yes, Peter Millar owns G/Fore. Acquired January 2018. The deeper ownership chain runs through Richemont, the Swiss conglomerate that also owns Cartier and Montblanc. The edge still holds, for now.',
    body: `Yes. Peter Millar acquired G/Fore in January 2018, and the brand has lived under that umbrella ever since. The deeper answer is that both brands sit inside Richemont, the Swiss luxury conglomerate that also owns Cartier, Van Cleef and Arpels, and Montblanc. So when you buy a pair of MG4+ spikeless shoes or a Killer Gators print polo, the chain of ownership runs from the LA design office to Raleigh to Geneva.

That last sentence is doing a lot of work, but it captures what makes the G/Fore story interesting. The brand that built itself on rebellion against country club beige now shares a parent company with the watch on a hedge fund manager's wrist.

How We Got Here

Mossimo Giannulli launched G/Fore in 2011 with premium leather golf gloves in colors you would not have seen at a private club in 2011. Vibrant pinks, reds, electric blues. The premise was simple. Golf apparel had been the same khaki-and-polo template for thirty years, and Giannulli had spent a career in fashion noticing that other sports got to be self-expressive. Surf got it. Skate got it. Tennis got it. Golf had not yet figured out it was allowed.

The gloves worked. They became the brand entry point, the way a great pair of sneakers can be the entry point for an apparel label. From there G/Fore expanded into footwear, then accessories, then a full apparel line. Within five years the brand had built itself a real presence in the corner of golf that Giannulli had identified as underserved: younger golfers who treated dressing for the course like they treated dressing for anywhere else.

The Peter Millar Deal

Peter Millar and G/Fore are an unlikely pairing on paper. Peter Millar is what you wear to a member-guest. G/Fore is what you wear to a member-guest if you want the other guests talking about your outfit. The brands met in 2017 on a co-branded shoe project for the PGA Show. The collaboration sold well enough that the conversation between Peter Millar CEO Scott Mahoney and Giannulli kept going, and by January 2018 it had turned into an acquisition.

What Peter Millar got was an instant ticket into a customer base it could not reach on its own. The 28-year-old who buys G/Fore Killer Gators is not the same person buying a Peter Millar Crown Sport polo. Owning both means you cover the spread without confusing either customer. What G/Fore got was back-end infrastructure, the boring but essential part of a clothing business that creative-led design houses tend to struggle with at scale. Sourcing, inventory, forecasting, global e-commerce. The unsexy machinery that keeps a brand reliable when the volume gets serious.

And both got into the Richemont family, which is the part most people miss. Peter Millar is a subsidiary of Compagnie Financiere Richemont SA, the Swiss luxury holding company. Cartier is in there. So is Montblanc. So is Chloe. G/Fore is now the smallest, most golf-specific, most accessible-price brand in a portfolio otherwise dominated by jewelry and watches.

What That Means for the Brand

The thing to watch with G/Fore under Peter Millar is whether the edge holds. The whole reason the brand worked is that it felt like it was made by people who actively did not want to fit in at a country club. When a brand like that gets acquired by the company that does fit in at the country club, the risk is the edge softens into background. So far that has not happened. Giannulli remains chief creative officer. Suzy Biszantz was named CEO in January 2025, with a brief that explicitly separates G/Fore from the Peter Millar mothership for operating purposes. The two brands share an owner and share systems. They are not blending into each other.

You see other ownership models around apparel in golf. TravisMathew sits inside Callaway. FootJoy sits inside Acushnet. Under Armour is public. Lululemon is public. The thing about G/Fore inside Richemont is that the parent has no other golf assets and no real plan to build any. G/Fore is the golf bet inside a luxury portfolio, which means it gets to keep its golf identity without competing for resources against three sister brands chasing the same customer.

So: yes, Peter Millar owns G/Fore. The full ownership chain runs through Richemont. The brand still feels like Mossimo, because Mossimo still designs it. The business underneath looks very different than it did when G/Fore was a glove company in 2011.`,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—';
  return (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
}

function pctClass(val) {
  if (val === null || val === undefined) return '';
  if (val > 0.05)  return 'da-mom-up';
  if (val < -0.05) return 'da-mom-down';
  return 'da-mom-flat';
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function estimateReadTime(text) {
  const words = text.trim().split(/\s+/).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

function shiftMonth(label, delta) {
  const [mon, year] = label.split(' ');
  const total = parseInt(year) * 12 + MONTH_NAMES.indexOf(mon) + delta;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return `${MONTH_NAMES[m]} ${y}`;
}

/**
 * Convert plain-text body to HTML.
 * - Paragraphs separated by blank lines become <p> or <h2>
 * - A block is treated as <h2> if it is a single short line (<= 80 chars),
 *   doesn't end with punctuation, and starts with a capital letter.
 * - Brand names (primary + secondary) are auto-linked first-occurrence-only,
 *   longest-name-first to avoid partial matches.
 */
function bodyToHtml(plainText, primarySlug, primaryName, allBrands) {
  const blocks = plainText.split(/\n\n+/).map(b => b.trim()).filter(Boolean);

  // Sort brands by name length descending so longer names match first
  const sortedBrands = [...allBrands].sort((a, b) => b.name.length - a.name.length);
  const linked = new Set();

  return blocks.map(block => {
    // Single-line blocks that look like section headers → <h2>
    const isHeader = !block.includes('\n')
      && block.length <= 80
      && /^[A-Z]/.test(block)
      && !/[.!?]$/.test(block)
      && block.split(/\s+/).length >= 2; // at least 2 words

    if (isHeader) {
      return `<h2>${escHtml(block)}</h2>`;
    }

    // Auto-link brand mentions (first occurrence per brand, across entire body)
    let out = block;
    for (const { slug, name } of sortedBrands) {
      if (linked.has(slug)) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\w/"])${escaped}(?![\\w"])`, '');
      if (re.test(out)) {
        out = out.replace(re, `<a href="/brands/${slug}/" class="da-brand-link">${name}</a>`);
        linked.add(slug);
      }
    }
    return `<p>${out}</p>`;
  }).join('\n');
}

function getBrandInfo(dormiedData, brandSlug) {
  const brand = dormiedData.brands.find(b => b.id === brandSlug);
  if (!brand) return null;
  const currentMonth  = dormiedData.meta.currentMonth;
  const previousMonth = dormiedData.meta.previousMonth;
  const month12ago    = shiftMonth(currentMonth, -12);
  const globalData    = brand.searchesByMarket?.global || {};
  const curSearches   = globalData[currentMonth]  || 0;
  const prevSearches  = globalData[previousMonth] || 0;
  const s12ago        = globalData[month12ago]    || 0;
  const maxSearches   = Math.max(...dormiedData.brands.map(b => b.searchesByMarket?.global?.[currentMonth] || 0));
  const di            = maxSearches > 0 ? Math.min(100, (curSearches / maxSearches) * 100) : 0;
  const sorted        = dormiedData.brands
    .map(b => ({ id: b.id, s: b.searchesByMarket?.global?.[currentMonth] || 0 }))
    .sort((a, b) => b.s - a.s);
  const rank          = sorted.findIndex(b => b.id === brandSlug) + 1;
  const momPct        = prevSearches > 0 ? ((curSearches - prevSearches) / prevSearches) * 100 : null;
  const MONTH_KEYS_SORTED = Object.keys(globalData).sort((a, b) => {
    const [ma, ya] = a.split(' '); const [mb, yb] = b.split(' ');
    return (parseInt(ya) * 12 + MONTH_NAMES.indexOf(ma)) - (parseInt(yb) * 12 + MONTH_NAMES.indexOf(mb));
  });
  const cmPos   = MONTH_KEYS_SORTED.indexOf(currentMonth);
  const last3m  = MONTH_KEYS_SORTED.slice(Math.max(0, cmPos - 2), cmPos + 1);
  const prior3m = MONTH_KEYS_SORTED.slice(Math.max(0, cmPos - 5), Math.max(0, cmPos - 2));
  const l3avg   = last3m.length  ? last3m.reduce((s, m) => s + (globalData[m] || 0), 0) / last3m.length  : 0;
  const p3avg   = prior3m.length ? prior3m.reduce((s, m) => s + (globalData[m] || 0), 0) / prior3m.length : 0;
  const t3m     = p3avg > 0 ? (l3avg - p3avg) / p3avg * 100 : null;
  const t12m    = s12ago > 0 ? (curSearches - s12ago) / s12ago * 100 : null;
  return { brand, rank, di, momPct, t3m, t12m, currentMonth };
}

// ── Image upload ─────────────────────────────────────────────────────────────

async function uploadImageToSupabase(supabase, imageUrl, slug) {
  if (!imageUrl) return { supabaseUrl: null, localUrl: null };
  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'DORMIED-Bot/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer      = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext         = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const storagePath = `articles/${slug}-hero.${ext}`;
    const localPath   = path.join(SITE_ROOT, 'images', 'articles', `${slug}-hero.${ext}`);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buffer);
    const localUrl = `https://dormied.com/images/articles/${slug}-hero.${ext}`;
    if (sharp && ext !== 'webp') {
      try {
        const webpPath = path.join(SITE_ROOT, 'images', 'articles', `${slug}-hero.webp`);
        await sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 82 }).toFile(webpPath);
      } catch (e) { console.warn(`  [img] WebP conversion failed: ${e.message}`); }
    }
    const { error } = await supabase.storage.from('dormied-articles').upload(storagePath, buffer, { contentType, upsert: true });
    if (error) { console.warn(`  [img] Supabase storage upload failed: ${error.message}`); return { supabaseUrl: null, localUrl }; }
    const { data } = supabase.storage.from('dormied-articles').getPublicUrl(storagePath);
    return { supabaseUrl: data?.publicUrl || null, localUrl };
  } catch (err) {
    console.warn(`  [img] Image download failed: ${err.message}`);
    return { supabaseUrl: null, localUrl: null };
  }
}

// ── HTML generator ────────────────────────────────────────────────────────────

function generateArticleHtml(opts) {
  const {
    title, bodyHtml, imageUrl, ogImageUrl, localUrl, imageAlt,
    slug, category, published_at, source_url, source_name,
    meta_description, seo_keywords,
    brandSlug, brandName, brandLogo, dataVersion,
    readTime, author, dormiedData,
    secondaryBrands = [],
  } = opts;

  const bInfo    = getBrandInfo(dormiedData, brandSlug);
  const bRank    = bInfo ? `#${bInfo.rank}` : '—';
  const bDi      = bInfo ? bInfo.di.toFixed(1) : '—';
  const bMom     = bInfo ? fmtPct(bInfo.momPct) : '—';
  const bT3m     = bInfo ? fmtPct(bInfo.t3m) : '—';
  const bT12m    = bInfo ? fmtPct(bInfo.t12m) : '—';
  const bMomCls  = bInfo && bInfo.momPct !== null ? ` ${pctClass(bInfo.momPct)}` : '';
  const bT3mCls  = bInfo && bInfo.t3m    !== null ? ` ${pctClass(bInfo.t3m)}` : '';
  const bT12mCls = bInfo && bInfo.t12m   !== null ? ` ${pctClass(bInfo.t12m)}` : '';

  const secondaryBrandWidgets = secondaryBrands.map(sb => {
    const sbInfo    = getBrandInfo(dormiedData, sb.slug);
    const sbRank    = sbInfo ? `#${sbInfo.rank}` : '—';
    const sbDi      = sbInfo ? sbInfo.di.toFixed(1) : '—';
    const sbMom     = sbInfo ? fmtPct(sbInfo.momPct) : '—';
    const sbT3m     = sbInfo ? fmtPct(sbInfo.t3m) : '—';
    const sbT12m    = sbInfo ? fmtPct(sbInfo.t12m) : '—';
    const sbMomCls  = sbInfo && sbInfo.momPct !== null ? ` ${pctClass(sbInfo.momPct)}` : '';
    const sbT3mCls  = sbInfo && sbInfo.t3m    !== null ? ` ${pctClass(sbInfo.t3m)}` : '';
    const sbT12mCls = sbInfo && sbInfo.t12m   !== null ? ` ${pctClass(sbInfo.t12m)}` : '';
    const sbInit    = sb.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const sbFallback = `<span class=&quot;bp-logo-initials&quot; style=&quot;background:#1a2a1a;width:40px;height:40px;font-size:0.9rem&quot;>${escHtml(sbInit)}</span>`;
    const sbLogoHtml = sb.logo
      ? `<img src="${escHtml(sb.logo.replace(/sz=\d+/, 'sz=40'))}" alt="${escHtml(sb.name)}" class="bp-logo-img" width="40" height="40" style="width:40px;height:40px" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${sbFallback}')">`
      : `<span class="bp-logo-initials" style="background:#1a2a1a;width:40px;height:40px;font-size:0.9rem">${escHtml(sbInit)}</span>`;
    return `
            <div class="da-brand-card da-brand-card--secondary">
              <div class="da-brand-card-header">
                <span class="da-brand-card-label">ALSO MENTIONED</span>
                <a href="/brands/${escHtml(sb.slug)}/" class="da-brand-card-cta">View Brand →</a>
              </div>
              <div class="da-brand-card-main">
                <div class="da-brand-card-identity">
                  <div class="da-brand-card-logo">${sbLogoHtml}</div>
                  <a href="/brands/${escHtml(sb.slug)}/" class="da-brand-card-name">${escHtml(sb.name)}</a>
                </div>
                <div class="da-brand-card-stats">
                  <div class="bp-metric-card"><span class="bp-metric-label">Global Rank</span><span class="bp-metric-val">${sbRank}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">DI Score</span><span class="bp-metric-val">${sbDi}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">M/M Change</span><span class="bp-metric-val${sbMomCls}">${sbMom}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">3M Trend</span><span class="bp-metric-val${sbT3mCls}">${sbT3m}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">12M Trend</span><span class="bp-metric-val${sbT12mCls}">${sbT12m}</span></div>
                </div>
              </div>
            </div>`;
  }).join('\n');

  const dateFormatted = formatDate(published_at);
  const dateISO       = new Date(published_at).toISOString();
  const canonicalUrl  = `https://dormied.com/news/${slug}/`;
  const ogImage       = ogImageUrl || imageUrl || 'https://dormied.com/images/og-image.jpg';
  const titleTag      = `${title} | DORMIED`;
  const keywordsStr   = (seo_keywords || []).join(', ');
  const initials      = brandName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const logoFallback  = `<span class=&quot;bp-logo-initials&quot; style=&quot;background:#1a2a1a;width:48px;height:48px;font-size:1rem&quot;>${escHtml(initials)}</span>`;
  const logoHtml      = brandLogo
    ? `<img src="${escHtml(brandLogo.replace(/sz=\d+/, 'sz=48'))}" alt="${escHtml(brandName)}" class="bp-logo-img" width="48" height="48" style="width:48px;height:48px" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${logoFallback}')">`
    : `<span class="bp-logo-initials" style="background:#1a2a1a;width:48px;height:48px;font-size:1rem">${escHtml(initials)}</span>`;

  const webpSrcset = (localUrl && localUrl.startsWith('https://dormied.com'))
    ? escHtml(localUrl.replace('https://dormied.com', '').replace(/\.(jpg|jpeg|png)$/i, '.webp'))
    : null;

  const imageHtml = imageUrl
    ? `<div class="sc-article-image">
        <picture>
          ${webpSrcset ? `<source srcset="${webpSrcset}" type="image/webp">` : ''}
          <img class="sc-article-hero-img" src="${escHtml(imageUrl)}" alt="${escHtml(imageAlt)}" width="1200" height="630" loading="eager">
        </picture>
        <span class="da-image-credit">Image: <a href="${escHtml(source_url)}" target="_blank" rel="noopener noreferrer">${escHtml(source_name)}</a></span>
      </div>`
    : '';

  const aboutEntries = [
    { slug: brandSlug, name: brandName },
    ...secondaryBrands,
  ].map(b => `{ "@type": "Organization", "name": "${escHtml(b.name)}", "url": "https://dormied.com/brands/${b.slug}/" }`);
  const aboutJson = aboutEntries.length
    ? `,\n    "about": [${aboutEntries.join(', ')}]`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-N4Q8J6L3');</script>
  <!-- End Google Tag Manager -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(titleTag)}</title>
  <meta name="description" content="${escHtml(meta_description)}">
  <meta name="keywords" content="${escHtml(keywordsStr)}">
  <meta name="author" content="${escHtml(author)}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="icon" href="/favicon.ico">
  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="apple-touch-icon" href="/images/dormied-icon.png">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(meta_description)}">
  <meta property="og:image" content="${escHtml(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="DORMIED">
  <meta property="og:locale" content="en_US">
  <meta property="article:published_time" content="${dateISO}">
  <meta property="article:author" content="${escHtml(author)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@DORMIED_GOLF">
  <meta name="twitter:title" content="${escHtml(title)}">
  <meta name="twitter:description" content="${escHtml(meta_description)}">
  <meta name="twitter:image" content="${escHtml(ogImage)}">
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
  <link rel="stylesheet" href="/css/fonts.css">
  <link rel="stylesheet" href="/css/styles.css?v=20260508">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${escHtml(title)}",
    "description": "${escHtml(meta_description)}",
    "image": "${escHtml(ogImage)}",
    "datePublished": "${dateISO}",
    "author": { "@type": "Person", "name": "${escHtml(author)}", "url": "https://dormied.com/about/" },
    "publisher": { "@type": "Organization", "name": "DORMIED", "url": "https://dormied.com" },
    "url": "${canonicalUrl}"${aboutJson},
    "breadcrumb": {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home",  "item": "https://dormied.com/" },
        { "@type": "ListItem", "position": 2, "name": "News",  "item": "https://dormied.com/news/" },
        { "@type": "ListItem", "position": 3, "name": "${escHtml(title)}", "item": "${canonicalUrl}" }
      ]
    }
  }
  </script>
</head>
<body>
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N4Q8J6L3" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <header class="site-header" role="banner">
    <div class="container header-inner">
      <a href="/" class="site-logo" aria-label="DORMIED home">
        <img src="/images/dormied-logo-colour.png" alt="DORMIED" class="logo-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="logo-text-fallback" style="display:none">DORMIED</span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a href="/rankings/"  class="site-nav-link">Index</a>
        <a href="/scorecard/" class="site-nav-link">Scorecard</a>
        <a href="/news/"      class="site-nav-link site-nav-link--active">News</a>
        <a href="/brands/"    class="site-nav-link">Brands</a>
      </nav>
    </div>
  </header>
  <main id="main-content">
    <nav class="da-breadcrumb container" aria-label="Breadcrumb" style="padding-top:.75rem;padding-bottom:.25rem;font-size:.78rem;color:var(--clr-muted,#6b7a6b)">
      <a href="/" style="color:inherit;text-decoration:none">Home</a>
      <span aria-hidden="true" style="margin:0 .4em">&rsaquo;</span>
      <a href="/news/" style="color:inherit;text-decoration:none">News</a>
      <span aria-hidden="true" style="margin:0 .4em">&rsaquo;</span>
      <span aria-current="page">${escHtml(title)}</span>
    </nav>
    <header class="da-article-header container">
      <a href="/news/" class="sc-label sc-label--link">News</a>
      <h1 class="sc-article-title">${escHtml(title)}</h1>
      <p class="sc-article-subtitle">${escHtml(meta_description)}</p>
      <p class="sc-article-byline">By ${escHtml(author)} &nbsp;&middot;&nbsp; <time datetime="${dateISO}">${escHtml(dateFormatted)}</time> &nbsp;&middot;&nbsp; ${escHtml(category)} &nbsp;&middot;&nbsp; ${escHtml(readTime)}</p>
    </header>
    <section class="da-article-section">
      <div class="container">
        <div class="table-layout">
          <div class="sc-article-main">
            ${imageHtml}
            <div class="da-article-body">${bodyHtml}</div>
            <div class="da-brand-card">
              <div class="da-brand-card-header">
                <span class="da-brand-card-label">DORMIED INDEX</span>
                <a href="/brands/${escHtml(brandSlug)}/" class="da-brand-card-cta">View Brand →</a>
              </div>
              <div class="da-brand-card-main">
                <div class="da-brand-card-identity">
                  <div class="da-brand-card-logo">${logoHtml}</div>
                  <a href="/brands/${escHtml(brandSlug)}/" class="da-brand-card-name">${escHtml(brandName)}</a>
                </div>
                <div class="da-brand-card-stats">
                  <div class="bp-metric-card"><span class="bp-metric-label">Global Rank</span><span class="bp-metric-val">${bRank}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">DI Score</span><span class="bp-metric-val">${bDi}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">M/M Change</span><span class="bp-metric-val${bMomCls}">${bMom}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">3M Trend</span><span class="bp-metric-val${bT3mCls}">${bT3m}</span></div>
                  <div class="bp-metric-card"><span class="bp-metric-label">12M Trend</span><span class="bp-metric-val${bT12mCls}">${bT12m}</span></div>
                </div>
              </div>
            </div>
            ${secondaryBrandWidgets}
            <section class="da-bottom-section" id="da-more-brand-section" aria-labelledby="da-more-brand-heading" hidden>
              <h3 class="da-bottom-heading" id="da-more-brand-heading">More on ${escHtml(brandName)}</h3>
              <div id="da-more-brand-list" class="da-bottom-cards"></div>
            </section>
            <section class="da-bottom-section" id="da-latest-dormied-section" aria-labelledby="da-latest-dormied-heading" hidden>
              <h3 class="da-bottom-heading" id="da-latest-dormied-heading">Latest from DORMIED</h3>
              <div id="da-latest-dormied-list" class="da-bottom-cards"></div>
            </section>
          </div>
          <aside class="sidebar-ad-col">
          </aside>
        </div>
      </div>
    </section>
  </main>
  <footer class="site-footer" role="contentinfo">
    <div class="container footer-inner">
      <div class="footer-brand">
        <a href="/" class="footer-logo" aria-label="DORMIED home">DORMIED</a>
        <div class="footer-social">
          <a href="https://x.com/DORMIED_GOLF" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on X">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <a href="https://www.instagram.com/dormiedgolf" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on Instagram">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
          </a>
          <a href="https://dormiedgolf.substack.com/" class="footer-social-link" target="_blank" rel="noopener" aria-label="DORMIED on Substack">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z"/></svg>
          </a>
        </div>
      </div>
      <nav class="footer-nav" aria-label="Footer navigation">
        <a href="/rankings/">Index</a>
        <a href="/scorecard/">Scorecard</a>
        <a href="/news/">News</a>
        <a href="/brands/">Brands</a>
        <a href="/about/">About</a>
        <a href="/contact/">Contact</a>
        <a href="/privacy/">Privacy</a>
        <a href="/terms/">Terms</a>
        <a href="/sitemap.xml">Sitemap</a>
      </nav>
      <div class="footer-signup">
        <div class="footer-signup-header">
          <p class="footer-signup-label">THE SCORECARD</p>
          <p class="footer-signup-sub">Golf's brand desk in your inbox. The biggest moves of the month, what drove them, and what they mean. Once a month.</p>
        </div>
        <form class="footer-signup-form" novalidate>
          <div class="footer-signup-row">
            <input class="footer-signup-input" type="email" placeholder="Your email" required autocomplete="email" aria-label="Email address">
            <button class="footer-signup-btn" type="submit">Get The Scorecard</button>
          </div>
          <p class="footer-signup-msg" style="display:none"></p>
        </form>
      </div>
      <p class="footer-legal">© DORMIED. Rankings are independent editorial content. No brand pays for placement or improved position on the DORMIED Index. All brand names and logos are property of their respective owners.</p>
    </div>
  </footer>
  <script>
    window.__DA_BRAND_SLUG__   = '${escHtml(brandSlug)}';
    window.__DA_ARTICLE_SLUG__ = '${escHtml(slug)}';
  </script>
  <script src="/js/analytics.min.js?v=20260320a"></script>
  <script src="/js/signup.min.js?v=20260324d"></script>
  <script src="/js/brand-data/${escHtml(brandSlug)}.js?v=${escHtml(dataVersion)}"></script>
  <script src="/js/da-article.min.js?v=20260522"></script>
</body>
</html>`;
}

// ── Sitemap helpers ───────────────────────────────────────────────────────────

function xmlEsc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addToSitemap(slug, publishedAt, imageUrl, imageTitle) {
  const sitemapPath = path.join(SITE_ROOT, 'sitemap.xml');
  let sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const dateStr  = publishedAt.slice(0, 10);
  const hasImage = imageUrl && !imageUrl.includes('og-image.jpg');
  const imageBlock = hasImage
    ? `\n    <image:image>\n      <image:loc>${xmlEsc(imageUrl)}</image:loc>\n      <image:title>${xmlEsc(imageTitle)}</image:title>\n    </image:image>`
    : '';
  const entry = `\n  <url>\n    <loc>https://dormied.com/news/${slug}/</loc>\n    <lastmod>${dateStr}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>${imageBlock}\n  </url>`;
  sitemap = sitemap.replace('</urlset>', entry + '\n</urlset>');
  fs.writeFileSync(sitemapPath, sitemap, 'utf8');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Missing Supabase env vars');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Load DORMIED_DATA from data.js
  const raw = fs.readFileSync(path.join(SITE_ROOT, 'js/data.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(raw, ctx);
  const dormiedData = ctx.window.DORMIED_DATA;
  const dataVersion = (dormiedData.meta.lastUpdated || '').replace(/-/g, '');

  console.log(`[inject] Loaded data.js — ${dormiedData.brands.length} brands, currentMonth: ${dormiedData.meta.currentMonth}`);
  console.log('');

  const results = [];

  for (const art of ARTICLES) {
    console.log(`══ ${art.title} ══`);

    // Resolve secondary brand objects
    const secondaryBrands = art.secondarySlugs
      .map(s => {
        const b = dormiedData.brands.find(b => b.id === s);
        if (!b) { console.warn(`  [warn] Secondary brand not found: ${s}`); return null; }
        return { slug: b.id, name: b.name, logo: b.logo || '' };
      })
      .filter(Boolean);

    // Primary brand
    const primaryBrand = dormiedData.brands.find(b => b.id === art.brandSlug);
    if (!primaryBrand) { console.error(`  [ERROR] Primary brand not found: ${art.brandSlug}`); continue; }

    // All brands for auto-linking
    const allBrands = [
      { slug: primaryBrand.id, name: primaryBrand.name },
      ...secondaryBrands.map(sb => ({ slug: sb.slug, name: sb.name })),
    ];

    // Upload image
    console.log(`  [img] Uploading hero image...`);
    const { supabaseUrl, localUrl } = await uploadImageToSupabase(supabase, art.imageUrl, art.slug);
    const finalImageUrl = supabaseUrl || art.imageUrl;
    const ogImageUrl    = localUrl || 'https://dormied.com/images/og-image.jpg';
    console.log(`  [img] ${supabaseUrl ? 'Supabase: ' + supabaseUrl : 'Fallback source URL'}`);

    // Convert body to HTML
    const bodyHtml = bodyToHtml(art.body, primaryBrand.id, primaryBrand.name, allBrands);
    const readTime = estimateReadTime(art.body);
    const publishedAt = new Date().toISOString();

    // Write HTML file
    const articleDir = path.join(SITE_ROOT, 'news', art.slug);
    fs.mkdirSync(articleDir, { recursive: true });
    const html = generateArticleHtml({
      title:           art.title,
      bodyHtml,
      imageUrl:        finalImageUrl,
      ogImageUrl,
      localUrl,
      imageAlt:        `${primaryBrand.name}: ${art.category}`,
      slug:            art.slug,
      category:        art.category,
      published_at:    publishedAt,
      source_url:      art.sourceUrl,
      source_name:     art.sourceName,
      meta_description: art.metaDescription,
      seo_keywords:    art.seoKeywords,
      brandSlug:       primaryBrand.id,
      brandName:       primaryBrand.name,
      brandLogo:       primaryBrand.logo || '',
      dataVersion,
      readTime,
      author:          art.author,
      dormiedData,
      secondaryBrands,
    });
    fs.writeFileSync(path.join(articleDir, 'index.html'), html, 'utf8');
    console.log(`  [html] Wrote news/${art.slug}/index.html`);

    // Supabase insert — status: 'published' directly
    const { error: insertErr } = await supabase.from('dormied_articles').insert({
      matched_article_id:    null,
      brand_slug:            primaryBrand.id,
      secondary_brand_slugs: secondaryBrands.map(sb => sb.slug),
      title:                 art.title,
      body:                  art.body,
      image_url:             finalImageUrl,
      source_url:            art.sourceUrl,
      source_name:           art.sourceName,
      meta_description:      art.metaDescription,
      seo_keywords:          art.seoKeywords,
      published_at:          publishedAt,
      status:                'published',
      slug:                  art.slug,
      category:              art.category,
      x_post_text:           art.xPostText,
      author:                art.author,
    });

    if (insertErr) {
      console.error(`  [db] Insert failed: ${insertErr.message}`);
    } else {
      console.log(`  [db] Inserted to dormied_articles (status: published)`);
    }

    // Add to sitemap
    addToSitemap(art.slug, publishedAt, ogImageUrl, art.title);
    console.log(`  [sitemap] Added /news/${art.slug}/`);
    console.log('');

    results.push({ slug: art.slug, title: art.title, ok: !insertErr });
  }

  // Regenerate search index
  console.log('[inject] Regenerating search index...');
  try {
    const { generateSearchIndex } = require('./generate-search-index.js');
    generateSearchIndex();
  } catch {
    try {
      require('child_process').execSync('node scripts/generate-search-index.js', { cwd: SITE_ROOT, stdio: 'inherit' });
    } catch (e) { console.warn('[inject] Search index regen failed:', e.message); }
  }

  // Regenerate news index pages
  console.log('[inject] Regenerating news index pages...');
  try {
    require('child_process').execSync('node scripts/generate-index-pages.js', { cwd: SITE_ROOT, stdio: 'inherit' });
  } catch (e) { console.warn('[inject] News index regen failed:', e.message); }

  console.log('\n[inject] ══ SUMMARY ══');
  results.forEach(r => console.log(`  ${r.ok ? '✓' : '✗'} /news/${r.slug}/`));
  console.log('\nNext steps:');
  console.log('  git add news/ sitemap.xml search-index.json news/index.html');
  console.log('  git commit -m "Publish 4 SEO articles: brand ownership and origin queries"');
  console.log('  git push origin main');
  console.log('  (X posts fire automatically within 30 min after Vercel deploy)');
}

main().catch(err => {
  console.error('[inject] Fatal:', err.message);
  process.exit(1);
});
