-- Run this once in your Supabase SQL editor to create the brand_explanations table.

CREATE TABLE IF NOT EXISTS brand_explanations (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id          text        NOT NULL,
  brand_name        text        NOT NULL,
  month             text        NOT NULL,   -- YYYY-MM format, e.g. "2026-01"
  explanation       text        NOT NULL,
  change_percentage numeric(6,2) NOT NULL,
  top_market        text        NOT NULL,
  created_at        timestamptz DEFAULT now()
);

-- Prevent duplicate entries per brand per month
CREATE UNIQUE INDEX IF NOT EXISTS brand_explanations_brand_month
  ON brand_explanations (brand_id, month);

-- Speed up frontend queries (current month lookups)
CREATE INDEX IF NOT EXISTS brand_explanations_month_idx
  ON brand_explanations (month);

-- Enable Row Level Security — read-only for anon users
ALTER TABLE brand_explanations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
  ON brand_explanations FOR SELECT
  TO anon
  USING (true);
