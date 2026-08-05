'use strict';
/**
 * scripts/lib/article-slug.js
 *
 * Builds the URL slug for a pipeline article.
 *
 * History. The original version slugified the whole editorial headline to 75
 * characters and appended the publish date. The first fix dropped the date and
 * capped the word count, which helped, but it was still TRUNCATING the headline
 * rather than EXTRACTING its subject, so slugs kept landing on a dangling word:
 *
 *   sun-mountain-hired-joel-dahmen-star             ends on a verb
 *   adidas-golf-priced-spikeless-shoe-like          ends on a preposition
 *   foresight-sports-important-club-mygolfspys-slow ends on an adjective
 *   cleveland-golf-588-grind-back-19999             "19999" is $199.99 mangled
 *
 * This version works the other way round: it takes the brand, then the proper
 * nouns and topic nouns from the headline, and refuses to end on anything that
 * is not a noun. The editorial headline is never altered; it remains the H1 and
 * the title tag. Only the slug is derived.
 */

// Dropped wherever they appear. Articles, prepositions, conjunctions,
// auxiliaries and the filler adverbs headlines lean on.
const DROP_ANYWHERE = new Set([
  'a','an','the','and','or','but','nor','so','yet','if','then','because',
  'in','on','at','to','for','of','with','by','from','into','onto','off','out',
  'up','down','over','under','across','against','about','after','before',
  'between','through','during','without','within','than','as','like','via',
  'is','are','was','were','be','been','being','am','isnt','arent','wasnt',
  'has','have','had','hasnt','havent','do','does','did','dont','doesnt',
  'will','wont','would','could','should','can','cant','may','might','must',
  'it','its','he','she','they','them','their','his','her','our','your','you',
  'this','that','these','those','there','here','what','which','who','whom',
  'just','now','still','already','finally','quietly','actually','really',
  'very','more','most','less','least','much','many','too','also','even',
  'thats','whats','heres','theres','no','not','never','always',
  // number words and headline scaffolding that carry no search intent
  'one','two','three','four','five','six','seven','eight','nine','ten',
  'part','reason','thing','things','way','ways','point','news','story',
  'nobody','everyone','anyone','someone','something','anything',
  'vs','versus','v','plus','per','amid','despite','among','toward','towards',
]);

// Verbs and adjectives are removed wherever they appear, not just blocked from
// the final position. NON_TERMINAL below is the safety net for anything that
// slips through; this set is the primary filter.
const DROP_VERBS_ADJECTIVES = new Set([
  'hired','hires','sold','sells','selling','priced','prices','keeps','kept',
  'killing','killed','kills','picking','picked','picks','moved','moves','moving',
  'won','wins','winning','bet','bets','betting','puts','putting','stopped',
  'stops','buying','buys','bought','drafts','drafted','launched','launching',
  'added','adds','adding','cuts','cutting','wore','wears','made','makes',
  'making','learns','learned','opens','opened','opening','turns','turned',
  'built','builds','building','said','says','saying','goes','going','went',
  'gets','getting','got','takes','taking','took','gives','giving','gave',
  'comes','coming','came','runs','running','ran','brings','bringing','brought',
  'holds','holding','held','leads','leading','led','shows','showing','showed',
  'tells','telling','told','wants','wanted','needs','needed','uses','using',
  'star','starring','starred','answers','proves','proved','means','meant',
  'looks','looking','admits','admitted','returns','returning','returned',
  'enters','entering','sits','sitting','beat','beats','beating','earn','earns',
  'get','buy','sell','win','hit','wear','bring','hold','come','keep','pick',
  'kill','move','hire','learn','prove','mean','admit','enter','answer','tell',
  'need','want','look','show','lead','give','take','make','build','turn','open',
  'slow','fast','quick','important','real','actual','own','whole','new','old',
  'best','worst','biggest','smallest','quiet','loud','big','small','cheap',
  'expensive','premium','free','next','last','first','second','third','only',
  'same','different','better','worse','higher','lower','longer','shorter',
  'entire','single','double','full','half','worth','right','wrong','hard','easy',
  'back','ahead','away','again','instead','anyway','already',
]);

// May appear inside a slug but must never END one. Verbs, adjectives and the
// adverbs that read as fragments when they land last.
const NON_TERMINAL = new Set([
  // verbs seen in real DORMIED headlines
  'hired','sold','sells','selling','priced','prices','pricing','keeps','kept',
  'killing','killed','kills','picking','picked','picks','moved','moves','moving',
  'won','wins','winning','bet','bets','betting','put','puts','putting',
  'stopped','stops','buying','buys','bought','drafts','drafted','launched',
  'launching','added','adds','adding','cut','cuts','cutting','wore','wears',
  'made','makes','making','learns','learned','opens','opened','opening',
  'turns','turned','built','builds','building','said','says','saying',
  'goes','going','went','gets','getting','got','takes','taking','took',
  'gives','giving','gave','comes','coming','came','runs','running','ran',
  'brings','bringing','brought','holds','holding','held','leads','leading',
  'led','shows','showing','showed','tells','telling','told','wants','wanted',
  'needs','needed','uses','using','used','star','starring','starred',
  'answers','answered','proves','proved','means','meant','looks','looking',
  'admits','admitted','returns','returning','returned','enters','entering',
  'sits','sitting','sat','wants','beat','beats','beating','earn','earns',
  // adjectives and adverbs that read as fragments when last
  'slow','fast','quick','important','real','actual','own','whole','new','old',
  'best','worst','biggest','smallest','quiet','loud','big','small','cheap',
  'expensive','premium','free','next','last','first','second','third','only',
  'same','different','better','worse','higher','lower','longer','shorter',
  'entire','single','double','full','half','worth','right','wrong','hard','easy',
]);

