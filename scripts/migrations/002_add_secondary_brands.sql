-- Migration: 002_add_secondary_brands
-- Adds secondary_brand_slugs column to dormied_articles.
-- Run once on the Supabase production database.
--
-- secondary_brand_slugs stores the slugs of additional brands
-- mentioned in an article beyond the primary brand. Used for:
--   1. Multi-brand widget rendering in generated HTML
--   2. Cross-brand dedup in generate-article.js
--   3. JSON-LD "about" array for structured data

ALTER TABLE dormied_articles
  ADD COLUMN IF NOT EXISTS secondary_brand_slugs TEXT[] DEFAULT '{}' NOT NULL;

-- GIN index for fast containment queries (e.g. "articles mentioning TaylorMade")
CREATE INDEX IF NOT EXISTS idx_dormied_articles_secondary_brand_slugs
  ON dormied_articles USING GIN (secondary_brand_slugs);

COMMENT ON COLUMN dormied_articles.secondary_brand_slugs IS
  'Additional brand slugs mentioned in this article beyond the primary brand. Populated by generate-article.js from golf_wire_matched.all_brand_slugs.';
