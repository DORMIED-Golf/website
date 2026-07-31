# Archived scripts

One-off migrations, historical backfills, and throwaway probes. Kept because
they document how the data got into its current shape, not because they should
be run again.

Nothing here is referenced by `package.json`, a GitHub workflow, or another
script — that was verified before moving, excluding each file's own header.

Notable:

- `impact-discovery.js` — its own header calls it a "THROWAWAY discovery probe";
  it was used once to design the affiliate schema against the live Impact API.
- `adsense-operation-a.js` / `-b.js` — from the AdSense era. The site runs
  Mediavine.
- `inject-*.js` — one-off injections of hand-authored SEO articles. Three of
  those pages are in `PROTECTED_SLUGS` in `generate-article.js` because their
  full HTML lives in the committed page, not in `dormied_articles.body`.
- `witb-rahm-backfill.js`, `witb-player-history-backfill.js` — historical WITB
  repairs, superseded by `witb-manual-update.js`.

If you need one, move it back rather than running it from here — paths are
relative to `scripts/`, so it will not resolve `./lib/...` correctly from this
directory.
