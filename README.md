# DORMIED

Golf's brand desk. 215 brands. 10 markets. Ranked monthly by real search data.

**Live site:** [dormied.com](https://dormied.com)
**Stack:** Vanilla HTML/CSS/JS · Vercel · Supabase · Beehiiv · Anthropic · Impact / CJ

---

## Read this first

**The repository IS the deployed artifact.** Vercel serves the committed HTML
directly. No build step, no framework. A bad commit is a bad site, which is why
generators write files into the repo and checks run on push.

**Pages are generated, not hand-written.** Almost every `index.html` under
`brands/`, `news/`, `witb/` and `scorecard/` comes from a script in `scripts/`.
Editing built HTML works until the next regeneration silently overwrites it.
Change the generator instead.

Four hand-authored articles are the exception — their full HTML lives in the
committed page rather than the database. They are listed in `PROTECTED_SLUGS` in
`scripts/generate-article.js`, and `--regenerate-all` skips them on purpose:
regenerating one collapses its body to a single line.

**Two hand-maintained stylesheets.** `css/styles.css` and `css/styles.min.css`
are both edited by hand — nothing derives one from the other — and different page
families load different files. A rule added to only one is invisible wherever
the other is loaded, and the page still renders, just unstyled. That shipped
twice before `npm run verify:css` existed. **Add rules to both.**

**`sitemap.xml` is generated.** Do not hand-edit it; run
`npm run regenerate:sitemap`. It derives `lastmod` from content sources only and
never falls back to `now()` or file mtime.

**The data bundles are built, and their cache buster is derived.** `js/data.js`
is the source of truth; `js/data.min.js`, `js/data-home.js` and every
`js/brand-data/*.js` are built from it and committed. Editing `data.js` without
rebuilding them changes nothing a reader sees — 241 pages load `data.min.js`,
not `data.js`. The `?v=` on those files comes from `meta.lastUpdated` via
`scripts/lib/data-version.js`, so bumping that field is what invalidates the
cache. It was hardcoded in three generators once, and a 215-brand bundle shipped
behind a `?v=` from the 175-brand era; at `max-age=604800` that is a week of
readers on the old brand set.

---

## What runs on its own

| Workflow | Schedule | What it does |
|---|---|---|
| `golf-wire-pipeline` | every 3h | Scrapes wires + pressrooms, matches brands, writes articles with Opus, publishes, re-bakes news index, homepage and sidebar modules |
| `affiliate-catalog-sync` | daily 08:00 | Impact, then Shopify merchant-feed, then CJ — each fails the job loudly rather than going stale quietly |
| `witb-weekly-crawl` | Tue 13:00 | Crawls tour bags, refreshes OWGR, rebuilds every WITB page |
| `post-to-x` | every 30m | Posts published articles to X |
| `verify-build` | push + PR | CSS parity + sitemap resolution — the only workflow gating a commit |

`main` moves on its own every 3 hours. If a push is rejected, **rebase rather
than merge**: the pipeline only touches generated output, so re-running the
generators on top of `origin/main` beats resolving conflicts in built HTML.

---

## Affiliate system

Three ingestion paths write into one `affiliate_products` table, distinguished by
a `source` column. **Each source's deactivation sweep is scoped to its own rows**,
so they can never deactivate each other's.

| Source | Script | Programs | Where the link comes from |
|---|---|---|---|
| `impact` | `sync-affiliate-catalog.js` | Pins & Aces | Impact's `Url` is already the tracking link |
| `shopify` | `sync-shopify-catalog.js` | Malbon | Merchant `products.json` + **constructed** Impact deep link |
| `cj` | `sync-cj-catalog.js` | Cobra, Puma Golf | CJ GraphQL, `linkCode(pid:){ clickUrl }` |

### The rule, and its one deliberate exception

`sync-affiliate-catalog.js` holds the line: **never build affiliate links** —
Impact hands us the URL. Correct wherever a catalog exists.

`sync-shopify-catalog.js` breaks it on purpose, because Malbon deep-links through
Impact but exposes no Impact catalog. The hazard is specific: **a wrong tracking
prefix still redirects perfectly and pays nothing.** Pages render, clicks land,
revenue is zero, and nothing downstream can see it. So that script refuses to
write a single row until it has resolved a real link and asserted the destination
host, path, and an Impact click id.

Same reason the CJ sync demands `CJ_PID`: `linkCode` needs it, and CJ's plain
`link` field is the advertiser's own URL, which earns nothing.

### Safety contract (all three)

- A partial or failed fetch writes **nothing** for that program and exits non-zero.
- The sweep runs only on a verified-complete fetch, and refuses to deactivate
  more than 20% of a program's active rows without `--allow-large-deactivation`.
- `first_seen_at` preserved. Nothing is ever deleted.
- **USD/US only — non-USD rows are skipped, never converted.**

That last one is not theoretical. Shopify prices `products.json` in the *caller's
geo* currency, so a sync from a Canadian egress returned CAD that looked exactly
like USD — a whole catalog loaded ~70% over the true price while every existing check
passed. The Shopify sync now pins `currency=` and cross-checks the storefront's
`og:price` tags before writing. Note the CAD figure was not recoverable by
dividing by an FX rate; Shopify Markets applies per-market pricing.

### Serving

Products reach the browser only via `/api/shop`. **`tracking_url` is never sent
to the client** — every card links to `/api/go/{id}`, which redirects
server-side. Carousels are empty mounts filled at runtime; no product data is
baked into any page.

`/api/shop?ids=` serves an explicit ordered set, used by Shop This Bag.

| Surface | Which products |
|---|---|
| `/brands/{slug}/` | that brand's catalog |
| News article / feature | the article's **primary** brand only |
| `/witb/players/{slug}/` | Shop This Bag — the clubs actually in that bag |
| `/witb/players/{slug}/` | or a brand carousel, via `PLAYER_SHOP_BRAND` |

Only one carousel per page (the JS binds by element id); Shop This Bag wins as
the more specific unit. Features need `inlineCommerce: true` to get one.

### Shop This Bag matching

`scripts/lib/witb-shop-match.js`. Deliberately conservative: **a missed match
costs a click; a wrong match sends a reader to the wrong club** on a page whose
whole value is equipment accuracy.

Gates — the title must name the club type, every significant model token must
appear, and models too short to be distinctive (Cobra's "SB") are refused unless
an override names the product.

Scoring uses only the **title head**, everything before ` | ` or ` / `. Retail
titles look like `MODEL Driver | Right 9.0 / graphite stiff / shaft`, and scoring
the whole string punished well-specified SKUs — it matched a *weight kit* to a
3-wood, and let a "Limited Edition" beat the real driver because its title was
shorter. Splitting only on **spaced** separators keeps `KING CB/MB Irons` intact.

Gendered and junior variants are excluded outright. That is scoped to the fact
that every tracked player is a men's professional — **adding LPGA players means
gating that on player gender, not excluding unconditionally.**

---

## WITB

180 players, ~7,100 bag items. Pages are generated per player and gated by
`scripts/witb-page-eligibility.js`: ranked players always qualify; unranked ones
do too unless blocklisted.

The weekly crawl is the default path. Manual updates exist for bags published
before the crawl sees them:

```bash
node scripts/witb-manual-update.js path/to/bag.json --dry-run
node scripts/witb-manual-update.js path/to/bag.json
```

Accepts one object or an array. Upserts on `(player_id, bag_date)` so re-runs
never duplicate, and the crawler is newer-date-wins, so a manual bag dated ahead
of a stale source is not reverted.

After a bag change, re-bake in this order (the script prints it too):

```bash
node scripts/witb-owgr-refresh.js            # ranks for new players
node scripts/generate-witb-player-page.js <slug>
node scripts/generate-witb-page.js           # /witb stats + bag moves
node scripts/generate-witb-players-page.js   # find-a-player grid
node scripts/refresh-modules.js              # sidebar, site-wide
```

### Brand normalisation

`scripts/lib/witb-brand-normalize.js` is shared by the crawler and the manual
updater so both store a club identically. The rule: **a sub-brand gets its own
brand row only if it has its own DORMIED page.** Odyssey does, so it is separate;
Toulon, Vokey and Spider do not, so they stay model prefixes. Scotty Cameron was
the case that forced this — the upstream source labels those putters
inconsistently, so the stored brand depended on which crawl ran.

---

## Content pipeline

Articles come from `golf-wire-pipeline` and live in `dormied_articles`; the
committed HTML is generated from those rows.

```bash
# rebuild every article's HTML from the DB — metadata only, no Opus calls
node scripts/generate-article.js --regenerate-all

# restrict to slugs (skips the site-wide index/sitemap rebuild)
node scripts/generate-article.js --regenerate-all --only=slug-a,slug-b
```

**Features** are separate: an entry in the `FEATURES` object in
`scripts/generate-feature.js` plus a markdown file.

```bash
node scripts/generate-feature.js <feature-key>
```

---

## Verification

```bash
npm run verify:css            # stylesheet parity — see "Read this first"
npm run verify:sitemap        # every sitemap URL resolves to a real file
npm run verify:index-pages
npm run verify:brands
npm run verify:scorecard
```

`verify:css` and `verify:sitemap` run in CI on push and PR. Both are offline —
no Supabase, no network, no secrets — so the workflow needs no configuration.

---

## Scripts

`scripts/` is the live set. `scripts/archive/` holds one-off migrations,
historical backfills and throwaway probes — kept because they document how the
data reached its current shape, not because they should run again. See
`scripts/archive/README.md`.

**Every script is guarded with `if (require.main === module)`. Keep it that way.**
Without it, `require()`-ing a file to inspect or test it executes it against
production — which is how a syntax check once started a live crawl and left two
players with a corrupted current-bag pointer, silently skewing every site-wide
statistic.

To syntax-check a script use `node --check`, never `require()`.

---

## How to Update Each Month

**On the 1st, after new search data is ready.**

1. **Update `js/data.js`** — new search volumes per brand per market, and
   `meta.lastUpdated` to the date of the update. That field is the `?v=` cache
   buster for every data bundle, so it is not optional.
2. **Rebuild the bundles** that pages actually load:
   ```bash
   node scripts/generate-brand-data.js
   node scripts/generate-home-data.js
   npx terser js/data.js --compress --mangle -o js/data.min.js
   ```
3. **Bump the `?v=` query** on those files in the committed HTML to match the
   new `meta.lastUpdated` (`sed` across `*.html`). Generators emit the right
   value on their own; already-built pages do not rewrite themselves.
4. **Refresh the DB layer** so the summary, ranks and momentum follow the data:
   ```bash
   node scripts/backfill-brand-scores.js
   node scripts/refresh-brand-summary.js
   ```
5. **Regenerate:**
   ```bash
   npm run generate-brands:force
   npm run generate-scorecard
   npm run regenerate:sitemap
   ```
   `--force`. New volumes reshuffle ranks, so every brand page is stale, not
   just the ones whose own numbers moved.
6. **Verify:** `npm run verify:brands && npm run verify:sitemap && npm run verify:css`
7. **Commit and push.** Vercel deploys from `main`.

---

## How to Add a Brand

**1. Add the brand data** to the `brands` array in `js/data.js`:

```js
{
  id:            "brand-name",         // lowercase, hyphens — used in the URL
  name:          "Brand Name",
  logo:          "/images/logos/brand-name.jpg",
  website:       "https://brandname.com",
  headquarters:  "City, Country",
  founded:       2005,                 // number, not a string
  parentCompany: "Independent",        // never blank — say what it is
  category:      "Clubs & Balls",
  allCategories: ["Clubs & Balls"],
  subCategories: ["Irons", "Drivers"],
  description:   "One sentence about the brand.",
  searchesByMarket: {
    global: { "Mar 2023": 0, /* … */ },
    us:     { "Mar 2023": 0, /* … */ },
    // all 10 markets: global, us, jp, kr, uk, ca, cn, au, de, se, fr
  }
}
```

Use `0` for months with no data.

**2. Update the meta block** — `totalBrands` in `js/data.js`, and `lastUpdated`
to today. `lastUpdated` is the `?v=` cache buster for `js/data.min.js` and every
`js/brand-data/*.js`; leaving it alone ships new data behind the old URL and
`Cache-Control: max-age=604800` keeps returning readers on the stale copy for a
week. Then update the brand-count copy in the HTML (search for `215 brands`).

**3. Add the logo** at `images/logos/brand-name.jpg`, matching the `id`.
**Square, at most 350x350, JPEG.** The logo box is square with
`object-fit: contain`, so a wide logo paints as a squat bar inside it — pad it
to square on its own background rather than letting the box do it. Brand sites
publish these at whatever size suits them; a batch imported straight from source
once averaged 29KB against the existing 6KB, on an image the page loads eagerly
above the fold.

**4. Add it to the feed tagger** in `api/_brands.json` so articles get tagged:

```json
{ "id": "brand-name", "name": "Brand Name", "matchTerms": ["BrandName"] }
```

`name` is always matched. `aliases` and `matchTerms` add more terms. If the name
is also ordinary golf or English phrasing — Municipal, Local Rule, Honors — set
`"autoMatch": false` so it is never tagged automatically; it still gets a page, a
directory row and a search entry. For a name that is only ambiguous in body copy,
add the lowercased term to `EXCLUSION_LIST` in `scripts/match-brands.js` instead,
which matches it in headlines only.

**5. Map it into WITB** if pros carry it — set `witb_brands.dormied_brand_slug`
to the new `id`, or the equipment rows will not link to the brand page and the
brand page will not get its ON TOUR module.

**6. Regenerate and verify:**

```bash
node scripts/generate-brand-data.js
node scripts/generate-home-data.js
npx terser js/data.js --compress --mangle -o js/data.min.js
node scripts/backfill-brand-scores.js && node scripts/refresh-brand-summary.js
npm run generate-brands:force
npm run generate-index-pages
npm run regenerate:search-index
npm run verify:brands && npm run verify:sitemap && npm run verify:css
```

`generate-brands:force`, not `generate-brands` — adding a brand reshuffles ranks
for everything below it, so every page needs rewriting, not just the new one.

Do **not** hand-add a `<url>` entry to `sitemap.xml` — the generator picks up the
new page and a manual edit will be overwritten.

If the brand is a sub-brand of one already tracked, decide deliberately whether
it gets its own page: that decision drives WITB brand normalisation (above).

---

## How to Add a Market / Country

1. Add the market to the `markets` array in the `js/data.js` meta block.
2. Add search data for that market to **every** brand.
3. The UI picks it up automatically — no template changes needed.

---

## UI

| File | What it controls |
|---|---|
| `css/styles.css` / `css/styles.min.css` | All styling — **edit both** |
| `js/home.js` | Homepage: top brands, movers, drops, match-up |
| `js/app.js` | Rankings table: filters, sorting, DI calculation |
| `js/brand.js` | Brand pages: chart, stats |
| `js/brands-dir.js` | Brand directory grid |
| `js/feed.js` / `js/feed-page.js` | News feed |
| `js/shop-carousel.js` | Affiliate carousels (brand, article, player) |
| `js/signup.js` | Newsletter popup and footer form |
| `js/explanations.js` | Reads existing brand_explanations rows for the homepage WHY IT MOVED module and the /rankings scorecard banner. Nothing writes new ones — see `scripts/archive/generate-explanations.js` |
| `js/utils.js` | Shared helpers |

Colours and fonts are CSS variables at the top of `css/styles.css`:

```css
:root {
  --green: #22c55e;          /* primary brand green */
  --bg: #060b06;             /* page background */
  --bg-surface: #0a100a;     /* card / panel background */
  --text: #e2ffe2;           /* primary text */
  --text-dim: #a3c9a3;       /* secondary text */
  --text-muted: #5a7a5a;     /* muted / label text */
  --border: #1a2e1a;         /* border colour */
  --font-display: 'Barlow Condensed';
  --font-mono: 'JetBrains Mono';
  --font-body: 'Inter';
}
```

`js/*.min.js` are built with `terser` and committed. Rebuild the minified file
whenever you edit the source **and bump the `?v=` query** — `Cache-Control` is
`max-age=604800`, so a stale buster means users keep the old file for a week.

---

## Ads

The site runs **Mediavine** (Journey), plus Grow.me for audience features. There
is no AdSense. `api/feed.js` (RSS aggregation) stays disabled so the site shows
only original content — an ad-network requirement that applies under Mediavine as
it did under AdSense.

`privacy/index.html` is hand-maintained and must describe what actually runs,
including affiliate links and the networks behind them.

---

## Environment Variables

Set locally in `.env`, and in the Vercel dashboard / GitHub Actions secrets.

| Variable | What it's for |
|---|---|
| `ANTHROPIC_API_KEY` | Article generation, WITB ledes, match-up write-ups |
| `SUPABASE_URL` | Database connection |
| `SUPABASE_ANON_KEY` | Read access — safe to expose in frontend |
| `SUPABASE_SERVICE_KEY` | Write access — **never in frontend code** |
| `BEEHIIV_PUBLICATION_ID` / `BEEHIIV_API_KEY` | Newsletter |
| `IMPACT_SID` / `IMPACT_TOKEN` | Impact affiliate catalog |
| `CJ_PAT` | CJ personal access token (bearer) |
| `CJ_COMPANY_ID` | CJ publisher company id |
| `CJ_PID` | CJ property id — required to mint tracking links |
| `INDEXNOW_KEY` | Search-engine ping on publish |

`.env` is gitignored and has never been committed.

---

## Local Development

```bash
npm run dev     # http://localhost:8080
```

Static server only. `/api/*` are Vercel functions and do **not** run locally —
carousels will remove themselves because `/api/shop` 404s. Test those against the
deployed site.

---

## Deploying

Push to `main`; Vercel deploys automatically. `npm run deploy` runs
`vercel --prod` to force one.
