-- ════════════════════════════════════════════════════════════════════════════
-- DORMIED Content Pipeline — Database Setup
-- Run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

-- NOTE: Before running this script, create a Supabase Storage bucket named
-- "dormied-articles" with public access enabled (Storage → New bucket →
-- Name: dormied-articles → Public bucket: ON).

-- ── 1. golf_wire_raw ────────────────────────────────────────────────────────
-- Raw press releases ingested from The Golf Wire RSS feed.

CREATE TABLE IF NOT EXISTS golf_wire_raw (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  source_url    text        UNIQUE NOT NULL,
  title         text        NOT NULL,
  body          text        NOT NULL,
  image_url     text,
  category      text,
  published_at  timestamptz,
  ingested_at   timestamptz DEFAULT now(),
  processed     boolean     DEFAULT false
);

CREATE INDEX IF NOT EXISTS golf_wire_raw_processed_idx
  ON golf_wire_raw (processed);
CREATE INDEX IF NOT EXISTS golf_wire_raw_published_idx
  ON golf_wire_raw (published_at DESC);

ALTER TABLE golf_wire_raw ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON golf_wire_raw FOR SELECT TO anon USING (true);

-- ── 2. golf_wire_matched ────────────────────────────────────────────────────
-- Brand match results for each raw article.

CREATE TABLE IF NOT EXISTS golf_wire_matched (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  raw_article_id      uuid NOT NULL REFERENCES golf_wire_raw(id) ON DELETE CASCADE,
  primary_brand_slug  text NOT NULL,
  all_brand_slugs     text[] NOT NULL DEFAULT '{}',
  matched_at          timestamptz DEFAULT now(),
  UNIQUE (raw_article_id, primary_brand_slug)
);

CREATE INDEX IF NOT EXISTS golf_wire_matched_brand_idx
  ON golf_wire_matched (primary_brand_slug);
CREATE INDEX IF NOT EXISTS golf_wire_matched_raw_idx
  ON golf_wire_matched (raw_article_id);

ALTER TABLE golf_wire_matched ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON golf_wire_matched FOR SELECT TO anon USING (true);

-- ── 3. dormied_articles ─────────────────────────────────────────────────────
-- Generated DORMIED original articles, ready to serve.

CREATE TABLE IF NOT EXISTS dormied_articles (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  matched_article_id  uuid REFERENCES golf_wire_matched(id) ON DELETE SET NULL,
  brand_slug          text NOT NULL,
  title               text NOT NULL,
  body                text NOT NULL,
  image_url           text,
  source_url          text NOT NULL,
  source_name         text NOT NULL DEFAULT 'The Golf Wire',
  meta_description    text,
  seo_keywords        text[] DEFAULT '{}',
  published_at        timestamptz DEFAULT now(),
  status              text NOT NULL DEFAULT 'published',
  slug                text UNIQUE NOT NULL,
  category            text,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dormied_articles_brand_idx
  ON dormied_articles (brand_slug);
CREATE INDEX IF NOT EXISTS dormied_articles_published_idx
  ON dormied_articles (published_at DESC);
CREATE INDEX IF NOT EXISTS dormied_articles_status_idx
  ON dormied_articles (status);

ALTER TABLE dormied_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON dormied_articles FOR SELECT TO anon USING (true);
