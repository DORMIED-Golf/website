'use strict';
/**
 * scripts/lib/data-version.js
 *
 * The ?v= cache buster for the shared /js/data.min.js bundle.
 *
 * Every page that loads data.min.js needs a buster that changes whenever the
 * data does. Three generators used to carry the date as a literal in their
 * templates, so a data refresh shipped a new file behind the old URL. That is
 * how the site came to serve a 215-brand bundle at ?v=20260709 — Cache-Control
 * is max-age=604800, so a returning reader would have kept the 175-brand copy
 * for a week. Reading meta.lastUpdated makes the buster impossible to forget.
 *
 * generate-article.js derives its per-brand busters from the same field.
 */

const fs   = require('fs');
const path = require('path');

const DATA_JS = path.resolve(__dirname, '../../js/data.js');

let cached = null;

function dataVersion() {
  if (cached) return cached;
  // data.js is ~3 MB and meta is the first thing in it, so read only the head.
  const fd  = fs.openSync(DATA_JS, 'r');
  const buf = Buffer.alloc(512);
  fs.readSync(fd, buf, 0, 512, 0);
  fs.closeSync(fd);

  const m = buf.toString('utf8').match(/"lastUpdated":\s*"(\d{4})-(\d{2})-(\d{2})"/);
  if (!m) throw new Error('data-version: no meta.lastUpdated found at the head of js/data.js');

  cached = m[1] + m[2] + m[3];
  return cached;
}

module.exports = { dataVersion };
