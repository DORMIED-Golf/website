#!/usr/bin/env node
'use strict';
/**
 * scripts/witb-shaft-cleanup.js
 *
 * One-off cleanup from the 9 Oct 2026 WITB audit, for CURRENT bags only:
 *
 *   1. Rows whose shaft text still carries labels for several clubs, e.g. an
 *      iron row reading "HZRDUS Smoke Black 90 (3, 4), DG Tour Issue S300
 *      (5-PW)". Each row gets the shaft its own clubs use; a wedge row whose
 *      lofts use different shafts is split into one row per shaft (the same
 *      convention new bags follow). Anything ambiguous is SKIPPED, never
 *      guessed: an iron range spanning two labels, a shaft name that is
 *      incomplete in the source, a label that matches no club.
 *   2. Utility irons stored as club_type 'iron' with a degree loft
 *      (X Forged UT, ZXiU...) become 'utility-iron'.
 *   3. Exact duplicate rows are removed.
 *
 * Default is a dry run that writes the plan (JSON + Markdown) to --out.
 * --apply executes it after saving a backup of every row it touches.
 *
 * Usage: node scripts/witb-shaft-cleanup.js --out <dir> [--apply]
 */
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { inferShaftSlug, upsertShaft } = require('./witb-manual-update.js');

const arg   = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const OUT   = arg('--out') || '.';
const APPLY = process.argv.includes('--apply');
const Z     = '00000000-0000-0000-0000-000000000000';

// ── Parsing ──────────────────────────────────────────────────────────────────
function topSplit(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') d++; if (ch === ')') d--;
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const IRON_NUM = { PW: 10, W: 10, AW: 11, GW: 11, UW: 11, SW: 12, LW: 13 };
const tok = t => (/^\d+$/.test(t) ? Number(t) : IRON_NUM[t.toUpperCase()] ?? null);
// "3, 4" / "5-PW" / "46-54" / "56, 60" -> set of numbers (iron slots or lofts)
function labelSet(label) {
  const set = new Set();
  for (const piece of label.split(',').map(s => s.trim()).filter(Boolean)) {
    const r = piece.match(/^([0-9A-Za-z]+)\s*-\s*([0-9A-Za-z]+)$/);
    if (r) {
      const a = tok(r[1]), b = tok(r[2]);
      if (a == null || b == null || b < a) return null;
      for (let n = a; n <= b; n++) set.add(n);
    } else {
      const n = tok(piece); if (n == null) return null; set.add(n);
    }
  }
  return set;
}
// A row's own clubs: iron slots from "4-PW", lofts from "46-10F, 52-08F" or "19, 22 degrees".
function rowSet(type, loft) {
  if (!loft) return null;
  if (type === 'wedge' || /degree/.test(loft)) {
    const groups = loft.replace(/degrees?/g, '').split(',').map(s => s.trim()).filter(Boolean);
    const nums = groups.map(g => (g.match(/^(\d+(?:\.\d+)?)/) || [])[1]).map(Number);
    return nums.every(n => n > 0) ? { set: new Set(nums), groups, nums } : null;
  }
  const s = labelSet(loft.replace(/\s+/g, ''));
  return s ? { set: s, groups: [loft], nums: null } : null;
}
const FRAGMENT = /^(S\d00|X\d00|S\+|Tour Issue\b|Onyx\b)/i;
const looksIncomplete = t => FRAGMENT.test(t) || /\b(N\.S\.? Pro|Dynamic Gold Tour Issue|Tour Issue)$/i.test(t) || t.split(/\s+/).length < 2;

