#!/usr/bin/env node
/**
 * scripts/inject-9-seo-articles.js
 *
 * Publishes 9 pre-written SEO articles directly to dormied_articles
 * (status='published') and generates the static HTML files.
 * No Opus calls — all content is pre-written.
 *
 * Articles 1-7: Travis (equipment / ownership / HQ)
 * Articles 8-9: Adam (Malbon apparel)
 *
 * Run: node scripts/inject-9-seo-articles.js
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const fs               = require('fs');
const path             = require('path');
const vm               = require('vm');
const { createClient } = require('@supabase/supabase-js');
let   sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

const SITE_ROOT   = path.resolve(__dirname, '..');
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ═══════════════════════════════════════════════════════════════════════════════
// ARTICLES
// ═══════════════════════════════════════════════════════════════════════════════

const ARTICLES = [
  // ── 1 ───────────────────────────────────────────────────────────────────────
  {
    slug:            'who-owns-scotty-cameron',
    brandSlug:       'scotty-cameron',
    secondarySlugs:  ['titleist'],
    title:           'Who Owns Scotty Cameron?',
    author:          'Travis',
    category:        'Putters',
    sourceUrl:       'https://www.scottycameron.com/bio/',
    sourceName:      'Scotty Cameron',
    imageUrl:        'https://www.scottycameron.com/media/o4rla2ra/2025-july-putter-neck-bend-shaft-article-img-1.jpg',
    metaDescription: 'Scotty Cameron is owned by Acushnet Holdings, parent of Titleist and FootJoy. The partnership began in 1994 after Bernhard Langer won the Masters with a Cameron prototype.',
    seoKeywords:     ['who owns Scotty Cameron','Scotty Cameron owner','Acushnet Scotty Cameron','Scotty Cameron history','Scotty Cameron Titleist'],
    xPostText:       'Scotty Cameron has been owned by Acushnet since 1994. The deal happened after Bernhard Langer won the 1993 Masters with a Cameron prototype. 31 years and 45+ majors later, the partnership is still in place.',
    body: `Scotty Cameron is owned by Acushnet Holdings Corp, the publicly-traded company that also owns Titleist, FootJoy, Vokey Design, and Pinnacle. The ownership has been in place since 1994, when Don T. Scotty Cameron and his wife Kathy partnered their Cameron Golf International business with Acushnet to make putters exclusively under the Titleist umbrella. Acushnet trades on the New York Stock Exchange under the ticker symbol GOLF, and Fila Korea Ltd holds a controlling 53.1 percent stake in the company through a 2018 share purchase.

The story behind the partnership is one of the more interesting in golf equipment history. Cameron grew up in Southern California learning to make putters in his father's garage. By the early 1990s he was designing putters under contract for Ray Cook Golf Company, Maxfli, Cleveland Classics, and Mizuno. The breakthrough moment came in April 1993, when Bernhard Langer won the Masters using a prototype Cameron putter. Within 18 months, Cameron was introduced to Wally Uihlein, then-CEO of Acushnet, by teaching pro Peter Kostis. The partnership was formalized in September 1994.

How Acushnet Came to Own Scotty Cameron

Acushnet itself has been through several owners. The company was acquired by American Brands in 1976, which later renamed itself Fortune Brands. In December 2010 Fortune Brands announced it would spin off its non-liquor businesses, including Acushnet. In May 2011 a Korean consortium led by Fila Korea and Mirae Asset Private Equity purchased Acushnet for $1.23 billion in cash. The deal closed in July 2011. Acushnet went public on the NYSE in October 2016, and Fila Korea increased its stake to a controlling position in 2018.

For Scotty Cameron specifically, this means the brand has been owned by Acushnet since 1994 through several changes of corporate parent above it. The Cameron design team and Putter Studio in Carlsbad have operated continuously throughout, and the brand has not been disturbed by any of the upstream ownership changes. Cameron himself remains the lead designer and his name and signature still appear on every putter.

What This Means for the Product

The Acushnet relationship gave Cameron something very few independent putter brands ever achieve: scale of distribution. Scotty Cameron putters are now stocked at every Titleist fitting account globally, which is a network the brand could never have built alone. The trade-off is that Cameron operates as a premium brand within a portfolio rather than as an independent house. Pricing, release cadence, and category positioning are coordinated with Acushnet's broader strategy.

The numbers reflect the bet's success. Scotty Cameron putters have won more than 45 major championships since the Acushnet partnership began. Tiger Woods used a Scotty Cameron putter for the majority of his career, including 13 of his 15 major wins. Today the brand competes in the premium milled putter segment against Bettinardi, L.A.B. Golf, Toulon Design, and a small handful of boutique makers. Volume sits with Odyssey and Ping at lower price points. The Cameron lane is the high-margin, tour-validated, custom-finished end of the market.

Context: How This Compares

Scotty Cameron's ownership structure mirrors how most premium putter brands sit inside larger equipment companies. Odyssey is owned by Callaway. Toulon Design is also owned by Callaway through the Odyssey acquisition. Bettinardi has stayed independent. The Cameron-Acushnet relationship is the longest-running and the most commercially successful of any of these, and it has held together through three changes of Acushnet's parent ownership without affecting the putter business in any visible way. That is unusual and worth noting.

If you are asking who owns Scotty Cameron because you wonder whether the brand is changing hands or being repositioned: the answer is no. Acushnet has owned Scotty Cameron for 31 years and shows no signs of selling or restructuring the relationship.`,
  },

  // ── 2 ───────────────────────────────────────────────────────────────────────
  {
    slug:            'where-are-titleist-clubs-made',
    brandSlug:       'titleist',
    secondarySlugs:  ['scotty-cameron'],
    title:           'Where Are Titleist Clubs Made?',
    author:          'Travis',
    category:        'Clubs',
    sourceUrl:       'https://www.golfsidekick.com/knowledge/where-are-titleist-golf-clubs-made/',
    sourceName:      'Golf Sidekick',
    imageUrl:        'https://d21buns5ku92am.cloudfront.net/68636/images/600255-250513_titleist_T100_hamilton_32333_R1-05bad8-large-1751901309.jpg',
    metaDescription: 'Titleist clubs are assembled in Carlsbad, California and regional hubs worldwide, with components sourced from Japan, Taiwan, China, and Vietnam. Designed in the USA.',
    seoKeywords:     ['where are Titleist clubs made','Titleist manufacturing','Titleist Carlsbad','Titleist assembly USA','Titleist component sourcing'],
    xPostText:       'Titleist clubs are assembled in Carlsbad, California, with components sourced from Japan, Taiwan, China, and Vietnam. The golf balls are made in Massachusetts. The two operations are entirely separate businesses.',
    body: `Titleist clubs are designed in the United States and assembled at facilities in Carlsbad, California, with additional regional assembly hubs in Japan, the United Kingdom, Australia, South Africa, and South Korea. The Carlsbad facility handles the majority of clubs sold in the Western Hemisphere. Component manufacturing, including clubheads, shafts, and grips, happens across a network of specialist suppliers primarily in China, Taiwan, Japan, and Vietnam. The country-of-origin label on a finished Titleist club reflects where final assembly took place, not where every component was produced.

This is the standard structure for premium golf equipment manufacturers, and Titleist is not unique in operating this way. What makes Titleist's setup notable is the geographic split between the Carlsbad club facility and the Massachusetts golf ball plants, which are entirely separate operations. Titleist golf balls are manufactured in New Bedford and North Dartmouth, Massachusetts, plus a fourth ball plant in Rayong, Thailand. The clubs and balls are designed, manufactured, and assembled by different teams in different parts of the country.

The Carlsbad Operation

Acushnet, Titleist's parent company, has operated in Carlsbad for decades. The Carlsbad facility at 2819 Loker Avenue is where the bulk of Titleist iron, wood, and hybrid assembly happens. Engineering, R&D, and tour fitting operations are also concentrated in Southern California, with the Titleist Performance Institute located in nearby Oceanside. The proximity to other major equipment companies in Carlsbad, including TaylorMade, Callaway, and Cobra Puma, is not a coincidence. The area has the deepest concentration of golf equipment manufacturing talent in the world.

Scotty Cameron putters, which are part of the Acushnet portfolio, are milled in the United States at Cameron's Putter Studio operation. The putters are made from 303 stainless steel (and 303 stainless imported from Germany for Cameron's premium G.S.S. releases, which is metallurgically identical to other 303 grades but trademarked under the Cameron brand). The putter operation is geographically and operationally separate from the rest of the Titleist club assembly business.

Vokey Wedges and Component Sourcing

Vokey Design wedges, also part of the Acushnet family, are designed in the United States and assembled at the same Carlsbad facility as Titleist irons and woods. The wedge heads are cast or forged by specialist partners, the shafts come from established Japanese and global producers, and final assembly happens in Carlsbad.

Component sourcing follows industry norms. Graphite shafts come primarily from Japan-headquartered manufacturers like Mitsubishi Chemical, Fujikura, and Graphite Design, often produced at their plants in Japan, China, or Vietnam. Steel shafts come from True Temper, KBS, and Nippon. Grips come from Golf Pride, Lamkin, and SuperStroke. Clubheads are cast or forged by specialist partners in Taiwan, China, and Japan. Titleist provides specifications, tolerances, and quality control oversight; the contracted suppliers produce to those specifications.

The DORMIED Take

The geography of where a Titleist club is made matters less than most buyers think. A globally-sourced Titleist iron assembled in Carlsbad will perform identically to one assembled in Manchester or Tokyo because the build tolerances and component specifications are controlled centrally. What you are buying is engineering, quality control, and the brand's distribution network, not country-of-origin stamps. The country listed on the sticker tells you where final assembly happened, which is the legal definition of where the product was made, but it does not capture the global nature of how the club came together.

If you are choosing between a Titleist club and a competitor based on manufacturing location, the better question is consistency of build, not country. Titleist's reputation rests on the consistency. The geography is the supporting cast.`,
  },

  // ── 3 ───────────────────────────────────────────────────────────────────────
  {
    slug:            'where-is-titleist-headquartered',
    brandSlug:       'titleist',
    secondarySlugs:  ['footjoy', 'scotty-cameron'],
    title:           'Where Is Titleist Headquartered?',
    author:          'Travis',
    category:        'Clubs',
    sourceUrl:       'https://en.wikipedia.org/wiki/Acushnet_Company',
    sourceName:      'Wikipedia',
    imageUrl:        'https://d21buns5ku92am.cloudfront.net/68636/images/569890-240521_titleist_gamble_sands_hamilton_14727_ProV1-95cf1f-large-1736268253.jpg',
    metaDescription: 'Titleist is headquartered at 333 Bridge Street, Fairhaven, Massachusetts, where parent company Acushnet has operated since 1910. The ball plants are nearby in New Bedford.',
    seoKeywords:     ['where is Titleist headquartered','Titleist headquarters','Titleist Fairhaven Massachusetts','Acushnet headquarters','Titleist address'],
    xPostText:       'Titleist HQ is 333 Bridge Street, Fairhaven, Massachusetts. Parent company Acushnet has operated in the New Bedford area since 1910. About 3,000 Massachusetts employees produce a million golf balls a day.',
    body: `Titleist is headquartered at 333 Bridge Street, Fairhaven, Massachusetts, 02719. The address is also home to Acushnet Holdings, Titleist's parent company. The greater New Bedford and Fairhaven area on Massachusetts's south coast is where Acushnet has operated since founder Philip E. Skipper Young launched the Acushnet Process Company in 1910. The first Titleist golf ball was produced in 1935, and the company has remained in the same region for the entire 90 years since.

This is unusual for a major golf brand. Most modern golf equipment companies have clustered in Carlsbad, California, where the climate allows year-round product testing and where the supplier ecosystem is most developed. Acushnet maintained its Massachusetts roots for both historical and structural reasons. The Massachusetts plants are dedicated to golf ball manufacturing, which has different facility requirements than club assembly. The Carlsbad operation, which handles club assembly, was added as a complement to the Massachusetts headquarters rather than as a replacement.

What Happens at the Fairhaven Headquarters

The Fairhaven campus serves as Acushnet's corporate headquarters, worldwide distribution center, and the operational hub for the broader Titleist and FootJoy businesses. Approximately 3,000 Acushnet employees work in Massachusetts, making the company one of the largest employers in the region. Several nearby facilities support the headquarters:

Ball Plant 2 sits at 256 Samuel Barnett Boulevard in North Dartmouth, where Titleist's premium golf balls including the Pro V1 are manufactured. Ball Plant 3 is at 215 Duchaine Boulevard in New Bedford. Ball Plant C operates from 700 Belleville Avenue in New Bedford. Acushnet's R&D Center sits at 181 Samuel Barnett Boulevard, also in North Dartmouth. Together these facilities produce roughly one million golf balls every day.

The Pro V1 has been the most-played ball on the PGA Tour since its 2000 launch, and approximately 75 percent of touring professionals worldwide play either a Pro V1 or Pro V1x. That entire production is anchored to the New Bedford area.

The Carlsbad Counterpart

While the headquarters is in Massachusetts, Titleist's club operations are in Carlsbad, California, at 2819 Loker Avenue. The Carlsbad facility handles iron, wood, and hybrid assembly, tour fitting operations, and engineering work specific to the club product lines. Acushnet also operates the Titleist Performance Institute (TPI) in Oceanside, California, which is the company's premier fitness and player development facility. The bicoastal structure reflects the historical reality that Acushnet's ball business is older and East Coast-rooted, while its club business expanded westward to be near the industry's gravitational center.

The DORMIED Take

The Fairhaven address matters because it tells you something about Acushnet's identity. The company has not chased the industry to California despite being one of the few major brands that could justify the move. The Massachusetts manufacturing base employs thousands of local workers, anchors the brand's heritage, and gives Titleist a story that competitors cannot match. Callaway, TaylorMade, and Cobra are all Carlsbad operations. Titleist is the Massachusetts holdout.

For anyone visiting the area or considering employment with the company: the public-facing entrance is at 333 Bridge Street, Fairhaven, MA 02719. Factory tours of the ball plants are occasionally offered, and the company maintains a strong community presence in the New Bedford and Fairhaven region.`,
  },

  // ── 4 ───────────────────────────────────────────────────────────────────────
  {
    slug:            'where-are-taylormade-clubs-manufactured',
    brandSlug:       'taylormade',
    secondarySlugs:  [],
    title:           'Where Are TaylorMade Clubs Manufactured?',
    author:          'Travis',
    category:        'Clubs',
    sourceUrl:       'https://allamerican.org/investigation/taylormade/',
    sourceName:      'AllAmerican.org',
    imageUrl:        'https://assets.taylormadegolf.com/i/5b/1222480/Rory-McIlroy-2026-Player-Page-Top-of-Qi4D-Driver-Swing-Face-On~W1500_H960_Mcrop_P50-50.jpg',
    metaDescription: 'TaylorMade clubs are designed in Carlsbad, California with assembly in the US and Japan. Components are sourced from China, Taiwan, Japan, and Vietnam.',
    seoKeywords:     ['where are TaylorMade clubs made','TaylorMade manufacturing','TaylorMade Carlsbad','TaylorMade assembly','TaylorMade components'],
    xPostText:       'TaylorMade clubs are designed in Carlsbad, California, assembled in the US and Japan, with components from across Asia. The company is now owned by South Korean PE firm Centroid Investment Partners.',
    body: `TaylorMade clubs are designed and headquartered in Carlsbad, California, but most physical manufacturing happens overseas. Component production for clubheads, shafts, and grips takes place across Asia, primarily in factories in China, Taiwan, Japan, and Vietnam. Final club assembly happens at TaylorMade's Carlsbad facility and at regional assembly operations in Japan. The Japanese assembly serves the Asian market and produces a separate Japan Exclusive Product line that is only available in the region.

TaylorMade is now owned by Centroid Investment Partners, a South Korean private equity firm that purchased the company from KPS Capital Partners in May 2021 for an estimated $1.7 billion. KPS had acquired TaylorMade from Adidas for $425 million in 2017. The current owner has retained the Carlsbad headquarters and the existing operational structure.

The Carlsbad Operation

TaylorMade's Carlsbad headquarters at 5545 Fermi Court is where designs originate, prototypes are tested, and final club assembly happens for the American market. The facility houses approximately 2,100 employees globally and serves as the design and tour fitting hub for the entire company. The famous Kingdom, TaylorMade's premium club fitting experience, is also located at the Carlsbad campus and is where top-tier customers and tour players go for in-person fittings with master fitters.

The assembly model is similar to Titleist's and Callaway's. Clubheads arrive from foundries in Asia, shafts come from specialist manufacturers in Japan and elsewhere, grips arrive from suppliers, and the final club is built to specification at the assembly facility. Quality control, swing-weight checks, loft and lie adjustments, and final inspection all happen at Carlsbad. The country-of-origin label on a finished TaylorMade club reflects where the assembly took place, which is most often the United States for American-market clubs.

Golf Balls Are Different

TaylorMade has its own golf ball plant in Liberty, South Carolina, opened in 2013. The Liberty facility produces TaylorMade's TP5 and TP5x premium balls, plus distance and recreational lines. The South Carolina plant is supplied with components from a TaylorMade ball plant in Korea that the company acquired in 2021. The Korean facility makes balls from start to finish for the Asian market and also produces components shipped to South Carolina for finishing.

This is a different model from the club business. The ball operation is largely vertically integrated, while the club operation relies on a global supplier network. Both work, and both are industry standard. TaylorMade chose the Korean acquisition specifically to expand its ball production capacity without building a new American facility.

The DORMIED Take

TaylorMade's manufacturing geography tells a story about modern golf equipment economics. The company that started as a single-product startup in McHenry, Illinois in 1979 with founder Gary Adams's first metalwood now operates across three continents with two ownership changes in the last decade. The Carlsbad headquarters anchors the design and brand identity. The Asian supplier network produces the components. The South Carolina and Korean ball plants handle the ball business separately. The whole structure is built for efficiency and tour responsiveness, not for any particular country of origin story.

If you are considering a TaylorMade purchase based on manufacturing location: the practical answer is that the assembly happens in California for American-market clubs and the component quality is controlled centrally regardless of where individual parts originated. The Carlsbad designation matters less than the build consistency, which TaylorMade has invested heavily in maintaining.`,
  },

  // ── 5 ───────────────────────────────────────────────────────────────────────
  {
    slug:            'where-is-taylormade-headquartered',
    brandSlug:       'taylormade',
    secondarySlugs:  [],
    title:           'Where Is TaylorMade Headquartered?',
    author:          'Travis',
    category:        'Clubs',
    sourceUrl:       'https://en.wikipedia.org/wiki/TaylorMade',
    sourceName:      'Wikipedia',
    imageUrl:        'https://www.taylormadegolf.com/on/demandware.static/-/Sites-TMaG-Library/en_US/v1778904629468/TaylorMade/plp/2025/the-kingdom/Kingdom_Banner_PracticeBalls.webp',
    metaDescription: 'TaylorMade is headquartered at 5545 Fermi Court, Carlsbad, California, with about 2,100 global employees. Owned by South Korean PE firm Centroid Investment Partners since 2021.',
    seoKeywords:     ['where is TaylorMade headquartered','TaylorMade headquarters','TaylorMade Carlsbad address','TaylorMade owner','Centroid Investment Partners TaylorMade'],
    xPostText:       'TaylorMade HQ is 5545 Fermi Court, Carlsbad, California. The company has been there since the 1990s after relocating from its 1979 McHenry, Illinois origin. Owned by South Korean PE firm Centroid since 2021.',
    body: `TaylorMade Golf Company is headquartered at 5545 Fermi Court, Carlsbad, California, 92008. The company has occupied the Carlsbad campus since the mid-1990s, after relocating from its founding location in McHenry, Illinois. The Carlsbad headquarters serves as the design, engineering, tour fitting, and final assembly hub for the company's North American operations. Roughly 2,100 employees work across TaylorMade's global operations, with a substantial share based at the Carlsbad campus.

TaylorMade is currently owned by Centroid Investment Partners, a South Korean private equity firm that acquired the company in May 2021 from KPS Capital Partners. The corporate ownership has changed three times in the last decade, but the headquarters and operational structure have remained in Carlsbad through each transition.

Why Carlsbad

Carlsbad is the densest concentration of golf equipment manufacturing in the world. Within a few miles of TaylorMade's Fermi Court address, you can find Callaway, Cobra Puma, Fujikura, Aldila, and the Carlsbad assembly operations for Titleist clubs. The Scotty Cameron Putter Studio is nearby in San Marcos. Vessel Golf assembles bags from its Carlsbad headquarters. The geographic clustering exists because the region offers year-round outdoor testing weather, proximity to a deep supplier base, and access to a talent pool that has worked across many of the major equipment brands over decades.

The TaylorMade campus itself is set up for the full product development cycle. Design and engineering teams work alongside materials scientists, tour fitters, and assembly technicians. The Kingdom, TaylorMade's premium fitting experience, occupies a distinct portion of the campus and is where top tier customers come for individual fittings. Tour players and contracted athletes also use the Kingdom for equipment review and prototype testing.

The Founding Story

TaylorMade's origin is more humble than its current scale suggests. Founder Gary Adams borrowed $24,000 against his house in 1979 and leased a 6,000 square foot building in McHenry, Illinois. The startup had three employees and produced exactly one product: a 12-degree loft steel-headed metalwood driver. The metalwood replaced persimmon, which had been the dominant material in driver manufacturing for decades, and the disruption was the foundation of TaylorMade's business.

By 1984, the company had grown enough that Adams sold to Salomon SA, the French ski equipment company. Salomon was later acquired by Adidas-Salomon AG, which kept TaylorMade in its portfolio until selling to KPS Capital Partners in 2017 for $425 million. KPS sold to Centroid in 2021 for an estimated $1.7 billion. The company that started as a single-product Illinois startup is now a global golf equipment powerhouse with annual revenue around $750 million.

The DORMIED Take

The Carlsbad headquarters is more than an address. It is TaylorMade's center of gravity, the place where the brand's biggest product launches are developed and the location that anchors the company's identity even as ownership has shifted. The decision to keep operations consolidated in Carlsbad through three private equity transactions reflects how much value sits in the location and the surrounding ecosystem. Selling the headquarters or relocating would mean losing the talent pool and the supplier proximity that gives TaylorMade much of its operational advantage.

For visitors: the public face of TaylorMade Carlsbad is the corporate headquarters at 5545 Fermi Court, and the retail and Kingdom experiences are not generally open to the public. Tour visits, fitting appointments, and corporate events are scheduled through TaylorMade's official channels.`,
  },

  // ── 6 ───────────────────────────────────────────────────────────────────────
  {
    slug:            'where-are-callaway-clubs-made',
    brandSlug:       'callaway',
    secondarySlugs:  ['odyssey-golf'],
    title:           'Where Are Callaway Clubs Made?',
    author:          'Travis',
    category:        'Clubs',
    sourceUrl:       'https://golferhive.com/where-are-callaway-golf-clubs-manufactured/',
    sourceName:      'Golfer Hive',
    imageUrl:        'https://images.contentstack.io/v3/assets/bltf7bc8e0c7e024392/blt41497dc17ac7841f/696561a4f6c32b0008b1cf3b/Shot-2-PDP-FWY-C-Hero-25-10-06-0116.png?auto=webp&width=3000&quality=75',
    metaDescription: 'Callaway clubs are designed in Carlsbad and primarily assembled in Monterrey, Mexico since 2010. Components come from Asia. Premium balls are made in Chicopee, Massachusetts.',
    seoKeywords:     ['where are Callaway clubs made','Callaway manufacturing','Callaway Monterrey Mexico','Callaway Carlsbad','Callaway ball plant Massachusetts'],
    xPostText:       'Callaway clubs are assembled in Monterrey, Mexico since 2010, designed in Carlsbad, with components from China and Vietnam. The premium balls are made in Chicopee, Massachusetts, at a former Spalding plant.',
    body: `Callaway clubs are designed in Carlsbad, California and primarily assembled in Monterrey, Mexico, with a separate assembly plant in Japan serving the Asian market. The Mexican assembly facility has been Callaway's main club assembly hub since 2010, when the company moved its primary club operations south of the border. Component manufacturing for clubheads, shafts, and grips happens across Asia, primarily in China and Vietnam. Callaway's premium golf balls are made in Chicopee, Massachusetts.

The 2010 move to Monterrey was a significant operational change. Before that, approximately 40 percent of Callaway's golf clubs were assembled at the Carlsbad headquarters facility. The relocation cut assembly costs and consolidated club production into a single high-throughput facility close to the American distribution market. Carlsbad retained design, engineering, prototyping, and tour fitting operations. The cost savings funded the company's ongoing investment in research and development and tour player contracts.

The Monterrey Operation

The Monterrey facility handles the assembly of finished clubs for the Western Hemisphere and European markets. Clubheads arrive from foundries in China and Taiwan, shafts come from Japanese and other Asian manufacturers, and grips arrive from multiple global suppliers. Final club assembly, including shaft installation, swing-weight verification, and loft-and-lie checks, happens at Monterrey. The proximity to the American market means assembled clubs can ship to US distribution within days rather than weeks.

For Asian markets, Callaway operates a separate assembly plant in Japan. This serves both the strategic need to be close to Asian customers and the practical reality that the Japanese golf market has different preferences for shaft profiles, grip sizes, and overall club specifications. The Japanese plant produces clubs tailored to those preferences.

The Chicopee Ball Plant

Callaway's golf balls are made at the Chicopee Manufacturing facility in Chicopee, Massachusetts. The 130-year-old facility was originally a Spalding manufacturing site dating to the late 1800s. Callaway acquired Chicopee through its 2003 purchase of the Top-Flite Golf division out of Spalding's bankruptcy. The deal cost $169 million and gave Callaway both a manufacturing base and access to Spalding's golf ball patents. Chicopee now produces Callaway's premium balls including the Chrome Soft and Chrome Soft X. The company has invested over $50 million modernizing the facility, which it claims is the most advanced ball production site in the world.

The DORMIED Take

Callaway's manufacturing geography reflects a deliberate trade-off. The Carlsbad headquarters keeps design and tour operations near the industry's talent pool. The Monterrey facility delivers cost-effective high-volume assembly close to the largest market. The Chicopee plant gives the company a premium American-made ball story for the segment of buyers who care about it. Each location handles what it does best, and the system has been operating reliably for 15 years.

For buyers asking where their Callaway club was made: the assembly tag will typically say Mexico for Western Hemisphere clubs, Japan for clubs purchased in Asia. The Asian-made label on components does not change the build quality, which is controlled centrally from Carlsbad. The Mexican assembly is the same operation that produces the clubs Xander Schauffele uses in his bag and the clubs Phil Mickelson plays in his testing rounds. The geography is operational, not a reflection of build quality.

Compared to Titleist's Carlsbad assembly model or TaylorMade's Carlsbad and Japan dual setup, Callaway's Monterrey-centered approach is the most efficient in pure unit-cost terms. Whether that efficiency translates to better consumer pricing depends on which model line you are looking at. Callaway's pricing remains comparable to its major competitors at most retail tiers.`,
  },

  // ── 7 ───────────────────────────────────────────────────────────────────────
  {
    slug:            'where-is-callaway-headquartered',
    brandSlug:       'callaway',
    secondarySlugs:  ['odyssey-golf', 'travismathew'],
    title:           'Where Is Callaway Headquartered?',
    author:          'Travis',
    category:        'Clubs',
    sourceUrl:       'https://en.wikipedia.org/wiki/Callaway_Golf_Company',
    sourceName:      'Wikipedia',
    imageUrl:        'https://www.todays-golfer.com/wp-images/1773/951x634/inside_odyssey11.jpg',
    metaDescription: 'Callaway Golf is headquartered at 2180 Rutherford Road, Carlsbad, California, where the company has operated since the early 1980s. Parent is Topgolf Callaway Brands.',
    seoKeywords:     ['where is Callaway headquartered','Callaway headquarters','Callaway Carlsbad address','Topgolf Callaway Brands','Callaway Golf Company address'],
    xPostText:       'Callaway HQ is 2180 Rutherford Road, Carlsbad, California. The company has been there since the early 1980s under founder Ely Callaway. Now part of Topgolf Callaway Brands with 24,000+ employees globally.',
    body: `Callaway Golf Company is headquartered at 2180 Rutherford Road, Carlsbad, California, 92008. The company has operated from Carlsbad since founder Ely Callaway Jr. relocated the business there in the early 1980s. The Carlsbad headquarters serves as the design, engineering, tour fitting, and corporate hub for what is now Topgolf Callaway Brands Corp, the parent entity that resulted from Callaway's 2021 acquisition of Topgolf Entertainment Group. The combined company employs more than 24,000 people globally and generates over $1 billion in annual revenue.

The Carlsbad location reflects how deeply embedded Callaway is in the Southern California golf equipment ecosystem. Within a few miles of the Rutherford Road campus, you can find TaylorMade, Cobra Puma, Fujikura, and the Carlsbad assembly facility for Titleist clubs. The Ely Callaway Performance Center, where the company conducts tour player fittings and product testing, is located about 10 miles north in Oceanside.

The Brand Portfolio at the Headquarters

Callaway's headquarters is also home to the broader portfolio of brands the company has acquired over the years. Odyssey, the dominant putter brand acquired by Callaway in 1997 for $130 million, operates from the Carlsbad campus. Toulon Design, the milled putter brand acquired in 2016, sits within the Odyssey division. TravisMathew, the lifestyle apparel brand Callaway acquired in 2017, has its own offices nearby in Huntington Beach but reports operationally through the Carlsbad headquarters. OGIO, the bag brand, was acquired in 2017. The full brand stack is managed from Carlsbad.

The Topgolf acquisition added another layer. Topgolf operates approximately 100 venues globally, most located in major American metropolitan areas. The Topgolf side of the business has its own operational headquarters in Dallas, Texas, but reports to the Carlsbad corporate parent. The combined company structure reflects Callaway's strategic shift from a pure equipment manufacturer to a broader golf entertainment and lifestyle business.

The Founding Story

Ely Callaway Jr. acquired Hickory Stick USA in 1982 and renamed the company Callaway Hickory Stick USA, later shortened to Callaway Golf Company. Callaway himself was a textile industry executive and an avid amateur golfer. The breakthrough product was the Big Bertha driver, introduced in 1991, which used an oversized 190cc head that made the club more forgiving and easier to hit than traditional persimmon drivers. The Big Bertha franchise became one of the most successful product lines in golf equipment history. Callaway went public on the New York Stock Exchange in February 1992 with a $250 million market cap. By late 1997 the company had reached a $3 billion market cap.

Callaway died of pancreatic cancer in July 2001. The company has been led by professional CEOs since, with Chip Brewer holding the role from 2012 onward.

The DORMIED Take

The Carlsbad headquarters is more than an address. It is the central node of the modern Callaway empire, the place where strategic decisions across equipment, apparel, putters, and entertainment all converge. Callaway's geographic concentration is part of what makes the company difficult to compete with at scale. A new entrant trying to compete across all of these categories from a different city would lack the supplier proximity, the talent pool, and the natural connection to the rest of the Carlsbad golf ecosystem that makes Callaway's coordination work.

For visitors: the corporate headquarters at 2180 Rutherford Road is not generally open to the public. The Ely Callaway Performance Center in Oceanside offers fitting experiences by appointment. Tour visits and corporate events are scheduled through Callaway's official channels.`,
  },

  // ── 8 ───────────────────────────────────────────────────────────────────────
  {
    slug:            'who-owns-malbon-golf',
    brandSlug:       'malbon',
    secondarySlugs:  [],
    title:           'Who Owns Malbon Golf?',
    author:          'Adam',
    category:        'Trendy/Lifestyle',
    sourceUrl:       'https://www.glossy.co/fashion/stephen-and-erica-malbon-malbon-glossy-50-2025/',
    sourceName:      'Glossy',
    imageUrl:        'https://malbon.com/cdn/shop/files/about_us_3.jpg?v=1746031828&width=800',
    metaDescription: 'Malbon Golf is owned by founders Stephen and Erica Malbon, who started the brand in Los Angeles in 2017. Anthos Capital led a $33 million funding round in 2025.',
    seoKeywords:     ['who owns Malbon Golf','Malbon Golf owner','Stephen Erica Malbon','Malbon Golf investors','Anthos Capital Malbon'],
    xPostText:       'Malbon Golf is owned by Stephen and Erica Malbon, the husband-and-wife founders who started the brand in LA in 2017. Anthos Capital led a $33M round in 2025. Revenue near $200M and growing.',
    body: `Malbon Golf is owned by founders Stephen and Erica Malbon, the husband-and-wife team who started the brand in Los Angeles in 2017. The brand remains privately held with significant outside investment, including a $33 million funding round led by Anthos Capital that closed in 2025. Stephen and Erica retain creative and operational leadership, but they brought in professional executives to handle day-to-day operations as the business has scaled toward roughly $200 million in annual revenue.

The leadership team now includes Aaron Heiser as CEO, Rebecca Jury as chief product officer, and Pierre Martin as chief marketing officer. All three came from Nike, which has become a recruiting pattern for Malbon as the brand has grown beyond the founder-led startup stage. Stephen Malbon describes the team additions as a way for him and Erica to focus more on creative direction and brand strategy while professional operators handle execution.

The Founding Story

Stephen and Erica met in Los Angeles around 2008 through a mutual friend. Stephen had spent his career in fashion and underground media, including founding the cult magazine Frank151 and working in adjacent corners of streetwear and skate culture. Erica had co-founded The Now, a boutique massage business. They got married, had kids, and at some point in his mid-thirties Stephen got pulled back into golf for the third time in his life. The first addiction had been as a 12-year-old caddy in Virginia Beach. The second was as a college kid working a club in Atlanta. The third hit when he was 33 and living in Los Angeles. That third one stuck.

In 2017, Stephen and Erica opened a small concept store on Fairfax Avenue in Los Angeles, the famous streetwear stretch. The store sold golf apparel that did not look like other golf apparel. The premise was simple: most golf clothing is designed for the country club aesthetic of 1985. Stephen and Erica thought there was a customer who wanted to play golf and look like someone who lives in 2017 Los Angeles. The store became the brand. Within a few years, Malbon had locations in New York, Miami, Carmel-by-the-Sea, Seoul, and Manila.

Strategic Partners and Major Investors

The $33 million Anthos Capital round in 2025 was the largest formal investment in the company to date. Anthos is a Los Angeles-based growth equity firm with a portfolio that includes American Giant, Bombas, and several other consumer brands. The capital is being used to fund international expansion, particularly into China, and to extend the brand beyond golf into adjacent categories like Malbon Golf and Hunt Club, Malbon Run Clubs, and Malbon Golf and Tackle. The strategy is to capture customers who care about more than one of these activities and want a single brand that speaks to all of them.

The DORMIED Take

Malbon's ownership story is more interesting than the typical apparel brand acquisition narrative because the founders still own the creative direction. Most golf apparel brands that hit this scale get acquired by a parent like Acushnet, Callaway, or a private equity firm. The founder usually gets a check and a transition period, then leaves. Stephen and Erica Malbon took the Anthos capital instead. They kept control of the brand. That decision is what allows the brand voice to stay specific and what protects against the dilution that often happens when streetwear brands sell to larger owners.

Whether that holds at $400 million in revenue is the open question. The brand is still in growth mode, and the next funding event or potential acquisition could change the structure. For now: founder-owned, Anthos-backed, professionally run, growing fast. That combination is rare in golf apparel, and it is most of what makes Malbon Malbon.`,
  },

  // ── 9 ───────────────────────────────────────────────────────────────────────
  {
    slug:            'why-is-malbon-so-popular',
    brandSlug:       'malbon',
    secondarySlugs:  [],
    title:           'Why Is Malbon So Popular?',
    author:          'Adam',
    category:        'Trendy/Lifestyle',
    sourceUrl:       'https://edition.cnn.com/sport/malbon-golf-sweatergate-masters-spt-spc',
    sourceName:      'CNN',
    imageUrl:        'https://malbon.com/cdn/shop/files/Mask_group4.png?v=1774395132&width=1272',
    metaDescription: 'Malbon is popular because it brought streetwear sensibility to golf apparel. The brand\'s collabs with Nike, Coca-Cola, and the viral 2024 Masters Jason Day moment helped propel its rise.',
    seoKeywords:     ['why is Malbon so popular','Malbon Golf popularity','Malbon Golf Jason Day Masters','Malbon Golf collabs','Malbon Golf brand history'],
    xPostText:       'Malbon is popular because it brought streetwear to a golf apparel category that had been stuck in 1985. The Jason Day Masters moment, the Nike and Grateful Dead collabs, and the LA store experience all compound.',
    body: `Malbon is popular because it solved a problem that golf apparel had been ignoring for thirty years. The problem was simple. The customer who wanted to play golf no longer dressed like the customer golf apparel was designed for. By 2017, the average golfer was younger, more style-conscious, and exposed to streetwear, hip-hop, and skate culture in a way that the traditional golf brands had never accounted for. Stephen and Erica Malbon launched their brand in Los Angeles that year with the explicit goal of making clothing that golfers under 40 actually wanted to wear. Eight years later, they have arguably the most culturally influential golf brand of the decade.

The popularity comes from a handful of overlapping decisions, all of which compound.

The Collab Strategy

Malbon collaborates with brands that have no obvious golf overlap. The list reads like a fashion editor's contact book. Coca-Cola. Budweiser. Nike. Polo Ralph Lauren. New Balance. Undefeated. Jimmy Choo. Bushmills Irish Whiskey. The Grateful Dead. Larry David's Curb Your Enthusiasm. Each collab puts the brand in front of an audience that did not previously think about golf apparel. A New Balance collab gets covered on Hypebeast. A Curb collab gets posted by HBO accounts. A Grateful Dead capsule gets reposted by music culture accounts that would never share a golf brand otherwise. Each of those reposts is free reach into a non-golf audience that golf brands have been trying to reach for decades and have largely failed to convert.

The Augusta Moment

In 2024, Malbon signed Jason Day as its first PGA Tour ambassador. Two months later, Day showed up at the Masters wearing a baggy fit and a sweater vest that read "Malbon Golf Championship" in oversized block lettering across the chest. Augusta National asked him to remove the vest before his second round. The internet did the rest. "Sweatergate" became the dominant story of that Masters week. Whether you loved it or hated it, you were talking about Malbon. For a brand that had spent seven years building cultural credibility in streetwear circles, getting suddenly thrust into the center of golf's most traditional event was the inflection point.

In 2026, Day returned to Augusta wearing the Birds of Georgia capsule, a bird-print collection designed specifically for the tournament. Augusta National again asked him to tone down the look. The story repeated. Malbon's reach kept compounding.

The Brand Voice

Malbon's product copy, social posts, and store experiences feel different from other golf brands. The voice is loose, slightly tongue-in-cheek, and intentionally irreverent without being cynical. The aesthetic borrows from skate brands of the 1990s and 2000s. The logo is informal. The typefaces feel like band merch, not country club signage. Walking into a Malbon store on Fairfax in Los Angeles or in Manila or in Seoul, the experience is closer to walking into Supreme than walking into a golf shop at a private club.

The Buckets Club

In 2023, Malbon launched the Buckets Club, a digital community that has functioned as a customer retention loop and a content engine. Buckets Club members get access to exclusive drops, events, and content. The club mirrors how streetwear brands like Supreme and luxury houses like Hermes use scarcity and access as marketing tools. The community side of Malbon is part of why customers stay attached to the brand rather than treating it as a one-time fashion purchase.

The DORMIED Take

The popularity is real and the catalysts are clear, but the durability question is open. Streetwear brands have a tendency to peak culturally and then either expand into mainstream banality or contract into niche relevance. Malbon's bet is that golf is too large a category to peak the way streetwear brands typically do. The argument is reasonable. Golf has 25 million participants in the United States alone and the average customer is older than the typical streetwear buyer, which means the audience renews more slowly and stays attached for longer.

The other thing keeping Malbon culturally durable is that the brand has not abandoned its identity as it has scaled. Founder-led businesses can hold creative coherence at scale better than corporate-acquired brands, and Malbon is still founder-led. The voice has not been laundered through a brand consulting firm. The products still look like Stephen and Erica designed them, because they did. That is most of what makes Malbon Malbon, and most of why the popularity has not yet softened the way it does for other apparel brands at this point in the curve.`,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES  (identical to inject-4-seo-articles.js, secondary logos updated to 48px)
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

function bodyToHtml(plainText, primarySlug, primaryName, allBrands) {
  const blocks = plainText.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
  const sortedBrands = [...allBrands].sort((a, b) => b.name.length - a.name.length);
  const linked = new Set();

  return blocks.map(block => {
    const isHeader = !block.includes('\n')
      && block.length <= 80
      && /^[A-Z]/.test(block)
      && !/[.!?]$/.test(block)
      && block.split(/\s+/).length >= 2;

    if (isHeader) return `<h2>${escHtml(block)}</h2>`;

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

  // Secondary brand widgets (48px logos to match primary)
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
    const sbFallback = `<span class=&quot;bp-logo-initials&quot; style=&quot;background:#1a2a1a;width:48px;height:48px;font-size:1rem&quot;>${escHtml(sbInit)}</span>`;
    const sbLogoHtml = sb.logo
      ? `<img src="${escHtml(sb.logo.replace(/sz=\d+/, 'sz=48'))}" alt="${escHtml(sb.name)}" class="bp-logo-img" width="48" height="48" style="width:48px;height:48px" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${sbFallback}')">`
      : `<span class="bp-logo-initials" style="background:#1a2a1a;width:48px;height:48px;font-size:1rem">${escHtml(sbInit)}</span>`;
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
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-N4Q8J6L3');</script>
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
  <link rel="stylesheet" href="/css/styles.css?v=20260717">
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
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://dormied.com/" },
        { "@type": "ListItem", "position": 2, "name": "News", "item": "https://dormied.com/news/" },
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
    console.log(`\n══ ${art.title} ══`);

    const secondaryBrands = art.secondarySlugs
      .map(s => {
        const b = dormiedData.brands.find(b => b.id === s);
        if (!b) { console.warn(`  [warn] Secondary brand not found: ${s}`); return null; }
        return { slug: b.id, name: b.name, logo: b.logo || '' };
      })
      .filter(Boolean);

    const primaryBrand = dormiedData.brands.find(b => b.id === art.brandSlug);
    if (!primaryBrand) { console.error(`  [ERROR] Primary brand not found: ${art.brandSlug}`); results.push({ slug: art.slug, title: art.title, ok: false }); continue; }

    const allBrands = [
      { slug: primaryBrand.id, name: primaryBrand.name },
      ...secondaryBrands.map(sb => ({ slug: sb.slug, name: sb.name })),
    ];

    console.log(`  [img] Uploading hero image...`);
    const { supabaseUrl, localUrl } = await uploadImageToSupabase(supabase, art.imageUrl, art.slug);
    const finalImageUrl = supabaseUrl || art.imageUrl;
    const ogImageUrl    = localUrl    || 'https://dormied.com/images/og-image.jpg';
    console.log(`  [img] ${supabaseUrl ? 'Supabase: ' + supabaseUrl.slice(-60) : 'Fallback: source URL'}`);

    const bodyHtml    = bodyToHtml(art.body, primaryBrand.id, primaryBrand.name, allBrands);
    const readTime    = estimateReadTime(art.body);
    const publishedAt = new Date().toISOString();

    const articleDir = path.join(SITE_ROOT, 'news', art.slug);
    fs.mkdirSync(articleDir, { recursive: true });
    const html = generateArticleHtml({
      title:            art.title,
      bodyHtml,
      imageUrl:         finalImageUrl,
      ogImageUrl,
      localUrl,
      imageAlt:         `${primaryBrand.name}: ${art.category}`,
      slug:             art.slug,
      category:         art.category,
      published_at:     publishedAt,
      source_url:       art.sourceUrl,
      source_name:      art.sourceName,
      meta_description: art.metaDescription,
      seo_keywords:     art.seoKeywords,
      brandSlug:        primaryBrand.id,
      brandName:        primaryBrand.name,
      brandLogo:        primaryBrand.logo || '',
      dataVersion,
      readTime,
      author:           art.author,
      dormiedData,
      secondaryBrands,
    });
    fs.writeFileSync(path.join(articleDir, 'index.html'), html, 'utf8');
    console.log(`  [html] Wrote news/${art.slug}/index.html`);

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
      console.error(`  [db] Insert FAILED: ${insertErr.message}`);
    } else {
      console.log(`  [db] Inserted to dormied_articles (status: published)`);
    }

    addToSitemap(art.slug, publishedAt, ogImageUrl, art.title);
    console.log(`  [sitemap] Added /news/${art.slug}/`);

    results.push({ slug: art.slug, title: art.title, ok: !insertErr });
  }

  // Regenerate search index
  console.log('\n[inject] Regenerating search index...');
  try {
    require('child_process').execSync('node scripts/generate-search-index.js', { cwd: SITE_ROOT, stdio: 'inherit' });
  } catch (e) { console.warn('[inject] Search index regen failed:', e.message); }

  // Regenerate news index pages
  console.log('[inject] Regenerating news index pages...');
  try {
    require('child_process').execSync('node scripts/generate-index-pages.js --news', { cwd: SITE_ROOT, stdio: 'inherit' });
  } catch (e) { console.warn('[inject] News index regen failed:', e.message); }

  console.log('\n[inject] ══ SUMMARY ══');
  results.forEach(r => console.log(`  ${r.ok ? '✓' : '✗'} /news/${r.slug}/`));
  console.log('\nNext steps:');
  console.log('  git add news/ images/articles/ sitemap.xml search-index.json');
  console.log('  git commit -m "Publish 9 SEO articles: brand ownership, manufacturing, and headquarters queries"');
  console.log('  git push origin main');
}

main().catch(err => {
  console.error('[inject] Fatal:', err.message);
  process.exit(1);
});
