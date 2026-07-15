#!/usr/bin/env node
/**
 * scripts/inject-batch4-seo.js
 *
 * Publishes 5 pre-written SEO articles to dormied_articles (status='published')
 * and generates static HTML files. No Opus calls — content is pre-written.
 *
 * Article 1 (dormie explainer) has brand_slug = NULL and renders WITHOUT
 * a DORMIED INDEX brand widget. Falls back to titleist.js for window.DORMIED_DATA
 * so the sidebar LATEST widget still functions.
 *
 * Run: node scripts/inject-batch4-seo.js
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
  // ── Article 1: Dormie explainer (NO brand) ──────────────────────────────────
  {
    slug:            'what-is-dormie-in-golf',
    brandSlug:       null,                   // intentionally no brand
    secondarySlugs:  [],
    title:           'What Is Dormie in Golf?',
    author:          'Travis',
    category:        'Culture',
    sourceUrl:       'https://www.usga.org/history/faq--golf-history-questions-232994f0.html',
    sourceName:      'USGA',
    imageUrl:        'https://res.cloudinary.com/rydercup-prod/w_960,c_fit,q_auto,g_center,dpr_2.0,f_auto/rydercup/news/folder-6/tiger-woods-2010-ryder-cup-chip-fans.jpg',
    metaDescription: 'Dormie is a match play term meaning a player leads by as many holes as remain. Once dormie, you cannot lose the match. Here is the meaning, origin, and history.',
    seoKeywords:     ['dormie golf', 'what is dormie in golf', 'dormie meaning', 'match play golf term', 'dormie etymology'],
    xPostText:       'Dormie: a match play term meaning you lead by as many holes as remain to be played. Once dormie, you cannot lose. The word traces to either the French "dormir" (to sleep) or shy Scottish dormice. It also happens to be where our name comes from.',
    body: `Dormie is a match play term that means a player or side is leading by exactly as many holes as there are holes left to play. If you are three up with three holes to go, you are dormie. Two up with two to play, dormie. One up with one to play, dormie. The significance is simple and decisive: once you are dormie in a format where holes can be tied, you cannot lose the match. The worst you can do is tie, and any hole you win or halve from that point ends it.

The word only applies to match play, the format where golfers compete hole by hole rather than by total strokes. It has no meaning in stroke play, where the only number that matters is the final tally. In match play, dormie marks the moment the trailing player runs out of room. They must win every remaining hole just to force a tie, and any halve hands the match to the leader.

A Quick Example

Picture an 18-hole match. Golfer A leads Golfer B by two holes standing on the 17th tee. Two holes remain, the 17th and the 18th, and A is two up. A is dormie. For B to avoid losing, B must win both the 17th and the 18th. If B wins the 17th, the match goes to the 18th with A one up, still dormie. If A halves the 18th, the match is over and A wins. B never had control. From the moment the match went dormie, A held every card that mattered.

This is why the term carries a particular psychological weight in match play. Going dormie is not the same as winning, but it removes the possibility of losing, which changes how both players approach the closing holes. The leader can play with house money. The trailing player has to chase, and chasing in match play often means taking risks that backfire.

Where the Word Comes From

The honest answer is that nobody is certain. Most dictionaries list the etymology of dormie as unknown. The earliest known printed use dates to 1847, according to Merriam-Webster. But there are two leading theories, and both are worth knowing because they are part of the texture of the game's history.

The first and most widely accepted theory traces dormie to the French word dormir, meaning to sleep. This is the origin endorsed by the USGA Museum. The logic runs that a player who has gone dormie can metaphorically go to sleep, relax, and stop worrying, because the match can no longer be lost. Dormir, to sleep, becomes dormie, the state of being safe enough to rest. The French connection is plausible given the deep historical ties between France and Scotland, where golf grew up. There is even a related phrase, the dormie house, which historically referred to lodging at a golf club, literally a place to sleep, which lends the sleep theory some additional credence.

The second theory is more colorful and comes from The Historical Dictionary of Golf. It suggests dormie may have originated in Scotland, where dormice, small reclusive rodents, inhabited the heaths and coastal links where early golf was played. The dormice were extremely shy and tended to hide at the approach of golfers, so spotting one was considered a good omen, a sign of fortune. The argument is that being dormie up, where you cannot lose, carries the same sense of good luck as a dormouse sighting, in roughly the way a birdie came to be named for the old American slang sense of a bird as something excellent. It is a charming theory, and there is even a reference in an 1828 essay by Sir Walter Scott about golfers at Carnoustie peppering their conversation with the names of small rodents. Whether that proves anything is another matter.

There is also a popular legend, repeated often enough that it deserves mention even though historians give it little weight, that the term traces to Mary Queen of Scots. She spent much of her childhood in France, spoke French fluently, and is sometimes credited with carrying golf vocabulary from France to Scotland, including the word caddie. Crediting dormie to her is fun, but there is no real evidence beyond the fact that it makes a good story.

Dormie Was Removed From the Rules of Golf

Here is a detail that surprises even experienced golfers: dormie no longer appears in the official Rules of Golf. The term was removed in the major 2019 revision of the rules, part of a broad effort by the USGA and the R&A to modernize and simplify golf's language. In the same revision, halving a hole became tying a hole, the status of a match became the score of a match, and making a claim became asking for a ruling. Dormie was quietly retired alongside them.

The word still lives in common usage. Commentators say it, players say it, and golf writers use it constantly. But officially, it is no longer a defined term in the rulebook. It survives as a piece of golf's vernacular rather than its formal vocabulary, which is a fitting fate for a word whose origin nobody can pin down.

Where You Still Hear It

Dormie comes up most in the team match play events that keep the format alive at the highest level. In the Ryder Cup and the Solheim Cup, individual matches finish after 18 holes even when tied, which means a match can go dormie in the closing holes. The same is true in the group stages of professional match play events. In knockout formats where matches must produce a winner and go to extra holes if tied, dormie loses its meaning, because a tie is no longer a possible result and the trailing player is never fully out of room.

For most golfers, dormie is something you encounter in a club match, a weekend better-ball, or a casual match against a friend. The moment someone announces the match is dormie, the dynamic shifts. The leader exhales. The trailer presses. The closing holes get interesting.

Why DORMIED Cares About This Word

Full disclosure on the name: this publication is called DORMIED, and yes, the name comes from this exact term. We liked dormie for the same reason match play golfers respect it. It marks the moment the outcome becomes clear, the point where the data has spoken and the result is no longer in doubt. That is what we try to do with brand data: track the golf brand landscape closely enough that the moves become legible, the leaders become clear, and the story stops being a guess. A brand that has built an insurmountable lead in attention is, in a sense, dormie. The rest of the field is chasing, and chasing is hard.

So the next time someone tells you a match is dormie, you will know precisely what it means: the leader cannot lose, the trailer must win out just to tie, and somewhere in the history of the word there is either a French verb about sleeping or a very shy Scottish rodent. Golf has never been entirely sure which. We are comfortable with the ambiguity. We named ourselves after it.`,
  },

  // ── Article 2: What Is Students Golf? ───────────────────────────────────────
  {
    slug:            'what-is-students-golf',
    brandSlug:       'students-golf',
    secondarySlugs:  [],
    title:           'What Is Students Golf?',
    author:          'Adam',
    category:        'Trendy/Lifestyle',
    sourceUrl:       'https://www.golfdigest.com/story/students-golf-apparel-micheal-huynh',
    sourceName:      'Golf Digest',
    imageUrl:        'https://studentsgolf.com/cdn/shop/files/Students_Golf_Final_Selects_1.jpg?v=1765223481&width=1200',
    metaDescription: 'Students Golf is a Los Angeles apparel brand founded in 2021 by designer Michael Huynh, built around the witty, emotional experience of being an amateur golfer.',
    seoKeywords:     ['what is Students Golf', 'Students Golf brand', 'Students Golf Los Angeles', 'Michael Huynh golf apparel', 'streetwear golf brand'],
    xPostText:       'Students Golf is an LA apparel brand founded in 2021 by designer Michael Huynh. Its whole premise: you are a student of golf, a game that humbles everyone. Slogans like "Golf May Tear Us Apart" sell a feeling, not a lifestyle.',
    body: `Students Golf is a Los Angeles golf apparel brand founded in 2021 by fashion designer Michael Huynh. It sits in the streetwear-meets-golf category alongside brands like Malbon and Eastside Golf, but Students carves out its own lane with a witty, self-aware approach built around the emotional experience of being an amateur golfer. The brand's whole premise is in the name: you are a student of golf, a student of life, perpetually learning a game that humbles everyone who plays it.

Huynh is not a lifelong golfer, and that is the point. He came to the sport relatively late, is in his early forties, and brought two decades of streetwear and fashion experience to a category he felt was creatively stagnant. His business partner, Bryan Lowman, spent roughly twenty years at Stussy, one of the foundational streetwear labels. Between them, they have lived through multiple cycles of streetwear and understand how brand storytelling works in a way that most golf apparel companies do not. That fluency shows in everything Students makes.

The Emotional Angle

What separates Students from the rest of the streetwear-golf pack is its focus on the feelings golf produces rather than the lifestyle around it. The brand's recurring inspiration is what Huynh calls the emotional frustrations of golf, the way the game consumes you, beats you, gets the best of you, and yet keeps you coming back. Slogans like Swing Mechanics and Golf May Tear Us Apart capture a tone that is equal parts ironic and sincere. It is golf apparel that acknowledges golf is hard and a little absurd, which is a refreshing break from the aspirational perfection most golf brands sell.

The aesthetic started with graphic t-shirts and has matured into full cut-and-sew collections, the manufacturing approach favored by serious streetwear designers because it allows custom construction rather than printing on blank stock. The brand introduced its first collar in its third collection, a small milestone that signaled the move from pure graphic-tee startup to a more complete apparel offering covering shorts, trousers, hoodies, and pullovers.

The Inclusivity Mission

Students has been explicit from the start about wanting to make golf less exclusionary. Huynh frames the brand as a way to bring different cultures into the game rather than break tradition. He tells a story about a friend being asked to change out of a Fred Perry shirt at a desert course, which he found absurd given Fred Perry's own deep heritage. The brand's position is that you do not need golf ball motifs on your clothes for it to be golf, and you do not need to fit a narrow country club mold to belong on a course.

That positioning has earned Students coverage in fashion outlets that rarely touch golf, including Hypebeast and Highsnobiety, which is exactly the crossover reach that traditional golf brands struggle to achieve. Getting written about by streetwear media puts the brand in front of an audience that golf apparel has historically failed to convert.

The DORMIED Take

Students Golf is a small brand with an outsized cultural footprint relative to its size, which is the hallmark of a label that understands storytelling. The founder's fashion pedigree and Lowman's Stussy background give it a credibility in streetwear that a golf-first brand cannot manufacture. The risk for Students is the same one facing every brand in this category: the streetwear-golf space is getting crowded, and differentiation gets harder as Malbon, Eastside, Metalwood, Public Drip, and others compete for the same style-conscious customer.

What protects Students is the emotional angle. Most competitors sell a lifestyle or an aesthetic. Students sells a feeling that every golfer recognizes, the love-hate relationship with a game that never fully cooperates. That is a more durable hook than a color palette, and it is most of what makes Students worth watching as the category matures.`,
  },

  // ── Article 3: Where to Buy William Murray Golf ──────────────────────────────
  {
    slug:            'where-to-buy-william-murray-golf',
    brandSlug:       'william-murray-golf',
    secondarySlugs:  [],
    title:           'Where to Buy William Murray Golf',
    author:          'Adam',
    category:        'Trendy/Lifestyle',
    sourceUrl:       'https://www.eastsideatx.com/william-murray-best-golf-attire/',
    sourceName:      'EASTside Magazine',
    imageUrl:        'https://www.williammurraygolf.com/cdn/shop/articles/william-murray-golf-pga-show-2025-orlando_905x450.jpg?v=1738072569',
    metaDescription: 'Buy William Murray Golf at williammurraygolf.com, theChivery.com, and the brand\'s official Amazon storefront. Here is where to find the full collection.',
    seoKeywords:     ['where to buy William Murray Golf', 'William Murray Golf website', 'William Murray Golf Amazon', 'buy William Murray Golf online', 'William Murray Golf store'],
    xPostText:       'Where to buy William Murray Golf: the official site williammurraygolf.com has the full range, with theChivery and an official Amazon storefront as alternatives. Bill Murray\'s golf brand, built on not taking the game too seriously.',
    body: `William Murray Golf is sold primarily through its own website at williammurraygolf.com, which carries the full current collection of polos, button-downs, pants, outerwear, and accessories. Beyond the direct site, the brand is available through theChivery.com, the e-commerce arm of the Chive Media Group that co-created the brand, and on Amazon through the official William Murray Golf storefront. Select golf and lifestyle retailers also stock the line, though availability at third-party shops varies by season and region.

For most buyers, the direct website is the best starting point. It carries the widest selection, the newest drops, and the brand's signature loud prints and irreverent designs that sell out fastest. theChivery is the next most reliable source given the corporate relationship, and Amazon offers the convenience of Prime shipping for buyers who already live in that ecosystem, though the Amazon selection is typically narrower than the brand's own site.

What You Are Actually Buying

William Murray Golf is the apparel brand built around actor and comedian Bill Murray and his five brothers. The clothing reflects the Murray brothers' off-the-cuff, do-not-take-yourself-too-seriously attitude toward golf. Expect bold patterns, playful prints, and designs meant to stand out on a course full of plain navy polos, while still being made from legitimate performance fabrics with moisture-wicking and stretch. The brand's pitch is that golf can be fun and a little irreverent without disrespecting the game, and the product line delivers on that with pieces that photograph well and read as personality-forward rather than corporate.

The pricing sits in the mid-premium range for golf apparel, comparable to other lifestyle-forward brands. Polos generally land in the range you would expect from a premium golf shirt, with limited-edition and heavily printed pieces commanding more. The brand runs frequent seasonal drops and collaborations, so the catalog rotates and sought-after prints can disappear quickly.

A Note on Sizing and Returns

Because the brand sells largely direct-to-consumer and through partner sites rather than brick-and-mortar golf shops, you usually cannot try pieces on before buying. Check the brand's size guide before ordering, particularly for the polos and pants where fit preferences matter most. Buying through the official website or theChivery generally gives you the most straightforward return experience, since those channels are tied directly to the brand's own fulfillment.

The DORMIED Take

William Murray Golf has built a durable niche by attaching a genuinely beloved celebrity to a category that takes itself far too seriously. The Bill Murray association is not a licensing afterthought; the Murray brothers are involved, the brand voice reflects their sensibility, and the whole thing feels authentic rather than slapped together. That authenticity is why the brand has lasted nearly a decade and doubled its business repeatedly when many celebrity-attached apparel ventures fizzle within a few seasons.

For buyers, the practical answer is simple: start at williammurraygolf.com for the full selection, use theChivery or Amazon as alternatives, and move quickly on limited prints because the best designs do not stick around. The brand is a reliable pick for golfers who want their wardrobe to signal that they are out there to enjoy themselves.`,
  },

  // ── Article 4: What Is William Murray Golf? ──────────────────────────────────
  {
    slug:            'what-is-william-murray-golf',
    brandSlug:       'william-murray-golf',
    secondarySlugs:  [],
    title:           'What Is William Murray Golf?',
    author:          'Adam',
    category:        'Trendy/Lifestyle',
    sourceUrl:       'https://www.eastsideatx.com/william-murray-best-golf-attire/',
    sourceName:      'EASTside Magazine',
    imageUrl:        'https://www.williammurraygolf.com/cdn/shop/articles/Screen_Shot_2023-09-28_at_9.07.15_AM_905x450.png?v=1695910498',
    metaDescription: 'William Murray Golf is a lifestyle golf apparel brand built around Bill Murray and his brothers. Founded 2016, launched 2017, known for bold, irreverent designs.',
    seoKeywords:     ['what is William Murray Golf', 'William Murray Golf brand', 'Bill Murray golf apparel', 'William Murray Golf history', 'William Murray Golf founded'],
    xPostText:       'William Murray Golf is the apparel brand built around Bill Murray and his five brothers. Founded 2016 by two theCHIVE colleagues, launched 2017, based in East Austin. It sells fun in a category that mostly sells seriousness.',
    body: `William Murray Golf is a golf and lifestyle apparel brand built around actor Bill Murray and his five brothers. Founded in 2016 and launched in spring 2017, the brand makes polos, button-downs, pants, outerwear, and accessories defined by bold prints, playful designs, and an irreverent attitude toward a sport that often takes itself too seriously. It is headquartered in East Austin, Texas, and has grown into one of the more recognizable names in lifestyle golf apparel.

The brand was co-founded by Kerry Michaels and Brandon Barrett, who met while working together at theCHIVE, the entertainment website, back in 2015. The two shared a passion for golf and a similar sense of humor, and they developed a brand pitch with Bill Murray as the face. After some convincing and a chance encounter with Bill's brother Joel Murray, Michaels and Barrett struck a deal with Bill and the Murray brothers in 2016. The brand launched the following spring through a partnership with Resignation Media, the company behind theCHIVE, and the broader Chive Media Group.

The Murray Brothers Connection

The brand is not a licensing deal where a celebrity name is rented and forgotten. Bill Murray and his brothers are genuinely woven into the brand's identity. The Murray brothers grew up in the northern suburbs of Chicago caddying and playing golf, and all of them were inducted into the Caddie Hall of Fame. Their collective sensibility, loose, funny, unpretentious, but genuinely respectful of the game, is the creative foundation of everything the brand makes. The name William Murray comes from Bill's full name, and the brand voice channels the same charm that made Bill a beloved figure in golf circles, particularly through his long association with the Pebble Beach Pro-Am and his famously unscripted on-course antics.

The product reflects that personality. Where most golf apparel sells aspiration and seriousness, William Murray Golf sells fun. The prints are loud, the designs are conversation-starters, and the marketing leans into the idea that golf should be enjoyed rather than endured. The clothing is still built from real performance fabrics with moisture-wicking and stretch, so it functions as golf apparel, but the entire point is to look like you are having a better time than everyone else on the course.

The Business

The brand has raised roughly $7 million in funding over its life and reportedly doubled its business year over year through its growth phase. It operates as an internet-first, direct-to-consumer brand, selling through its own website, through theChivery, and through an official Amazon storefront, with select third-party retail distribution. The East Austin headquarters reflects the brand's identity as a culturally-aware operation rather than a traditional golf company, positioned closer to the lifestyle and entertainment world than to the equipment-driven golf industry.

The DORMIED Take

William Murray Golf occupies a specific and defensible position: it is the golf brand for people who want to signal that they do not take themselves too seriously. That sounds simple, but it is hard to execute authentically, and the brand pulls it off because the Murray connection is real. The brothers' genuine golf history and Bill's actual cultural standing give the brand a credibility that manufactured celebrity ventures lack.

The brand sits in the same broad lifestyle-golf category as Malbon, William Murray, and the streetwear-adjacent labels, but it competes on humor and personality rather than streetwear credibility or fashion-forward design. That is a narrower lane, but it is a durable one, because there will always be golfers who would rather be funny than fashionable. Nearly a decade in, the brand has proven the niche is real and sustainable.`,
  },

  // ── Article 5: What Is Public Drip Golf? ────────────────────────────────────
  {
    slug:            'what-is-public-drip-golf',
    brandSlug:       'public-drip',
    secondarySlugs:  [],
    title:           'What Is Public Drip Golf?',
    author:          'Adam',
    category:        'Trendy/Lifestyle',
    sourceUrl:       'https://linksmagazine.com/7-under-the-radar-golf-apparel-brands-to-know-in-2026/',
    sourceName:      'LINKS Magazine',
    imageUrl:        'https://cdn.shopify.com/s/files/1/0475/7218/9333/files/DSC07075.jpg?v=1679070587',
    metaDescription: 'Public Drip is a Brooklyn golf apparel brand founded in 2020 by Neil Tan, built for the public-course athlete with a menswear-rooted, sustainable approach.',
    seoKeywords:     ['what is Public Drip golf', 'Public Drip golf brand', 'Public Drip apparel', 'Neil Tan golf', 'Brooklyn golf brand'],
    xPostText:       'Public Drip is a Brooklyn golf apparel brand founded in 2020 by Neil Tan, built around the public-course athlete. Inspired by Van Cortlandt Park, the oldest public course in the US. Menswear restraint over streetwear loudness.',
    body: `Public Drip is a Brooklyn-based golf apparel brand founded in 2020 by Neil Tan. It is built around the idea of the public athlete, the golfer who plays municipal courses and public tracks rather than private clubs, and who values self-expression and versatility as much as performance. The brand blends the timeless forms of traditional menswear with the function of modern sportswear, producing pieces designed to move seamlessly from the golf course to the cafe, the park, and the rest of everyday life.

Tan founded the brand after getting back into golf and teeing it up at Van Cortlandt Park Golf Course in the North Bronx, the oldest public golf course in the United States. That setting is central to the brand's identity. Where most golf apparel is built around the aesthetics and exclusivity of the country club, Public Drip is an ode to public-course golf and the venues that open their doors to everyone. The brand name itself plays on that ethos, public access crossed with the streetwear sense of drip, meaning style.

The Menswear Influence

What sets Public Drip apart from the louder streetwear-golf brands is its restraint. The pieces are largely subdued in their aesthetic, with subtle accents rather than bold graphics. The signature Public Athlete Polo features a contrasting knitted spread collar inspired by classic Italian knit ties, with a four-button placket shaped to reference the brand's P logo. Knit collars echo traditional dress shirts. Tan has a clear affinity for menswear, and the design language reflects an effort to modernize the menswear roots of classic golf apparel rather than reject them.

That versatility is the core proposition. Tan has talked about loving the way dress shirts look but recognizing you cannot wear one every day, so he set out to build a line of menswear with enough range to dress up with a jacket or sweater and blend into a modern office, while also performing on the course. The pieces are made through a cut-and-sew method, the construction approach serious apparel designers favor, and increasingly use recycled materials, including polyester from recycled sources and graphic tees made from recycled fishing nets.

Collaborations and Growth

Public Drip has steadily raised its profile through collaborations and editorial coverage. It has been featured by Hypebeast multiple times and named among the rising brands changing golf. In 2025, the brand collaborated with LIV Golf's Cleeks Golf Club on a limited capsule unofficially titled Tradition, Refreshed, which paired the brand's recycled-material approach with a professional team's roster. In early 2026, Public Drip partnered with RepSpark, the leading business-to-business e-commerce platform in golf, to scale its wholesale operations and reach more retailers.

The DORMIED Take

Public Drip is one of the more thoughtful entries in the crowded streetwear-golf category precisely because it does not lean on streetwear loudness. The menswear restraint and the public-course ethos give it a point of view that feels earned rather than borrowed. Where Malbon channels Los Angeles streetwear energy and Students Golf sells the emotional comedy of the amateur game, Public Drip occupies the quieter, more design-driven menswear lane, closer to what Manors does in London but rooted in New York municipal golf culture.

The brand's commitment to recycled materials and its public-athlete positioning give it a clear identity that should age well as the broader category matures. The RepSpark wholesale partnership signals an ambition to grow beyond direct-to-consumer drops into broader retail distribution. Whether Public Drip can scale while keeping the understated identity that differentiates it is the open question, but the foundation is one of the more coherent in the category.`,
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

function stripEmDashes(text) {
  // Site-wide rule: no em dashes
  return text.replace(/—/g, ' - ');
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
 * - A block is an <h2> if it's a single short line (<=80 chars),
 *   doesn't end with punctuation, starts with a capital letter, and has >=2 words.
 * - Brand names are auto-linked first-occurrence-only, longest-name-first.
 */
