#!/usr/bin/env node
/**
 * Publish SEO Article Batch 3 — Takomo, McLaren Golf, Manors Golf
 *
 * 1. Inserts 7 rows into dormied_articles (Supabase)
 * 2. Runs generate-article.js --regenerate-all to write HTML files
 *
 * Usage: node scripts/publish-seo-batch3.js
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const { execSync }     = require('child_process');
const path             = require('path');

const SITE_ROOT = path.resolve(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fix inline <a> slugs & strip links to pages that don't exist on the site. */
function fixBody(text) {
  let out = text;
  // Fix wrong primary brand slugs
  out = out.replace(/href="\/brands\/takomo\/"/g, 'href="/brands/takomo-golf/"');
  out = out.replace(/href="\/brands\/manors\/"/g, 'href="/brands/manors-golf/"');
  // Fix malbon-golf → malbon (malbon page exists, malbon-golf does not)
  out = out.replace(/href="\/brands\/malbon-golf\/"/g, 'href="/brands/malbon/"');
  // Strip links to brand pages that do NOT exist on the site
  // Pattern: <a href="/brands/SLUG/" class="da-brand-link">LABEL</a>
  const MISSING = ['miura', 'porsche', 'arcteryx', 'parlay-golf', 'criquet'];
  for (const slug of MISSING) {
    const re = new RegExp(
      `<a href="/brands/${slug}/" class="da-brand-link">([^<]+)</a>`,
      'g'
    );
    out = out.replace(re, '$1'); // replace with just the label text
  }
  return out;
}

/** Count words in a body string (for word_count column). */
function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** First paragraph ≤200 chars as excerpt. */
function excerpt(text) {
  const first = (text.split(/\n\n+/).find(p => p.trim()) || '').trim();
  return first.length <= 200 ? first : first.slice(0, 197) + '...';
}

// ── Article Definitions ───────────────────────────────────────────────────────

const NOW = new Date().toISOString();

const IMAGE_BASE = 'https://cimmmmnapdthqvtifpzr.supabase.co/storage/v1/object/public/dormied-articles/articles';

