'use strict';
/**
 * scripts/lib/link-entities.js
 *
 * Auto-links the first mention of every DORMIED-tracked brand and every WITB
 * player with a page, in article and feature bodies.
 *
 * Articles used to link only the brands the wire matcher attached to the story
 * (primary + secondary), so a putter piece naming L.A.B., Odyssey, TaylorMade
 * and Bettinardi linked Wilson alone, and no article linked a player at all.
 *
 * Targets are read from disk, so this works identically in the pipeline and in
 * a local re-bake: brands from js/data.js, players from the h1 of every
 * witb/players/<slug>/index.html that exists (a link never points at a page
 * that is not there).
 *
 * Rules
 *   - First occurrence only, per entity, across the whole body.
 *   - Case-sensitive, whole-word, never inside an existing link or a tag.
 *   - The story's own brands (primary/secondary) link first.
 *   - Brand names that are ordinary English words ("Vessel", "Hedge",
 *     "Honors") link only when they are the story's own brand, so a sentence
 *     starting "Honors aside" never becomes a link.
 *   - "Wilson" is not linked when it directly follows a capitalised word, so
 *     a player called Mark Wilson is not sent to the Wilson brand page.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

const GENERIC_BRAND_WORDS = new Set([
  'Hedge', 'Honors', 'Municipal', 'Vessel', 'Pinnacle', 'Kraken', 'Rhone', 'Oban',
  'Extracurricular', 'Fiori',
]);
const SURNAME_BRANDS = new Set(['Wilson']);
// "<X> Golf" brands whose bare name is unambiguous in golf copy. Deliberately
// excludes stems that are places, people, other companies or plain words
// (Cleveland, Ben Hogan, McLaren, Mitsubishi, Barstool, Head, Vice, Sunday...).
const SHORT_FORM_OK = new Set([
  'Adidas', 'Arccos', 'Avoda', 'Bonobos', 'Bridgestone', 'Bushnell', 'Calliope', 'Devereux', 'Edel',
  'Forden', 'Garmin', 'Good Good', 'KBS', 'Kirkland', 'Krank', 'L.A.B.', 'LAZRUS', 'Lululemon', 'Macade',
  'Maejer', 'Miura', 'New Balance', 'Nike', 'Oakley', 'Odyssey', 'Ogio', 'Payntr', 'PowerBilt',
  'Precision Pro', 'Puma', 'Radry', 'Snell', 'Takomo', 'Toulon', 'TPT', 'Under Armour', 'Zire',
]);

function unescapeHtml(s) {
  return String(s).replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let cached = null;

/** { brands: [{slug, name}], players: [{slug, name}] } from the working tree. */
function loadLinkTargets(root = ROOT) {
  if (cached) return cached;
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8'), ctx);
  const brands = ((ctx.window.DORMIED_DATA || {}).brands || [])
    .filter(b => b.id && b.name && fs.existsSync(path.join(root, 'brands', b.id, 'index.html')))
    .map(b => ({ slug: b.id, name: b.name }));

  const players = [];
  const dir = path.join(root, 'witb', 'players');
  for (const slug of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const file = path.join(dir, slug, 'index.html');
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, 'utf8').match(/<h1[^>]*id="player-title"[^>]*>([^<]+)<\/h1>/);
    const name = m && unescapeHtml(m[1]).trim();
    if (name && /\s/.test(name)) players.push({ slug, name });
  }
  cached = { brands, players };
  return cached;
}

/**
 * A per-body linking context. primarySlugs are the story's own brands.
 * `escaped` means the HTML being linked has already been entity-escaped
 * (features escape before linking; articles do not).
 */
function createLinkContext({ primarySlugs = [], extraBrands = [], escaped = false, targets = loadLinkTargets() } = {}) {
  const primary = new Set(primarySlugs.filter(Boolean));
  // The story's own brands always link, even one too new to be in js/data.js yet.
  const known = new Set(targets.brands.map(b => b.slug));
  const brands = targets.brands.concat(extraBrands.filter(b => b && b.slug && b.name && !known.has(b.slug)));
  const brandNames = new Set(brands.map(b => b.name));
  const brandEntries = brands
    .filter(b => primary.has(b.slug) || !GENERIC_BRAND_WORDS.has(b.name))
    .map(b => ({ key: `b:${b.slug}`, name: b.name, href: `/brands/${b.slug}/`, cls: 'da-brand-link', primary: primary.has(b.slug) }));
  // "Odyssey" for Odyssey Golf: the short form shares the brand's key, so
  // whichever appears first links and the other does not link again.
  const aliasEntries = brandEntries
    .filter(e => / Golf$/.test(e.name) && SHORT_FORM_OK.has(e.name.replace(/ Golf$/, '')))
    .map(e => ({ ...e, name: e.name.replace(/ Golf$/, '') }));
  // "Pins and Aces" is written "Pins & Aces" in copy, and the reverse.
  for (const e of brandEntries) {
    const swapped = e.name.includes(' and ') ? e.name.replace(/ and /g, ' & ')
      : e.name.includes(' & ') ? e.name.replace(/ & /g, ' and ') : null;
    if (swapped) aliasEntries.push({ ...e, name: swapped });
  }
  const entries = [
    ...brandEntries,
    ...aliasEntries,
    ...targets.players
      .filter(p => !brandNames.has(p.name))
      .map(p => ({ key: `p:${p.slug}`, name: p.name, href: `/witb/players/${p.slug}/`, cls: 'da-player-link', primary: false })),
  ];
  entries.sort((a, b) => (b.primary - a.primary) || (b.name.length - a.name.length));
  for (const e of entries) {
    const shown = escaped ? escapeHtml(e.name) : e.name;
    const pat = shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A capitalised word right before "Wilson" is a first name ("Mark Wilson").
    // No period in that class: a sentence ending "Bettinardi. Wilson" is not one.
    const before = SURNAME_BRANDS.has(e.name) ? '(?<![\\w/"\\-&])(?<![A-Z][\\w\']*\\s)' : '(?<![\\w/"\\-&])';
    e.re = new RegExp(`${before}${pat}(?![\\w"\\-])`);
    e.shown = shown;
  }
  return { entries, linked: new Set() };
}

/** Links first mentions in html (text nodes only), mutating ctx.linked. */
function autoLinkEntities(html, ctx) {
  if (!ctx || !html) return html;
  for (const e of ctx.entries) {
    if (ctx.linked.has(e.key)) continue;
    let done = false;
    html = html.replace(/(<a[\s>][\s\S]*?<\/a>)|(<[^>]+>)|([^<]+)/g, (match, anchor, tag, text) => {
      if (done || anchor || tag || !text) return match;
      if (!e.re.test(text)) return match;
      done = true;
      return text.replace(e.re, `<a href="${e.href}" class="${e.cls}">${e.shown}</a>`);
    });
    if (done) ctx.linked.add(e.key);
  }
  return html;
}

module.exports = { loadLinkTargets, createLinkContext, autoLinkEntities, GENERIC_BRAND_WORDS };