function bodyToHtml(plainText, allBrands) {
  const blocks = stripEmDashes(plainText).split(/\n\n+/).map(b => b.trim()).filter(Boolean);
  const sortedBrands = [...allBrands].sort((a, b) => b.name.length - a.name.length);
  const linked = new Set();

  return blocks.map(block => {
    const isHeader = !block.includes('\n')
      && block.length <= 80
      && /^[A-Z]/.test(block)
      && !/[.!?,;:]$/.test(block)
      && block.split(/\s+/).length >= 2;

    if (isHeader) {
      return `<h2>${escHtml(block)}</h2>`;
    }

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
  if (!brandSlug) return null;
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
      signal: AbortSignal.timeout(20000),
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
    console.warn(`  [img] Image download/upload failed: ${err.message}`);
    return { supabaseUrl: null, localUrl: null };
  }
}

// ── HTML generator ────────────────────────────────────────────────────────────
// Matches the current generate-article.js template (v=20260522, LATEST sidebar,
// feed.min.js). Handles null brandSlug: omits brand widget, uses titleist.js
// as fallback data source for window.DORMIED_DATA (needed by feed.js LATEST widget).

function generateArticleHtml(opts) {
  const {
    title, bodyHtml, imageUrl, ogImageUrl, localUrl, imageAlt,
    slug, category, published_at, source_url, source_name,
    meta_description, seo_keywords,
    brandSlug, brandName, brandLogo, dataVersion,
    readTime, author, dormiedData,
    secondaryBrands = [],
  } = opts;

  const hasBrand = !!(brandSlug && brandName);

  // Brand metrics (only if hasBrand)
  const bInfo    = hasBrand ? getBrandInfo(dormiedData, brandSlug) : null;
  const bRank    = bInfo ? `#${bInfo.rank}` : '—';
  const bDi      = bInfo ? bInfo.di.toFixed(1) : '—';
  const bMom     = bInfo ? fmtPct(bInfo.momPct) : '—';
  const bT3m     = bInfo ? fmtPct(bInfo.t3m) : '—';
  const bT12m    = bInfo ? fmtPct(bInfo.t12m) : '—';
  const bMomCls  = bInfo && bInfo.momPct !== null ? ` ${pctClass(bInfo.momPct)}` : '';
  const bT3mCls  = bInfo && bInfo.t3m    !== null ? ` ${pctClass(bInfo.t3m)}` : '';
  const bT12mCls = bInfo && bInfo.t12m   !== null ? ` ${pctClass(bInfo.t12m)}` : '';

  // Secondary brand widgets
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

  // Brand card HTML (only rendered when hasBrand)
  let brandCardHtml = '';
  if (hasBrand) {
    const initials    = brandName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const logoFallback = `<span class=&quot;bp-logo-initials&quot; style=&quot;background:#1a2a1a;width:48px;height:48px;font-size:1rem&quot;>${escHtml(initials)}</span>`;
    const logoHtml     = brandLogo
      ? `<img src="${escHtml(brandLogo.replace(/sz=\d+/, 'sz=48'))}" alt="${escHtml(brandName)}" class="bp-logo-img" width="48" height="48" style="width:48px;height:48px" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${logoFallback}')">`
      : `<span class="bp-logo-initials" style="background:#1a2a1a;width:48px;height:48px;font-size:1rem">${escHtml(initials)}</span>`;
    brandCardHtml = `
            <!-- Brand card -->
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
            </div>`;
  }

  // "More on [Brand]" section (only when hasBrand)
  const moreBrandHtml = hasBrand
    ? `
            <!-- More on [Brand] -->
            <section class="da-bottom-section" id="da-more-brand-section" aria-labelledby="da-more-brand-heading" hidden>
              <h3 class="da-bottom-heading" id="da-more-brand-heading">More on ${escHtml(brandName)}</h3>
              <div id="da-more-brand-list" class="da-bottom-cards"></div>
            </section>`
    : '';

  // JSON-LD about entries
  const aboutEntries = [];
  if (hasBrand) aboutEntries.push(`{ "@type": "Organization", "name": "${escHtml(brandName)}", "url": "https://dormied.com/brands/${brandSlug}/" }`);
  secondaryBrands.forEach(b => aboutEntries.push(`{ "@type": "Organization", "name": "${escHtml(b.name)}", "url": "https://dormied.com/brands/${b.slug}/" }`));
  const aboutJson = aboutEntries.length ? `,\n    "about": [${aboutEntries.join(', ')}]` : '';

  // Brand data JS: use the brand's own file, or titleist.js as fallback for null-brand articles
  const dataScriptSlug = brandSlug || 'titleist';

  // Image HTML
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
  <link rel="stylesheet" href="/css/styles.css?v=20260522">
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
            <div class="da-article-body">
              ${bodyHtml}
            </div>
            ${brandCardHtml}
            ${secondaryBrandWidgets}
            ${moreBrandHtml}
          </div><!-- /sc-article-main -->
          <!-- Sidebar: LATEST widget -->
          <aside class="sidebar-ad-col">
            <!-- AD_UNIT:sidebar
            -->
            <section class="home-stories-section latest-feed-section" aria-labelledby="article-latest-heading">
              <h2 class="latest-feed-heading" id="article-latest-heading">Latest</h2>
              <div id="dormied-latest-list" class="latest-feed-list">
                <p class="latest-feed-loading">Loading&#x2026;</p>
              </div>
            </section>
          </aside>
        </div><!-- /table-layout -->
      </div><!-- /container -->
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
      <p class="footer-legal">&copy; <span id="footer-year"></span> DORMIED. Rankings are independent editorial content. No brand pays for placement or improved position on the DORMIED Index. All brand names and logos are property of their respective owners.</p>
    </div>
  </footer>
  <script>window.__DA_BRAND_SLUG__='${escHtml(brandSlug || '')}';window.__DA_ARTICLE_SLUG__='${escHtml(slug)}';</script>
  <script>document.getElementById('footer-year').textContent=new Date().getFullYear();</script>
  <script src="/js/analytics.min.js?v=20260320a"></script>
  <script src="/js/signup.min.js?v=20260324d"></script>
  <script src="/js/search.min.js?v=20260508"></script>
  <script src="/js/brand-data/${escHtml(dataScriptSlug)}.js?v=${escHtml(dataVersion)}"></script>
  <script src="/js/feed.min.js?v=20260717"></script>
  <script src="/js/da-article.min.js?v=20260522"></script>
  <!-- AD_SCRIPT
  -->
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

  console.log(`[inject] Loaded data.js -- ${dormiedData.brands.length} brands, currentMonth: ${dormiedData.meta.currentMonth}`);
  console.log(`[inject] dataVersion: ${dataVersion}`);
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

    // Primary brand (may be null for dormie article)
    let primaryBrand = null;
    if (art.brandSlug) {
      primaryBrand = dormiedData.brands.find(b => b.id === art.brandSlug);
      if (!primaryBrand) {
        console.error(`  [ERROR] Primary brand not found in data.js: ${art.brandSlug}`);
        console.error('  Pausing -- do NOT auto-create brand records. Fix and retry.');
        process.exit(1);
      }
    }

    const brandName = primaryBrand ? primaryBrand.name : '';
    const brandLogo = primaryBrand ? (primaryBrand.logo || '') : '';

    // Brands for auto-linker (only primary + secondary for this article)
    const allBrands = [
      ...(primaryBrand ? [{ slug: primaryBrand.id, name: primaryBrand.name }] : []),
      ...secondaryBrands.map(sb => ({ slug: sb.slug, name: sb.name })),
    ];

    // Upload image
    console.log(`  [img] Uploading hero image...`);
    const { supabaseUrl, localUrl } = await uploadImageToSupabase(supabase, art.imageUrl, art.slug);
    const finalImageUrl = supabaseUrl || art.imageUrl;
    const ogImageUrl    = localUrl || art.imageUrl || 'https://dormied.com/images/og-image.jpg';
    console.log(`  [img] ${supabaseUrl ? 'Supabase: ' + supabaseUrl : 'Fallback: ' + art.imageUrl}`);

    // Convert body to HTML
    const bodyHtml  = bodyToHtml(art.body, allBrands);
    const readTime  = estimateReadTime(art.body);
    const publishedAt = new Date().toISOString();

    // Write HTML file
    const articleDir = path.join(SITE_ROOT, 'news', art.slug);
    fs.mkdirSync(articleDir, { recursive: true });
    const imageAlt = primaryBrand ? `${primaryBrand.name} -- ${art.category}` : `${art.title}`;
    const html = generateArticleHtml({
      title:            art.title,
      bodyHtml,
      imageUrl:         finalImageUrl,
      ogImageUrl,
      localUrl,
      imageAlt,
      slug:             art.slug,
      category:         art.category,
      published_at:     publishedAt,
      source_url:       art.sourceUrl,
      source_name:      art.sourceName,
      meta_description: art.metaDescription,
      seo_keywords:     art.seoKeywords,
      brandSlug:        art.brandSlug,
      brandName,
      brandLogo,
      dataVersion,
      readTime,
      author:           art.author,
      dormiedData,
      secondaryBrands,
    });
    const htmlPath = path.join(articleDir, 'index.html');
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log(`  [html] Wrote news/${art.slug}/index.html (${Math.round(fs.statSync(htmlPath).size / 1024)}KB)`);

    // Verify no brand widget on null-brand article
    if (!art.brandSlug) {
      const brandWidgetCount = (html.match(/DORMIED INDEX/g) || []).length;
      if (brandWidgetCount > 0) {
        console.error(`  [ERROR] Dormie article contains "DORMIED INDEX" ${brandWidgetCount} time(s) -- should be 0!`);
        process.exit(1);
      }
      console.log(`  [verify] No brand widget confirmed (0 occurrences of "DORMIED INDEX")`);
    }

    // Supabase insert
    const { error: insertErr } = await supabase.from('dormied_articles').insert({
      matched_article_id:    null,
      brand_slug:            art.brandSlug || null,
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
      console.log(`  [db] Inserted to dormied_articles (brand_slug: ${art.brandSlug || 'NULL'}, status: published)`);
    }

    // Add to sitemap
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
    require('child_process').execSync('node scripts/generate-index-pages.js', { cwd: SITE_ROOT, stdio: 'inherit' });
  } catch (e) { console.warn('[inject] News index regen failed:', e.message); }

  console.log('\n[inject] ══ SUMMARY ══');
  results.forEach(r => console.log(`  ${r.ok ? '✓' : '✗'} /news/${r.slug}/`));
  console.log('\nNext steps:');
  console.log('  git add news/ sitemap.xml search-index.json news/index.html images/articles/');
  console.log('  git commit -m "Publish 5 SEO articles: dormie explainer + apparel brands"');
  console.log('  git push origin main');
}

main().catch(err => {
  console.error('[inject] Fatal:', err.message);
  process.exit(1);
});