const ARTICLES = [
  // ── ARTICLE 1 ──────────────────────────────────────────────────────────────
  {
    slug:        'are-takomo-irons-good',
    title:       'Are Takomo Irons Good?',
    brand_slug:  'takomo-golf',
    category:    'Clubs',
    author:      'Travis',
    image_url:   `${IMAGE_BASE}/are-takomo-irons-good-hero.webp`,
    source_url:  'https://pluggedingolf.com/takomo-201-irons-review/',
    source_name: 'Plugged In Golf',
    meta_description: 'Yes, Takomo irons are good. The Iron 201 is forged from S20C steel (same grade Miura uses) and sells for ~$589, roughly half the cost of comparable OEM sets.',
    x_post: 'Yes, Takomo irons are good. The Iron 201 is forged from S20C steel, the same grade Miura uses. Retails at ~$589 for a full 4-PW set with KBS shafts. Reviewers compare the feel directly to Mizuno and Miura.',
    body: `Yes. Takomo irons are good, and they are very good for the price. Independent reviewers consistently rate them in the same conversation as Mizuno and Miura forged irons for feel, with the caveat that the Takomo cosmetic finish and the tour validation are not at the same level. The flagship Iron 201 set is forged from S20C carbon steel, the same grade Miura uses in its premium irons, and retails for around $589 for a 4-PW set including KBS shafts and Lamkin grips. That is roughly half what a comparable Mizuno or Srixon set costs.

This is not marketing puffery. It is the consistent finding across reviewers at Plugged In Golf, MyGolfSpy, Independent Golf Reviews, Golf Sidekick, and Golf Reviews Guide. Each has independently tested the Iron 201 and reached the same conclusion: the feel is genuinely soft, the forgiveness is genuine for a player's cavity back, and the price point is unmatched in the category.

What Makes Them Good

The S20C steel is the key technical specification. S20C is a low-carbon steel with a grain structure that responds well to forging and produces the soft impact feedback that better players want. Miura uses S20C. Mizuno uses 1025E and chromoly mixes in its current Pro lineup. The fact that Takomo specs the same base material as Miura is not an accident. It is a deliberate choice to deliver the feel that the brand's target customer expects, at a price the OEM model cannot match because the OEM has to support traditional retail margins, marketing budgets, and tour player contracts.

The Iron 201 itself is a forged cavity back. The face and the cavity are both CNC-milled after forging, which gives the surface a precise finish and contributes to consistency in launch and ball speed across the face. The cavity design provides perimeter weighting for forgiveness without losing the workability that better players want. The blade length and offset are tight enough to look like a player's iron at address.

The Limitations Worth Knowing

S20C steel scratches. The same softness that makes the irons feel great also means they show bag chatter and contact marks more than harder alloys would. If you keep your clubs in pristine cosmetic condition, this matters. If you actually play the clubs, they will show wear faster than your friend's Mizuno JPX 925 set.

The topline on the Iron 201 is slightly thicker than what a true tour-level player's iron would feature. Reviewers consistently note this. It is not a blade. It looks more like a Mizuno MP-20 HMB than a Mizuno Pro 221. For mid-handicap players this is a feature, not a bug. For low single-digit players hunting the most workable head profile, the 301 CB or 301 MB models in the Takomo lineup are the better fit.

There is no tour validation. <a href="/brands/takomo-golf/" class="da-brand-link">Takomo</a> has signed Wesley Bryan and brought on Grant Horvat and the Bryan Bros as content-creator shareholders, but the brand does not have a presence on the PGA Tour the way OEMs do. For some buyers, that absence is a deal-breaker. For others, it is irrelevant.

The DORMIED Take

If you are a 5 to 15 handicap player looking for a forged cavity back at under $600, Takomo irons are genuinely good and are the clear value choice in the category. They are not a Mizuno or a Miura at half price. They are a different product designed to deliver most of what those brands deliver in feel, at a price point those brands cannot match because of their cost structure. That is the trade.

For better players who want true blade workability, the 301 series in the lineup is worth a look. For higher-handicap players, the 101 series provides more forgiveness with a deeper cavity. The 201 is the brand's flagship and the right starting point for most buyers.

The reviewers agree. The buyers agree. The numbers agree. Takomo irons are good.`,
  },

  // ── ARTICLE 2 ──────────────────────────────────────────────────────────────
  {
    slug:        'who-owns-takomo-golf',
    title:       'Who Owns Takomo Golf?',
    brand_slug:  'takomo-golf',
    category:    'Clubs',
    author:      'Travis',
    image_url:   `${IMAGE_BASE}/who-owns-takomo-golf-hero.jpg`,
    source_url:  'https://golfreviewsguide.com/grant-horvat-takomo-golf/',
    source_name: 'Golf Reviews Guide',
    meta_description: 'Takomo Golf is owned by founder and CEO Sebastian Haapahovi. Grant Horvat and the Bryan Bros became minority shareholders in January 2025.',
    x_post: 'Takomo Golf is owned by founder Sebastian Haapahovi. Grant Horvat and Wesley and George Bryan became minority shareholders in January 2025. The content creators are equity partners, not just endorsers.',
    body: `Takomo Golf is owned primarily by founder and CEO Sebastian Haapahovi, with minority shareholders including YouTube golf content creator Grant Horvat, PGA Tour winner Wesley Bryan, and his brother George Bryan. The shareholder additions of Horvat and the Bryan Bros were announced in January 2025 as part of a strategic move to align the Finnish direct-to-consumer brand with the rising influence of golf content creators. Haapahovi remains the controlling owner and continues to run the company from its Turku, Finland headquarters.

This is an unusual ownership structure for a golf equipment brand. Most challenger DTC brands in the category are either solo-founder operations or backed by traditional venture capital. Takomo went a different direction: it gave equity to the content creators who would shape how the brand reached its audience. Horvat is listed as Shareholder and Director of Tempo at Takomo Golf. Wesley and George Bryan are shareholders and brand ambassadors. All three play Takomo irons and wedges in their video content and have helped collaborate on product development, including the Skyforger wedge line.

Why This Ownership Model Matters

Traditional golf brands hire athletes through endorsement deals. The athlete plays the clubs, posts the social media, hits the photo shoots, and collects a check. Takomo went one step further by making content creators ownership stakeholders. The economic incentive shifts. Horvat is not just a paid spokesperson. He participates in the upside of the company's growth. That changes how he talks about the brand, what he tests, and how often he features the clubs in content.

The pattern has spread. Wesley Bryan was already playing Takomo irons in competition for a year before becoming a shareholder. The shareholder formalization in January 2025 cemented what was already a working partnership. <a href="/brands/takomo-golf/" class="da-brand-link">Takomo</a> has since expanded its content creator network to include influencers Sabrina Andolpho, Claire Hogle, and Luke Kwon, all working as brand ambassadors.

The Founder and the Vision

Sebastian Haapahovi founded Takomo in 2020 in Turku, Finland. He was a former IT executive who came back to golf in his thirties and was put off by the price of premium equipment. The story is that he was looking for a forged iron set, was quoted $1,400 for a set he liked, and decided he could do better. The brand name "Takomo" means "forge" in Finnish, which is both literal and a brand statement about what differentiates the product.

Haapahovi's bet was that the global supply chain for premium forged irons could deliver the same product the OEMs deliver, but at a fraction of the price, if you cut out the retail margins and the marketing budget. The company designs in Finland, contracts manufacturing to Taiwan, and ships from Hong Kong. Quality control sits with the Finnish team. The bet has held up. Takomo has expanded from one iron model to a full bag offering including the 101, 101T, 101U, 201, 301 CB, 301 MB irons, the Skyforger wedge line, the Ignis D1 driver and woods, and now a low-torque putter line acquired through the December 2025 purchase of Finnish putter maker Otso Golf.

Recent Acquisitions

The Otso acquisition in December 2025 was the company's first move beyond its DTC equipment lineup. Otso was a small Finnish brand designing low-torque putters in the same category as L.A.B. Golf. Takomo acquired the design rights and the services of Otso CEO Miika Farin, who joined Takomo as senior product designer to lead the new Takomo putter family. The acquisition pushed Takomo closer to the full-bag company status that Haapahovi has said is the long-term goal.

The DORMIED Take

Takomo's ownership structure is a useful case study in how the modern DTC golf brand can grow without traditional venture capital. Haapahovi has retained majority ownership while bringing in strategic minority shareholders who happen to be the brand's most influential customers. The economic alignment is what makes the partnership stickier than a paid endorsement. Whether that model scales as Takomo grows is the open question. For now: Finnish, founder-led, content-creator-aligned, growing fast.`,
  },

  // ── ARTICLE 3 ──────────────────────────────────────────────────────────────
  {
    slug:        'who-makes-mclaren-golf-clubs',
    title:       'Who Makes McLaren Golf Clubs?',
    brand_slug:  'mclaren-golf',
    category:    'Clubs',
    author:      'Travis',
    image_url:   `${IMAGE_BASE}/who-makes-mclaren-golf-clubs-hero.jpg`,
    source_url:  'https://golf.com/gear/irons/mclaren-golf-iron-creation/',
    source_name: 'GOLF.com',
    meta_description: 'McLaren Golf clubs are made by McLaren Racing in partnership with 8AM Golf. The clubs use MIM technology and are designed by a team of former Titleist, Cobra, and Callaway veterans.',
    x_post: 'McLaren Golf clubs are made by McLaren Racing with a team of former Titleist, Cobra, TaylorMade, and Callaway veterans. They use MIM technology. Series 1 and Series 3 irons are $375 per club.',
    body: `McLaren Golf clubs are made by McLaren Racing in collaboration with 8AM Golf, the parent company of GOLF.com. The clubs are designed in-house by a team of former Titleist, Cobra, TaylorMade, and Callaway veterans who were hired specifically to launch the brand. McLaren Golf is a wholly-owned subsidiary of the broader McLaren group, which is best known for its Formula 1 Grand Prix racing team and its supercar division. The clubs launched on April 29, 2026, with Justin Rose, Ian Poulter, and Michelle Wie West as the inaugural brand ambassadors.

The team behind the clubs is more accomplished than the brand's debut would suggest. CEO Neil Howie spent 25-plus years at Callaway, ultimately serving as President and Managing Director of Callaway Europe. Senior Design Manager for irons and wedges JP Harrington was a former Titleist designer and the founder of JP Wedges before joining McLaren. Director of Engineering Ryan Badgero is a 12-year Cobra Golf veteran. Chief Marketing Officer Ryan Lauder spent his career at TaylorMade. The collective experience of the founding team across the major OEMs is one of the most pedigreed assemblies of golf industry talent ever brought together to launch a new brand.

How the Clubs Are Made

The Series 1 and Series 3 iron sets are built using Metal Injection Molding (MIM) technology, which is a manufacturing process that injects fine metal powder into a mold and then sinters the result at high temperature. MIM is not new in golf. <a href="/brands/cobra/" class="da-brand-link">Cobra</a> Golf uses it for its King wedge line. <a href="/brands/callaway/" class="da-brand-link">Callaway</a> Golf uses it for the Opus wedge series. The advantage of MIM is that it produces tighter design tolerances than casting can achieve while maintaining the metal density that gives the clubs a forged feel.

McLaren uses MIM with a specific twist. Each iron head in the set includes a calibration weight inside the cavity. These weights are not uniform across the set. Each iron has a slightly different weight with slightly different geometry, designed to fine-tune the center of gravity and headweight per club so the entire set feels uniform when swung. The weights are factory-installed and are not user-serviceable. They are calibration weights, not swing-weighting tools.

The Production Partners

McLaren Golf does not operate its own manufacturing plant. Like every major OEM, it contracts manufacturing through specialist partners. The MIM heads are produced by a manufacturing partner that has not been publicly disclosed in McLaren's launch materials. Final assembly happens at McLaren's contracted facility. The complete supply chain is similar to how every premium golf brand operates: heads from foundries, shafts from established Japanese and global producers, grips from established manufacturers, and final assembly to specification.

The headquarters operation sits at McLaren Technology Centre in Woking, England, which is the same campus where the McLaren F1 team designs and tests its race cars. Justin Rose has been involved in the iron testing program at Woking, and McLaren has been explicit that the engineering culture borrowed from F1 racing is central to the brand's identity. Whether that translates to a competitive advantage on the course is the open question.

The DORMIED Take

McLaren Golf is not a vanity project the way previous luxury car brand attempts at golf were. Porsche Design tried golf clubs in the 902 series and quietly exited the category. Ferrari teamed with Cobra on a $2,000 driver that became a collector's item rather than a product. Aston Martin had a Merchandise Show booth nobody remembers. Those projects were licensing deals with golf brands. McLaren built its own team and its own design pipeline with industry veterans who have shipped at OEM scale.

The team McLaren assembled is good enough to ship product that competes on engineering and design. The price point ($375 per club, or about $2,520 for a 7-club set) is positioning the brand as a premium niche player, not a volume competitor. That is the right strategic answer for a luxury automotive brand entering golf, and it matches how PXG launched in 2013. Whether McLaren can build a sustained business out of the niche depends on the next 18 to 36 months of product cadence and tour validation.

For now: McLaren Golf is a subsidiary of McLaren Racing, designed in Woking, manufactured through MIM technology by contracted partners, and launched with a team of OEM veterans who collectively have decades of golf industry experience. It is the most serious luxury-car-into-golf attempt to date.`,
  },

  // ── ARTICLE 4 ──────────────────────────────────────────────────────────────
  {
    slug:        'how-much-are-mclaren-golf-clubs',
    title:       'How Much Are McLaren Golf Clubs?',
    brand_slug:  'mclaren-golf',
    category:    'Clubs',
    author:      'Travis',
    image_url:   `${IMAGE_BASE}/how-much-are-mclaren-golf-clubs-hero.jpg`,
    source_url:  'https://sports.yahoo.com/articles/justin-rose-confirms-debut-mclaren-173000071.html',
    source_name: 'Yahoo Sports',
    meta_description: 'McLaren Golf clubs cost $375 per club, or about $2,625 for a 7-club iron set. Both Series 1 and Series 3 irons are priced the same.',
    x_post: 'McLaren Golf clubs are $375 per club. A 7-club Series 1 (blade) or Series 3 (cavity back) set runs ~$2,625. The pricing positions McLaren as a boutique luxury alternative to PXG, not a mass-market OEM competitor.',
    body: `McLaren Golf clubs cost $375 per club, which puts a 7-club Series 1 or Series 3 iron set at $2,625. In the UK, the same clubs sell for £360 per club, or about £2,520 for a full 7-club set. McLaren launched the brand on April 29, 2026, with two iron sets available: the Series 1, a tour blade designed for skilled players, and the Series 3, a more forgiving cavity back. Both sets are priced identically per club.

This is premium pricing. For context, a Titleist T100 iron set retails around $1,400 to $1,600 for 8 clubs. A Mizuno Pro 245 set runs about $1,500 to $1,700 for 8 clubs. A PXG 0317T set sits around $1,800 for 7 clubs. McLaren Golf is positioned above the standard OEM price tier and into the boutique premium category occupied by <a href="/brands/scotty-cameron/" class="da-brand-link">Scotty Cameron</a> putters, <a href="/brands/bettinardi/" class="da-brand-link">Bettinardi</a> milled wedges, and select Miura Japanese forgings.

What You Get for the Price

The Series 1 is a precision-engineered blade-style iron built for players who prioritize control, workability, and pure feedback. The Series 3 is a more forgiving design with a wider sole and a sole cut at the heel that helps the club exit turf more efficiently. Both irons are manufactured using Metal Injection Molding (MIM), which produces tighter tolerances than casting and gives the irons a forged-like feel without the cost penalty of traditional forging.

Each iron head includes a calibration weight inside the cavity that is factory-tuned to dial in the center of gravity and headweight for that specific loft. The weights vary across the set, with different weights and shapes in each head to create a uniform feel across the whole iron set. This is the kind of attention-to-detail engineering that McLaren is leaning into with the launch and that explains some of the premium pricing.

Shafts come from McLaren's design partners with both steel and graphite options. Grips are standard from <a href="/brands/golf-pride/" class="da-brand-link">Golf Pride</a> and <a href="/brands/lamkin/" class="da-brand-link">Lamkin</a>. Custom fitting is part of the buying experience, with the brand's launch materials emphasizing the boutique feel of the order process.

Why the Price Point Makes Strategic Sense

McLaren is not trying to compete with <a href="/brands/titleist/" class="da-brand-link">Titleist</a> or <a href="/brands/taylormade/" class="da-brand-link">TaylorMade</a> on volume. The pricing strategy is the same one PXG used at its 2013 launch, when it priced the original 0311 irons at $400 per club and used the premium positioning to establish the brand identity. PXG eventually expanded into lower price tiers over time. McLaren may follow the same playbook.

The customer McLaren is targeting is the player who already owns a McLaren or who wants the brand cachet of owning McLaren equipment. That customer is not deciding between McLaren and Mizuno on a strict performance-per-dollar basis. The customer is deciding whether the McLaren brand and the engineering story are worth the premium. For some buyers it will be. For others it will not.

The DORMIED Take

$375 per club is a high but not unreasonable price for a boutique premium iron with MIM construction, custom calibration weights, and the McLaren brand attached. It is more expensive than mainstream OEM offerings but cheaper than the high end of the milled-forging boutique category. The pricing makes McLaren a luxury alternative to PXG, not a mass-market competitor to Titleist or TaylorMade.

Whether the pricing holds depends on what McLaren does in the next 12 months. If the brand expands into woods, wedges, and putters at similar price points, it builds out a coherent luxury equipment offering. If the brand discounts heavily to clear inventory, the premium positioning collapses and the launch story becomes another cautionary tale about luxury automotive crossover into golf. The early signs are that McLaren is committed to the premium positioning. Time will tell whether the customer base supports it.

For now: $375 per club, $2,625 per 7-club iron set, in both Series 1 (blade) and Series 3 (cavity back) configurations. Available direct from mclarengolf.com.`,
  },

  // ── ARTICLE 5 ──────────────────────────────────────────────────────────────
  {
    slug:        'who-owns-mclaren-golf',
    title:       'Who Owns McLaren Golf?',
    brand_slug:  'mclaren-golf',
    category:    'Clubs',
    author:      'Travis',
    image_url:   `${IMAGE_BASE}/who-owns-mclaren-golf-hero.jpg`,
    source_url:  'https://golf.com/gear/mclaren-announces-new-golf-division/',
    source_name: 'GOLF.com',
    meta_description: 'McLaren Golf is owned by McLaren Racing, a subsidiary of McLaren Group. The launch is in partnership with 8AM Golf, parent of GOLF.com.',
    x_post: 'McLaren Golf is owned by McLaren Racing, part of the broader McLaren Group. Launched April 29, 2026, in partnership with 8AM Golf (parent of GOLF.com). CEO Neil Howie was previously President of Callaway Europe.',
    body: `McLaren Golf is owned by McLaren Racing, the British Formula 1 team and parent of the broader McLaren brand. The golf division was launched in partnership with 8AM Golf, the parent company of GOLF.com. McLaren Racing itself is part of McLaren Group, the privately-held British company that also operates McLaren Automotive, the supercar manufacturer, and McLaren Applied Technologies, the engineering services arm. The McLaren Group's largest shareholder is the sovereign wealth fund of Bahrain through Mumtalakat Holding Company.

The corporate hierarchy reads from top to bottom as: Mumtalakat (Bahrain sovereign wealth fund, majority owner) → McLaren Group → McLaren Racing → McLaren Golf. The actual ownership structure is more complex due to additional investors at the McLaren Group level, including the Saudi Public Investment Fund (which purchased a stake in 2023) and various private investors. The point is that McLaren Golf sits at the bottom of a substantial corporate structure with deep capital reserves.

The Launch Partnership With 8AM Golf

The collaboration with 8AM Golf is unusual and worth understanding. 8AM Golf is the holding company behind GOLF.com, GOLF Magazine, and several other golf media and equipment-adjacent businesses. The CEO is Howard Milstein, the New York real estate mogul who owns the New York Islanders and has been an active investor in golf media for years. 8AM Golf brings golf industry expertise and an established media platform to the McLaren launch. McLaren brings the engineering pedigree and the brand.

The partnership model is not a licensing deal where McLaren slaps its logo on someone else's product. The McLaren Golf team is staffed by McLaren-hired employees including CEO Neil Howie (formerly Callaway Europe President) and Senior Design Manager JP Harrington (formerly Titleist and founder of JP Wedges). 8AM Golf provides strategic support and distribution channels but does not control the product or design decisions.

Why McLaren Decided to Build a Golf Brand

The decision came from the McLaren Racing side rather than the automotive side. CEO Zak Brown of McLaren Racing is a serious golfer. Lando Norris, the McLaren F1 driver who won the 2025 Drivers' Championship, is a serious golfer and was present at the brand's Miami launch event. The internal narrative is that the engineering excellence McLaren applies to F1 race cars can translate to golf equipment, and that the brand has the financial capacity and the engineering depth to do it right.

The skeptical reading is that this is a vanity project and most automotive crossovers into golf have ended on the clearance rack. Porsche Design tried golf clubs in the 902 series and exited. Ferrari teamed with Cobra on a $2,000 driver that ended as a collector's item. Aston Martin had a forgotten Merchandise Show booth. The optimistic reading is that McLaren built a serious team of golf industry veterans (Howie, Harrington, Badgero, Lauder) and committed real capital to the launch. The early product has gotten genuinely positive coverage from independent reviewers.

The DORMIED Take

McLaren Golf has deeper resources than any other recent golf equipment launch. The brand sits inside a corporate structure that owns Formula 1 teams and produces supercars, with sovereign wealth fund backing and partnerships with established golf media. That kind of capital depth lets McLaren take a longer view than a typical startup can.

The question is whether the brand's commitment will last beyond the launch enthusiasm. Most luxury-car-into-golf attempts have failed because the parent company eventually decided golf was a distraction from the core business. McLaren has been more deliberate. The team hired, the engineering investment in MIM technology, the brand ambassadors signed, and the partnership with 8AM Golf all signal a multi-year commitment. Whether that translates into a sustainable equipment brand or fades into another cautionary tale depends on what happens between now and the 2028 product cycle.

For now: McLaren Golf is owned by McLaren Racing, which is owned by McLaren Group, which is majority-owned by Mumtalakat (Bahrain sovereign wealth fund). Launched April 29, 2026, in partnership with 8AM Golf. Led by CEO Neil Howie with a team of OEM veterans. The most serious luxury-automotive-into-golf attempt to date.`,
  },

  // ── ARTICLE 6 ──────────────────────────────────────────────────────────────
  {
    slug:        'where-is-manors-golf-from',
    title:       'Where Is Manors Golf From?',
    brand_slug:  'manors-golf',
    category:    'Trendy/Lifestyle',
    author:      'Adam',
    image_url:   `${IMAGE_BASE}/where-is-manors-golf-from-hero.jpg`,
    source_url:  'https://hypebeast.com/2021/5/manors-classic-collection-golf-details-interview',
    source_name: 'Hypebeast',
    meta_description: 'Manors Golf is from London, England, founded in 2019 by Jojo Regan, Luke Davies, and Nick Watts. The brand draws from British heritage golf aesthetics.',
    x_post: 'Manors Golf is from London. Founded 2019 by Jojo Regan, Luke Davies, and Nick Watts. The brand lives at the intersection of British heritage and modern golfwear. London is the strategic asset, not just the address.',
    body: `Manors Golf is from London, England. The brand was founded in 2019 by Jojo Regan, Luke Davies, and Nick Watts, three friends with a shared frustration that golf clothing in the late 2010s was stuck in a stylistic time warp. The headquarters sits at 45 Wandsworth Bridge Road in Fulham, southwest London. The geographic identity matters to the brand. London is the spine of British golf heritage, and Manors has built its aesthetic around tapping that history.

The founding story is more interesting than the typical streetwear-meets-golf origin. Jojo Regan grew up playing golf and stayed with the game into adulthood. Luke Davies, a school friend, came to golf later. The two reconnected over rounds at London courses and noticed something both of them found ridiculous: every golf apparel option in the late 2010s was technical performance wear designed for tour players, marketed to weekend golfers who would never break 90. The two of them did not need a moisture-wicking polo to shoot 92. They wanted to look like the people they admired from the sport's golden era.

The Heritage Reference Point

Manors leans hard on the late-1960s through mid-1970s aesthetic of British and American golf. Arnold Palmer. Gary Player. Jack Nicklaus. The era when golfers dressed sharply enough that the gallery often looked as good as the players. Manors brand director Nick Watts spent the early years of the company trawling YouTube and Getty Images archive footage of golf tournaments from that period to inform the brand's visual language. The result is a product line that mixes argyle cardigans, wide-leg trousers, structured polos, and tailored knitwear, all updated with modern technical fabrics and fit.

The brand's positioning has been described as "if Arc'teryx and Rapha had a baby that played golf." The reference points are deliberate. Arc'teryx for the technical quality and performance fabric integration. Rapha for the heritage cycling-meets-modern aesthetic and the community-building approach to brand. <a href="/brands/manors-golf/" class="da-brand-link">Manors</a> has built a similar community around the brand through events at iconic golf venues like Royal Dornoch in Scotland and Assoufid Golf Club in Morocco, with members traveling to Manors-organized trips.

What London Actually Means for the Business

Wandsworth Bridge Road is the brand's working address, but the geographic identity of London matters more strategically than operationally. London gives Manors immediate access to UK golf media, the European fashion scene, and the proximity to historic links courses that anchor the brand's aesthetic. The brand has hosted activations at The London Club, Pyrford Lakes in Surrey, and other UK courses that would be inaccessible to a brand based outside the country.

The wholesale distribution is global. Manors sells through Matches Fashion, Lane Crawford in Asia, and select boutiques across the US, South Korea, Germany, and Thailand. UK is the largest source of revenue at roughly 70 percent, with the remaining 30 percent split mostly between the US and Asia. Direct-to-consumer growth has been the fastest channel, with the brand reporting over 600 percent year-over-year DTC growth in 2023.

The DORMIED Take

The London headquarters is more than an address. It is the brand's most important strategic asset. Manors is leveraging British heritage golf imagery in a way that an American or Asian brand could not credibly do. Country club aesthetics, links course culture, Old Tom Morris references, and the visual library of post-war British golf are all native to the London-based founding team and would feel imported by anyone trying to replicate the playbook from a different country.

Compare this to <a href="/brands/malbon/" class="da-brand-link">Malbon</a>, which is unmistakably Los Angeles in voice, or to <a href="/brands/eastside-golf/" class="da-brand-link">Eastside Golf</a>, which is rooted in American urban culture. Manors occupies the British heritage space, and the location at Wandsworth Bridge Road is part of what makes that authentic. The geography is brand strategy, not just operations.

For now: London, England. Founded 2019. Three founders, all British. Heritage references that only a London-based team could pull off convincingly. The address is the point.`,
  },

  // ── ARTICLE 7 ──────────────────────────────────────────────────────────────
  {
    slug:        'who-owns-manors-golf',
    title:       'Who Owns Manors Golf?',
    brand_slug:  'manors-golf',
    category:    'Trendy/Lifestyle',
    author:      'Adam',
    image_url:   `${IMAGE_BASE}/who-owns-manors-golf-hero.png`,
    source_url:  'https://wwd.com/menswear-news/mens-sportswear/manors-golf-brand-for-young-people-1236139658/',
    source_name: 'WWD',
    meta_description: 'Manors Golf is owned by founders Jojo Regan, Luke Davies, and Nick Watts, with strategic angel investors including actor Nicholas Hoult and Jungle\'s Tom McFarland.',
    x_post: 'Manors Golf is owned by founders Jojo Regan, Luke Davies, and Nick Watts. Angel investors include actor Nicholas Hoult and Jungle frontman Tom McFarland. £5M valuation, founder-controlled, no acquisition in sight.',
    body: `Manors Golf is owned by its three co-founders, Jojo Regan, Luke Davies, and Nick Watts, with minority stakes held by a group of strategic investors that includes actor Nicholas Hoult, media entrepreneur Jamie Bolding, sports media investor Andrew Croker, and Jungle frontman Tom McFarland. The brand has stayed founder-controlled since launching in 2019 and has used crowdfunding through Crowdcube alongside traditional angel investment to fund its growth. As of late 2024, the company had raised over £1 million across multiple rounds and was valued around £5 million.

The founder-led structure matters more than the math. Most apparel brands at Manors's scale and growth rate have been acquired or absorbed into a larger group by year five. Manors has stayed independent. Regan, Davies, and Watts are the operators and the creative leadership. They have brought in strategic capital but have not sold to a parent company. That decision has shaped what the brand is and what it is not.

The Investor Roster

The investor list reads like a thoughtful curation of British creative talent rather than a typical golf brand cap table. Nicholas Hoult is the actor known for his Hollywood film career. Jamie Bolding founded the media platform Jungle Creations. Andrew Croker is an investor in sports media businesses. Tom McFarland is one of the frontmen of Jungle, the British music group. The pattern is investors who understand brand-building and the cultural side of business, not investors who write checks based on revenue multiples.

Beyond the named angels, Manors has raised through Crowdcube twice. The first round in late 2023 to early 2024 raised £601,733 from 181 individual investors at an oversubscription rate that crossed the original £400,000 target. The second round closed in late 2024 and added approximately another £400,000 to the company's balance sheet. The crowdfunding approach matches the brand's community-first ethos. Customers can become small shareholders in the same brand they buy from, which is an unusual structure in golf apparel.

The Founder-Operator Model

Regan, Davies, and Watts are all in their late twenties to early thirties as of 2026. Regan handles business strategy and serves as the public face. Davies handles operations and partnerships. Watts is the creative director and shapes the visual language. The split has held since the founding, with no internal restructuring or founder departures. That stability is rare in venture-backed apparel brands at this stage.

The strategic implication is that <a href="/brands/manors-golf/" class="da-brand-link">Manors</a> is not for sale right now. The founders have positioned the company for long-term independent growth rather than a near-term exit. The growth metrics support that path. Revenue grew from £300,000 in 2022 to £430,000 by October 2023, and the DTC channel grew over 600 percent year-over-year. Wholesale distribution has expanded to Matches Fashion, Lane Crawford in Asia, and boutique partners across multiple continents.

The Comparison That Matters

The closest analog in apparel for what Manors is doing is the founder-controlled, community-built brand model that companies like Parlay Golf and <a href="/brands/students-golf/" class="da-brand-link">Students Golf</a> are also pursuing in different geographic and aesthetic territories. Manors's London base and British heritage focus differentiate the brand from the LA-based <a href="/brands/malbon/" class="da-brand-link">Malbon</a> model or the East Coast prep aesthetic of brands like Criquet. Each is playing in a different lane, but all three are betting that founder-led brands can hold creative coherence at scale that corporate-acquired brands lose.

The DORMIED Take

The ownership structure tells you what to expect from Manors over the next few years. Founder-controlled means the brand voice stays specific. The Crowdcube community means customer-owners become customer-evangelists, which lowers customer acquisition cost. The strategic angel investors mean the cap table has the cultural credibility that the brand identity requires.

What you should not expect is rapid scaling to mass-market apparel volumes. Manors has chosen to grow as a premium boutique label, not as a Lululemon-style growth-at-all-costs apparel platform. The founders have been explicit that the goal is a globally recognizable brand within ten years, not maximum revenue in five. That patience is what differentiates Manors from most of the venture-backed apparel brands trying to scale quickly through the same window.

For now: Jojo Regan, Luke Davies, and Nick Watts. Strategic angel investors including Nicholas Hoult and Tom McFarland. Crowdcube investor community. £5 million valuation as of early 2024. Founder-led, independent, growing patiently. That structure is most of what makes Manors Manors.`,
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log('[batch3] Inserting 7 articles into dormied_articles...');

  for (const art of ARTICLES) {
    const body = fixBody(art.body);

    const row = {
      title:                 art.title,
      slug:                  art.slug,
      body,
      author:                art.author,
      category:              art.category,
      brand_slug:            art.brand_slug,
      secondary_brand_slugs: [],
      image_url:             art.image_url,
      source_url:            art.source_url,
      source_name:           art.source_name,
      meta_description:      art.meta_description,
      seo_keywords:          [],
      published_at:          NOW,
      status:                'published',
      x_post_text:           art.x_post,
      matched_article_id:    null,
    };

    const { error } = await sb.from('dormied_articles').insert(row);
    if (error) {
      console.error(`[batch3] FAIL insert ${art.slug}: ${error.message}`);
    } else {
      console.log(`[batch3] OK insert: ${art.slug} (author: ${art.author})`);
    }
  }

  console.log('\n[batch3] Running generate-article.js --regenerate-all...');
  execSync('node scripts/generate-article.js --regenerate-all', {
    cwd:   SITE_ROOT,
    stdio: 'inherit',
  });

  console.log('\n[batch3] Done. HTML files generated.');
}

// Only run when invoked directly. Without this, `require()`-ing this file for
// inspection or testing executes it against production.
if (require.main === module) {
  main().catch(err => {
    console.error('[batch3] Fatal:', err.message);
    process.exit(1);
  });
}