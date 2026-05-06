#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   scripts/verify-index-pages.js
   Validates that /brands/, /news/, /scorecard/ index pages contain static
   pre-rendered content for crawlers.

   Exits 0 on success, 1 on failure.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let errors = 0;

function check(label, value, min) {
  if (typeof value === 'boolean') {
    if (!value) {
      console.error(`  ✖  ${label}`);
      errors++;
    } else {
      console.log(`  ✔  ${label}`);
    }
  } else {
    if (value < min) {
      console.error(`  ✖  ${label}: got ${value}, need ≥ ${min}`);
      errors++;
    } else {
      console.log(`  ✔  ${label}: ${value}`);
    }
  }
}

function countMatches(html, pattern) {
  return (html.match(pattern) || []).length;
}

/* ── brands/index.html ─────────────────────────────────────────────────── */
console.log('\n── brands/index.html ──────────────────────────────────────');
{
  const filePath = path.join(ROOT, 'brands/index.html');
  if (!fs.existsSync(filePath)) {
    console.error('  ✖  File not found: brands/index.html');
    errors++;
  } else {
    const html = fs.readFileSync(filePath, 'utf8');
    check('h1 text "The Field"',    html.includes('id="brands-title"') && html.includes('>The Field<'), true);
    check('meta description present', html.includes('<meta name="description"'), true);
    check('brand card links (>100)', countMatches(html, /<a href="\/brands\/[^"]+\/" class="brand-dir-card"/g), 100);
    check('brand-dir-rank spans',    countMatches(html, /class="brand-dir-rank"/g), 100);
    check('brand-dir-di spans',      countMatches(html, /class="brand-dir-di"/g), 100);
  }
}

/* ── news/index.html ───────────────────────────────────────────────────── */
console.log('\n── news/index.html ────────────────────────────────────────');
{
  const filePath = path.join(ROOT, 'news/index.html');
  if (!fs.existsSync(filePath)) {
    console.error('  ✖  File not found: news/index.html');
    errors++;
  } else {
    const html = fs.readFileSync(filePath, 'utf8');
    check('h1 text "The Feed"',      html.includes('id="feed-title"') && html.includes('>The Feed<'), true);
    check('meta description present', html.includes('<meta name="description"'), true);
    check('article links (>20)',      countMatches(html, /href="\/news\/[^"]+\/"/g), 20);
    check('feed-entry articles (>20)', countMatches(html, /class="feed-entry"/g), 20);
    check('feed-page.min.js present',  html.includes('feed-page.min.js'), true);
  }
}

/* ── news/page/2–5 ─────────────────────────────────────────────────────── */
for (let p = 2; p <= 5; p++) {
  const filePath = path.join(ROOT, `news/page/${p}/index.html`);
  console.log(`\n── news/page/${p}/index.html ${'─'.repeat(40 - String(p).length)}`);
  if (!fs.existsSync(filePath)) {
    console.error(`  ✖  File not found: news/page/${p}/index.html`);
    errors++;
  } else {
    const html = fs.readFileSync(filePath, 'utf8');
    check('article links (>3)',      countMatches(html, /href="\/news\/[^"]+\/"/g), 3);
    check('NO feed-page.min.js',     !html.includes('feed-page.min.js'), true);
    check('rel prev/next present',   html.includes('rel="prev"') || html.includes('rel="next"'), true);
    check(`canonical /news/page/${p}/`, html.includes(`/news/page/${p}/`), true);
  }
}

/* ── scorecard/index.html ──────────────────────────────────────────────── */
console.log('\n── scorecard/index.html ───────────────────────────────────');
{
  const filePath = path.join(ROOT, 'scorecard/index.html');
  if (!fs.existsSync(filePath)) {
    console.error('  ✖  File not found: scorecard/index.html');
    errors++;
  } else {
    const html = fs.readFileSync(filePath, 'utf8');
    check('h1 text "The Scorecard"', html.includes('id="sc-archive-title"') && html.includes('>The Scorecard<'), true);
    check('meta description present', html.includes('<meta name="description"'), true);
    check('/scorecard/ links (≥2)',  countMatches(html, /href="\/scorecard\/[^"]+\/"/g), 2);
    check('scorecard-entry present (≥2)', countMatches(html, /class="scorecard-entry"/g), 2);
    check('read-more links (≥2)',         countMatches(html, /class="read-more"/g), 2);
  }
}

/* ── sitemap.xml ────────────────────────────────────────────────────────── */
console.log('\n── sitemap.xml ─────────────────────────────────────────────');
{
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    const xml = fs.readFileSync(sitemapPath, 'utf8');
    check('/brands/ in sitemap',    xml.includes('<loc>https://dormied.com/brands/</loc>'), true);
    check('/news/ in sitemap',      xml.includes('<loc>https://dormied.com/news/</loc>'), true);
    check('/scorecard/ in sitemap', xml.includes('<loc>https://dormied.com/scorecard/</loc>'), true);
    check('/news/page/2/ in sitemap', xml.includes('<loc>https://dormied.com/news/page/2/</loc>'), true);
  } else {
    console.warn('  ⚠  sitemap.xml not found — skipping sitemap checks');
  }
}

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(56));
if (errors > 0) {
  console.error(`✖  ${errors} check(s) failed`);
  process.exit(1);
} else {
  console.log('✔  All index page checks passed');
}
