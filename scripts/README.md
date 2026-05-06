# DORMIED Content Pipeline — Scripts

## Generation overview

| Script | Output | Trigger |
|---|---|---|
| `generate-article.js` | `news/[slug]/index.html` | CI pipeline every 3 hours |
| `generate-brand-page.js` | `brands/[slug]/index.html` (169 pages) | Manual after monthly data update |
| `generate-index-pages.js` | `brands/`, `news/`, `scorecard/` index pages | Auto after article/brand generation; manual for scorecard |
| `generate-scorecard-page.js` | `scorecard/[slug]/index.html` | Manual after adding a new issue to `js/scorecard-data.js` |

All generators follow the same pattern:
- Read source data via Node's `vm.runInContext` (for `.js` data files) or Supabase (for article content)
- Write complete, self-contained HTML files to disk with all content visible as text
- Update `sitemap.xml` lastmod entries
- Support `--force` (regenerate all) and `--slug=` (single target) flags
- Mtime-based smart skip: if the output file is newer than its source, skip it

---

## Scorecard page generator

`generate-scorecard-page.js` — produces `scorecard/[slug]/index.html` for each monthly issue.

### Source data

All content lives in `js/scorecard-data.js` at `window.DORMIED_SCORECARD_DATA.issues`. Each issue object contains:

- `slug`, `title`, `subtitle`, `date`, `dateISO`, `monthLabel` — identity fields
- `images` — optional hero or strip images
- `toc` — ordered list of section IDs and labels for the table of contents
- `sections` — array of `{ id, heading, body }` objects; body is HTML string
- `indexSnapshot` — top-brand table for the issue's data month
- `brandMentions` — array of brand slugs that appear in the content

### Brand auto-linker

The auto-linker turns scorecard issues into internal link hubs (10–30 links per page to brand profile pages).

**How it works:**

1. At script start, `buildBrandNameMap(dormiedData)` builds a `{ slug → name }` lookup from `js/data.js`.
2. For each section, `autoLinkBrandsInSection(html, brandMentions, brandNameMap)` processes the body HTML using a regex tokenizer that separates text nodes from tags.
3. Brand names from the `brandMentions` array are sorted longest-first (so "TaylorMade Golf" matches before "TaylorMade") to avoid substring collisions.
4. The **first occurrence** of each brand name in each section is replaced with `<a href="/brands/[slug]/">[name]</a>`. Subsequent occurrences stay as plain text.
5. Existing `<a>` tags are skipped — the regex matches `(<a[\s>][\s\S]*?<\/a>)` as a pass-through token.

**Why per-section, not per-document:** linking once per section keeps each section self-contained for readers who jump directly to a section via the TOC. It also produces more links per page than once-per-document.

### Running it

```bash
# Regenerate only issues newer than their output files
npm run generate-scorecard

# Force-regenerate all issues
npm run generate-scorecard:force

# One issue only
node scripts/generate-scorecard-page.js --slug=april-2026

# Verify output
npm run verify:scorecard
```

### Adding a new issue

1. Add the new issue object to the **top** of the `issues` array in `js/scorecard-data.js` (newest first).
2. Run `npm run generate-scorecard`.
3. The generator writes `scorecard/[new-slug]/index.html`, updates sitemap.xml, and updates the "More from The Scorecard" cross-links in other issue pages (via --force or by touching the data file mtime).
4. Commit and push. Vercel deploys automatically.
5. Run `npm run verify:scorecard` to confirm the new page passes all checks.

### Vercel config

The `/scorecard/:slug` and `/scorecard/:slug/` rewrites are **removed** once static files exist. Vercel serves `scorecard/[slug]/index.html` directly. The `/scorecard/` and `/scorecard` rewrites (for the archive index page) are kept.

Cache headers: `/scorecard/(.+)/` → `Cache-Control: public, no-cache` (matches `/brands/(.+)/` pattern).

---

## Verify scripts

| Script | What it checks |
|---|---|
| `verify-brands.js` | Each brand has a static file; minimum content present |
| `verify-index-pages.js` | brands/, news/, scorecard/ index pages have static content and link counts |
| `verify-scorecard-pages.js` | Each scorecard issue page exists, >15KB, no fetch()/document.write, unique meta descriptions |

All three run in CI (`golf-wire-pipeline.yml`) and exit 1 on failure, blocking the commit step.
