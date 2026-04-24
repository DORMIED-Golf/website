#!/usr/bin/env node
/**
 * add-threads-columns.js
 * Adds threads_post_id and threads_posted_at columns to dormied_articles.
 * Run once: node scripts/migrations/add-threads-columns.js
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

async function main() {
  console.log('Adding threads_post_id and threads_posted_at columns...');

  // Use raw SQL via Supabase's rpc or the REST SQL endpoint.
  // Supabase doesn't expose DDL via the JS client directly, so we use
  // the management API approach: run a do-nothing query then check columns,
  // or simply use the pg REST endpoint with service key.

  const sql = `
    ALTER TABLE dormied_articles
      ADD COLUMN IF NOT EXISTS threads_post_id   TEXT,
      ADD COLUMN IF NOT EXISTS threads_posted_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_dormied_articles_threads_posted_at
      ON dormied_articles (threads_posted_at)
      WHERE threads_posted_at IS NULL;
  `;

  // Supabase JS client doesn't run DDL, so use the REST /rest/v1/rpc or
  // the pg connection. We'll call it via fetch to the Supabase SQL editor endpoint.
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ sql }),
  });

  if (!res.ok) {
    // exec_sql may not exist — fall back to instructions
    console.warn('exec_sql RPC not available. Run this SQL manually in the Supabase SQL editor:\n');
    console.log(sql);
    return;
  }

  console.log('✓ Columns added successfully.');
}

main().catch(err => { console.error(err.message); process.exit(1); });
