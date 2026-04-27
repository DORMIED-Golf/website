# DORMIED — Monthly Update Guide

## Stack
- **Frontend**: Vanilla HTML/CSS/JS, hosted on Vercel
- **Data**: `js/data.js` — single source of truth for all 169 brands × 10 markets
- **API**: Vercel serverless functions (`api/`)
- **Database**: Supabase (`brand_explanations` table)
- **Newsletter**: Beehiiv
- **AI**: Anthropic Claude (AI-generated brand movement explanations)
- **Analytics**: Google Tag Manager (GTM-N4Q8J6L3)

---

## Every Month: Update Checklist

Run this checklist on the **1st of each month** after the prior month's data is ready.

### 1. Update `js/data.js`

Open `js/data.js` and make these changes:

**a) Update the meta block at the top:**
```js
meta: {
  lastUpdated:    "2026-04-01",   // today's date
  currentMonth:   "Mar 2026",     // the month you just added
  previousMonth:  "Feb 2026",     // one month back
  threeMonthsAgo: "Dec 2025",     // three months back
  scorecardUrl:   "",             // fill in once Scorecard post is live
  ...
}
```

**b) Add new month search data for all 169 brands:**

Each brand has `searchesByMarket: { global: {}, us: {}, jp: {}, ... }`.
Add the new month key to every market object for every brand:
```js
"Mar 2026": 45000,  // new entry at the end of each market object
```

> **Tip:** Use the Python generator script to automate this from the XLSX file:
> ```bash
> python3 scripts/generate_data.py
> ```
> This reads `/Users/travisr/Downloads/DORMIED 2.0 Database.xlsx` and outputs a fresh `data.js`.

### 2. Bump the asset version string

In every HTML file, find the `data.js` script tag and update the version:
```html
<script src="js/data.js?v=20260401"></script>
```
Use today's date in `YYYYMMDD` format. This forces browsers to fetch the new data.

**Files to update** (search for `data.js?v=`):
- `index.html`
- `rankings/index.html`
- `brands/index.html`
- `brands/brand.html`
- `feed/index.html`

### 3. Update `sitemap.xml`

Change the `<lastmod>` date on the homepage entry:
```xml
<lastmod>2026-04-01</lastmod>
```

### 4. Set the Scorecard URL (once post is live)

In `js/data.js` meta:
```js
scorecardUrl: "/scorecard/2026-03/",
```
This controls the "Read this month's full breakdown" link in the Scorecard banner on the Index page.

### 5. AI Explanations (auto-runs via GitHub Actions)

The `scripts/generate-explanations.js` script runs automatically on the 1st of each month via GitHub Actions. It:
- Reads `data.js` to find brands with >15% MoM change
- Calls Claude (Anthropic API) with web search enabled
- Stores results in Supabase `brand_explanations` table

To run manually:
```bash
npm run generate-explanations
# or for a specific month:
node scripts/generate-explanations.js 2026-03
```

---

## Environment Variables

All secrets are stored as environment variables. **Never hardcode them.**

| Variable | Where Used | How to Set |
|---|---|---|
| `ANTHROPIC_API_KEY` | `scripts/generate-explanations.js` | Vercel + local `.env` |
| `SUPABASE_URL` | `js/explanations.js` (public) | Hardcode in explanations.js — it's the project URL, not a secret |
| `SUPABASE_ANON_KEY` | `js/explanations.js` (public) | Hardcode in explanations.js — anon key is read-only, safe to expose |
| `SUPABASE_SERVICE_KEY` | `scripts/generate-explanations.js` | Vercel + local `.env` only |
| `BEEHIIV_PUBLICATION_ID` | `api/subscribe.js` | Vercel dashboard |
| `BEEHIIV_API_KEY` | `api/subscribe.js` | Vercel dashboard |

Copy `.env.example` to `.env` and fill in values for local development.

---

## Adding a New Brand

1. Add a new brand object to the `brands` array in `js/data.js`
2. Follow the existing brand object structure exactly
3. Add 36 months of historical data for all 10 markets (or zeros for months with no data)
4. Update `meta.totalBrands` count
5. Add the brand logo to `images/logos/<brand-id>.jpg`
6. Update `api/_brands.json` so the feed correctly tags articles mentioning this brand

---

## Deploying

```bash
# Push to GitHub (triggers Vercel auto-deploy)
git add .
git commit -m "Data update: Mar 2026"
git push

# Or deploy directly via Vercel CLI
npm run deploy
```

---

## File Structure

```
dormied_website/
├── index.html              — Homepage
├── rankings/index.html     — The Index (rankings table)
├── brands/index.html       — The Field (brand directory)
├── brands/brand.html       — Individual brand page template
├── feed/index.html         — News page
├── css/styles.css          — All styles (single file)
├── js/
│   ├── utils.js            — Shared utilities (load first)
│   ├── data.js             — ALL brand data (update monthly)
│   ├── explanations.js     — Supabase AI explanations module
│   ├── app.js              — Rankings table engine
│   ├── home.js             — Homepage logic
│   ├── brand.js            — Brand page logic
│   ├── brands-dir.js       — Brand directory grid
│   ├── feed.js             — Feed widget (used on multiple pages)
│   ├── feed-page.js        — Full feed page logic
│   └── signup.js           — Newsletter signup + popup
├── api/
│   ├── feed.js             — RSS aggregator (Vercel serverless)
│   ├── subscribe.js        — Beehiiv subscription (Vercel serverless)
│   └── _brands.json        — Brand name/keyword map for feed tagging
├── scripts/
│   └── generate-explanations.js — Monthly AI explanation generator
├── images/logos/           — Brand logo files (<brand-id>.jpg)
├── vercel.json             — Routing, cache headers, function config
├── sitemap.xml             — Update lastmod monthly
├── robots.txt              — SEO
├── .env.example            — Copy to .env for local dev
└── MAINTENANCE.md          — This file
```
