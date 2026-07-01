# DORMIED

Golf's brand desk. 169 brands. 10 markets. Ranked monthly by real search data.

**Live site:** [dormied.com](https://dormied.com)
**Stack:** Vanilla HTML/CSS/JS · Vercel · Supabase · Beehiiv · Anthropic

---

## How to Update Each Month

**Do this on the 1st of every month after new search data is ready.**

### Step 1 — Update the data file

Open `js/data.js` in any text editor. At the very top, update the four lines inside the `meta` block:

```js
lastUpdated:    "2026-04-01",   // today's date
currentMonth:   "Mar 2026",     // the new month you're adding
previousMonth:  "Feb 2026",     // one month back
threeMonthsAgo: "Dec 2025",     // three months back
```

Then add the new month's search numbers for every brand. Each brand entry looks like this:

```js
global: { "Mar 2023": 12000, "Apr 2023": 14000, ... "Feb 2026": 18000 }
```

Add `"Mar 2026": [number]` at the end of each market object for every brand. This is the most time-consuming step — use the Python generator script to automate it from the XLSX file:

```
python3 scripts/generate_data.py
```

### Step 2 — Update the version number in all HTML files

In these 5 files, find the line that loads `data.js` and change the `?v=` number to today's date (YYYYMMDD format):

- `index.html`
- `rankings/index.html`
- `brands/index.html`
- `brands/brand.html`
- `feed/index.html`

Change: `<script src="js/data.js?v=20260317">`
To: `<script src="js/data.js?v=20260401">`

### Step 3 — Update the sitemap date

Open `sitemap.xml`. Change all `<lastmod>` dates to today:
```xml
<lastmod>2026-04-01</lastmod>
```

### Step 4 — Set the Scorecard URL (once your post is live)

In `js/data.js`, find `scorecardUrl` in the meta block and fill it in:
```js
scorecardUrl: "/scorecard/2026-03/",
```
Leave it blank (`""`) if the post isn't live yet.

### Step 5 — Deploy

```
git add .
git commit -m "Data update: Mar 2026"
git push
```

Vercel deploys automatically when you push to GitHub. Done.

---

## How to Update the UI, Add Features, or Fix Bugs

### Which file does what

| File | What it controls |
|---|---|
| `css/styles.css` | All visual styling — colours, fonts, layout, spacing |
| `js/home.js` | Homepage: top brands, movers, drops, match-up |
| `js/app.js` | Rankings table: filters, sorting, DI calculation |
| `js/brand.js` | Individual brand pages: chart, stats, explanations |
| `js/brands-dir.js` | Brand directory grid |
| `js/feed.js` / `js/feed-page.js` | News feed |
| `js/signup.js` | Newsletter popup and footer form |
| `js/explanations.js` | AI-generated movement explanations (reads from Supabase) |
| `js/utils.js` | Shared helpers used across all JS files |

### Colours and fonts

All colours and fonts are defined as CSS variables at the top of `css/styles.css`:

```css
:root {
  --green: #22c55e;          /* primary brand green */
  --bg: #060b06;             /* page background */
  --bg-surface: #0a100a;     /* card / panel background */
  --text: #e2ffe2;           /* primary text */
  --text-dim: #a3c9a3;       /* secondary text */
  --text-muted: #5a7a5a;     /* muted / label text */
  --border: #1a2e1a;         /* border colour */
  --font-display: 'Barlow Condensed';   /* headlines */
  --font-mono: 'JetBrains Mono';        /* numbers, data */
  --font-body: 'Inter';                 /* body copy */
}
```

Change any value here and it updates everywhere on the site instantly.

### Making a UI change safely

1. Make your change in the file
2. Open `http://localhost:8080` in your browser (`npm run dev` to start the server)
3. Check it looks right
4. Bump the CSS/JS version number in the HTML files (same process as the data version)
5. Push to GitHub

---

## How to Add a Brand

### Step 1 — Add the brand data

Open `js/data.js`. Copy an existing brand entry (one full `{ id: ..., name: ..., ... }` block) and paste it into the `brands` array. Fill in all fields:

```js
{
  id:            "brand-name",         // lowercase, hyphens, no spaces — used in the URL
  name:          "Brand Name",
  logo:          "/images/logos/brand-name.jpg",
  website:       "https://brandname.com",
  headquarters:  "City, Country",
  founded:       "2005",
  parentCompany: "",                   // leave blank if independent
  category:      "Clubs & Balls",      // one of the four main categories
  allCategories: ["Clubs & Balls"],
  subCategories: ["Irons", "Drivers"],
  description:   "One sentence about the brand.",
  searchesByMarket: {
    global: { "Mar 2023": 0, "Apr 2023": 0, ... "Feb 2026": 0 },
    us:     { "Mar 2023": 0, ... },
    // repeat for all 10 markets: jp, kr, uk, ca, cn, au, de, se, fr
  }
}
```

For months with no data, use `0`. Start with real data from the first month the brand had meaningful search volume.

### Step 2 — Update the brand count

In `js/data.js` meta block, change:
```js
totalBrands: 122,
```
to:
```js
totalBrands: 123,
```

Also update it in all 5 HTML files — search for `"122 brands"` and update the copy.

### Step 3 — Add the logo

Save the logo as a `.jpg` file named `brand-name.jpg` (matching the `id` you used) and place it in:
```
images/logos/brand-name.jpg
```

### Step 4 — Add the brand to the feed tagger

Open `api/_brands.json`. Add an entry:
```json
{ "id": "brand-name", "name": "Brand Name", "keywords": ["Brand Name", "BrandName"] }
```

This makes the news feed correctly tag articles that mention your brand.

### Step 5 — Update the sitemap

Open `sitemap.xml` and add a new `<url>` entry at the bottom of the brand section:
```xml
<url>
  <loc>https://dormied.com/brands/brand-name/</loc>
  <lastmod>2026-04-01</lastmod>
  <changefreq>monthly</changefreq>
  <priority>0.7</priority>
</url>
```

---

## How to Add a Market / Country

Adding a new market is a two-part job: data and UI.

### Step 1 — Add the market to the meta block

In `js/data.js`, find the `markets` array and add your new market:
```js
{ key: "mx", label: "Mexico", flag: "🇲🇽" }
```

### Step 2 — Add search data for every brand

For every brand in `js/data.js`, add a new market key inside `searchesByMarket`:
```js
mx: { "Mar 2023": 0, "Apr 2023": 0, ... "Feb 2026": 0 }
```

Use `0` for months with no data.

### Step 3 — The UI picks it up automatically

The country filter tabs on the Index page and brand pages are generated dynamically from the `markets` array in the meta block. Once you add the market there, it appears in the UI. The flag emoji is also pulled from that array.

---

## Ads

Ads are served by **Mediavine Journey**, which requires ad-network exclusivity —
no other programmatic ad code (Google AdSense, etc.) may run on the site.

The Journey tag is loaded in the `<head>` of every page (and in every page
generator) alongside the Grow.me pixel:

```html
<script type="text/javascript" async="async" data-noptimize="1" data-cfasync="false"
        src="//scripts.scriptwrapper.com/tags/06995677-1354-493f-9a2b-7ccd99d5a7ad.js"></script>
```

Journey places ads automatically, so there are no manual ad-slot divs to maintain.
Do not add Google AdSense or any other programmatic ad-network code — doing so
violates the Journey exclusivity requirement.

---

## How to Update SEO

### Page titles and meta descriptions

Each HTML file has its own title and meta description near the top of the `<head>`:

```html
<title>Golf Brand Rankings — The DORMIED Index</title>
<meta name="description" content="Your description here.">
```

Keep titles under 60 characters. Keep descriptions under 155 characters and make them compelling — this is what appears in Google search results.

The same title and description should be updated in the Open Graph and Twitter Card tags just below:
```html
<meta property="og:title" content="...">
<meta property="og:description" content="...">
<meta name="twitter:title" content="...">
<meta name="twitter:description" content="...">
```

### Structured data (JSON-LD)

Each page has structured data blocks in the `<head>` that help Google understand the content. They look like:
```html
<script type="application/ld+json">
{ "@context": "https://schema.org", ... }
</script>
```

To update them, edit the values inside — keep the structure exactly as-is and only change the text content.

### Sitemap

`sitemap.xml` in the root folder. Update `<lastmod>` dates monthly. Google uses this to know when to re-crawl.

### LLM discoverability

`llms.txt` in the root folder. This tells AI tools (ChatGPT, Claude, Perplexity) what DORMIED is and what pages exist. Update it if you add major new sections.

---

## Environment Variables

These are secrets stored outside the codebase. You need them set in two places: locally in a `.env` file (for running scripts on your computer) and in the Vercel dashboard (for the live site).

| Variable | What it's for |
|---|---|
| `ANTHROPIC_API_KEY` | AI-generated brand explanations |
| `SUPABASE_URL` | Database connection (also hardcoded in `js/explanations.js` — it's safe to do so) |
| `SUPABASE_ANON_KEY` | Database read access (also in `js/explanations.js` — safe to expose) |
| `SUPABASE_SERVICE_KEY` | Database write access — **never put this in frontend code** |
| `BEEHIIV_PUBLICATION_ID` | Newsletter signup |
| `BEEHIIV_API_KEY` | Newsletter signup |

Copy `.env.example` to `.env` and fill in each value for local use.

To set them on Vercel: go to your project → **Settings** → **Environment Variables**.

---

## Static Index Page Generation

`/brands/`, `/news/`, and `/scorecard/` are pre-rendered at build time so crawlers see fully populated HTML without running JavaScript.

### How it works

`scripts/generate-index-pages.js` reads local data files and Supabase, then injects content directly into the three HTML files:

| Page | Source data | Output |
|---|---|---|
| `/brands/` | `js/data.js` | 169 ranked brand cards with DI, trend arrows, sub-categories |
| `/news/` | Supabase `dormied_articles` | 25 most recent articles; pages 2–5 at `/news/page/N/` |
| `/scorecard/` | `js/scorecard-data.js` | Latest hero card + full archive |

Client-side JS (`brands-dir.js`, `feed-page.js`, `scorecard-archive.js`) is modified to **preserve the static HTML** on page load. It only re-renders when the user actively uses search, filter, or sort. When filters are cleared, the original static HTML is restored from cache.

### Running it

```bash
# All three pages
npm run generate-index-pages

# Individual pages
npm run generate-index-pages:brands
npm run generate-index-pages:news
npm run generate-index-pages:scorecard

# Force-regenerate even if source data hasn't changed
node scripts/generate-index-pages.js --force

# Verify output
npm run verify:index-pages
```

### Pipeline integration

The generation script is wired into the publish pipeline:

- `generate-article.js` automatically runs `generate-index-pages.js --news` after each article batch.
- `generate-brand-page.js` automatically runs `generate-index-pages.js --brands` after brand pages are written.
- Scorecard is regenerated manually after updating `js/scorecard-data.js`.

The script has mtime-based skipping: if the output file is newer than its source data, it skips that page. Explicit flags (`--brands`, `--news`, `--scorecard`, `--force`) always regenerate regardless.

### Monthly update flow

After updating `js/data.js` with new search numbers, run:

```bash
npm run generate-index-pages:brands
```

After publishing new articles via `generate-article.js`, the `/news/` index regenerates automatically.

After publishing a new Scorecard issue (updating `js/scorecard-data.js`), run:

```bash
npm run generate-index-pages:scorecard
```

---

## Local Development

```bash
npm run dev
# Opens a local server at http://localhost:8080
```

---

## Deploying

Vercel auto-deploys every time you push to the `main` branch on GitHub.

To push:
```bash
git add .
git commit -m "Description of what changed"
git push
```

That's it. Vercel handles the rest in about 30 seconds.
