#!/usr/bin/env node
/**
 * Adds x_post_text, x_post_id, x_posted_at columns to dormied_articles.
 * Run once: node scripts/migrate-x-columns.js
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// Use Supabase's pg proxy to run raw SQL via the PostgREST /sql endpoint
// (requires service_role key)
function runSQL(sql) {
  return new Promise((resolve, reject) => {
    const url  = new URL(`${SUPABASE_URL}/rest/v1/`);
    const body = JSON.stringify({ query: sql });

    // Attempt via PostgREST query endpoint (Supabase >= 2.x)
    const opts = {
      hostname: url.hostname,
      path:     '/rest/v1/',
      method:   'OPTIONS',
      headers:  {
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    // Prefer direct HTTP call via node https
    const req = https.request({
      hostname: url.hostname,
      port:     443,
      path:     `/pg/query`,
      method:   'POST',
      headers:  {
        'apikey':         SERVICE_KEY,
        'Authorization':  `Bearer ${SERVICE_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function migrate() {
  console.log('[migrate] Running Supabase migration for X posting columns...');

  const sql = `
    ALTER TABLE dormied_articles
      ADD COLUMN IF NOT EXISTS x_post_text   text,
      ADD COLUMN IF NOT EXISTS x_post_id     text,
      ADD COLUMN IF NOT EXISTS x_posted_at   timestamptz;
  `;

  const result = await runSQL(sql);
  console.log(`[migrate] Response status: ${result.status}`);
  console.log(`[migrate] Response body: ${result.body}`);

  if (result.status >= 200 && result.status < 300) {
    console.log('[migrate] ✓ Migration applied successfully');
  } else {
    console.error('[migrate] ✗ Migration may have failed. Run this SQL manually in the Supabase Dashboard SQL Editor:');
    console.log('\n' + sql);
  }
}

migrate().catch(err => {
  console.error('[migrate] Error:', err.message);
  console.log('\nRun this SQL manually in Supabase Dashboard → SQL Editor:\n');
  console.log(`ALTER TABLE dormied_articles
  ADD COLUMN IF NOT EXISTS x_post_text   text,
  ADD COLUMN IF NOT EXISTS x_post_id     text,
  ADD COLUMN IF NOT EXISTS x_posted_at   timestamptz;`);
});