// Nouns that look like verbs or adjectives but are the subject in golf copy.
// Whitelisted so the noun-ending rule does not strip a legitimate topic word.
const TOPIC_NOUNS = new Set([
  'grind','drive','driver','drivers','test','tests','testing','price','pricing',
  'sale','sales','launch','deal','deals','watch','business','software','hardware',
  'documentary','shoe','shoes','club','clubs','cup','event','events',
  'bag','bags','wedge','wedges','putter','putters','iron','irons','ball','balls',
  'glove','gloves','headcover','cover','brand','store','line','series','review',
  'reviews','data','share','spikes','shaft','shafts','grip','grips',
  'apparel','collab','collaboration','partnership','sponsorship','contract',
  'rankings','ranking','index','study','report','patent','lawsuit','refresh',
  'collection','drop','model','models','lineup','range','set','sets','fitting',
  'hybrid','hybrids','fairway','wood','woods','loft','bounce','sole','face',
  'markdown','discount','revenue','margin','retail','wholesale','tech','design',
]);


// Product descriptors. ALWAYS retained: they bypass the adjective drop, the
// -ing/-ed/-ly morphology rejection, and they count as valid terminal tokens.
//
// The distinction is editorial adjective versus product descriptor. "Important",
// "quiet" and "new" express the writer's opinion and go. "Spikeless", "forged"
// and "milled" are what a shopper types, and dropping them cost the two slugs
// their primary search term: "adidas spikeless golf shoe" is the query, and
// PXG sells Sugar Daddy and Sugar Daddy Milled as different products.
//
// Rule for future additions: if a shopper would type it when searching for the
// product, keep it. If it only expresses an opinion, leave it out.
const KEEP_DESCRIPTORS = new Set([
  'spikeless','waterproof','adjustable','forged','milled','cast','rusting',
  'insulated','hollow','hybrid','blade','blades','cavity','mallet',
  'counterbalanced','oversized','midsize','jumbo','lightweight','graphite',
  'steel','urethane','surlyn','cashmere','merino','seamless','tapered',
  'cropped','quilted','limited','anodised','anodized','brushed','weighted',
  'stamped','knit','woven','vented','perforated','recycled','stretch',
  'armlock','broomstick','centre-shafted','face-balanced','toe-hang',
]);

// Multi-word descriptors. tokenize() splits on hyphens, so these are detected
// in the raw headline first and their parts whitelisted for that call only.
// That keeps "slow" when it is part of "Slow-Swing" without resurrecting bare
// "slow" as an adjective anywhere else.
const KEEP_HYPHENATED = [
  'slow-swing','low-spin','high-launch','high-spin','low-launch','zero-torque',
  'tour-issue','tour-only','players-distance','game-improvement','max-forgiveness',
  'soft-feel','deep-face','low-profile','high-moi','center-shafted',
];

const CURRENCY = /[$£€¥]\s?\d[\d.,]*(?:\s?(?:million|billion|m|bn|k))?/gi;

