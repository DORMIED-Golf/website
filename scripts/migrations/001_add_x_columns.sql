-- Migration: Add X (Twitter) posting columns to dormied_articles
-- Run this once in the Supabase Dashboard → SQL Editor

ALTER TABLE dormied_articles
  ADD COLUMN IF NOT EXISTS x_post_text   text,
  ADD COLUMN IF NOT EXISTS x_post_id     text,
  ADD COLUMN IF NOT EXISTS x_posted_at   timestamptz;

-- Confirm
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'dormied_articles'
  AND column_name IN ('x_post_text', 'x_post_id', 'x_posted_at');