function planRow(it) {
  const sh = it.raw_shaft || '';
  const parts = topSplit(sh).map(p => {
    const m = p.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return m ? { text: m[1].trim(), label: m[2].trim(), set: labelSet(m[2]) } : { text: p.trim(), label: null, set: null };
  });
  const labelled = parts.filter(p => p.label);
  if (!labelled.length || parts.length < 2) return null;                 // not a multi-shaft line
  if (labelled.some(p => !p.set)) return { kind: 'skip', why: 'a label is not a club or loft list' };
  const defaults = parts.filter(p => !p.label);
  if (defaults.length > 1) return { kind: 'skip', why: 'more than one unlabelled shaft' };
  const rs = rowSet(it.club_type, it.loft_or_number);
  if (!rs) return { kind: 'skip', why: `row loft "${it.loft_or_number || ''}" cannot be read` };
  const ownerOf = n => {
    const hits = labelled.filter(p => p.set.has(n));
    if (hits.length > 1) return { err: `club ${n} is in two labels` };
    if (hits.length === 1) return { part: hits[0] };
    return defaults[0] ? { part: defaults[0] } : { err: `club ${n} matches no label` };
  };
  const owners = [...rs.set].map(ownerOf);
  const bad = owners.find(o => o.err); if (bad) return { kind: 'skip', why: bad.err };
  const distinct = [...new Set(owners.map(o => o.part))];
  if (distinct.some(p => looksIncomplete(p.text))) return { kind: 'skip', why: `shaft name incomplete in source ("${distinct.find(p => looksIncomplete(p.text)).text}")` };
  if (distinct.length === 1) return { kind: 'reshaft', shaft: distinct[0].text };
  if (it.club_type !== 'wedge') return { kind: 'skip', why: 'an iron range spans two shafts' };
  // Split a wedge row: group its loft groups by owning shaft, keeping order.
  const rows = [];
  // One owner per loft group (two 60s are two groups but one loft number).
  rs.groups.forEach((g, i) => {
    const part = ownerOf(rs.nums[i]).part;
    const last = rows[rows.length - 1];
    if (last && last.shaft === part.text) last.loft += ', ' + g; else rows.push({ loft: g, shaft: part.text });
  });
  return { kind: 'split', rows };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function all(sb, table, sel) {
  const out = [];
  for (let last = Z; ; ) {
    const { data, error } = await sb.from(table).select(sel).gt('id', last).order('id').limit(1000);
    if (error) throw new Error(error.message);
    if (!data.length) break; out.push(...data); last = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  return out;
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const players = await all(sb, 'witb_players', 'id,slug,name');
  const bags    = (await all(sb, 'witb_bags', 'id,player_id,bag_date,is_current')).filter(b => b.is_current);
  const bagInfo = new Map(bags.map(b => [b.id, { ...b, player: players.find(p => p.id === b.player_id) }]));
  const items   = (await all(sb, 'witb_bag_items', '*')).filter(i => bagInfo.has(i.bag_id));

  const plan = [];
  for (const it of items) {
    const p = planRow(it);
    if (p) plan.push({ item: it, ...p });
    if (it.club_type === 'iron' && /degree/.test(it.loft_or_number || '') && /\bUT\b|ZXiU|\bZX U\b|Utility|\bU-?\d{3}\b/i.test(it.raw_model || '')) {
      plan.push({ item: it, kind: 'retype', to: 'utility-iron' });
    }
  }
  // Exact duplicates within a bag.
  const seen = new Map();
  for (const it of items) {
    const k = [it.bag_id, it.club_type, it.raw_brand, it.raw_model, it.loft_or_number, it.raw_shaft].join('|');
    if (seen.has(k)) plan.push({ item: it, kind: 'delete-duplicate' }); else seen.set(k, it.id);
  }

  // Report.
  const who = it => bagInfo.get(it.bag_id).player.slug;
  const fmt = (t, m, l, s) => `${t} · ${m}${l ? ` (${l})` : ''} · ${s || '—'}`;
  const md = ['# WITB current-bag cleanup — before and after', ''];
  const sections = { reshaft: 'Shaft corrected (row keeps one shaft)', split: 'Wedge row split by shaft', retype: 'Utility iron retyped', 'delete-duplicate': 'Duplicate row removed', skip: 'Left unchanged (ambiguous, needs a human)' };
  for (const [kind, title] of Object.entries(sections)) {
    const rows = plan.filter(p => p.kind === kind).sort((a, b) => who(a.item).localeCompare(who(b.item)));
    md.push(`## ${title} (${rows.length})`, '');
    for (const p of rows) {
      const it = p.item;
      md.push(`**${who(it)}** — ${it.raw_brand} ${it.raw_model}`);
      md.push(`- Before: ${fmt(it.club_type, it.raw_model, it.loft_or_number, it.raw_shaft)}`);
      if (kind === 'reshaft') md.push(`- After: ${fmt(it.club_type, it.raw_model, it.loft_or_number, p.shaft)}`);
      if (kind === 'split') p.rows.forEach((r, i) => md.push(`- After ${i + 1}: ${fmt(it.club_type, it.raw_model, r.loft, r.shaft)}`));
      if (kind === 'retype') md.push(`- After: ${fmt(p.to, it.raw_model, it.loft_or_number, it.raw_shaft)}`);
      if (kind === 'delete-duplicate') md.push('- After: removed (identical row kept)');
      if (kind === 'skip') md.push(`- Why: ${p.why}`);
      md.push('');
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'cleanup-plan.md'), md.join('\n'));
  fs.writeFileSync(path.join(OUT, 'cleanup-plan.json'), JSON.stringify(plan.map(p => ({ ...p, slug: who(p.item) })), null, 1));
  const counts = Object.fromEntries(Object.keys(sections).map(k => [k, plan.filter(p => p.kind === k).length]));
  console.log('[cleanup] plan:', JSON.stringify(counts), '| players:', new Set(plan.filter(p => p.kind !== 'skip').map(p => who(p.item))).size);
  if (!APPLY) return;

  // ── Apply ──────────────────────────────────────────────────────────────────
  const touched = plan.filter(p => p.kind !== 'skip');
  fs.writeFileSync(path.join(OUT, 'cleanup-backup.json'), JSON.stringify(touched.map(p => p.item), null, 1));
  const shaftId = async text => { const slug = inferShaftSlug(text); return slug ? upsertShaft(sb, { slug, model: text }) : null; };
  const bagsTouched = new Set();
  for (const p of touched) {
    const it = p.item; bagsTouched.add(it.bag_id);
    if (p.kind === 'reshaft') {
      const { error } = await sb.from('witb_bag_items').update({ raw_shaft: p.shaft, shaft_id: await shaftId(p.shaft) }).eq('id', it.id);
      if (error) throw new Error(`${who(it)} reshaft: ${error.message}`);
    } else if (p.kind === 'split') {
      const [first, ...rest] = p.rows;
      const { error } = await sb.from('witb_bag_items').update({ loft_or_number: first.loft, raw_shaft: first.shaft, shaft_id: await shaftId(first.shaft) }).eq('id', it.id);
      if (error) throw new Error(`${who(it)} split: ${error.message}`);
      // position is an integer column: open a gap of rest.length right after
      // this row (reading positions fresh, since an earlier split in the same
      // bag may have moved them), then insert into it.
      const { data: self } = await sb.from('witb_bag_items').select('position').eq('id', it.id).single();
      const P = self.position;
      const { data: below } = await sb.from('witb_bag_items').select('id,position').eq('bag_id', it.bag_id).gt('position', P).order('position', { ascending: false });
      for (const b of below) {
        const { error: eS } = await sb.from('witb_bag_items').update({ position: b.position + rest.length }).eq('id', b.id);
        if (eS) throw new Error(`${who(it)} shift: ${eS.message}`);
      }
      let k = 0;
      for (const r of rest) {
        const { id, ...base } = it;
        const { error: e2 } = await sb.from('witb_bag_items').insert({ ...base, loft_or_number: r.loft, raw_shaft: r.shaft, shaft_id: await shaftId(r.shaft), position: P + (++k) });
        if (e2) throw new Error(`${who(it)} split insert: ${e2.message}`);
      }
    } else if (p.kind === 'retype') {
      const { error } = await sb.from('witb_bag_items').update({ club_type: p.to }).eq('id', it.id);
      if (error) throw new Error(`${who(it)} retype: ${error.message}`);
    } else if (p.kind === 'delete-duplicate') {
      const { error } = await sb.from('witb_bag_items').delete().eq('id', it.id);
      if (error) throw new Error(`${who(it)} delete: ${error.message}`);
    }
  }
  // Renumber positions 1..n in each touched bag so inserted rows sit in order.
  for (const bagId of bagsTouched) {
    const { data } = await sb.from('witb_bag_items').select('id,position').eq('bag_id', bagId).order('position');
    for (let i = 0; i < data.length; i++) {
      if (data[i].position !== i + 1) await sb.from('witb_bag_items').update({ position: i + 1 }).eq('id', data[i].id);
    }
  }
  fs.writeFileSync(path.join(OUT, 'cleanup-slugs.txt'), [...new Set(touched.map(p => who(p.item)))].join('\n'));
  console.log(`[cleanup] applied ${touched.length} change(s) across ${bagsTouched.size} bag(s); backup in cleanup-backup.json`);
}

main().catch(e => { console.error('[cleanup]', e.message); process.exit(1); });