const tokenize = str => String(str || '')
  .toLowerCase()
  .replace(/[’']/g, '')
  .replace(/[^a-z0-9\s-]/g, ' ')
  .split(/[\s-]+/)
  .filter(Boolean);

const singular = w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** True when a token is acceptable as the final word of a slug. */
function isTerminal(token, extraKeep) {
  if (KEEP_DESCRIPTORS.has(token) || (extraKeep && extraKeep.has(token))) return true;
  if (TOPIC_NOUNS.has(token) || TOPIC_NOUNS.has(singular(token))) return true;
  if (NON_TERMINAL.has(token) || DROP_ANYWHERE.has(token)) return false;
  // Morphology: participles and adverbs are never the subject.
  if (/(?:ing|ly)$/.test(token) && token.length > 5) return false;
  if (/ed$/.test(token) && token.length > 4) return false;
  return true;
}

/**
 * Proper-noun phrases from the headline: capitalised runs, ignoring a word that
 * is only capitalised because it starts the headline or follows a full stop.
 * This is what keeps "Joel Dahmen" and "Presidents Cup" intact.
 */
function properNounTokens(title) {
  const out = [];
  const cleaned = String(title || '').replace(CURRENCY, ' ');
  const sentences = cleaned.split(/(?<=[.!?:])\s+/);
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((raw, i) => {
      const bare = raw.replace(/[^A-Za-z0-9’'-]/g, '');
      if (!bare || i === 0) return;                       // skip sentence-initial
      if (!/^[A-Z]/.test(bare)) return;
      out.push(...tokenize(bare));
    });
  }
  return out;
}

/**
 * @param {string} title      the editorial headline, never modified
 * @param {string} dateStr    ISO publish date, used only as a last-resort suffix
 * @param {string} brandName  the article's primary brand, so the slug leads with
 *                            it even when the headline does not
 * @param {(s:string)=>boolean} isTaken  collision check against existing slugs
 */
function makeSlug(title, dateStr, brandName = '', isTaken = () => false) {
  const MAX_WORDS = 6;
  const MIN_WORDS = 3;

  const brand = tokenize(brandName);
  const seen  = new Set();
  for (const b of brand) { seen.add(b); seen.add(singular(b)); }

  const headline = String(title || '').replace(CURRENCY, ' ');
  const proper   = new Set(properNounTokens(title));

  // Hyphenated descriptors present in this headline, whitelisted for this call.
  const extraKeep = new Set();
  const lowerTitle = headline.toLowerCase();
  for (const phrase of KEEP_HYPHENATED) {
    if (lowerTitle.includes(phrase)) for (const part of phrase.split('-')) extraKeep.add(part);
  }
  const isKeeper = w => KEEP_DESCRIPTORS.has(w) || extraKeep.has(w);

  // Only the first sentence is considered. DORMIED headlines put the story in
  // sentence one and an aside in sentence two ("About Bags.", "That's the
  // Actual News."), and the aside is never what the slug should be about.
  const firstSentence = headline.split(/(?<=[.!?])\s+/)[0] || headline;

  // Content words: everything that is not scaffolding, a verb or an adjective.
  // A product descriptor overrides the adjective drop.
  const content = [];
  for (const w of tokenize(firstSentence)) {
    if (seen.has(w) || seen.has(singular(w))) continue;
    if (!isKeeper(w) && (DROP_ANYWHERE.has(w) || DROP_VERBS_ADJECTIVES.has(w))) continue;
    seen.add(w); seen.add(singular(w));
    content.push(w);
  }

  // The topic noun anchors the end. Take the LAST one in the sentence: headlines
  // open with a generic noun ("The Most Important Club in ...") and land on the
  // specific one ("... Driver Test").
  let topicIdx = -1;
  content.forEach((w, i) => {
    if (TOPIC_NOUNS.has(w) || TOPIC_NOUNS.has(singular(w))) topicIdx = i;
  });

  // Body is drawn from the words before the topic. Model numbers and product
  // descriptors are always kept; everything else contributes at most the two
  // words nearest the topic. Headline order is preserved throughout, so the
  // slug still reads like the story.
  let rest;
  if (topicIdx >= 0) {
    const before = content.slice(0, topicIdx);
    const room   = Math.max(0, MAX_WORDS - brand.length - 1);

    // Model numbers and product descriptors claim the available room first;
    // whatever is left goes to the ordinary words nearest the topic. Trimming
    // by position alone dropped "rusting" from "$1,600 Rusting Blade".
    const priority = before.map((w, i) => i).filter(i => /^\d+$/.test(before[i]) || isKeeper(before[i]));
    const kept     = priority.slice(0, room);
    const normal   = before.map((w, i) => i).filter(i => !priority.includes(i));
    const filler   = normal.slice(-Math.max(0, room - kept.length));

    const chosen = [...kept, ...filler].sort((a, b) => a - b).map(i => before[i]);
    rest = chosen.concat(content[topicIdx]);
  } else {
    rest = content.slice(0, Math.max(0, MAX_WORDS - brand.length));
  }

  // Never end on a verb, preposition, article or adjective.
  while (rest.length && !isTerminal(rest[rest.length - 1], extraKeep)) rest.pop();

  let words = [...brand, ...rest];
  // Brand-only would collide with the brand page's own naming, so fall back to
  // the first terminal-safe content word rather than emitting it.
  if (words.length < Math.min(MIN_WORDS, brand.length + 1) || rest.length === 0) {
    const extra = tokenize(headline).find(w =>
      !seen.has(w) && !DROP_ANYWHERE.has(w) && isTerminal(w, extraKeep));
    if (extra) words = [...brand, extra];
  }

  let base = words.join('-').replace(/^-+|-+$/g, '');
  if (!base) base = `article-${String(dateStr).slice(0, 10)}`;

  if (!isTaken(base)) return base;
  for (let n = 2; n <= 9; n++) {
    if (!isTaken(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${String(dateStr).slice(0, 10)}`;
}

module.exports = { makeSlug, isTerminal, KEEP_DESCRIPTORS, KEEP_HYPHENATED, DROP_VERBS_ADJECTIVES, TOPIC_NOUNS, NON_TERMINAL, DROP_ANYWHERE };
