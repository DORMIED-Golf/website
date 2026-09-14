'use strict';
/**
 * scripts/lib/seo-pages.js
 *
 * The pages a search engine can index, read from disk: every served .html file
 * that is not noindex, not a meta-refresh, not a vercel.json redirect source,
 * and whose canonical (if any) points at its own URL. The SEO gates check
 * exactly this set, so a template canonicalised elsewhere (brands/brand.html)
 * or a legacy stub behind a redirect is never mistaken for a live page.
 */

const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..', '..');
const ORIGIN = 'https://dormied.com';
const SKIP   = new Set(['node_modules', '.git', '.claude', '.vercel', 'scripts', 'prompts', 'eval-results', 'archive']);

function htmlFiles(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) htmlFiles(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
  }
  return out;
}

function urlFor(rel) {
  if (rel === 'index.html') return `${ORIGIN}/`;
  if (rel.endsWith('/index.html')) return `${ORIGIN}/${rel.slice(0, -'index.html'.length)}`;
  return `${ORIGIN}/${rel.slice(0, -'.html'.length)}`;
}

function redirectSources() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    return new Set((v.redirects || []).map(r => String(r.source || '').replace(/\/$/, '')));
  } catch { return new Set(); }
}

/** Text of an HTML fragment: tags stripped, common entities decoded, whitespace collapsed. */
function text(s) {
  return String(s || '').replace(/<[^>]+>/g, '')
    .replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/** Value of an attribute on a tag string, honouring either quote style. */
function attr(tag, name) {
  const m = String(tag).match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? text(m[1] !== undefined ? m[1] : m[2]) : null;
}

/** Headings in document order, ignoring scripts, styles, templates and comments. */
function headings(html) {
  const body = html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, '');
  return [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map(m => ({ level: Number(m[1]), text: text(m[2]) }));
}

function indexablePages() {
  const redirects = redirectSources();
  const pages = [];
  for (const file of htmlFiles()) {
    const rel  = path.relative(ROOT, file).split(path.sep).join('/');
    const url  = urlFor(rel);
    const html = fs.readFileSync(file, 'utf8');
    const head = html.split(/<\/head>/i)[0];
    if (redirects.has(url.slice(ORIGIN.length).replace(/\/$/, ''))) continue;
    if (/<meta[^>]+http-equiv=["']refresh/i.test(head)) continue;
    const robots = (head.match(/<meta[^>]+name=["']robots["'][^>]*>/i) || [])[0];
    if (robots && /noindex/i.test(attr(robots, 'content') || '')) continue;
    const canonTag  = (head.match(/<link[^>]+rel=["']canonical["'][^>]*>/i) || [])[0];
    const canonical = canonTag ? attr(canonTag, 'href') : null;
    if (canonical && canonical !== url) continue;
    pages.push({ rel, url, html, head, canonical });
  }
  return pages;
}

module.exports = { ROOT, ORIGIN, indexablePages, headings, attr, text };
